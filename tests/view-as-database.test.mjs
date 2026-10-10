import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// View as: a super admin sees the workspace exactly as one of their people does, read-only.
const db=new PGlite();
const roles=['super_admin','super_admin','cleans','stays','client'];
const users=roles.map((_,i)=>`79000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const session=i=>users[i].replace('7900','7a00');
const [A,B,C,D]=[0,1,2,3];
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users on delete cascade,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`view${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1",[users[i],roles[i],'Person '+i]);
}
beforeEach(async()=>{await db.exec('rollback').catch(()=>{});await db.exec('reset role');});

// One Data API request, the way PostgREST runs it: claims and headers for this transaction only,
// then the request check, then the query; always rolled back.
async function request(i,sql,{viewAs,params=[]}={}){
 await db.exec('begin');
 try{
  await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:users[i],session_id:session(i),role:'authenticated',email:`view${i}@example.com`})]);
  await db.query("select set_config('request.headers',$1,true)",[JSON.stringify(viewAs?{'user-agent':'test','x-recharge-view-as':viewAs}:{'user-agent':'test'})]);
  await db.exec('set local role authenticated');
  await db.query('select public.workspace_request_check()');
  return (await db.query(sql,params)).rows;
 }finally{await db.exec('rollback');}
}
const one=async(i,sql,opts)=>(await request(i,sql,opts))[0].r;
async function as(i,sql,params=[]){
 await db.exec('reset role');
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[i],session_id:session(i)})]);
 await db.exec('set role authenticated');
 try{return (await db.query(sql,params)).rows[0]?.r;}finally{await db.exec('reset role');await db.query("select set_config('request.jwt.claims','',false)");}
}
const start=(i,target)=>as(i,'select public.workspace_view_as_start($1::jsonb) r',[JSON.stringify({action:'startViewAs',userId:users[target]})]);

test('without the header every request is answered as the person signed in',async()=>{
 assert.equal(await one(C,'select auth.uid() r'),users[C]);
 assert.equal(await one(A,'select private.workspace_actor_role() r'),'super_admin');
 assert.equal(await one(A,"select current_setting('transaction_read_only') r"),'off');
});

test('only an active super admin who started viewing that person can view as them',async()=>{
 await assert.rejects(request(C,'select 1',{viewAs:users[D]}),/Only super admins/);
 await assert.rejects(request(A,'select 1',{viewAs:'not-a-uuid'}),/Only super admins/);
 await assert.rejects(request(A,'select 1',{viewAs:users[C]}),/has ended/,'nothing started yet');
 await assert.rejects(start(C,D),/Only super admins/);
 await assert.rejects(start(A,B),/not a super admin/,'not another super admin');
 await assert.rejects(start(A,A),/not a super admin/);
 await assert.rejects(as(A,'select public.workspace_view_as_start($1::jsonb) r',[JSON.stringify({userId:users[C],extra:1})]),/Choose someone/);
 const people=await as(A,'select public.workspace_view_as_people() r');
 assert.deepEqual(people.map(p=>p.role).sort(),['cleans','client','stays']);
 await assert.rejects(as(C,'select public.workspace_view_as_people() r'),/Only super admins/);
});

test('viewing answers as the person, read-only, for that request only',async()=>{
 const shown=await start(A,C);
 assert.equal(shown.userId,users[C]);
 assert.equal(shown.role,'cleans');
 const logged=(await db.query("select count(*)::int n from public.workspace_access_events where event_type='viewed_as' and user_id=$1 and actor_id=$2",[users[C],users[A]])).rows[0].n;
 assert.equal(logged,1,'recorded in Access history');
 assert.equal(await one(A,'select auth.uid() r',{viewAs:users[C]}),users[C]);
 assert.equal(await one(A,'select private.workspace_actor_role() r',{viewAs:users[C]}),'cleans');
 assert.equal((await one(A,'select public.workspace_account() r',{viewAs:users[C]})).userId,users[C]);
 assert.equal(await one(A,'select private.workspace_viewer() r',{viewAs:users[C]}),users[A]);
 assert.equal(await one(A,"select auth.jwt()->>'email' r",{viewAs:users[C]}),null,'the super admin\'s email is not passed on');
 await assert.rejects(request(A,"select public.workspace_save_favorites('{\"items\":[]}'::jsonb) r",{viewAs:users[C]}),/read-only transaction/);
 // The next request without the header is the super admin again.
 assert.equal(await one(A,'select auth.uid() r'),users[A]);
 assert.equal(await one(A,'select private.workspace_actor_role() r'),'super_admin');
 // Another super admin cannot use someone else's view.
 await assert.rejects(request(B,'select 1',{viewAs:users[C]}),/has ended/);
});

