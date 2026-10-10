import { createClient } from '@supabase/supabase-js';
import { DeliveryJob, DeliveryResult, IntegrationSettings, ProviderFailure,MAX_PHOTO_BYTES,photoFormat } from './integration-policy';
import { noticeCopy } from './notice-copy';

async function jsonRequest(url:string,init:RequestInit,readOnly=false):Promise<Record<string,unknown>> {
  let response:Response;
  try { response=await fetch(url,{...init,redirect:'manual',signal:AbortSignal.timeout(15_000)}); }
  catch { throw new ProviderFailure(init.method==='POST'&&!readOnly?'uncertain':'retryable'); }
  if (!response.ok) throw new ProviderFailure(response.status===429?'retryable':response.status>=500?(init.method==='POST'&&!readOnly?'uncertain':'retryable'):'rejected');
  try { return await response.json(); } catch { throw new ProviderFailure(init.method==='POST'&&!readOnly?'uncertain':'rejected'); }
}
export async function cloudinarySignature(parameters:Record<string,string>,secret:string,algorithm:'SHA-256'|'SHA-1'='SHA-256') {
  const text=Object.entries(parameters).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('&')+secret;
  const digest=await crypto.subtle.digest(algorithm,new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function uploadPrivatePhoto(settings:IntegrationSettings,publicId:string,bytes:Uint8Array,format:string) {
  // Resolve a previous upload if the provider succeeded but the database commit/response failed.
  // This fixed-host authenticated lookup makes retrying the same intent safe with overwrite=false.
  let existing:Response;
  try {existing=await fetch(`https://api.cloudinary.com/v1_1/${settings.CLOUDINARY_CLOUD_NAME}/resources/image/authenticated/${encodeURIComponent(publicId)}`,{headers:{Authorization:`Basic ${btoa(`${settings.CLOUDINARY_API_KEY}:${settings.CLOUDINARY_API_SECRET}`)}`},redirect:'manual',signal:AbortSignal.timeout(15_000)});}
  catch {throw new ProviderFailure('retryable');}
  if(existing.ok) {
    const result=await existing.json() as Record<string,unknown>;
    if(!result||typeof result!=='object')throw new ProviderFailure('rejected');
    if(result.public_id!==publicId||result.resource_type!=='image'||result.type!=='authenticated'||typeof result.asset_id!=='string'||!Number.isSafeInteger(result.version)||result.format!==format||!Number.isSafeInteger(result.bytes)||result.bytes!==bytes.length)throw new ProviderFailure('rejected');
    return {assetId:result.asset_id,publicId,version:Number(result.version),format,bytes:Number(result.bytes)};
  }
  if(existing.status!==404)throw new ProviderFailure(existing.status===429||existing.status>=500?'retryable':'rejected');
  const parameters={public_id:publicId,timestamp:String(Math.floor(Date.now()/1000)),type:'authenticated',overwrite:'false'};
  const form=new FormData();
  for(const [key,value] of Object.entries(parameters))form.set(key,value);
  form.set('api_key',settings.CLOUDINARY_API_KEY!);
  form.set('signature',await cloudinarySignature(parameters,settings.CLOUDINARY_API_SECRET!));
  form.set('file',new Blob([new Uint8Array(bytes)],{type:`image/${format==='jpg'?'jpeg':format}`}),`photo.${format}`);
  // No client-supplied URL or transformation parameters; uploads are authenticated assets.
  const result=await jsonRequest(`https://api.cloudinary.com/v1_1/${settings.CLOUDINARY_CLOUD_NAME}/image/upload`,{method:'POST',body:form});
  if(result.public_id!==publicId||result.resource_type!=='image'||result.type!=='authenticated'||typeof result.asset_id!=='string'||!Number.isSafeInteger(result.version)||result.format!==format||result.bytes!==bytes.length)throw new ProviderFailure('rejected');
  const signature=await cloudinarySignature({public_id:publicId,version:String(result.version)},settings.CLOUDINARY_API_SECRET!,String(result.signature).length===40?'SHA-1':'SHA-256');
  if(result.signature!==signature)throw new ProviderFailure('rejected');
  return {assetId:result.asset_id,publicId,version:Number(result.version),format,bytes:Number(result.bytes)};
}
export async function deliverNotification(settings:IntegrationSettings,job:DeliveryJob):Promise<DeliveryResult> {
  // Each kind of update has its own wording (lib/notice-copy.ts). It never includes private property
  // names, addresses, bank details, access codes or job notes.
  const { title, message: text } = noticeCopy(job.eventType);
  if(job.channel==='email') {
    const headers={Authorization:`Bearer ${settings.RESEND_API_KEY}`,'Content-Type':'application/json'};
    if(job.state==='accepted') {
      const result=await jsonRequest(`https://api.resend.com/emails/${encodeURIComponent(job.providerId!)}`,{headers});
      if(result.id!==job.providerId)throw new ProviderFailure('rejected');
      if(result.last_event==='delivered')return {state:'delivered'};
      if(['bounced','complained','failed','canceled'].includes(String(result.last_event)))throw new ProviderFailure('rejected');
      return {state:'pending'};
    }
    // Resend's idempotency window is 24 hours. An expired unknown send needs human review.
    if(Date.now()-Date.parse(job.createdAt)>23*3600000)throw new ProviderFailure('uncertain');
    const result=await jsonRequest('https://api.resend.com/emails',{method:'POST',headers:{...headers,'Idempotency-Key':`recharge-notification/${job.id}`},body:JSON.stringify({from:settings.NOTIFICATION_FROM_EMAIL,to:[job.destination],subject:title,text})});
    if(typeof result.id!=='string'||!result.id)throw new ProviderFailure('uncertain');
    return {state:'accepted',providerId:result.id};
  }
  const headers={Authorization:`Bearer ${settings.EXPO_ACCESS_TOKEN}`,'Content-Type':'application/json'};
  const result=await jsonRequest(`https://exp.host/--/api/v2/push/${job.state==='accepted'?'getReceipts':'send'}`,{method:'POST',headers,body:JSON.stringify(job.state==='accepted'?{ids:[job.providerId]}:{to:job.destination,title:'Recharge',body:title,data:{screen:'activity'}})},job.state==='accepted');
  const data=(job.state==='accepted'?(result.data as Record<string,unknown>)?.[job.providerId!]:result.data) as Record<string,unknown>|undefined;
  if(job.state==='accepted'&&!data)return {state:'pending'};
  if(data?.status==='ok')return job.state==='accepted'?{state:'delivered'}:typeof data.id==='string'?{state:'accepted',providerId:data.id}:Promise.reject(new ProviderFailure('uncertain'));
  const error=(data?.details as Record<string,unknown>)?.error;
  throw new ProviderFailure(error==='DeviceNotRegistered'?'device_removed':error==='MessageRateExceeded'?'retryable':'rejected');
}
// A one-off email the team wrote (Client Enquiries), sent now. The key makes a retried send
// the same email.
export async function sendEmail(settings:IntegrationSettings,email:{to:string;subject:string;text:string;html:string;idempotencyKey:string}) {
  const result=await jsonRequest('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${settings.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':email.idempotencyKey},
    body:JSON.stringify({from:settings.NOTIFICATION_FROM_EMAIL,to:[email.to],subject:email.subject,text:email.text,html:email.html})});
  if(typeof result.id!=='string'||!result.id)throw new ProviderFailure('uncertain');
  return result.id;
}
export async function downloadPrivatePhoto(settings:IntegrationSettings,asset:{providerAssetId:string;format:string;bytes:number}) {
  const now=Math.floor(Date.now()/1000);
  const parameters={asset_id:asset.providerAssetId,timestamp:String(now),expires_at:String(now+60)};
  const form=new URLSearchParams({...parameters,api_key:settings.CLOUDINARY_API_KEY!,signature:await cloudinarySignature(parameters,settings.CLOUDINARY_API_SECRET!)});
  const response=await fetch(`https://api.cloudinary.com/v1_1/${settings.CLOUDINARY_CLOUD_NAME}/asset/download`,{method:'POST',body:form,redirect:'manual',signal:AbortSignal.timeout(15_000)});
  if(!response.ok||!response.body)throw new ProviderFailure('rejected');
  const reader=response.body.getReader();let total=0;const chunks:Uint8Array[]=[];
  while(true){const next=await reader.read();if(next.done)break;total+=next.value.length;if(total>MAX_PHOTO_BYTES){await reader.cancel();throw new ProviderFailure('rejected');}chunks.push(next.value);}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  if(total!==asset.bytes||photoFormat(bytes)!==asset.format)throw new ProviderFailure('rejected');
  return bytes;
}

