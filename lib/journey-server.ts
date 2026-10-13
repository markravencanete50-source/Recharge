import { authSecurityConfiguration,requestQuota } from './auth-security';
import { boundedJson,isSameOrigin } from './auth-security-policy';
import { isNativeRequest } from './native-request-policy';
import { businessContext,businessResponse,databaseFailure,viewAsFailure } from './business-server';
import { journeyReadSchema,journeyActionSchema,operationsReadSchema } from './journey-policy';
import { operationsActionSchema, validationReason } from './operations-policy';
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
   const workId='workId' in parsed.data?parsed.data.workId:undefined;
   const result=workId?await session.client.rpc('workspace_operation_read',{target:workId})
    :await session.client.rpc(kind==='journey'?'workspace_journey_read':'workspace_operations_read',kind==='journey'?{target:parsed.data.propertyId||null}:{target_property:parsed.data.propertyId||null});
   return result.error?databaseFailure(result.error):businessResponse({data:result.data,account:session.account,mode:'live'});
  }
  const quota=await requestQuota(request,'business-user',60,60,session.account.userId);
  if(!quota.allowed){const response=businessResponse({error:'Too many updates. Please wait.'},429);response.headers.set('Retry-After',String(quota.retryAfter));return response;}
  const parsed=(kind==='journey'?journeyActionSchema:operationsActionSchema).safeParse(await boundedJson(request));
  if(!parsed.success)return businessResponse({error:validationReason(parsed.error)},400);
  const result=await session.client.rpc(kind==='journey'?'workspace_journey_action':'workspace_operations_action',{input:parsed.data});
  return result.error?databaseFailure(result.error):businessResponse({data:result.data,ok:true});
 }catch(error){return viewAsFailure(error)??businessResponse({error:'The property journey is temporarily unavailable'},503);}
}
