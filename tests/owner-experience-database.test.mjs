import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Owners and approvals: an owner declining a repair cost with a reason, Stays re-quoting or closing
// it, the company-wide management limit for repairs, and owner reports that show each owner only
// their own bookings.
const db=new PGlite();
const roles=['super_admin','client','stays','ready','client','cleans','admin'];
const [ADMIN,OWNER,STAYS,READY,OTHER_OWNER,CLEANER,MANAGER]=[0,1,2,3,4,5,6];
const users=roles.map((_,i)=>`75000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const session=i=>users[i].replace('7500','7600');
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`owner-experience${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1",[users[i],roles[i],'Person '+i]);
 await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features',[users[i]]);
}
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[i],session_id:session(i)})]);await db.exec('set role authenticated');}
beforeEach(async()=>{await db.exec('reset role');await db.exec('delete from private.workspace_write_limits');});
after(()=>db.close());
const action=async input=>(await db.query('select public.workspace_operations_action($1::jsonb) result',[JSON.stringify({requestId:crypto.randomUUID(),...input})])).rows[0].result;
const update=(w,step,data)=>action({action:'updateOperation',workId:w.workId,version:w.version,step,data});
const report=(propertyId,data)=>action({action:'createOperation',propertyId,kind:'maintenance',data:{hazard:false,repairType:'leak',...data}});
const finance=async input=>(await db.query('select public.workspace_finance_action($1::jsonb) result',[JSON.stringify({requestId:crypto.randomUUID(),...input})])).rows[0].result;
const financeRead=async section=>(await db.query('select public.workspace_finance_read($1,null,null,null,null) result',[section])).rows[0].result;
const management=async()=>(await db.query("select public.workspace_teams_read('management',null,null,null,null) result")).rows[0].result;
const bookings=async(from,to)=>(await db.query('select public.workspace_owner_bookings($1::date,$2::date) result',[from,to])).rows[0].result;
const told=async(user,work,step)=>(await db.exec('reset role'),await db.query("select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and o.work_id=$2 and a.event_type=$3",[user,work,'operations.updateOperation.'+step])).rows[0].n;
const setLimit=async minor=>{await as(MANAGER);const policy=await financeRead('policy');return finance({action:'setRepairApprovalLimit',version:policy.version,managementRepairLimitMinor:minor});};

const saveProperty=async name=>(await db.query('select public.workspace_save_property($1::jsonb) id',[JSON.stringify({requestId:crypto.randomUUID(),name,address:'Test address',region:'Edinburgh',bedrooms:2})])).rows[0].id;
await as(ADMIN);
const home=await saveProperty('Owner home'),other=await saveProperty('Another owner home');
for(const [i,assignment] of [[OWNER,'client'],[STAYS,'staff'],[READY,'staff']])await db.query('select public.workspace_assign_property($1,$2,$3)',[home,users[i],assignment]);
await db.query('select public.workspace_assign_property($1,$2,$3)',[other,users[OTHER_OWNER],'client']);
await db.exec('reset role');
// The owner's set-up form: repairs up to £100 go ahead without asking.
const journeyWork=(await db.query("insert into public.workspace_work_items(property_id,module_id,title,created_by,request_id) values($1,'property-onboarding','Test journey',$2,$3) returning id",[home,users[ADMIN],crypto.randomUUID()])).rows[0].id;
await db.query("insert into private.workspace_journeys(property_id,client_id,work_id,property_type,bathrooms,form) values($1,$2,$3,'Flat',1,$4::jsonb)",[home,users[OWNER],journeyWork,JSON.stringify({repairLimitMinor:10000,fullRepairPermission:false})]);

