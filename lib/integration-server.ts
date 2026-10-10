import { env } from 'cloudflare:workers';
import { businessContext,businessResponse,databaseFailure,viewAsFailure } from './business-server';
import { authSecurityConfiguration,requestQuota,securityRpc } from './auth-security';
import { boundedJson,isSameOrigin } from './auth-security-policy';
import { isNativeRequest } from './native-request-policy';
import { integrationActionSchema,integrationConfiguration,IntegrationSettings,DeliveryJob,ProviderFailure,normalizeHostawayReservation } from './integration-policy';
import { deliverNotification } from './integration-providers';
import { cancelHostawayReservation,hostawayCancelErrorMessage,isHostawayConfigured,listHostawayReservations } from './hostaway';
import { cancelElsewhereMessage,CANCEL_ON_CHANNEL } from './hostaway-sync-policy';
import { hostawaySyncConfigured,runHostawaySync } from './hostaway-sync';

export function integrationSettings():IntegrationSettings {
  return {...process.env,...env as unknown as IntegrationSettings};
}
export async function dispatchNotifications(settings=integrationSettings()) {
  const config=integrationConfiguration(settings);
  // Missing services do not claim jobs or consume attempts.
  if(!config.email&&!config.push)return {mode:'unconfigured',processed:0};
  const jobs=await securityRpc<DeliveryJob[]>('integration_claim_notifications',{email_enabled:config.email,push_enabled:config.push});
  const summary={mode:'configured',processed:0,accepted:0,delivered:0,pending:0,failed:0};
  for(const job of jobs) {
    if(!await securityRpc<boolean>('integration_check_notification',{target:job.id,claim:job.lease}))continue;
    let outcome:string,provider:string|null=null;
    try {const result=await deliverNotification(settings,job);outcome=result.state;provider=result.providerId||null;}
    catch(error){outcome=error instanceof ProviderFailure?error.code:'uncertain';}
    // Lease fencing prevents a late worker from overwriting a subsequent receipt check.
    const saved=await securityRpc<boolean>('integration_finish_notification',{target:job.id,claim:job.lease,outcome,provider});
    if(saved){summary.processed++;if(outcome==='accepted'||outcome==='delivered'||outcome==='pending')summary[outcome]++;else summary.failed++;}
  }
  return summary;
}
export async function integrationRoute(request:Request,native=false) {
  if(request.method==='POST'&&(native?!isNativeRequest(request):!isSameOrigin(request,authSecurityConfiguration()?.origin)))return businessResponse({error:'Invalid request origin'},403);
  try {
    const session=await businessContext(request,native);
    if(!session)return businessResponse({error:'Sign in required'},401);
    if(session.account.status!=='active')return businessResponse({error:'Active workspace access required'},403);
    const settings=integrationSettings(),configuration=integrationConfiguration(settings);
    if(request.method==='GET') {
      // The delivery status is for admins; admins and the Stays team also see the Hostaway sync.
      const admin=['admin','super_admin'].includes(session.account.role);
      const result=admin?await session.client.rpc('workspace_integration_status'):{data:null,error:null};
      if(result.error)return databaseFailure(result.error);
      const hostaway=hostawaySyncConfigured()&&(admin||session.account.role==='stays')?await session.client.rpc('workspace_hostaway_status'):null;
      // Admins also see double bookings, to cancel one of each.
      const doubles=hostaway&&!hostaway.error&&admin?await session.client.rpc('workspace_hostaway_double_bookings'):null;
      return businessResponse({configuration,data:result.data,hostaway:hostaway&&!hostaway.error?{configured:hostawaySyncConfigured(),...hostaway.data,doubleBookings:doubles&&!doubles.error?doubles.data:[]}:null});
    }
    const quota=await requestQuota(request,'integrations-user',6,60,session.account.userId);
    if(!quota.allowed){const response=businessResponse({error:'Too many integration requests'},429);response.headers.set('Retry-After',String(quota.retryAfter||60));return response;}
    const parsed=integrationActionSchema.safeParse(await boundedJson(request));
    if(!parsed.success)return businessResponse({error:'Check the integration request'},400);
    if(parsed.data.action==='dispatchNotifications') {
      if(!['admin','super_admin'].includes(session.account.role))return businessResponse({error:'Admin access required'},403);
      return businessResponse(await dispatchNotifications(settings));
    }
    if(parsed.data.action==='syncHostaway') {
      if(!['admin','super_admin'].includes(session.account.role))return businessResponse({error:'Admin access required'},403);
      if(!hostawaySyncConfigured())return businessResponse({error:'The Hostaway sync is switched off',mode:'unconfigured'},503);
      try {return businessResponse(await runHostawaySync('manual'));}
      catch {return businessResponse({error:'Hostaway could not be synced just now. The error is shown on the sync card.'},502);}
    }
    if(parsed.data.action==='cancelHostawayReservation') {
      if(!['admin','super_admin'].includes(session.account.role))return businessResponse({error:'Admin access required'},403);
      if(!isHostawayConfigured())return businessResponse({error:'Hostaway is not connected',mode:'unconfigured'},503);
      const check=await session.client.rpc('workspace_hostaway_cancel_check',{target:parsed.data.reservationId});
      if(check.error)return databaseFailure(check.error);
      const stay=check.data as {hostawayId:string;channel:string|null;canCancelInHostaway:boolean};
      // Airbnb and Booking.com only accept cancellations on their own sites.
      if(!stay.canCancelInHostaway)return businessResponse({error:cancelElsewhereMessage(stay.channel),cancelOn:CANCEL_ON_CHANNEL[stay.channel??'other']??CANCEL_ON_CHANNEL.other},409);
      try {await cancelHostawayReservation(stay.hostawayId);}
      catch(error){return businessResponse({error:hostawayCancelErrorMessage(error)},502);}
      // Hostaway has cancelled it: record that now (the stay and its unstarted clean), not at the next sync.
      try {return businessResponse({ok:true,...await securityRpc<{cancelledCleans:number}>('integration_hostaway_cancelled',{target:parsed.data.reservationId,actor:session.account.userId})});}
      catch {return businessResponse({ok:true,cancelledCleans:0,note:'Cancelled in Hostaway. Recharge will show it at the next sync.'});}
    }
    if(!['admin','super_admin','stays'].includes(session.account.role)||!session.account.modules.includes('direct-bookings'))return businessResponse({error:'Reservation import access required'},403);
    if(!configuration.reservations)return businessResponse({error:'Hostaway import is awaiting configuration',mode:'unconfigured'},503);
    const scoped=await session.client.rpc('workspace_portfolio_read',{section:'portfolio',target_property:null,start_on:null,end_on:null});
    if(scoped.error)return databaseFailure(scoped.error);
    const propertyId=parsed.data.propertyId;
    const property=scoped.data?.properties?.find((p:{id:string})=>p.id===propertyId);
    if(!property)return businessResponse({error:'Property access denied'},403);
    if(!property.hostawayListingId)return businessResponse({error:'Map this property to its Hostaway listing first'},409);
    const rows=await listHostawayReservations(property.hostawayListingId);
    const summary={imported:0,unchanged:0,failed:0,nextOffset:null as number|null,bounded:true};
    // Ten records per run keep database quotas and Worker duration bounded. Never infer cancellation from an absent row.
    const offset=parsed.data.offset;
    for(const row of rows.slice(offset,offset+10)) {
      try {
        const value=normalizeHostawayReservation(row,property.hostawayListingId);
        const result=await session.client.rpc('workspace_import_reservation',{input:{propertyId:property.id,listingId:property.hostawayListingId,...value}});
        if(result.error)summary.failed++;else if(result.data.changed)summary.imported++;else summary.unchanged++;
      } catch {summary.failed++;}
    }
    if(rows.length>offset+10)summary.nextOffset=offset+10;
    return businessResponse(summary);
  } catch (error) {return viewAsFailure(error)??businessResponse({error:'The integration connection is temporarily unavailable'},503);}
}