test('viewing ends when stopped, after 12 hours, or if the person loses access',async()=>{
 await start(A,D);
 assert.equal(await one(A,'select auth.uid() r',{viewAs:users[D]}),users[D]);
 await as(A,'select public.workspace_view_as_stop() r');
 await assert.rejects(request(A,'select 1',{viewAs:users[D]}),/has ended/);
 await start(A,D);
 await db.query("update private.workspace_view_as_sessions set started_at=now()-interval '13 hours' where viewer_id=$1 and ended_at is null",[users[A]]);
 await assert.rejects(request(A,'select 1',{viewAs:users[D]}),/has ended/);
 await start(A,D);
 await db.query("update public.workspace_profiles set status='revoked' where user_id=$1",[users[D]]);
 await assert.rejects(request(A,'select 1',{viewAs:users[D]}),/has ended/);
 await db.query("update public.workspace_profiles set status='active' where user_id=$1",[users[D]]);
 // Starting someone else ends the earlier view.
 await start(A,C);
 await assert.rejects(request(A,'select 1',{viewAs:users[D]}),/has ended/);
});

test('private conversations and personal data stay private while viewing',async()=>{
 const convo=async(members,kind='direct')=>{
  const id=(await db.query("insert into private.chat_conversations(kind,created_by) values($1,$2) returning id",[kind,users[members[0]]])).rows[0].id;
  for(const m of members)await db.query('insert into private.chat_members(conversation_id,user_id) values($1,$2)',[id,users[m]]);
  await db.query("insert into private.chat_messages(conversation_id,author_id,body,request_id) values($1,$2,'Hello',gen_random_uuid())",[id,users[members[1]]]);
  return id;
 };
 const privateChat=await convo([C,D]), withViewer=await convo([A,C]);
 await start(A,C);
 const theirs=(await as(C,"select public.workspace_chat_read('list') r")).map(c=>c.id);
 assert.ok(theirs.includes(privateChat)&&theirs.includes(withViewer),'the cleaner sees both');
 const shown=(await one(A,"select public.workspace_chat_read('list') r",{viewAs:users[C]})).map(c=>c.id);
 assert.ok(shown.includes(withViewer),'a conversation the super admin is in still shows');
 assert.ok(!shown.includes(privateChat),'a private chat between two others is hidden');
 await assert.rejects(request(A,"select public.workspace_chat_read('messages',$1::uuid) r",{viewAs:users[C],params:[privateChat]}),/private to the people in it/);
 assert.equal(await one(A,"select public.workspace_chat_read('unread') r",{viewAs:users[C]}),0);
 assert.equal(await as(C,"select public.workspace_chat_read('unread') r"),1,'unread for the cleaner themselves is unchanged');
 await assert.rejects(request(A,"select public.workspace_privacy_read('export') r",{viewAs:users[C]}),/Personal data is not shown/);
 assert.equal((await as(C,"select public.workspace_privacy_read('export') r")).profile.userId,users[C]);
});

test('the request check is open to every caller and the tables are not',async()=>{
 await db.exec('set role anon');
 await db.query('select public.workspace_request_check()');
 await assert.rejects(db.query('select public.workspace_view_as_people()'),/permission denied/);
 await db.exec('reset role');await db.exec('set role authenticated');
 await assert.rejects(db.query('select * from private.workspace_view_as_sessions'),/permission denied/);
});