test('an owner declines a repair cost with a reason; Stays re-quote it back to the owner or close it',async()=>{
 await as(STAYS);
 let repair=await report(home,{issue:'Shower tray cracked and leaking',estimatedCostMinor:45000});
 assert.equal(repair.data.phase,'owner_approval');
 await assert.rejects(update(repair,'declineBudget',{reason:'Too expensive for now'}),/Only the owner/,'Stays cannot decline for the owner');
 await as(OTHER_OWNER);await assert.rejects(update(repair,'declineBudget',{reason:'Not my property at all'}),/access/i);
 await as(OWNER);
 await assert.rejects(update(repair,'declineBudget',{reason:'no'}),/reason/i,'a reason of at least 5 characters');
 await assert.rejects(update(repair,'declineBudget',{reason:'x'.repeat(2001)}),/reason/i);
 repair=await update(repair,'declineBudget',{reason:'Please get a second quote first'});
 assert.equal(repair.data.phase,'owner_declined');assert.equal(repair.data.ownerDeclinedReason,'Please get a second quote first');
 assert.equal(repair.status,'waiting','the repair stays open');
 await assert.rejects(update(repair,'approveBudget',{consent:true}),/consent/,'nothing left to approve');
 assert.equal(await told(users[STAYS],repair.workId,'declineBudget'),1,'Stays on the property are told');
 assert.equal(await told(users[ADMIN],repair.workId,'declineBudget'),1,'admins are told');
 assert.equal(await told(users[READY],repair.workId,'declineBudget'),0,'Ready are not');
 // Stays see the reason, and re-quote: it goes back to the owner even under their limit.
 await as(READY);await assert.rejects(update(repair,'reviseQuote',{quoteMinor:9000,reason:'Second quote from another firm'}),/re-quoted|access/i);
 await as(STAYS);
 const seen=(await db.query('select public.workspace_operations_read($1) data',[home])).rows[0].data.find(w=>w.workId===repair.workId);
 assert.equal(seen.data.ownerDeclinedReason,'Please get a second quote first');
 repair=await update(repair,'reviseQuote',{quoteMinor:9000,reason:'Second quote from another firm'});
 assert.equal(repair.data.phase,'owner_approval');assert.equal(repair.data.estimatedCostMinor,9000);
 await as(OWNER);repair=await update(repair,'approveBudget',{consent:true});
 assert.equal(repair.data.phase,'triage','carries on as before');assert.equal(repair.data.ownerApprovedMinor,9000);
 // A second repair the owner declines is closed by Stays.
 await as(STAYS);let second=await report(home,{issue:'Replace the garden fence panels',estimatedCostMinor:30000});
 await assert.rejects(update(second,'closeRepair',{note:'Owner does not want it'}),/declined repair/,'only a declined repair is closed this way');
 await as(OWNER);second=await update(second,'declineBudget',{reason:'I will arrange this myself'});
 await as(STAYS);second=await update(second,'closeRepair',{note:'Owner arranging it themselves'});
 assert.equal(second.status,'cancelled');assert.equal(second.data.phase,'closed');
});

test('above the management limit, an admin approves after the owner, or first when the owner pre-authorised it',async()=>{
 await as(STAYS);
 let small=await report(home,{issue:'Kitchen tap washer',estimatedCostMinor:60000});
 assert.equal(small.data.phase,'owner_approval');
 await as(OWNER);small=await update(small,'approveBudget',{consent:true});
 assert.equal(small.data.phase,'triage','no management limit is set by default');

 await as(OWNER);await assert.rejects(finance({action:'setRepairApprovalLimit',version:1,managementRepairLimitMinor:50000}),/Management access|Unknown/);
 await as(STAYS);await assert.rejects(finance({action:'setRepairApprovalLimit',version:1,managementRepairLimitMinor:50000}),/Management access|Unknown/);
 const set=await setLimit(50000);assert.equal(set.managementRepairLimitMinor,50000);
 assert.equal((await financeRead('policy')).managementRepairLimitMinor,50000);

 // Owner first, then management.
 await as(STAYS);let repair=await report(home,{issue:'Boiler needs replacing',estimatedCostMinor:250000,repairType:'heating'});
 assert.equal(repair.data.phase,'owner_approval');
 await as(OWNER);repair=await update(repair,'approveBudget',{consent:true});
 assert.equal(repair.data.phase,'management_approval');
 assert.equal(await told(users[MANAGER],repair.workId,'approveBudget'),1,'admins are told it needs them');
 await as(MANAGER);
 const queue=await management();
 const waiting=queue.repairApprovals.find(r=>r.workId===repair.workId);
 assert.ok(waiting,'listed in Management → Waiting on you');assert.equal(waiting.estimatedCostMinor,250000);assert.equal(waiting.limitMinor,50000);assert.equal(waiting.propertyName,'Owner home');
 await as(STAYS);await assert.rejects(update(repair,'approveManagement',{}),/Management approval/,'Stays cannot approve for management');
 await assert.rejects(update(repair,'referReady',{troubleshooting:'Checked the boiler',guestUpdate:'Engineer coming'}),/consent/i,'nothing moves before management');
 await as(MANAGER);repair=await update(repair,'approveManagement',{note:'Agreed with the owner by phone'});
 assert.equal(repair.data.phase,'triage');assert.equal(repair.data.managementApprovedMinor,250000);
 assert.equal(await told(users[STAYS],repair.workId,'approveManagement'),1,'Stays hear it can go ahead');

 // Pre-authorised by the owner (under their limit), but above the management limit: management first.
 await setLimit(5000);
 await as(STAYS);let pre=await report(home,{issue:'Lock barrel replacement',estimatedCostMinor:8000,repairType:'locks_access'});
 assert.equal(pre.data.phase,'management_approval');
 await as(MANAGER);
 await assert.rejects(update(pre,'declineManagement',{reason:'no'}),/reason/i);
 pre=await update(pre,'declineManagement',{reason:'Use the spare barrel in the store'});
 assert.equal(pre.data.phase,'management_declined');assert.equal(pre.status,'waiting');
 // A cheaper re-quote below the management limit carries on without asking anyone again.
 await as(STAYS);pre=await update(pre,'reviseQuote',{quoteMinor:3000,reason:'Using the spare barrel'});
 assert.equal(pre.data.phase,'triage');

 // A higher quote within the owner's limit but above the management limit goes to management.
 pre=await update(pre,'reviseQuote',{quoteMinor:9500,reason:'Spare barrel does not fit'});
 assert.equal(pre.data.phase,'management_approval');assert.equal(pre.data.resumePhase,'triage');
 await as(MANAGER);pre=await update(pre,'approveManagement',{});assert.equal(pre.data.phase,'triage');

 // Switched off again: nothing more needs management.
 await setLimit(null);assert.equal((await financeRead('policy')).managementRepairLimitMinor,null);
 await as(STAYS);const free=await report(home,{issue:'Cheap fix again',estimatedCostMinor:9000});
 assert.equal(free.data.phase,'triage');
});