// Supabase Storage: a private bucket only the backend can read or write (no storage policies are
// granted to users). Each upload intent has its own fixed path, so a retry finds the earlier copy.
export const MEDIA_BUCKET = 'workspace-media';
export const STORAGE_PREFIX = 'storage:';
function storageBucket(settings:IntegrationSettings) {
  const client = createClient(settings.SUPABASE_URL!, settings.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return client.storage.from(MEDIA_BUCKET);
}
const storagePath = (publicId:string, format:string) => {
  if (!/^recharge\/[0-9a-f-]{36}$/.test(publicId) || !['jpg','png','webp'].includes(format)) throw new ProviderFailure('rejected');
  return `${publicId}.${format}`;
};
async function readStorage(settings:IntegrationSettings, path:string) {
  const result = await storageBucket(settings).download(path);
  if (result.error || !result.data) throw new ProviderFailure('retryable');
  const bytes = new Uint8Array(await result.data.arrayBuffer());
  if (bytes.length > MAX_PHOTO_BYTES) throw new ProviderFailure('rejected');
  return bytes;
}
export async function uploadStoragePhoto(settings:IntegrationSettings,publicId:string,bytes:Uint8Array,format:string) {
  const path = storagePath(publicId, format);
  const asset = { assetId: STORAGE_PREFIX + path, publicId, version: 1, format, bytes: bytes.length };
  const result = await storageBucket(settings).upload(path, bytes, { contentType: `image/${format==='jpg'?'jpeg':format}`, upsert: false, cacheControl: 'private, max-age=0' });
  if (!result.error) return asset;
  // Already there from an earlier attempt: accept it only if it is the same photo.
  const existing = await readStorage(settings, path).catch(() => null);
  if (existing && existing.length === bytes.length && existing.every((b, i) => b === bytes[i])) return asset;
  throw new ProviderFailure('retryable');
}
export async function downloadStoragePhoto(settings:IntegrationSettings,asset:{providerAssetId:string;format:string;bytes:number}) {
  const path = asset.providerAssetId.slice(STORAGE_PREFIX.length);
  if (!/^recharge\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path)) throw new ProviderFailure('rejected');
  const bytes = await readStorage(settings, path);
  if (bytes.length !== asset.bytes || photoFormat(bytes) !== asset.format) throw new ProviderFailure('rejected');
  return bytes;
}
