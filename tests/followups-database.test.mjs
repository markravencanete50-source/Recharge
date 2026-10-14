import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Repair quotes that change after reporting, and the Monday "weekly report ready" notice for owners.
const db=new PGlite();
const roles=['super_admin','client','stays','ready','cleans'];
const users=roles.map((_,i)=>`73000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const session=i=>users[i].replace('7300','7400');
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`followups${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1",[users[i],roles[i],'Person '+i]);
 await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features',[users[i]]);
}
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[i],session_id:session(i)})]);await db.exec('set role authenticated');}
beforeEach(async()=>{await db.exec('reset role');await db.exec('delete from private.workspace_write_limits');});
const action=async input=>(await db.query('select public.workspace_operations_action($1::jsonb) result',[JSON.stringify({requestId:crypto.randomUUID(),...input})])).rows[0].result;
const update=(w,step,data)=>action({action:'updateOperation',workId:w.workId,version:w.version,step,data});
const today=(await db.query("select (now() at time zone 'Europe/London')::date::text d")).rows[0].d;
let property;
await as(0);property=(await db.query('select public.workspace_save_property($1::jsonb) id',[JSON.stringify({requestId:crypto.randomUUID(),name:'Quote property',address:'Test address',region:'Edinburgh',bedrooms:2})])).rows[0].id;
for(const [i,assignment] of [[1,'client'],[2,'staff'],[3,'staff']])await db.query('select public.workspace_assign_property($1,$2,$3)',[property,users[i],assignment]);
await db.exec('reset role');

test('a higher quote at or over the limit goes to management, then the owner, and the repair carries on once approved',async()=>{
 await as(2);
 let repair=await action({action:'createOperation',propertyId:property,kind:'maintenance',data:{issue:'Dripping kitchen tap',estimatedCostMinor:0,hazard:false,repairType:'leak'}});
 assert.equal(repair.data.phase,'triage');
 repair=await update(repair,'referReady',{troubleshooting:'Isolation valve turned off',guestUpdate:'Plumber being arranged'});
 await as(3);repair=await update(repair,'bookRepair',{repairOn:today,contractor:'Leith Plumbing',guestUpdate:'Plumber booked'});
 assert.equal(repair.data.phase,'booked');
 await assert.rejects(update(repair,'reviseQuote',{quoteMinor:15000,reason:'x'}),/reason/i);
 repair=await update(repair,'reviseQuote',{quoteMinor:15000,reason:'The tap body is cracked and needs replacing'});
 assert.equal(repair.data.phase,'management_approval');assert.equal(repair.data.resumePhase,'booked');
 await as(0);repair=await update(repair,'approveManagement',{});
 assert.equal(repair.data.phase,'owner_approval');assert.equal(repair.data.resumePhase,'booked');
 assert.equal(repair.data.estimatedCostMinor,15000);assert.equal(repair.data.previousEstimateMinor,0);
 await db.exec('reset role');
 assert.equal((await db.query("select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type='operations.updateOperation.reviseQuote'",[users[1]])).rows[0].n,1,'the owner is told');
 await as(3);await assert.rejects(update(repair,'completeRepair',{report:'Tap replaced and tested',actualCostMinor:15000,guestUpdate:'All fixed'}),/Booked repair/);
 await as(1);repair=await update(repair,'approveBudget',{consent:true});
 assert.equal(repair.data.phase,'booked','back where it was');assert.equal(repair.data.resumePhase,null);
 await as(3);repair=await update(repair,'reviseQuote',{quoteMinor:12000,reason:'Found the part cheaper'});
 assert.equal(repair.data.phase,'booked','a lower quote needs no new approval');
 repair=await update(repair,'completeRepair',{report:'Tap replaced and tested',actualCostMinor:12000,guestUpdate:'All fixed'});
 assert.equal(repair.status,'completed');
 await assert.rejects(update(repair,'reviseQuote',{quoteMinor:1000,reason:'Too late to change'}),/closed/);
});

test('owners hear each Monday that their weekly report is ready, once a week',async()=>{
 await db.query("update public.workspace_properties set status='active' where id=$1",[property]);
 const run=async at=>(await db.query('select private.workspace_weekly_report_notices($1::timestamptz) r',[at])).rows[0].r.sent;
 assert.equal(await run('2026-10-13 09:00:00 Europe/London'),0,'not on a Tuesday');
 assert.equal(await run('2026-10-12 07:30:00 Europe/London'),0,'not before 8am');
 assert.equal(await run('2026-10-12 09:00:00 Europe/London'),1);
 assert.equal(await run('2026-10-12 15:00:00 Europe/London'),0,'once a week');
 assert.equal((await db.query("select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where a.event_type='reports.weekly_ready' and o.user_id=$1",[users[1]])).rows[0].n,1,'the owner is told');
 assert.equal((await db.query("select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where a.event_type='reports.weekly_ready' and o.user_id=$1",[users[2]])).rows[0].n,0,'staff are not');
 assert.equal(await run('2026-10-19 08:05:00 Europe/London'),1,'next Monday again');
 await as(1);assert.ok((await db.query("select public.workspace_portfolio_read('notifications',null,null,null) r")).rows[0].r.some(n=>n.event_type==='reports.weekly_ready'),'the owner sees it in the app');
 await assert.rejects(db.query('select public.workspace_weekly_report_notices()'),/permission denied/);
});