test('owner reports show each owner only their own bookings; cleaners are refused',async()=>{
 await db.exec('reset role');
 const stay=(prop,reference,checkIn,checkOut,status,extra={})=>db.query("insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,channel,channel_reference,guests,payout_minor) values($1,$2,$3,$4,$5,'hostaway',$6,$7,$8,$9)",
  [prop,reference,checkIn,checkOut,status,extra.channel??'airbnb',extra.code??null,extra.guests??null,extra.payout??null]);
 await stay(home,'HA:1','2026-09-28','2026-10-03','confirmed',{code:'HMABC123',guests:2,payout:40000});
 await stay(home,'HA:2','2026-10-10','2026-10-14','confirmed',{channel:'booking_com',code:'1234567890',guests:3,payout:52000});
 await stay(home,'HA:3','2026-10-20','2026-10-22','cancelled',{payout:99999});
 await stay(other,'HA:4','2026-10-05','2026-10-07','confirmed',{payout:30000});

 await as(OWNER);
 const mine=await bookings('2026-10-01','2026-10-31');
 assert.deepEqual(mine.stays.map(s=>s.reference),['HA:1','HA:2'],'confirmed stays overlapping the month, own properties only');
 const first=mine.stays[0];
 assert.equal(first.nights,5);assert.equal(first.guests,2);assert.equal(first.channel,'airbnb');assert.equal(first.channelReference,'HMABC123');assert.equal(first.payoutMinor,40000);assert.equal(first.propertyName,'Owner home');
 assert.deepEqual(mine.properties.map(p=>p.propertyName),['Owner home']);
 assert.equal(mine.properties[0].bookedNights,6,'two nights of the September stay fall in October, plus four');
 assert.equal(mine.properties[0].payoutMinor,92000,'payouts for stays checking out in October');
 await assert.rejects(bookings('2026-01-01','2027-06-01'),/400 days/);

 await as(OTHER_OWNER);
 const theirs=await bookings('2026-10-01','2026-10-31');
 assert.deepEqual(theirs.stays.map(s=>s.reference),['HA:4']);assert.ok(!theirs.properties.some(p=>p.propertyName==='Owner home'));

 // An owner without the dashboard tool sees nothing.
 await db.exec('reset role');await db.query("delete from public.workspace_module_grants where user_id=$1 and module_id='client-dashboard'",[users[OTHER_OWNER]]);
 await as(OTHER_OWNER);assert.deepEqual((await bookings('2026-10-01','2026-10-31')).stays,[]);

 await as(CLEANER);await assert.rejects(bookings('2026-10-01','2026-10-31'),/Owner reports access/);
 await as(STAYS);await assert.rejects(bookings('2026-10-01','2026-10-31'),/Owner reports access/);
 await as(ADMIN);const all=await bookings('2026-10-01','2026-10-31');
 assert.deepEqual(all.stays.map(s=>s.reference).sort(),['HA:1','HA:2','HA:4']);
});
