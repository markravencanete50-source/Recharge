import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Offline photo capture: a photo taken with no signal is retried with the same request id (its
// idempotency key), maybe hours later. A repeat never makes a second photo, and an upload that
// started but never finished can still be completed after the usual 15 minutes.
const db=new PGlite();
const roles=['super_admin','cleans','accounts','cleans'];
const [ADMIN,CLEANER,ACCOUNTS,OTHER_CLEANER]=roles.map((_,i)=>i);
const users=roles.map((_,i)=>`95000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const session=i=>users[i].replace('9500','9600');
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`offline${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2 where user_id=$1",[users[i],roles[i]]);
 await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features',[users[i]]);
}
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(i==='service'?{}:{sub:users[i],session_id:session(i)})]);await db.exec(i==='service'?'set role service_role':'set role authenticated');}
beforeEach(async()=>{await db.exec('reset role');await db.exec('delete from private.workspace_write_limits');});
after(()=>db.close());
const rpc=async(name,args=[])=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
const owner=async(text,args=[])=>{await db.exec('reset role');return (await db.query(text,args)).rows;};
const prepare=(input,key)=>rpc('workspace_prepare_upload',[{requestId:key,contentHash:'a'.repeat(64),...input}]);
const commit=async intent=>{await as('service');return rpc('integration_commit_upload',[intent.id,{assetId:'storage:'+intent.publicId+'.jpg',publicId:intent.publicId,version:1,format:'jpg',bytes:2048}]);};
const evidence=async workId=>Number((await owner('select count(*) n from private.workspace_media_evidence where work_id=$1',[workId]))[0].n);
const expire=key=>owner("update private.workspace_upload_intents set expires_at=now()-interval '3 hours' where request_id=$1",[key]);

await as(ADMIN);
const property=await rpc('workspace_save_property',[{requestId:crypto.randomUUID(),name:'Island cottage',address:'1 Pier Road',region:'Highlands',bedrooms:2}]);
await owner("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,'cleaner',$5),($1,$3,'cleaner',$5),($1,$4,'staff',$5) on conflict do nothing",[property,users[CLEANER],users[OTHER_CLEANER],users[ACCOUNTS],users[ADMIN]]);
await as(ADMIN);
const clean=await rpc('workspace_operations_action',[{action:'createOperation',requestId:crypto.randomUUID(),propertyId:property,kind:'cleaning',data:{dueOn:'2026-10-10',checklist:['Kitchen']}}]);
await rpc('workspace_assign_work',[clean.workId,clean.version,users[CLEANER]]);

test('the same key for the same clean and photo is the same upload, and never a second photo',async()=>{
 const key=crypto.randomUUID(),photo={workId:clean.workId,purpose:'cleaning'};
 await as(CLEANER);const first=await prepare(photo,key);
 await as(CLEANER);assert.deepEqual(await prepare(photo,key),first,'a retry before it was saved continues the same upload');
 const saved=await commit(first);
 await as(CLEANER);assert.equal((await prepare(photo,key)).evidenceId,saved,'a retry after a lost answer returns the photo already saved');
 assert.equal(await commit(first),saved,'committing again keeps the one photo');
 assert.equal(await evidence(clean.workId),1);
 await as(CLEANER);await assert.rejects(prepare({...photo,purpose:'maintenance'},key),/already used/,'the key cannot be reused for something else');
 await as(CLEANER);await assert.rejects(rpc('workspace_prepare_upload',[{requestId:key,contentHash:'b'.repeat(64),...photo}]),/already used/,'or for different bytes');
 await as(OTHER_CLEANER);await assert.rejects(prepare(photo,key),/denied/,'another cleaner cannot use the clean');
});

test('an upload interrupted hours ago can be finished with the same key',async()=>{
 const key=crypto.randomUUID(),photo={workId:clean.workId,purpose:'cleaning'};
 await as(CLEANER);const first=await prepare(photo,key);
 await expire(key);
 await as(CLEANER);const again=await prepare(photo,key);
 assert.equal(again.id,first.id,'the same upload, not a new one');assert.equal(again.publicId,first.publicId);
 assert.ok((await owner('select expires_at>now() fresh from private.workspace_upload_intents where request_id=$1',[key]))[0].fresh,'with a fresh 15 minutes');
 const before=await evidence(clean.workId),saved=await commit(again);
 assert.equal(await evidence(clean.workId),before+1);
 await expire(key);
 await as(CLEANER);assert.equal((await prepare(photo,key)).evidenceId,saved,'a saved photo is returned however late the retry');
 assert.equal(await evidence(clean.workId),before+1);
});

test('permission is still checked on every retry',async()=>{
 const key=crypto.randomUUID(),photo={workId:clean.workId,purpose:'cleaning'};
 await as(CLEANER);const first=await prepare(photo,key);
 await expire(key);
 await owner("update public.workspace_work_items set assignee_id=$2 where id=$1",[clean.workId,users[OTHER_CLEANER]]);
 try {
  await as(CLEANER);await assert.rejects(prepare(photo,key),/denied/,'no longer the cleaner on this clean');
  await assert.rejects(commit(first),/expired|changed|revoked/,'and the interrupted upload cannot be committed');
 } finally {await owner("update public.workspace_work_items set assignee_id=$2 where id=$1",[clean.workId,users[CLEANER]]);}
});

test('receipts on an expense: an interrupted upload is finished with the same key',async()=>{
 await as(ACCOUNTS);
 const expense=await rpc('workspace_finance_action',[{requestId:crypto.randomUUID(),action:'createExpense',propertyId:property,supplier:'Pier Hardware',reference:'PH-7',category:'maintenance',description:'Replacement door handle',amountMinor:2400,receivedOn:'2026-10-09',source:'manual'}]);
 const key=crypto.randomUUID(),photo={expenseId:expense.id,purpose:'expense'};
 await as(ACCOUNTS);const first=await prepare(photo,key);
 await expire(key);
 await as(ACCOUNTS);const again=await prepare(photo,key);assert.equal(again.id,first.id);
 const saved=await commit(again);
 await expire(key);
 await as(ACCOUNTS);assert.equal((await prepare(photo,key)).evidenceId,saved);
 assert.equal(Number((await owner('select count(*) n from private.workspace_media_evidence where expense_id=$1',[expense.id]))[0].n),1);
});
