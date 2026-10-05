import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
const roles=['super_admin','cleans','ready','stays','client','cleans'];
const users=roles.map((_,i)=>`61000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
for(let i=0;i<users.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`integration${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[users[i].replace('6100','6200'),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[users[i].replace('6100','6200'),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2 where user_id=$1",[users[i],roles[i]]);
 await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features',[users[i]]);
}
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(i==='service'?{}:{sub:users[i],session_id:users[i].replace('6100','6200')})]);await db.exec(i==='service'?'set role service_role':'set role authenticated');}
const rpc=async(name,args=[])=>{const placeholders=args.map((_,i)=>'$'+(i+1)).join(',');return (await db.query(`select public.${name}(${placeholders}) result`,args)).rows[0].result;};
await as(0);
const property=await rpc('workspace_save_property',[{requestId:crypto.randomUUID(),name:'Test property',address:'Test address',region:'Edinburgh',bedrooms:2}]);
for(let i=1;i<=4;i++)await rpc('workspace_assign_property',[property,users[i],i===1?'cleaner':i===4?'client':'staff']);
const clean=await rpc('workspace_operations_action',[{action:'createOperation',requestId:crypto.randomUUID(),propertyId:property,kind:'cleaning',data:{dueOn:'2026-10-06',checklist:['Kitchen']}}]);
await rpc('workspace_assign_work',[clean.workId,clean.version,users[1]]);
await db.exec('reset role');await db.query("update public.workspace_properties set hostaway_listing_id='listing-test' where id=$1",[property]);
beforeEach(async()=>{await db.exec('reset role');await db.exec('delete from private.workspace_write_limits');});
after(()=>db.close());
const prepare=async(id=crypto.randomUUID(),hash='a'.repeat(64))=>rpc('workspace_prepare_upload',[{requestId:id,workId:clean.workId,purpose:'cleaning',contentHash:hash}]);
let intent;
test('only assigned cleaner can prepare cleaning evidence, with immutable request ownership',async()=>{
 await as(5);await assert.rejects(prepare(),/access denied/);
 await as(4);await assert.rejects(prepare(),/access denied/);
 await as(1);const request=crypto.randomUUID();intent=await prepare(request);assert.deepEqual(await prepare(request),intent);
 await assert.rejects(prepare(request,'b'.repeat(64)),/already used/);
 await assert.rejects(rpc('workspace_prepare_upload',[{requestId:crypto.randomUUID(),workId:clean.workId,purpose:'delivery',contentHash:'a'.repeat(64)}]),/purpose/);
 await assert.rejects(rpc('workspace_prepare_upload',[{requestId:crypto.randomUUID(),workId:clean.workId,purpose:'mailbox',contentHash:'a'.repeat(64)}]),/consent/);
});
test('client cannot register evidence, claim delivery jobs, or directly read private tables',async()=>{
 await as(1);
 for(const name of ['integration_commit_upload','integration_claim_notifications','integration_finish_notification']){
  const params=name==='integration_commit_upload'?[intent.id,{}]:name==='integration_claim_notifications'?[true,true]:[crypto.randomUUID(),crypto.randomUUID(),'delivered',null];
  await assert.rejects(rpc(name,params),/permission denied/);
 }
 for(const table of ['workspace_upload_intents','workspace_notification_deliveries','workspace_media_evidence'])await assert.rejects(db.query('select * from private.'+table),/permission denied/);
 await db.exec('reset role');await db.exec('set role anon');await assert.rejects(prepare(),/permission denied/);
});
test('trusted upload commit checks bound asset metadata and is idempotent',async()=>{
 await as('service');
 const asset={assetId:'provider-asset-test',publicId:intent.publicId,version:1,format:'jpg',bytes:100};
 await assert.rejects(rpc('integration_commit_upload',[intent.id,{...asset,publicId:'somebody-else'}]),/Invalid verified asset/);
 await assert.rejects(rpc('integration_commit_upload',[intent.id,{...asset,bytes:null}]),/Invalid verified asset/);
 const id=await rpc('integration_commit_upload',[intent.id,asset]);assert.equal(await rpc('integration_commit_upload',[intent.id,asset]),id);
 await as(1);const evidence=await rpc('workspace_media_read',[clean.workId]);assert.equal(evidence.length,1);assert.equal(evidence[0].id,id);assert.equal('publicId' in evidence[0],false);
 assert.equal((await rpc('workspace_media_asset',[id])).providerAssetId,'provider-asset-test');
 await as(5);await assert.rejects(rpc('workspace_media_read',[clean.workId]),/access denied/);
 await assert.rejects(rpc('workspace_media_asset',[id]),/access denied/);
});
test('revoked access prevents a delayed provider response from committing evidence',async()=>{
 await as(1);const pending=await prepare();await db.exec('reset role');await db.query("update public.workspace_profiles set status='revoked' where user_id=$1",[users[1]]);
 await as('service');await assert.rejects(rpc('integration_commit_upload',[pending.id,{assetId:'test',publicId:pending.publicId,version:1,format:'jpg',bytes:100}]),/revoked/);
 await db.exec('reset role');await db.query("update public.workspace_profiles set status='active' where user_id=$1",[users[1]]);
});
async function enqueue(subject=users[1]) {
 await db.exec('reset role');const event=(await db.query("insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values($1,$2,$3,'test.event') returning id",[users[0],property,clean.workId])).rows[0].id;
 await db.query('insert into private.workspace_notification_outbox(user_id,work_id,event_id) values($1,$2,$3)',[subject,clean.workId,event]);
}
test('disabled notification channels do not consume attempts; concurrent claims are disjoint',async()=>{
 await enqueue();await as('service');assert.deepEqual(await rpc('integration_claim_notifications',[false,false]),[]);
 const first=await rpc('integration_claim_notifications',[true,false]);assert.ok(first.length);assert.deepEqual(await rpc('integration_claim_notifications',[true,false]),[]);
 for(const job of first){assert.equal(job.channel,'email');assert.equal(await rpc('integration_finish_notification',[job.id,crypto.randomUUID(),'accepted','receipt']),false);
 assert.equal(await rpc('integration_finish_notification',[job.id,job.lease,'accepted','receipt-'+job.id]),true);}
});
test('provider acceptance and delivery are distinct; stale send leases require review',async()=>{
 await db.exec('reset role');await db.exec("update private.workspace_notification_deliveries set next_attempt_at=now()-interval '1 second'");await as('service');
 const accepted=await rpc('integration_claim_notifications',[true,false]);assert.ok(accepted.every(j=>j.state==='accepted'));
 for(const job of accepted)assert.equal(await rpc('integration_finish_notification',[job.id,job.lease,'delivered',null]),true);
 await enqueue();await as('service');const send=await rpc('integration_claim_notifications',[true,false]);assert.ok(send.length);
 await assert.rejects(rpc('integration_finish_notification',[send[0].id,send[0].lease,'delivered',null]),/acceptance required/);
 await db.exec('reset role');await db.exec("update private.workspace_notification_deliveries set lease_until=now()-interval '1 second' where state='queued'");await as('service');
 assert.deepEqual(await rpc('integration_claim_notifications',[true,false]),[]);
 await as(0);const status=await rpc('workspace_integration_status');assert.ok(status.notifications.review>=1);assert.ok(status.notifications.delivered>=1);
});
test('revoked recipients are cancelled before retry and notification status is admin-only',async()=>{
 await enqueue();await as('service');const jobs=await rpc('integration_claim_notifications',[true,false]);
 for(const job of jobs)await rpc('integration_finish_notification',[job.id,job.lease,'retryable',null]);
 await db.exec('reset role');await db.query("update public.workspace_profiles set status='revoked' where user_id=$1",[users[1]]);await db.exec("update private.workspace_notification_deliveries set next_attempt_at=now()-interval '1 second'");
 await as('service');assert.deepEqual(await rpc('integration_claim_notifications',[true,false]),[]);
 await as(3);await assert.rejects(rpc('workspace_integration_status'),/Admin access/);
 await db.exec('reset role');await db.query("update public.workspace_profiles set status='active' where user_id=$1",[users[1]]);
});
test('access revoked after a batch claim is checked again before the individual send',async()=>{
 await enqueue();await as('service');const jobs=await rpc('integration_claim_notifications',[true,false]);assert.ok(jobs.length);
 for(const job of jobs)assert.equal(await rpc('integration_check_notification',[job.id,job.lease]),true);
 await db.exec('reset role');await db.query("update public.workspace_profiles set status='revoked' where user_id=$1",[users[1]]);
 await as('service');for(const job of jobs)assert.equal(await rpc('integration_check_notification',[job.id,job.lease]),false);
 await db.exec('reset role');await db.query("update public.workspace_profiles set status='active' where user_id=$1",[users[1]]);
 await as(1);await assert.rejects(rpc('integration_check_notification',[jobs[0].id,jobs[0].lease]),/permission denied/);
});
test('new private tables have RLS and exposed RPCs do not become public security definers',async()=>{
 const tables=await db.query("select relname,relrowsecurity from pg_class where relname in ('workspace_upload_intents','workspace_notification_deliveries')");assert.equal(tables.rows.length,2);assert.ok(tables.rows.every(t=>t.relrowsecurity));
 const functions=await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef");assert.equal(functions.rows.length,0);
});
test('Hostaway import is scoped, idempotent, detects overlaps and invalidates old follow-ups',async()=>{
 const value={propertyId:property,listingId:'listing-test',externalId:'external-test',checkIn:'2026-11-01',checkOut:'2026-11-08',status:'confirmed'};
 await as(1);await assert.rejects(rpc('workspace_import_reservation',[value]),/access denied/);
 await as(3);const first=await rpc('workspace_import_reservation',[value]);assert.equal(first.changed,true);assert.ok(first.followUpWorkId);
 assert.equal((await rpc('workspace_import_reservation',[value])).changed,false);
 await assert.rejects(rpc('workspace_import_reservation',[{...value,listingId:'wrong'}]),/mapping changed/);
 await assert.rejects(rpc('workspace_import_reservation',[{...value,externalId:'overlapping'}]),/overlaps/);
 const update=await rpc('workspace_import_reservation',[{...value,checkOut:'2026-11-09'}]);assert.equal(update.id,first.id);assert.notEqual(update.followUpWorkId,first.followUpWorkId);
 const work=await rpc('workspace_operations_read',[property]);assert.equal(work.find(w=>w.workId===first.followUpWorkId).status,'cancelled');
 const cancel=await rpc('workspace_import_reservation',[{...value,status:'cancelled'}]);assert.equal(cancel.followUpWorkId,null);
});
