import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const roles=['super_admin','client','client','stays','ready','cleans','cleaning_manager'];
const users=roles.map((_,i)=>`51000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`operations${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[users[i].replace('5100','5200'),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[users[i].replace('5100','5200'),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2 where user_id=$1",[users[i],roles[i]]);
 await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features',[users[i]]);
}
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[i],session_id:users[i].replace('5100','5200')})]);await db.exec('set role authenticated');}
const action=async input=>(await db.query('select public.workspace_operations_action($1::jsonb) result',[JSON.stringify({requestId:crypto.randomUUID(),...input})])).rows[0].result;
const update=async (w,step,data)=>action({action:'updateOperation',workId:w.workId,version:w.version,step,data});
const create=async (kind,data)=>action({action:'createOperation',propertyId:property,kind,data});
let property,booking,repair,clean,purchase;
await as(0);property=(await db.query('select public.workspace_save_property($1::jsonb) id',[JSON.stringify({requestId:crypto.randomUUID(),name:'Operations property',address:'Test address',region:'Edinburgh',bedrooms:2})])).rows[0].id;
for(let i=1;i<users.length;i++)if(i!==2)await db.query('select public.workspace_assign_property($1,$2,$3)',[property,users[i],i===1?'client':i===5?'cleaner':i===6?'cleaning_manager':'staff']);
// Test-only private owner preferences. Hosted workspace remains empty.
await db.exec('reset role');
const journeyWork=(await db.query("insert into public.workspace_work_items(property_id,module_id,title,created_by,request_id) values($1,'property-onboarding','Test journey',$2,$3) returning id",[property,users[0],crypto.randomUUID()])).rows[0].id;
await db.query("insert into private.workspace_journeys(property_id,client_id,work_id,property_type,bathrooms,form) values($1,$2,$3,'Flat',1,$4::jsonb)",[property,users[1],journeyWork,JSON.stringify({repairLimitMinor:10000,fullRepairPermission:false,warrantyDetails:'Contact manufacturer first',mailPreference:'leave_safely'})]);
const today=(await db.query('select current_date::text d')).rows[0].d;
const dateAfter=async n=>(await db.query('select (current_date+$1::int)::text d',[n])).rows[0].d;
beforeEach(async()=>{await db.exec('reset role');await db.exec('delete from private.workspace_write_limits');await as(0);});
after(()=>db.close());

