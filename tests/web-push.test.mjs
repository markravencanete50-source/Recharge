import test,{after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'vite';

// Web push: the message is encrypted so only the one browser can read it, the request is signed
// with Recharge's own key, and each notice goes to each allowed browser once.
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false}});
const push=await vite.ssrLoadModule('/lib/web-push.ts');
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});after(()=>vite.close());
const subtle=crypto.subtle,enc=new TextEncoder();
const hmac=async(key,data)=>new Uint8Array(await subtle.sign('HMAC',await subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']),data));
const cat=(...a)=>{const o=new Uint8Array(a.reduce((n,x)=>n+x.length,0));let i=0;for(const x of a){o.set(x,i);i+=x.length;}return o;};

// The browser's side (RFC 8291), written independently of lib/web-push.ts.
async function browserDecrypt(body,ua,auth){
 const salt=body.slice(0,16),rs=new DataView(body.buffer,body.byteOffset).getUint32(16),idlen=body[20],asPublic=body.slice(21,21+idlen),sealed=body.slice(21+idlen);
 assert.equal(rs,4096);assert.equal(idlen,65);
 const uaPublic=new Uint8Array(await subtle.exportKey('raw',ua.publicKey));
 const shared=new Uint8Array(await subtle.deriveBits({name:'ECDH',public:await subtle.importKey('raw',asPublic,{name:'ECDH',namedCurve:'P-256'},false,[])},ua.privateKey,256));
 const ikm=(await hmac(await hmac(auth,shared),cat(enc.encode('WebPush: info\0'),uaPublic,asPublic,new Uint8Array([1])))).slice(0,32);
 const prk=await hmac(salt,ikm);
 const cek=(await hmac(prk,cat(enc.encode('Content-Encoding: aes128gcm\0'),new Uint8Array([1])))).slice(0,16);
 const nonce=(await hmac(prk,cat(enc.encode('Content-Encoding: nonce\0'),new Uint8Array([1])))).slice(0,12);
 const plain=new Uint8Array(await subtle.decrypt({name:'AES-GCM',iv:nonce},await subtle.importKey('raw',cek,'AES-GCM',false,['decrypt']),sealed));
 assert.equal(plain.at(-1),2,'single final record');
 return new TextDecoder().decode(plain.slice(0,-1));
}
async function vapidKeys(){
 const pair=await subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 return {pair,settings:{VAPID_PUBLIC_KEY:push.b64url(new Uint8Array(await subtle.exportKey('raw',pair.publicKey))),VAPID_PRIVATE_KEY:(await subtle.exportKey('jwk',pair.privateKey)).d,APP_ORIGIN:'https://recharge.example'}};
}

test('keys are only used when complete and well formed',async()=>{
 const {settings}=await vapidKeys();
 assert.ok(push.webPushKeys(settings));
 assert.equal(push.webPushKeys({...settings,VAPID_PRIVATE_KEY:''}),null);
 assert.equal(push.webPushKeys({...settings,VAPID_PUBLIC_KEY:'short'}),null);
 assert.equal(push.webPushKeys({...settings,APP_ORIGIN:'http://insecure.example'}),null);
});

test('only the browser it is for can read the message, and the request is signed by Recharge',async()=>{
 const {pair,settings}=await vapidKeys(),keys=push.webPushKeys(settings);
 const ua=await subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']),auth=crypto.getRandomValues(new Uint8Array(16));
 const job={endpoint:'https://fcm.googleapis.com/fcm/send/abc',p256dh:push.b64url(new Uint8Array(await subtle.exportKey('raw',ua.publicKey))),auth:push.b64url(auth),eventType:'journey.publishEstimate'};
 let seen;globalThis.fetch=async(url,init)=>{seen={url,init};return new Response('',{status:201});};
 assert.equal(await push.sendWebPush(job,keys),'sent');
 assert.equal(seen.url,job.endpoint);assert.equal(seen.init.headers['Content-Encoding'],'aes128gcm');assert.equal(seen.init.redirect,'manual');
 const message=JSON.parse(await browserDecrypt(new Uint8Array(seen.init.body),ua,auth));
 assert.equal(message.url,'/workspace/live');assert.ok(message.title.length>3);
 assert.equal(JSON.stringify(message).includes('journey.'),false,'plain wording, no internal names');
 // The signature checks out with Recharge's public key, for this push service, for 12 hours at most.
 const [,token,k]=seen.init.headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
 assert.equal(k,settings.VAPID_PUBLIC_KEY);
 const [h,c,s]=token.split('.');
 assert.ok(await subtle.verify({name:'ECDSA',hash:'SHA-256'},pair.publicKey,push.fromB64url(s),enc.encode(h+'.'+c)));
 const claims=JSON.parse(new TextDecoder().decode(push.fromB64url(c)));
 assert.equal(claims.aud,'https://fcm.googleapis.com');assert.equal(claims.sub,'https://recharge.example');assert.ok(claims.exp-Date.now()/1000<=12*3600+5);
 globalThis.fetch=async()=>new Response('',{status:410});assert.equal(await push.sendWebPush(job,keys),'gone');
 globalThis.fetch=async()=>{throw new Error('offline');};assert.equal(await push.sendWebPush(job,keys),'failed');
 // Anything but a browser push service is never contacted.
 let called=false;globalThis.fetch=async()=>{called=true;return new Response('',{status:201});};
 assert.equal(await push.sendWebPush({...job,endpoint:'https://169.254.169.254/latest'},keys),'gone');assert.equal(called,false);
});

test('the push service answer is kept for each notice and device, so a refused pop-up shows',async()=>{
 const {settings}=await vapidKeys(),keys=push.webPushKeys(settings);
 const ua=await subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const job={endpoint:'https://web.push.apple.com/abc',p256dh:push.b64url(new Uint8Array(await subtle.exportKey('raw',ua.publicKey))),auth:push.b64url(crypto.getRandomValues(new Uint8Array(16))),eventType:'reports.weekly_ready',outboxId:7,subscriptionId:'95000000-0000-4000-8000-000000000001'};
 let seen;globalThis.fetch=async(url,init)=>{seen=init;return new Response('',{status:403});};
 assert.deepEqual(await push.sendWebPushResult(job,keys),{outcome:'failed',status:403});
 assert.equal(seen.headers.Urgency,'high','phones deliver it straight away');
 globalThis.fetch=async()=>{throw new Error('offline');};assert.deepEqual(await push.sendWebPushResult(job,keys),{outcome:'failed',status:0});
 // A test notification carries its own wording.
 let body;globalThis.fetch=async(url,init)=>{body=init.body;return new Response('',{status:201});};
 assert.deepEqual(await push.sendWebPushResult(job,keys,{title:'Recharge',message:'Test'}),{outcome:'sent',status:201});assert.ok(body.length>100);
 // The minute run records each answer.
 const calls=[];globalThis.fetch=async()=>new Response('',{status:403});
 const rpc=async(name,args)=>{calls.push([name,args]);return name==='integration_claim_web_push'?[job]:null;};
 assert.deepEqual(await push.dispatchWebPush(settings,rpc),{mode:'configured',sent:0,failed:1,claimed:1});
 assert.deepEqual(calls[1],['integration_web_push_result',{outbox:7,subscription:job.subscriptionId,outcome:'failed',status_code:403}]);
});

test('each notice goes once to each browser of its person, and only while they have access',async()=>{
 const db=new PGlite();
 const roles=['super_admin','client','client'];
 const users=roles.map((_,i)=>`95000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`),session=i=>users[i].replace('9500','9600');
 await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
 for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
 for(let i=0;i<users.length;i++){
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`push${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(i),users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session(i),users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2 where user_id=$1",[users[i],roles[i]]);
 }
 const as=async i=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(i==='service'?{}:{sub:users[i],session_id:session(i)})]);await db.exec(i==='service'?'set role service_role':'set role authenticated');};
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.r;
 const sub=n=>({endpoint:`https://fcm.googleapis.com/fcm/send/${n}`,p256dh:'B'+'a'.repeat(86),auth:'a'.repeat(22)});
 await as(1);await q('select public.workspace_web_push_subscribe($1) r',[sub('one')]);
 await assert.rejects(q('select public.workspace_web_push_subscribe($1) r',[{...sub('bad'),endpoint:'http://insecure.example/x'}]),/Check the notification/);
 await assert.rejects(q('select public.workspace_web_push_subscribe($1) r',[{...sub('bad'),endpoint:'https://attacker.example/x'}]),/Check the notification/,'only browser push services');
 await assert.rejects(q('select public.integration_claim_web_push() r'),/permission denied/,'people cannot claim notices');
 await assert.rejects(db.query('select * from private.workspace_web_push'),/permission denied/);
 // A notice for person 1, and one for person 2 who has no browser switched on.
 await db.exec('reset role');
 for(const i of [1,2]){const ev=(await db.query("insert into public.workspace_activity(event_type) values('reports.weekly_ready') returning id")).rows[0].id;await db.query('insert into private.workspace_notification_outbox(user_id,event_id) values($1,$2)',[users[i],ev]);}
 await as('service');const first=await q('select public.integration_claim_web_push() r');
 assert.deepEqual(first.map(j=>[j.endpoint,j.eventType]),[['https://fcm.googleapis.com/fcm/send/one','reports.weekly_ready']]);
 assert.deepEqual(await q('select public.integration_claim_web_push() r'),[],'never sent twice');
 // The push service's answer is kept, and the person sees how their devices are doing (nobody else's).
 await q('select public.integration_web_push_result($1,$2,$3,$4)::text r',[first[0].outboxId,first[0].subscriptionId,'failed',403]);
 await as(1);await assert.rejects(q('select public.integration_web_push_result($1,$2,$3,$4)::text r',[first[0].outboxId,first[0].subscriptionId,'sent',201]),/permission denied/,'only the backend records answers');
 const [device]=await q('select public.workspace_web_push_status() r');
 assert.deepEqual([device.endpointHost,device.sent,device.failed,device.lastStatus],['fcm.googleapis.com',0,1,403]);
 await as(2);assert.deepEqual(await q('select public.workspace_web_push_status() r'),[]);
 // Opening Updates: one call marks everything up to the newest shown, for this person only; a newer one stays unread.
 await db.exec('reset role');
 const newer=(await db.query("insert into public.workspace_activity(event_type) values('reports.weekly_ready') returning id")).rows[0].id;await db.query('insert into private.workspace_notification_outbox(user_id,event_id) values($1,$2)',[users[1],newer]);
 await as(1);assert.deepEqual(await q('select public.workspace_notifications_read_all($1) r',[newer-1]),{read:1});
 await db.exec('reset role');
 assert.deepEqual((await db.query('select user_id,event_id,read_at is not null r from private.workspace_notification_outbox order by event_id')).rows.map(r=>[r.user_id===users[1]?1:2,r.r]),[[1,true],[2,false],[1,false]]);
 await as(1);assert.deepEqual(await q('select public.workspace_notifications_read_all($1) r',[newer]),{read:1});
 await as('service');
 // The same browser signed in as someone else now belongs to them.
 await as(2);await q('select public.workspace_web_push_subscribe($1) r',[sub('one')]);
 await db.exec('reset role');assert.equal((await db.query('select user_id from private.workspace_web_push')).rows[0].user_id,users[2]);
 // A blocked person is not sent anything; a browser that went away is forgotten.
 await db.query("update public.workspace_profiles set status='revoked' where user_id=$1",[users[2]]);
 const ev=(await db.query("insert into public.workspace_activity(event_type) values('reports.weekly_ready') returning id")).rows[0].id;await db.query('insert into private.workspace_notification_outbox(user_id,event_id) values($1,$2)',[users[2],ev]);
 await as('service');assert.deepEqual(await q('select public.integration_claim_web_push() r'),[]);
 await q("select public.integration_remove_web_push('https://fcm.googleapis.com/fcm/send/one')::text r");
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from private.workspace_web_push')).rows[0].n,0);
 await db.close();
});

test('on computers the pop-up stays until clicked, and an open Recharge window chimes the moment it arrives',async()=>{
 const sw=await fs.readFile('mobile/web-static/sw.js','utf8');
 assert.match(sw,/requireInteraction: true/);assert.match(sw,/tag: "recharge", renotify: true/,'a new one replaces the last and alerts again');
 assert.match(sw,/postMessage\(\{ type: "recharge-push" \}\)/);
 const page=await fs.readFile('mobile/src/LiveWorkspace.tsx','utf8');
 assert.match(page,/type !== "recharge-push"/);
 const chime=await fs.readFile('mobile/src/Notifications.tsx','utf8');
 assert.match(chime,/createDynamicsCompressor/,'loud without distorting');
});
