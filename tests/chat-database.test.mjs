import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Chat: team conversations, each owner's conversation with Recharge, unread counts, one
// notification per conversation until it is read, and owner reply times for client relations.
const db=new PGlite();
const roles=['super_admin','stays','cleans','client','client','stays','ready'];
const users=roles.map((_,i)=>`97000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`),session=i=>users[i].replace('9700','9800');
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`chat${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1",[users[i],roles[i],'Person '+i]);
 await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features',[users[i]]);
}
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[i],session_id:session(i)})]);await db.exec('set role authenticated');}
beforeEach(async()=>{await db.exec('reset role');await db.exec('delete from private.workspace_write_limits');});
const read=async(section,target=null)=>(await db.query('select public.workspace_chat_read($1,$2) r',[section,target])).rows[0].r;
const act=async input=>(await db.query('select public.workspace_chat_action($1::jsonb) r',[JSON.stringify(input)])).rows[0].r;
const send=(conversationId,body)=>act({action:'send',requestId:crypto.randomUUID(),conversationId,body});
const outbox=async user=>(await db.exec('reset role'),(await db.query("select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type like 'chat.%'",[user])).rows[0].n);

// Person 3 owns a property that Stays person 1 works on; Stays person 5 does not.
await as(0);
const property=(await db.query('select public.workspace_save_property($1) r',[{requestId:crypto.randomUUID(),name:'Chat flat',address:'Example chat address',region:'Edinburgh',bedrooms:1}])).rows[0].r;
await db.query('select public.workspace_assign_property($1,$2,$3)',[property,users[1],'staff']);
await db.query('select public.workspace_assign_property($1,$2,$3)',[property,users[3],'client']);

let direct;
test('team members message each other; nobody else sees it',async()=>{
 await as(1);direct=await act({action:'startDirect',userId:users[2]});
 assert.equal(direct.title,'Person 2');
 assert.equal((await act({action:'startDirect',userId:users[2]})).id,direct.id,'the same conversation is reused');
 await assert.rejects(act({action:'startDirect',userId:users[3]}),/team/,'owners are not messaged one to one');
 const request=crypto.randomUUID();
 const first=await act({action:'send',requestId:request,conversationId:direct.id,body:'Can you take the 2pm clean?'});
 assert.deepEqual(await act({action:'send',requestId:request,conversationId:direct.id,body:'Can you take the 2pm clean?'}),first,'a retried send is not duplicated');
 await as(2);assert.equal((await read('list'))[0].unread,1);assert.equal(await read('unread'),1);
 assert.deepEqual((await read('messages',direct.id)).messages.map(m=>[m.body,m.mine,m.authorName]),[['Can you take the 2pm clean?',false,'Person 1']]);
 for(const i of [3,5]){await as(i);await assert.rejects(read('messages',direct.id),/not found/);assert.ok(!(await read('list')).some(c=>c.id===direct.id));}
 // The owner has only their property's chat (migration 20261027400000), named by its address.
 await as(3);assert.deepEqual((await read('list')).map(c=>[c.kind,c.ownerView]),[['owner',true]]);
 await as(3);await assert.rejects(send(direct.id,'Hello'),/not found/);
});

// One notice per message (Lee, round 5; migration 20261015300000), read or not.
test('people are told about every message',async()=>{
 const before=await outbox(users[2]);
 await as(1);await send(direct.id,'Second message');await send(direct.id,'Third message');
 assert.equal(await outbox(users[2]),before+2,'told about each message, even unread');
 await as(2);await act({action:'markRead',conversationId:direct.id});assert.equal(await read('unread'),0);
 await as(1);await send(direct.id,'After they read it');
 assert.equal(await outbox(users[2]),before+3);
});

test('a group can be about a property, and only team members can be added',async()=>{
 await as(1);
 await assert.rejects(act({action:'startGroup',title:'Owners too',userIds:[users[3]]}),/team members/);
 const group=await act({action:'startGroup',title:'Chat flat changeover',userIds:[users[2],users[6]],propertyId:property});
 assert.equal(group.propertyName,'Chat flat');assert.equal(group.subtitle,'3 people');
 await as(5);await assert.rejects(act({action:'startGroup',title:'Not my property',userIds:[users[2]],propertyId:property}),/Property not found/);
 await as(3);await assert.rejects(act({action:'startGroup',title:'Owner group',userIds:[users[1]]}),/Team members/);
});

test('an owner messages Recharge; the right team sees it and replies as Recharge',async()=>{
 await as(3);const conv=await act({action:'startOwner'});assert.equal(conv.title,'Recharge');
 await send(conv.id,'When is the next clean?');
 assert.ok(await outbox(users[1])>=1,'Stays on the owner’s property are told');
 await as(4);await assert.rejects(read('messages',conv.id),/not found/,'another owner');
 await as(5);await assert.rejects(read('messages',conv.id),/not found/,'Stays who do not work on the property');
 await as(1);assert.equal((await read('list')).find(c=>c.id===conv.id).title,'Person 3');
 assert.equal((await act({action:'startOwner',ownerId:users[3]})).id,conv.id);
 await send(conv.id,'Tomorrow at 11am.');
 await as(3);const view=await read('messages',conv.id);
 assert.deepEqual(view.messages.map(m=>m.authorName),['You','Recharge · Person']);
 // Client relations: the owner's message is timed and credited to whoever was on shift.
 await db.exec('reset role');
 await db.query("insert into private.workspace_shifts(user_id,department,clocked_in_at,request_id) values($1,'client_relations',now()-interval '1 hour',gen_random_uuid())",[users[5]]);
 await db.query("update private.chat_messages set created_at=now()-interval '20 minutes' where body='When is the next clean?'");
 await db.query("update private.chat_messages set created_at=now()-interval '17 minutes' where body='Tomorrow at 11am.'");
 await as(0);const today=new Date().toISOString().slice(0,10);
 const score=(await db.query('select public.workspace_client_relations_read($1,$2) r',[today,today])).rows[0].r;
 assert.deepEqual(score.overall,{green:1,amber:0,red:0});
 assert.deepEqual(score.people.map(p=>[p.fullName,p.green,p.onTrack]),[['Person 5',1,true]]);
 await as(3);await assert.rejects(db.query('select public.workspace_client_relations_read($1,$2) r',[today,today]),/Team access/);
});

test('people cannot read chat tables directly',async()=>{
 await as(1);
 for(const t of ['chat_conversations','chat_members','chat_messages','chat_reads'])await assert.rejects(db.query('select * from private.'+t),/permission denied/);
});
