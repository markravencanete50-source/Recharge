import test,{after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false}});
const policy=await vite.ssrLoadModule('/lib/integration-policy.ts');
const {cloudinarySignature,uploadPrivatePhoto,deliverNotification,downloadPrivatePhoto,uploadStoragePhoto,downloadStoragePhoto}=await vite.ssrLoadModule('/lib/integration-providers.ts');
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});after(()=>vite.close());
const settings={CLOUDINARY_CLOUD_NAME:'test',CLOUDINARY_API_KEY:'test-key',CLOUDINARY_API_SECRET:'test-secret',RESEND_API_KEY:'test-resend',NOTIFICATION_FROM_EMAIL:'updates@example.com',EXPO_ACCESS_TOKEN:'test-push'};
const job={id:'test-id',lease:'test-lease',channel:'email',destination:'owner@example.com',state:'queued',providerId:null,createdAt:new Date().toISOString()};
test('provider credentials alone do not enable services; no secrets in configuration report',()=>{
 assert.deepEqual(policy.integrationConfiguration(settings),{media:false,mediaProvider:null,email:false,push:false,reservations:false});
 const status=policy.integrationConfiguration({...settings,MEDIA_UPLOADS_ENABLED:'true',NOTIFICATION_EMAIL_ENABLED:'true',NOTIFICATION_PUSH_ENABLED:'true'});
 assert.deepEqual(status,{media:true,mediaProvider:'cloudinary',email:true,push:true,reservations:false});assert.equal(JSON.stringify(status).includes('test-secret'),false);
 assert.equal(policy.integrationConfiguration({...settings,MEDIA_UPLOADS_ENABLED:'true',CLOUDINARY_CLOUD_NAME:'evil/../../host'}).media,false);
 // Without Cloudinary, photos use the project's own private storage bucket.
 const storage={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'};
 assert.equal(policy.integrationConfiguration(storage).mediaProvider,'storage');
 assert.equal(policy.integrationConfiguration({...storage,MEDIA_STORAGE:'off'}).media,false);
 assert.equal(policy.integrationConfiguration({...storage,SUPABASE_SECRET_KEY:'eyJ-old-key'}).media,false);
 assert.equal(policy.integrationConfiguration({...storage,SUPABASE_URL:'http://example.supabase.co'}).media,false);
});
test('photo validation checks file bytes, rejects SVG/HTML and enforces size limits',()=>{
 assert.equal(policy.photoFormat(new Uint8Array([255,216,255,...Array(13).fill(0)])),'jpg');
 assert.equal(policy.photoFormat(new Uint8Array([137,80,78,71,13,10,26,10,...Array(13).fill(0)])),'png');
 for(const text of ['<svg><script>bad</script></svg>','<html>bad file</html>'])assert.equal(policy.photoFormat(new TextEncoder().encode(text)),null);
 const tooLarge=new Uint8Array(policy.MAX_PHOTO_BYTES+1);tooLarge.set([255,216,255]);assert.equal(policy.photoFormat(tooLarge),null);
});
test('Hostaway normalisation fails closed for unknown statuses or wrong properties',()=>{
 const row={id:'1',listingId:'7',arrivalDate:'2026-10-06',departureDate:'2026-10-08',status:'modified'};
 assert.equal(policy.normalizeHostawayReservation(row,'7').status,'confirmed');
 assert.equal(policy.normalizeHostawayReservation({...row,status:'canceled'},'7').status,'cancelled');
 assert.throws(()=>policy.normalizeHostawayReservation({...row,status:'unknown'},'7'));
 assert.throws(()=>policy.normalizeHostawayReservation(row,'other'));
});
test('Cloudinary request uses a fixed private asset, verifies signed metadata and retries existing uploads',async()=>{
 const calls=[];const bytes=new Uint8Array([255,216,255,...Array(13).fill(0)]);
 const result={public_id:'recharge/test',resource_type:'image',type:'authenticated',asset_id:'asset-test',version:1,format:'jpg',bytes:bytes.length};
 result.signature=await cloudinarySignature({public_id:result.public_id,version:'1'},settings.CLOUDINARY_API_SECRET,'SHA-1');
 globalThis.fetch=async(url,init)=>{calls.push({url,init});return init.method==='POST'?Response.json(result):new Response('',{status:404});};
 const first=await uploadPrivatePhoto(settings,result.public_id,bytes,'jpg');assert.equal(first.assetId,'asset-test');
 const post=calls.find(c=>c.init.method==='POST');assert.equal(post.init.body.get('type'),'authenticated');assert.equal(post.init.body.get('overwrite'),'false');assert.equal(post.init.body.has('api_secret'),false);assert.equal(post.init.redirect,'manual');
 globalThis.fetch=async()=>Response.json(result);assert.deepEqual(await uploadPrivatePhoto(settings,result.public_id,bytes,'jpg'),first);
 globalThis.fetch=async(url,init)=>init.method==='POST'?Response.json({...result,signature:'forged'}):new Response('',{status:404});
 await assert.rejects(uploadPrivatePhoto(settings,result.public_id,bytes,'jpg'),/rejected/);
 // A redirect is never followed: it fails like any other unexpected answer.
 globalThis.fetch=async()=>new Response('',{status:302,headers:{location:'https://example.invalid/'}});
 await assert.rejects(uploadPrivatePhoto(settings,result.public_id,bytes,'jpg'),/rejected/);
});
test('email uses a stable idempotency key and acceptance does not imply delivery',async()=>{
 const calls=[];globalThis.fetch=async(url,init)=>{calls.push({url,init});return Response.json({id:'receipt',last_event:'sent'});};
 assert.deepEqual(await deliverNotification(settings,job),{state:'accepted',providerId:'receipt'});
 assert.equal(calls[0].init.headers['Idempotency-Key'],'recharge-notification/test-id');
 const payload=JSON.parse(calls[0].init.body);assert.match(payload.text,/Sign in/);assert.doesNotMatch(payload.text,/property|code|bank|guest/i);
 // Every email carries the Recharge logo (Lee, 14 October); the HTML part is the same text with the logo on top, nothing more.
 assert.match(payload.html,/^<div[^>]*><div[^>]*><img src="https:\/\/app\.rechargegroup\.co\.uk\/recharge-email-logo\.png" alt="Recharge" width="180" height="50"/);assert.doesNotMatch(payload.html.replace(/<[^>]+>/g,' '),/property|code|bank|guest/i);assert.ok(payload.html.includes('Sign in'));
 assert.deepEqual(await deliverNotification(settings,{...job,state:'accepted',providerId:'receipt'}),{state:'pending'});
 globalThis.fetch=async()=>Response.json({id:'receipt',last_event:'delivered'});
 assert.deepEqual(await deliverNotification(settings,{...job,state:'accepted',providerId:'receipt'}),{state:'delivered'});
});
test('private photo viewing signs a short-lived download on the server and refuses substituted data',async()=>{
 const bytes=new Uint8Array([255,216,255,...Array(13).fill(0)]);let call;
 globalThis.fetch=async(url,init)=>{call={url,init};return new Response(bytes);};
 assert.deepEqual(await downloadPrivatePhoto(settings,{providerAssetId:'asset-test',format:'jpg',bytes:bytes.length}),bytes);
 assert.match(call.url,/^https:\/\/api.cloudinary.com\/v1_1\/test\/asset\/download$/);assert.equal(call.init.body.get('asset_id'),'asset-test');assert.equal(call.init.body.has('api_secret'),false);assert.equal(Number(call.init.body.get('expires_at'))-Number(call.init.body.get('timestamp')),60);
 globalThis.fetch=async()=>new Response('<html>unexpected</html>');await assert.rejects(downloadPrivatePhoto(settings,{providerAssetId:'asset-test',format:'jpg',bytes:bytes.length}),/rejected/);
});
test('Expo checks receipts after a ticket; missing receipts are pending and removed devices fail explicitly',async()=>{
 const push={...job,channel:'push',destination:'ExpoPushToken[test]'};
 globalThis.fetch=async()=>Response.json({data:{status:'ok',id:'push-receipt'}});
 assert.deepEqual(await deliverNotification(settings,push),{state:'accepted',providerId:'push-receipt'});
 globalThis.fetch=async()=>Response.json({data:{}});
 assert.deepEqual(await deliverNotification(settings,{...push,state:'accepted',providerId:'push-receipt'}),{state:'pending'});
 globalThis.fetch=async()=>Response.json({data:{'push-receipt':{status:'ok'}}});
 assert.deepEqual(await deliverNotification(settings,{...push,state:'accepted',providerId:'push-receipt'}),{state:'delivered'});
 globalThis.fetch=async()=>Response.json({data:{status:'error',details:{error:'DeviceNotRegistered'}}});
 await assert.rejects(deliverNotification(settings,push),/device_removed/);
});
test('ambiguous sends are flagged for review; receipt-read failures and rate limits can retry',async()=>{
 globalThis.fetch=async()=>{throw new Error('Network timeout with secret provider data');};
 await assert.rejects(deliverNotification(settings,job),/uncertain/);
 await assert.rejects(deliverNotification(settings,{...job,channel:'push',state:'accepted',providerId:'receipt'}),/retryable/);
 globalThis.fetch=async()=>new Response('',{status:429});await assert.rejects(deliverNotification(settings,job),/retryable/);
 let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({id:'test'});};
 await assert.rejects(deliverNotification(settings,{...job,createdAt:'2025-01-01T00:00:00Z'}),/uncertain/);assert.equal(calls,0);
});

