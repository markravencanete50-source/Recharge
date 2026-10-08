import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Portfolio insights (owners and 12 months), each person's department and usual shift, and empty
// nights in the coming week turned into pricing tickets on the backend's schedule.
const db=new PGlite();
const roles=['super_admin','stays','client','client','cleans'];
const users=roles.map((_,i)=>`a1000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const session=i=>users[i].replace('a100','a200');
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`portfolio${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1",[users[i],roles[i],['Admin','Sam Stays','Fiona Owner','Gary Owner','Cara Cleaner'][i]]);
 await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features',[users[i]]);
}
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[i],session_id:session(i)})]);await db.exec('set role authenticated');}
async function asBackend(){await db.exec('reset role');await db.query("select set_config('request.jwt.claims','',false)");await db.exec('set role service_role');}
beforeEach(async()=>{await db.exec('reset role');await db.exec('delete from private.workspace_write_limits');});
const portfolio=async section=>(await db.query('select public.workspace_portfolio_read($1,null,null,null) r',[section])).rows[0].r;
const team=async input=>(await db.query('select public.workspace_teams_action($1::jsonb) result',[JSON.stringify({requestId:crypto.randomUUID(),...input})])).rows[0].result;
const teamRead=async (section,from=null,to=null)=>(await db.query('select public.workspace_teams_read($1,$2::date,$3::date,null,null) result',[section,from,to])).rows[0].result;
const today=(await db.query("select (now() at time zone 'Europe/London')::date::text d")).rows[0].d;
const props=[];
await as(0);
for(const [name,ownerIdx] of [['Harbour Flat',2],['Mill Cottage',2],['Garden Loft',3]]){
 const id=(await db.query('select public.workspace_save_property($1::jsonb) id',[JSON.stringify({requestId:crypto.randomUUID(),name,address:'Test address',region:'Edinburgh',bedrooms:2})])).rows[0].id;
 await db.query('select public.workspace_assign_property($1,$2,$3)',[id,users[ownerIdx],'client']);
 await db.query('select public.workspace_assign_property($1,$2,$3)',[id,users[1],'staff']);
 props.push(id);
}
await db.exec('reset role');
await db.query("update public.workspace_properties set status='active' where id=any($1::uuid[])",[props]);

test('insights list each owner with their properties and twelve months of the portfolio',async()=>{
 await as(1);const insights=await portfolio('insights');
 assert.deepEqual(insights.owners.map(o=>[o.name,o.propertyIds.length]),[['Fiona Owner',2],['Gary Owner',1]]);
 assert.equal(insights.trend.length,12);
 const now=insights.trend.at(-1);assert.equal(now.month,today.slice(0,7));assert.equal(now.added,3);assert.equal(now.liveProperties,3);
 await as(2);await assert.rejects(portfolio('insights'),/Portfolio access/);
});

test('admins set each person\'s department and usual shift; clock-in and performance use it',async()=>{
 await as(1);await assert.rejects(team({action:'saveRota',userId:users[1],department:'guest_relations',usualShift:'early'}),/Management access/);
 await as(0);await team({action:'saveRota',userId:users[1],department:'guest_relations',usualShift:'early'});
 await assert.rejects(team({action:'saveRota',userId:users[2],department:'guest_relations',usualShift:'early'}),/not found/);
 await team({action:'saveRota',userId:users[1],department:'client_relations',usualShift:'late'});
 const rota=await teamRead('rota');assert.deepEqual(rota.find(r=>r.userId===users[1]),{userId:users[1],fullName:'Sam Stays',role:'stays',department:'client_relations',usualShift:'late'});
 assert.equal(rota.some(r=>r.role==='client'),false);
 await as(1);assert.deepEqual((await teamRead('shift')).rota,{department:'client_relations',usualShift:'late'});
 assert.deepEqual((await teamRead('rota')).map(r=>r.userId),[users[1]],'others see only themselves');
 await as(0);const perf=await teamRead('teamPerformance',today,today);
 assert.equal(perf.people.find(p=>p.userId===users[1]).usualShift,'late');
});

test('empty nights become one pricing ticket per property, kept up to date and closed when priced',async()=>{
 await as(1);
 // Garden Loft is fully booked for the week.
 await db.query('select public.workspace_operations_action($1::jsonb)',[JSON.stringify({action:'recordReservation',requestId:crypto.randomUUID(),propertyId:props[2],reference:'FULL-WEEK',checkIn:today,checkOut:(await db.query("select ($1::date+7)::text d",[today])).rows[0].d,status:'confirmed'})]);
 await assert.rejects(db.query('select public.workspace_open_pricing_gaps()'),/permission denied/);
 await asBackend();assert.deepEqual((await db.query('select public.workspace_open_pricing_gaps() r')).rows[0].r,{opened:2,updated:0,closed:0});
 assert.deepEqual((await db.query('select public.workspace_open_pricing_gaps() r')).rows[0].r,{opened:0,updated:0,closed:0},'a second run changes nothing');
 await as(1);let gap=(await db.query('select public.workspace_operations_read($1) d',[props[0]])).rows[0].d.find(w=>w.kind==='pricing_gap');
 assert.equal(gap.data.nights.length,7);
 // A pricing decision on one night takes it off the ticket.
 await db.query('select public.workspace_operations_action($1::jsonb)',[JSON.stringify({action:'createOperation',requestId:crypto.randomUUID(),propertyId:props[0],kind:'daily_pricing',data:{night:today,currentRateMinor:12000,proposedRateMinor:11000,decision:'change',reason:'Short notice gap tonight'}})]);
 await asBackend();assert.equal((await db.query('select public.workspace_open_pricing_gaps() r')).rows[0].r.updated,1);
 await as(1);gap=(await db.query('select public.workspace_operations_read($1) d',[props[0]])).rows[0].d.find(w=>w.kind==='pricing_gap');assert.equal(gap.data.nights.length,6);
 // Booking the rest of the week closes it.
 await db.query('select public.workspace_operations_action($1::jsonb)',[JSON.stringify({action:'recordReservation',requestId:crypto.randomUUID(),propertyId:props[0],reference:'REST-OF-WEEK',checkIn:(await db.query("select ($1::date+1)::text d",[today])).rows[0].d,checkOut:(await db.query("select ($1::date+7)::text d",[today])).rows[0].d,status:'confirmed'})]);
 await asBackend();assert.equal((await db.query('select public.workspace_open_pricing_gaps() r')).rows[0].r.closed,1);
 await as(1);assert.equal((await db.query('select public.workspace_operations_read($1) d',[props[0]])).rows[0].d.find(w=>w.kind==='pricing_gap').status,'completed');
});