test('seven-night reservation creates exactly one follow-up; unconfirmed policy cannot quote',async()=>{
 await as(3);const input={action:'recordReservation',requestId:crypto.randomUUID(),propertyId:property,reference:'TEST-SEVEN',checkIn:await dateAfter(20),checkOut:await dateAfter(27),status:'confirmed'};
 const r=await action(input);assert.ok(r.followUpWorkId);assert.equal(r.discountConfirmed,false);assert.deepEqual(await action(input),r);
 booking=(await db.query('select public.workspace_operations_read($1) data',[property])).rows[0].data.find(w=>w.workId===r.followUpWorkId);
 await assert.rejects(update(booking,'prepareQuote',{checkIn:await dateAfter(40),checkOut:await dateAfter(47),baseAmountMinor:200000}),/not confirmed/);
 await assert.rejects(action({...input,requestId:crypto.randomUUID(),reference:'OVERLAP'}),/overlaps/);
 await as(1);await assert.rejects(action({action:'configureBookingPolicy',version:1,minimumNights:7,discountBps:1000,discountCapMinor:10000,confirmed:true}),/Super admin/);
});
test('policy version freezes capped quote; acceptance does not confirm until matching invoice is paid',async()=>{
 const p=await action({action:'configureBookingPolicy',version:1,minimumNights:7,discountBps:1000,discountCapMinor:10000,confirmed:true});assert.equal(p.version,2);
 await as(3);booking=await update(booking,'prepareQuote',{checkIn:await dateAfter(40),checkOut:await dateAfter(47),baseAmountMinor:200000});assert.equal(booking.data.quoteAmountMinor,190000);
 booking=await update(booking,'recordGuestAcceptance',{guestEvidence:'Recorded guest acceptance reference TEST'});assert.equal(booking.status,'approved');
 await assert.rejects(update(booking,'confirmBooking',{invoiceId:crypto.randomUUID(),reference:'DIRECT-TEST'}),/paid booking invoice/);
 await as(0);const invoice=(await db.query('select public.workspace_create_invoice($1::jsonb) id',[JSON.stringify({requestId:crypto.randomUUID(),propertyId:property,moduleId:'owner-statements',workId:booking.workId,recipientId:users[1],reference:'DIRECT-INVOICE',amountMinor:190000,currency:'GBP'})])).rows[0].id;
 await assert.rejects(update(booking,'confirmBooking',{invoiceId:invoice,reference:'DIRECT-TEST'}),/paid booking invoice/);
 await db.query("select public.workspace_set_invoice_status($1,1,'paid')",[invoice]);booking=await update(booking,'confirmBooking',{invoiceId:invoice,reference:'DIRECT-TEST'});assert.equal(booking.status,'completed');
});
test('daily listing evidence creates one relisting task; pricing cannot target occupied nights',async()=>{
 await as(3);const input={action:'createOperation',requestId:crypto.randomUUID(),propertyId:property,kind:'listing_health',data:{checkedOn:today,platform:'Airbnb',listingVisible:true,reviewSentiment:'negative',reviewAcknowledged:true,suspended:false,evidence:'Actual recorded negative review reference',relist:true}};
 const checked=await action(input);assert.equal(checked.status,'completed');assert.deepEqual(await action(input),checked);
 await assert.rejects(action({...input,requestId:crypto.randomUUID()}),/already exists/);
 const rows=(await db.query('select public.workspace_operations_read($1) data',[property])).rows[0].data;assert.equal(rows.filter(w=>w.kind==='relisting').length,1);
 await action({action:'recordReservation',propertyId:property,reference:'THIS-WEEK',checkIn:today,checkOut:await dateAfter(1),status:'confirmed'});
 await assert.rejects(create('daily_pricing',{night:today,currentRateMinor:12000,proposedRateMinor:11000,decision:'change',reason:'Recorded gap reason'}),/occupied/);
 let pricing=await create('daily_pricing',{night:await dateAfter(2),currentRateMinor:12000,proposedRateMinor:11000,decision:'change',reason:'Recorded gap reason'});assert.equal(pricing.data.phase,'proposed');
 pricing=await update(pricing,'recordApplied',{evidence:'Manually applied in actual listing dashboard'});assert.equal(pricing.status,'completed');
});
test('maintenance above owner limit requires consent and warranty contact before shared Ready referral',async()=>{
 await as(3);repair=await create('maintenance',{issue:'Heating is not working',estimatedCostMinor:15000,hazard:false});assert.equal(repair.data.phase,'management_approval');
 await assert.rejects(update(repair,'referReady',{troubleshooting:'Checked user thermostat setting',guestUpdate:'Guest informed of escalation'}),/Owner budget/);
 await as(0);repair=await update(repair,'approveManagement',{});assert.equal(repair.data.phase,'owner_approval');
 await as(2);assert.deepEqual((await db.query('select public.workspace_operations_read($1) data',[property])).rows[0].data,[]);await assert.rejects(update(repair,'approveBudget',{consent:true}),/Work access/);
 await as(1);repair=await update(repair,'approveBudget',{consent:true});
 await as(3);await assert.rejects(update(repair,'referReady',{troubleshooting:'Checked user thermostat setting',guestUpdate:'Guest informed of escalation'}),/warrantyContactEvidence/);
 repair=await update(repair,'referReady',{troubleshooting:'Checked user thermostat setting',warrantyContactEvidence:'Manufacturer contacted and could not repair',guestUpdate:'Guest informed of escalation',readyUserId:users[4]});
 await as(4);const shared=(await db.query('select public.workspace_operations_read($1) data',[property])).rows[0].data.find(w=>w.workId===repair.workId);assert.ok(shared);
 repair=await update(repair,'bookRepair',{repairOn:today,visitFrom:'10:00',visitTo:'12:00',contractor:'Test-only repair company',guestUpdate:'Guest informed of booked repair'});
 await assert.rejects(update(repair,'completeRepair',{report:'Repair report with test findings',actualCostMinor:16000,guestUpdate:'Guest informed of completion'}),/Increased repair/);
 repair=await update(repair,'completeRepair',{report:'Repair report with test findings',actualCostMinor:15000,guestUpdate:'Guest informed of completion'});assert.equal(repair.status,'completed');
});
test('cleaner needs assignment and verified media; generic buttons cannot approve or invoice unreviewed work',async()=>{
 await as(6);clean=await create('cleaning',{dueOn:today,checklist:['Kitchen','Bathroom']});
 await as(0);await db.query('select public.workspace_assign_work($1,$2,$3)',[clean.workId,clean.version,users[5]]);clean.version++;
 await as(5);await assert.rejects(update(clean,'submitCleaning',{checks:['Kitchen','Bathroom'],report:'Cleaned required rooms',photoIds:[crypto.randomUUID()],mailAction:'leave_safely'}),/Verified cleaning photos/);
 await assert.rejects(db.query("select public.workspace_transition_work($1,$2,'in_progress','',$3)",[clean.workId,clean.version,crypto.randomUUID()]),/evidence-based/);
 await as(0);await assert.rejects(db.query('select public.workspace_create_invoice($1::jsonb)',[JSON.stringify({requestId:crypto.randomUUID(),propertyId:property,moduleId:'cleans-invoices',recipientId:users[5],reference:'PREMATURE-CLEAN',amountMinor:5000,currency:'GBP'})]),/Accepted cleaning/);
 await db.exec('reset role');const photo=(await db.query("insert into private.workspace_media_evidence(property_id,work_id,owner_id,purpose,provider_id,verified_at) values($1,$2,$3,'cleaning','TEST-ONLY-clean-photo',now()) returning id",[property,clean.workId,users[5]])).rows[0].id;
 await as(5);await assert.rejects(update(clean,'submitCleaning',{checks:['Kitchen','Bathroom'],report:'Cleaned required rooms',photoIds:[photo],mailAction:'open_and_photograph'}),/mailbox consent/);
 clean=await update(clean,'submitCleaning',{checks:['Kitchen','Bathroom'],report:'Cleaned required rooms',photoIds:[photo],mailAction:'leave_safely'});assert.equal(clean.status,'in_review');
 await as(6);clean=await update(clean,'reviewCleaning',{accepted:true,guestFeedback:'Actual test guest feedback',reviewNote:'Manager reviewed all required evidence'});assert.equal(clean.status,'completed');
});
test('purchase requires Accounts approval, verified Ready delivery and matching paid invoice',async()=>{
 await as(3);purchase=await create('purchase',{requirements:'Replacement bed and mattress',budgetMinor:60000});
 await assert.rejects(update(purchase,'approvePurchase',{approvedAmountMinor:50000,approvalNote:'Within property budget'}),/Accounts approval/);
 await as(0);purchase=await update(purchase,'approvePurchase',{approvedAmountMinor:50000,approvalNote:'Within property budget'});purchase=await update(purchase,'recordOrder',{orderReference:'TEST-ORDER',supplier:'Test supplier'});
 await assert.rejects(update(purchase,'reconcilePurchase',{invoiceId:crypto.randomUUID(),reconciliation:'Checked invoice and delivery'}),/paid purchase invoice/);
 await db.exec('reset role');assert.equal((await db.query("select w.status from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='purchase_delivery' and d.data->>'sourceWorkId'=$1",[purchase.workId])).rows[0].status,'waiting');
 await as(4);await assert.rejects(update(purchase,'recordDelivery',{receivedOn:today,evidence:'Delivery recorded test receipt',photoIds:[crypto.randomUUID()]}),/Verified delivery/);
 await db.exec('reset role');const photo=(await db.query("insert into private.workspace_media_evidence(property_id,work_id,owner_id,purpose,provider_id,verified_at) values($1,$2,$3,'delivery','TEST-ONLY-delivery-photo',now()) returning id",[property,purchase.workId,users[4]])).rows[0].id;
 await as(4);purchase=await update(purchase,'recordDelivery',{receivedOn:today,evidence:'Delivery recorded test receipt',photoIds:[photo]});
 const deliveryTicket=async()=>(await db.query("select w.status,d.data->>'workStatus' work_status from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='purchase_delivery' and d.data->>'sourceWorkId'=$1",[purchase.workId])).rows;
 await db.exec('reset role');assert.deepEqual(await deliveryTicket(),[{status:'completed',work_status:'completed'}]);
 await as(0);const invoice=(await db.query('select public.workspace_create_invoice($1::jsonb) id',[JSON.stringify({requestId:crypto.randomUUID(),propertyId:property,moduleId:'purchase-order-accounts',workId:purchase.workId,recipientId:users[1],reference:'PURCHASE-TEST',amountMinor:50000,currency:'GBP'})])).rows[0].id;
 await db.query("select public.workspace_set_invoice_status($1,1,'paid')",[invoice]);purchase=await update(purchase,'reconcilePurchase',{invoiceId:invoice,reconciliation:'Checked invoice and delivery evidence'});assert.equal(purchase.status,'completed');
});
test('licence task needs actual dated grant evidence, and private data is never directly accessible',async()=>{
 await db.exec('reset role');const work=(await db.query("select private.workspace_handover($1,'licensing','Test licence task','licensing','{}') id",[property])).rows[0].id;
 await as(3);let item=(await db.query('select public.workspace_operations_read($1) data',[property])).rows[0].data.find(w=>w.workId===work);
 await assert.rejects(update(item,'recordGranted',{reference:'TEST-LIC',grantedOn:today,checklist:{application:true,safetyChecks:false,authorityGrant:true},evidence:'Actual authority grant reference'}),/Authority grant/);
 item=await update(item,'recordGranted',{reference:'TEST-LIC',grantedOn:today,checklist:{application:true,safetyChecks:true,authorityGrant:true},evidence:'Actual authority grant reference'});assert.equal(item.status,'completed');
 await assert.rejects(db.query('select * from private.workspace_booking_policy'),/permission denied/);
 await as(2);assert.deepEqual((await db.query('select public.workspace_operations_read($1) data',[property])).rows[0].data,[]);
});
test('portfolio totals and UK-dated weekly report use actual scoped records and sourced events',async()=>{
 await as(3);const save=async input=>(await db.query('select public.workspace_portfolio_action($1::jsonb) data',[JSON.stringify({requestId:crypto.randomUUID(),propertyId:property,...input})])).rows[0].data;
 const read=async (section,extra={})=>(await db.query('select public.workspace_portfolio_read($1,$2,$3,$4) data',[section,property,extra.from||null,extra.to||null])).rows[0].data;
 await save({action:'saveLocation',version:1,latitude:55.9533,longitude:-3.1883,hostawayListingId:'TEST-ONLY-MANUAL-LINK'});
 const portfolio=await read('portfolio');assert.equal(portfolio.count,1);assert.equal(portfolio.properties[0].latitude,55.9533);assert.equal(portfolio.regions[0].properties,1);
 await save({action:'recordLocalEvent',name:'Actual sourced test event',eventOn:await dateAfter(10),sourceUrl:'https://example.com/test-only-event',opportunity:'Recorded test opportunity for this property'});
 const report=await read('weekly',{from:today,to:today});assert.equal(report.listingChecks.length,1);assert.equal(report.pricing.length,1);assert.equal(report.events.length,1);assert.equal(report.events[0].eventOn,await dateAfter(10));assert.equal(report.pricing[0].phase,'applied');assert.equal(JSON.stringify(report).includes('warranty'),false);
 const gaps=await read('vacancies');assert.equal(gaps.length,7);assert.equal(gaps[0].occupied,true);assert.equal(gaps[2].occupied,false);
 await as(1);assert.equal((await read('weekly',{from:today,to:today})).propertyId,property);
 await as(2);await assert.rejects(read('weekly',{from:today,to:today}),/report access denied/);assert.equal((await read('portfolio')).count,0);
});
test('access changes invalidate cached action receipts and revoked property assignments never expose rows',async()=>{
 await as(3);const input={action:'recordReservation',requestId:crypto.randomUUID(),propertyId:property,reference:'REVOKED-RETRY',checkIn:await dateAfter(70),checkOut:await dateAfter(72),status:'enquiry'};await action(input);
 await db.exec('reset role');await db.query("update public.workspace_profiles set status='revoked' where user_id=$1",[users[3]]);
 await as(3);await assert.rejects(action(input),/Active access/);assert.equal((await db.query('select * from public.workspace_properties')).rows.length,0);
 await db.exec('reset role');await db.query("update public.workspace_profiles set status='active',role='client' where user_id=$1",[users[3]]);await as(3);await assert.rejects(action(input),/access changed/);
 await db.exec('reset role');await db.query("update public.workspace_profiles set role='stays' where user_id=$1",[users[3]]);
});
test('department handovers produce scoped in-app notifications, without asserting external delivery',async()=>{
 await as(4);const notes=(await db.query("select public.workspace_portfolio_read('notifications') data")).rows[0].data;assert.ok(notes.some(n=>n.event_type==='handover.created'));assert.ok(notes.every(n=>n.status==='available_in_app'));
 await as(2);assert.deepEqual((await db.query("select public.workspace_portfolio_read('notifications') data")).rows[0].data,[]);
});
