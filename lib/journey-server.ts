import { authSecurityConfiguration,requestQuota } from './auth-security';
import { boundedJson,isSameOrigin } from './auth-security-policy';
import { isNativeRequest } from './native-request-policy';
import { businessContext,businessResponse,databaseFailure,viewAsFailure } from './business-server';
import { DECLINE_REASON_MESSAGE,declineReasonMissing,estimateRateIssues,journeyReadSchema,journeyActionSchema,journeyValidationField,journeyValidationReason,operationsReadSchema } from './journey-policy';
import { operationsActionSchema, validationReason } from './operations-policy';
import { CONTRACTORS_READ,LIMITS_ACTION,LIMITS_READ,repairLimitActionSchema } from './repair-contractors';
import { CLEANER_REPAIRS_READ } from './cleaner-repairs';
// Two bytes a character in the worst case for the longest agreement, with room for the rest of the request.
const JOURNEY_BODY_LIMIT=600_000;
export const journeyRoute=(request:Request,native=false)=>workflowRoute(request,native,'journey');
export const operationsRoute=(request:Request,native=false)=>workflowRoute(request,native,'operations');
async function workflowRoute(request:Request,native:boolean,kind:'journey'|'operations'){
 const config=authSecurityConfiguration();
 if(request.method==='POST'&&(native?!isNativeRequest(request):!isSameOrigin(request,config?.origin)))return businessResponse({error:'Invalid request origin'},403);
 try{
  const session=await businessContext(request,native);
  if(!session)return businessResponse({error:'Sign in required'},401);
  if(session.account.status!=='active')return businessResponse({error:'Active workspace access required'},403);
  if(request.method==='GET'){
   const parsed=(kind==='journey'?journeyReadSchema:operationsReadSchema).safeParse(Object.fromEntries(new URL(request.url).searchParams));
   if(!parsed.success)return businessResponse({error:'Check your property filter'},400);
   if('section' in parsed.data){
    // Repairs with contractors (lib/repair-contractors.ts): the contractors for a property, or every owner's repair limits.
    // A cleaner's own repairs (lib/cleaner-repairs.ts).
    const result=parsed.data.section===LIMITS_READ.section?await session.client.rpc(LIMITS_READ.rpc)
     :parsed.data.section===CLEANER_REPAIRS_READ.section?await session.client.rpc(CLEANER_REPAIRS_READ.rpc)
     :await session.client.rpc(CONTRACTORS_READ.rpc,{[CONTRACTORS_READ.arg]:parsed.data.propertyId});
    return result.error?databaseFailure(result.error):businessResponse({data:result.data,account:session.account,mode:'live'});
   }
   const workId='workId' in parsed.data?parsed.data.workId:undefined;
   const result=workId?await session.client.rpc('workspace_operation_read',{target:workId})
    :await session.client.rpc(kind==='journey'?'workspace_journey_read':'workspace_operations_read',kind==='journey'?{target:parsed.data.propertyId||null}:{target_property:parsed.data.propertyId||null});
   return result.error?databaseFailure(result.error):businessResponse({data:result.data,account:session.account,mode:'live'});
  }
  const quota=await requestQuota(request,'business-user',60,60,session.account.userId);
  if(!quota.allowed){const response=businessResponse({error:'Too many updates. Please wait.'},429);response.headers.set('Retry-After',String(quota.retryAfter));return response;}
  // A journey can carry a whole agreement (up to 200,000 characters) or a drawn signature (migration 20261024100000).
  const body=await boundedJson(request,kind==='journey'?JOURNEY_BODY_LIMIT:16_384);
  // Limit Changer: a property's repair limit has its own database call (super admins only; the database checks).
  if(kind==='operations'&&body&&typeof body==='object'&&(body as {action?:unknown}).action===LIMITS_ACTION.action){
   const limit=repairLimitActionSchema.safeParse(body);
   if(!limit.success)return businessResponse({error:'Check the limit and the properties'},400);
   const result=await session.client.rpc(LIMITS_ACTION.rpc,{[LIMITS_ACTION.arg]:limit.data});
   return result.error?databaseFailure(result.error):businessResponse({data:result.data,ok:true});
  }
  const parsed=(kind==='journey'?journeyActionSchema:operationsActionSchema).safeParse(body);
  // A journey refusal names its field too (`field`), so the form can show the message next to it.
  if(!parsed.success)return businessResponse({error:kind==='journey'?journeyValidationReason(parsed.error):validationReason(parsed.error),...(kind==='journey'?{field:journeyValidationField(parsed.error)}:{})},400);
  if(kind==='journey'&&parsed.data.action==='publishEstimate'){const issue=estimateRateIssues(parsed.data)[0];if(issue)return businessResponse({error:issue.message,field:issue.field},400);}
  if(kind==='journey'&&parsed.data.action==='decideEstimate'&&declineReasonMissing(parsed.data))return businessResponse({error:DECLINE_REASON_MESSAGE,field:'feedback'},400);
  const result=await session.client.rpc(kind==='journey'?'workspace_journey_action':'workspace_operations_action',{input:parsed.data});
  if(result.error)return databaseFailure(result.error);
  // A published estimate without an owner account is emailed to the enquiry with a private link (migration 20261019520000).
  // Loaded only here, so other journey requests never load the email sender.
  if(kind==='journey'&&parsed.data.action==='publishEstimate'){const {emailPublishedEstimate}=await import('./estimate-link-server');return businessResponse({data:await emailPublishedEstimate(session,parsed.data.requestId,result.data),ok:true});}
  return businessResponse({data:result.data,ok:true});
 }catch(error){return viewAsFailure(error)??businessResponse({error:'The property journey is temporarily unavailable'},503);}
}
