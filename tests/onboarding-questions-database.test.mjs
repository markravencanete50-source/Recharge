import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Owners ask questions any time and the team answers; the onboarding team is put on new enquiries
// and the Ready team on new inspections automatically.
const db=new PGlite();
const roles=['super_admin','client','stays','ready','client','stays'];
const users=roles.map((_,i)=>`91000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const session=i=>users[i].replace('9100','9200');
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`onboard-q${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2 where user_id=$1",[users[i],roles[i]]);
}
// Person 5 (Stays) has no onboarding tool, so is not put on enquiries.
for(let i=0;i<users.length;i++)await db.query("insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features where $2 or module_id<>'property-onboarding'",[users[i],i!==5]);
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[i],session_id:session(i)})]);await db.exec('set role authenticated');}
beforeEach(async()=>{await db.exec('reset role');await db.exec('delete from private.workspace_write_limits');});
const action=async input=>(await db.query('select public.workspace_journey_action($1::jsonb) result',[JSON.stringify({requestId:crypto.randomUUID(),...input})])).rows[0].result;
const owner=async(text,args)=>{await db.exec('reset role');return (await db.query(text,args)).rows;};
let journey;

test('the onboarding team is put on a new enquiry and told about it',async()=>{
 await as(1);journey=await action({action:'createEnquiry',name:'Question flat',address:'Example question address',propertyType:'Flat',bedrooms:2,bathrooms:1});
 const assigned=(await owner("select user_id from public.workspace_property_assignments where property_id=$1 and assignment='staff'",[journey.propertyId])).map(r=>r.user_id);
 assert.deepEqual(assigned,[users[2]],'Stays with the onboarding tool only');
 assert.equal((await owner('select count(*)::int n from private.workspace_notification_outbox where user_id=$1 and work_id=$2',[users[2],journey.workId]))[0].n,1);
});

test('the owner asks a question; the team answers it once',async()=>{
 await as(1);journey=await action({action:'askQuestion',propertyId:journey.propertyId,version:journey.version,question:'Can I still stay there a few weekends a year?'});
 assert.equal(journey.questions.length,1);assert.equal(journey.questions[0].askedByOwner,true);assert.equal(journey.questions[0].answer,null);
 assert.equal((await owner("select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type='journey.askQuestion'",[users[2]]))[0].n,1,'Stays are told');
 await as(4);await assert.rejects(action({action:'askQuestion',propertyId:journey.propertyId,version:journey.version,question:'Another owner should not ask here'}),/denied|Only the owner/);
 await as(1);await assert.rejects(action({action:'answerQuestion',propertyId:journey.propertyId,version:journey.version,questionId:journey.questions[0].id,answer:'Owners cannot answer'}),/Team answer/);
 await as(2);journey=await action({action:'answerQuestion',propertyId:journey.propertyId,version:journey.version,questionId:journey.questions[0].id,answer:'Yes: block the dates in your calendar and we keep them free.'});
 assert.match(journey.questions[0].answer,/block the dates/);
 await assert.rejects(action({action:'answerQuestion',propertyId:journey.propertyId,version:journey.version,questionId:journey.questions[0].id,answer:'Second answer'}),/already been answered/);
});

test('the Ready team is put on a new inspection',async()=>{
 await db.exec('reset role');
 await db.query("select private.workspace_handover($1,'new-property-inspection-board','Book the new property inspection','inspection',jsonb_build_object('phase','ready_to_book'))",[journey.propertyId]);
 const assigned=(await owner("select user_id from public.workspace_property_assignments where property_id=$1 and assignment='staff' order by user_id",[journey.propertyId])).map(r=>r.user_id);
 assert.deepEqual(assigned,[users[2],users[3]]);
});
