import { businessContext,businessResponse,databaseFailure,viewAsFailure } from './business-server';
import { portfolioReadSchema,portfolioActionSchema } from './portfolio-policy';
import { weeklyReportCsv } from './weekly-report';
import { authSecurityConfiguration,requestQuota } from './auth-security';
import { boundedJson,isSameOrigin,securityHeaders } from './auth-security-policy';
import { isNativeRequest } from './native-request-policy';
export async function portfolioRoute(request:Request,native=false){
 if(request.method==='POST'&&(native?!isNativeRequest(request):!isSameOrigin(request,authSecurityConfiguration()?.origin)))return businessResponse({error:'Invalid request origin'},403);
 try{
  const session=await businessContext(request,native);
  if(!session)return businessResponse({error:'Sign in required'},401);
  if(session.account.status!=='active')return businessResponse({error:'Active workspace access required'},403);
  if(request.method==='GET'){
   const parsed=portfolioReadSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
   if(!parsed.success)return businessResponse({error:parsed.error.issues[0]?.message||'Check the report filter'},400);
   const q=parsed.data,result=await session.client.rpc('workspace_portfolio_read',{section:q.section,target_property:q.propertyId||null,start_on:q.from||null,end_on:q.to||null});
   if(result.error)return databaseFailure(result.error);
   if(q.download){return new Response(weeklyReportCsv(result.data),{headers:{...securityHeaders,Vary:'Cookie, Authorization','Content-Type':'text/csv;charset=utf-8','Content-Disposition':`attachment; filename="recharge-property-report-${q.from}-${q.to}.csv"`}});}
   return businessResponse({data:result.data,account:session.account,mode:'live'});
  }
  const quota=await requestQuota(request,'business-user',60,60,session.account.userId);
  if(!quota.allowed){const response=businessResponse({error:'Too many updates. Please wait.'},429);response.headers.set('Retry-After',String(quota.retryAfter));return response;}
  const parsed=portfolioActionSchema.safeParse(await boundedJson(request));
  if(!parsed.success)return businessResponse({error:'Check the property details'},400);
  const result=await session.client.rpc('workspace_portfolio_action',{input:parsed.data});return result.error?databaseFailure(result.error):businessResponse({data:result.data,ok:true});
 }catch(error){return viewAsFailure(error)??businessResponse({error:'The property portfolio is temporarily unavailable'},503);}
}
