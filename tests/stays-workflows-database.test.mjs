import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Stays and repairs as the client described them: reviews logged one by one, re-listing when chosen,
// licensing stages, a guest saying no, repair types with urgency, the right people told, and the
// daily sign-off.
const db=new PGlite();
const roles=['super_admin','client','stays','ready','stays'];
const users=roles.map((_,i)=>`71000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const session=i=>users[i].replace('7100','7200');
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`stays-flow${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1",[users[i],roles[i],'Person '+i]);
 await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features',[users[i]]);
}
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[i],session_id:session(i)})]);await db.exec('set role authenticated');}
beforeEach(async()=>{await db.exec('reset role');await db.exec('delete from private.workspace_write_limits');});
const action=async input=>(await db.query('select public.workspace_operations_action($1::jsonb) result',[JSON.stringify({requestId:crypto.randomUUID(),...input})])).rows[0].result;
const create=(kind,data)=>action({action:'createOperation',propertyId:property,kind,data});
const update=(w,step,data)=>action({action:'updateOperation',workId:w.workId,version:w.version,step,data});
const team=async input=>(await db.query('select public.workspace_teams_action($1::jsonb) result',[JSON.stringify({requestId:crypto.randomUUID(),...input})])).rows[0].result;
const teamRead=async section=>(await db.query('select public.workspace_teams_read($1,null,null,null,null) result',[section])).rows[0].result;
const items=async kind=>(await db.query('select public.workspace_operations_read($1) data',[property])).rows[0].data.filter(w=>w.kind===kind);
const notified=async(user,work,step)=>(await db.exec('reset role'),await db.query("select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and o.work_id=$2 and a.event_type=$3",[user,work,'operations.updateOperation.'+step])).rows[0].n;
const today=(await db.query("select (now() at time zone 'Europe/London')::date::text d")).rows[0].d;
let property;
await as(0);property=(await db.query('select public.workspace_save_property($1::jsonb) id',[JSON.stringify({requestId:crypto.randomUUID(),name:'Flow property',address:'Test address',region:'Edinburgh',bedrooms:2})])).rows[0].id;
for(const [i,assignment] of [[1,'client'],[2,'staff'],[3,'staff']])await db.query('select public.workspace_assign_property($1,$2,$3)',[property,users[i],assignment]);
await db.exec('reset role');

test('a bad review only re-lists when chosen; a hidden listing always does',async()=>{
 await as(2);
 await create('listing_health',{checkedOn:today,platform:'Airbnb',listingVisible:true,reviewSentiment:'negative',reviewAcknowledged:true,suspended:false,evidence:'Bad review, handled with the guest'});
 assert.equal((await items('relisting')).length,0,'a bad review alone does not re-list');
 await create('listing_health',{checkedOn:today,platform:'Booking.com',listingVisible:false,reviewSentiment:'none',reviewAcknowledged:false,suspended:false,evidence:'Listing not showing in search'});
 const relist=await items('relisting');assert.equal(relist.length,1);assert.equal(relist[0].data.reason,'hidden');assert.equal(relist[0].data.phase,'to_relist');
});

test('guest reviews are logged one by one and a bad one can be sent for re-listing',async()=>{
 await as(2);
 const good=await create('guest_review',{platform:'Airbnb',reviewedOn:today,rating:5,outOf:5,sentiment:'positive',summary:'Lovely stay, spotless flat',relist:false});
 assert.equal(good.status,'completed');assert.equal(good.data.workStatus,'completed');
 await assert.rejects(create('guest_review',{platform:'Airbnb',reviewedOn:today,rating:6,outOf:5,sentiment:'positive',summary:'Rating above the scale',relist:false}),/rating/);
 await assert.rejects(create('guest_review',{platform:'Airbnb',reviewedOn:today,rating:5,outOf:5,sentiment:'positive',summary:'Good reviews are not re-listed',relist:true}),/rating/);
 const before=(await items('relisting')).length;
 const bad=await create('guest_review',{platform:'Booking.com',reviewedOn:today,rating:3,outOf:10,sentiment:'negative',summary:'Dirty bathroom and no hot water',relist:true,response:'Apologised and refunded one night'});
 const relist=(await items('relisting')).filter(w=>w.data.sourceWorkId===bad.workId);assert.equal(relist.length,1);assert.equal((await items('relisting')).length,before+1);
 let r=await update(relist[0],'startRelisting',{note:'New listing being drafted on Booking.com'});assert.equal(r.status,'in_progress');assert.equal(r.data.phase,'relisting');
 await assert.rejects(update(r,'startRelisting',{note:'Started twice'}),/already started/);
 r=await update(r,'completeHandover',{evidence:'New listing live, old one archived'});assert.equal(r.status,'completed');
 await as(4);await assert.rejects(create('guest_review',{platform:'Airbnb',reviewedOn:today,rating:5,outOf:5,sentiment:'positive',summary:'Unassigned Stays cannot log here',relist:false}),/denied/);
});

