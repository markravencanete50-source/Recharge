import { z } from 'zod';
import { businessContext,businessResponse,databaseFailure } from './business-server';
import { authSecurityConfiguration,requestQuota,securityRpc } from './auth-security';
import { isSameOrigin,securityHeaders } from './auth-security-policy';
import { isNativeRequest } from './native-request-policy';
import { integrationConfiguration,MAX_PHOTO_BYTES,mediaInputSchema,photoFormat } from './integration-policy';
import { uploadPrivatePhoto,downloadPrivatePhoto,uploadStoragePhoto,downloadStoragePhoto,STORAGE_PREFIX } from './integration-providers';
import { integrationSettings } from './integration-server';

export async function mediaRoute(request:Request,native=false) {
  if(request.method==='POST'&&(native?!isNativeRequest(request):!isSameOrigin(request,authSecurityConfiguration()?.origin)))return businessResponse({error:'Invalid request origin'},403);
  try {
    const session=await businessContext(request,native);
    if(!session)return businessResponse({error:'Sign in required'},401);
    if(session.account.status!=='active')return businessResponse({error:'Active workspace access required'},403);
    if(request.method==='GET') {
      const parsed=z.union([z.object({workId:z.string().uuid()}).strict(),z.object({assetId:z.string().uuid()}).strict()]).safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if(!parsed.success)return businessResponse({error:'Choose a work item'},400);
      if('assetId' in parsed.data) {
        // A signed-in person can view photos freely, but not pull them without limit.
        const reads=await requestQuota(request,'media-read-user',240,60,session.account.userId);
        if(!reads.allowed){const response=businessResponse({error:'Too many photo requests. Please wait.'},429);response.headers.set('Retry-After',String(reads.retryAfter||60));return response;}
        const result=await session.client.rpc('workspace_media_asset',{target_asset:parsed.data.assetId});
        if(result.error)return databaseFailure(result.error);
        const settings=integrationSettings();if(!integrationConfiguration(settings).media)return businessResponse({error:'Photo service is awaiting configuration'},503);
        const bytes=String(result.data.providerAssetId).startsWith(STORAGE_PREFIX)?await downloadStoragePhoto(settings,result.data):await downloadPrivatePhoto(settings,result.data);
        return new Response(bytes,{headers:{...securityHeaders,Vary:'Cookie, Authorization','Cache-Control':'private, max-age=3600','Content-Type':`image/${result.data.format==='jpg'?'jpeg':result.data.format}`,'Content-Disposition':`inline; filename="recharge-photo.${result.data.format}"`}});
      }
      const result=await session.client.rpc('workspace_media_read',{target_work:parsed.data.workId});
      return result.error?databaseFailure(result.error):businessResponse({data:result.data,uploadsEnabled:integrationConfiguration(integrationSettings()).media});
    }
    const settings=integrationSettings();
    if(!integrationConfiguration(settings).media)return businessResponse({error:'Photo uploads are awaiting configuration',mode:'unconfigured'},503);
    const quota=await requestQuota(request,'media-user',10,60,session.account.userId);
    if(!quota.allowed){const response=businessResponse({error:'Too many uploads. Please wait.'},429);response.headers.set('Retry-After',String(quota.retryAfter||60));return response;}
    if(!request.headers.get('Content-Type')?.startsWith('multipart/form-data;'))return businessResponse({error:'Upload a photo file'},400);
    // Stream bound works even when a client omits or forges Content-Length.
    const reader=request.body?.getReader();if(!reader)return businessResponse({error:'Photo file required'},400);
    let size=0;const chunks:Uint8Array[]=[];
    while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>MAX_PHOTO_BYTES+65536){await reader.cancel();return businessResponse({error:'Photo must be no larger than 8 MB'},413);}chunks.push(next.value);}
    const body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
    const form=await new Response(body,{headers:{'Content-Type':request.headers.get('Content-Type')!}}).formData();
    if([...form.keys()].some(k=>!['requestId','workId','expenseId','purpose','checklistItem','photo'].includes(k))||[...form.keys()].some(k=>form.getAll(k).length!==1))return businessResponse({error:'Unexpected upload fields'},400);
    const parsed=mediaInputSchema.safeParse({requestId:form.get('requestId'),workId:form.get('workId')??undefined,expenseId:form.get('expenseId')??undefined,purpose:form.get('purpose'),checklistItem:form.get('checklistItem')??undefined});
    const photo=form.get('photo');if(!parsed.success||!(photo instanceof Blob))return businessResponse({error:'Check the photo and work details'},400);
    const bytes=new Uint8Array(await photo.arrayBuffer()),format=photoFormat(bytes);
    if(!format)return businessResponse({error:'Choose a JPEG, PNG or WebP photo up to 8 MB'},400);
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
    const prepared=await session.client.rpc('workspace_prepare_upload',{input:{...parsed.data,contentHash:hash}});
    if(prepared.error)return databaseFailure(prepared.error);
    if(prepared.data.evidenceId)return businessResponse({id:prepared.data.evidenceId,verified:true});
    const asset=integrationConfiguration(settings).mediaProvider==='cloudinary'?await uploadPrivatePhoto(settings,prepared.data.publicId,bytes,format):await uploadStoragePhoto(settings,prepared.data.publicId,bytes,format);
    const evidence=await securityRpc<string>('integration_commit_upload',{target_intent:prepared.data.id,asset});
    return businessResponse({id:evidence,verified:true});
  } catch {return businessResponse({error:'Photo upload could not be verified. Retry with the same request, or contact your manager.'},503);}
}