test('Supabase Storage keeps each photo at its own fixed private path and accepts a retry of the same photo',async()=>{
 const storage={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'};
 const bytes=new Uint8Array([255,216,255,...Array(13).fill(7)]),publicId='recharge/11111111-1111-4111-8111-111111111111';
 const saved=new Map(),calls=[];
 globalThis.fetch=async(url,init={})=>{
  const u=String(url);calls.push({url:u,method:init.method||'GET',headers:init.headers});
  const path=u.split('/storage/v1/object/')[1]?.replace(/^authenticated\//,'');
  if((init.method||'GET')==='POST'){if(saved.has(path))return Response.json({statusCode:'409',error:'Duplicate',message:'The resource already exists'},{status:409});saved.set(path,new Uint8Array(await new Response(init.body).arrayBuffer()));return Response.json({Key:path});}
  return saved.has(path)?new Response(saved.get(path)):Response.json({error:'not found'},{status:404});
 };
 const asset=await uploadStoragePhoto(storage,publicId,bytes,'jpg');
 assert.deepEqual(asset,{assetId:'storage:'+publicId+'.jpg',publicId,version:1,format:'jpg',bytes:bytes.length});
 assert.ok(calls[0].url.startsWith('https://example.supabase.co/storage/v1/object/workspace-media/recharge/'),'private bucket, fixed path');
 assert.deepEqual(await uploadStoragePhoto(storage,publicId,bytes,'jpg'),asset,'a retry of the same photo is accepted');
 await assert.rejects(uploadStoragePhoto(storage,publicId,new Uint8Array([255,216,255,...Array(13).fill(9)]),'jpg'),/retryable/,'a different photo never replaces it');
 assert.deepEqual(await downloadStoragePhoto(storage,{providerAssetId:asset.assetId,format:'jpg',bytes:bytes.length}),bytes);
 await assert.rejects(downloadStoragePhoto(storage,{providerAssetId:'storage:../secret.jpg',format:'jpg',bytes:16}),/rejected/);
 await assert.rejects(uploadStoragePhoto(storage,'../escape',bytes,'jpg'),/rejected/);
 await assert.rejects(downloadStoragePhoto(storage,{providerAssetId:asset.assetId,format:'jpg',bytes:99}),/rejected/,'size must match what was verified');
});