test('licensing runs application, safety checks, then grant',async()=>{
 await db.exec('reset role');const work=(await db.query("select private.workspace_handover($1,'licensing','Complete licensing process','licensing','{}') id",[property])).rows[0].id;
 await as(2);let l=(await items('licensing')).find(w=>w.workId===work);
 await assert.rejects(update(l,'recordSafetyChecks',{checks:{gasSafety:true,electrical:true,alarms:true,legionella:true,epc:true,insurance:true},evidence:'All certificates uploaded'}),/every licensing safety check/i);
 l=await update(l,'submitApplication',{authority:'City of Edinburgh Council',applicationReference:'STL-2026-001',submittedOn:today});assert.equal(l.status,'in_progress');assert.equal(l.data.phase,'applied');
 await assert.rejects(update(l,'recordSafetyChecks',{checks:{gasSafety:true,electrical:true,alarms:true,legionella:false,epc:true,insurance:true},evidence:'Legionella still outstanding'}),/every licensing safety check/i);
 l=await update(l,'recordSafetyChecks',{checks:{gasSafety:true,electrical:true,alarms:true,legionella:true,epc:true,insurance:true},evidence:'All certificates checked and filed'});assert.equal(l.data.phase,'checks_done');
 l=await update(l,'recordGranted',{reference:'STL-2026-001',grantedOn:today,checklist:{application:true,safetyChecks:true,authorityGrant:true},evidence:'Licence letter received from the council'});assert.equal(l.status,'completed');
});

test('a direct-booking offer can be closed when the guest says no',async()=>{
 await as(2);await action({action:'recordReservation',propertyId:property,reference:'LONG-STAY',checkIn:'2027-02-01',checkOut:'2027-02-10',status:'confirmed'});
 const offer=(await items('direct_booking'))[0];assert.equal(offer.data.phase,'follow_up');
 const closed=await update(offer,'recordGuestDecline',{reason:'Guest prefers to keep the Airbnb booking'});
 assert.equal(closed.status,'cancelled');assert.equal(closed.data.phase,'declined');
 await assert.rejects(update(closed,'recordGuestDecline',{reason:'Already closed'}),/closed/);
});

test('repairs carry type and urgency; Ready hears of the referral, Stays of the booking',async()=>{
 await as(2);
 await assert.rejects(create('maintenance',{issue:'Boiler not firing',estimatedCostMinor:0,hazard:false,repairType:'boilers'}),/repair type/);
 let repair=await create('maintenance',{issue:'Boiler not firing, no heating',estimatedCostMinor:0,hazard:false,repairType:'heating',urgent:true});
 assert.equal(repair.data.repairType,'heating');assert.equal(repair.data.urgent,true);assert.equal(repair.data.phase,'triage');
 repair=await update(repair,'referReady',{troubleshooting:'Checked thermostat, reset boiler, pressure is fine',guestUpdate:'Engineer being arranged today',urgent:true,readyUserId:users[3]});
 assert.equal(repair.data.referredBy,users[2]);assert.equal(repair.data.urgent,true);
 assert.equal(await notified(users[3],repair.workId,'referReady'),1,'Ready on the property is told');
 await as(3);repair=await update(repair,'bookRepair',{repairOn:today,visitFrom:'14:00',visitTo:'16:00',contractor:'Leith Heating',guestUpdate:'Engineer arriving this afternoon'});
 assert.equal(await notified(users[2],repair.workId,'bookRepair'),1,'the Stays person who referred it is told');
 assert.equal(await notified(users[4],repair.workId,'bookRepair'),0,'unassigned Stays are not');
 assert.equal(await notified(users[3],repair.workId,'bookRepair'),0,'Ready, who booked it, is not told about their own action');
});

test('Stays sign off the day once, explaining any open re-listings',async()=>{
 await as(2);
 const read=await teamRead('signoff');assert.equal(read.mine,null);assert.ok(read.snapshot.openRelistings>=1);
 await assert.rejects(team({action:'signOffDay',allVisible:true,reviewsHandled:true,suspensionsHandled:true,relistingsDone:false,note:''}),/Confirm every daily check/);
 await assert.rejects(team({action:'signOffDay',allVisible:true,reviewsHandled:true,suspensionsHandled:true,relistingsDone:true,note:''}),/open re-listings/);
 const done=await team({action:'signOffDay',allVisible:true,reviewsHandled:true,suspensionsHandled:true,relistingsDone:true,note:'Booking.com re-listing waiting on photos'});
 assert.equal(done.day,today);
 await assert.rejects(team({action:'signOffDay',allVisible:true,reviewsHandled:true,suspensionsHandled:true,relistingsDone:true,note:'Second time today'}),/already signed off/);
 assert.ok((await teamRead('signoff')).mine);
 await as(3);await assert.rejects(teamRead('signoff'),/Stays access/);
 await as(0);const admin=await teamRead('signoff');assert.equal(admin.recent.length,1);assert.equal(admin.recent[0].fullName,'Person 2');
 const perf=(await db.query('select public.workspace_teams_read($1,$2::date,$2::date,null,null) result',['teamPerformance',today])).rows[0].result;
 const person=perf.people.find(p=>p.userId===users[2]);assert.equal(person.signOffs,1);assert.equal(person.reviewsLogged,2);
});
