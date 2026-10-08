import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'vite';

// Accounts and Ready: expense paperwork photos, the draft expense a completed repair creates,
// purchases closed against their supplier invoice, Stays confirming a paid direct booking,
// Ready's access instructions, Ready Home, and routine visits created and reminded on schedule.
// Everyone holds their role's default tools, as in the live app.
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false}});
const {DEFAULT_ROLE_MODULES}=await vite.ssrLoadModule('/lib/modules.ts');
await vite.close();
const db=new PGlite();
const roles=['super_admin','accounts','stays','ready','client','ready','ready'];
const [ADMIN,ACCOUNTS,STAYS,READY,OWNER,OTHER_READY,PURCHASE_READY]=roles.map((_,i)=>i);
const users=roles.map((_,i)=>`86000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const session=i=>users[i].replace('8600','8700');
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`accounts-ready${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1",[users[i],roles[i],['Ada Admin','Aileen Accounts','Sam Stays','Rory Ready','Owen Owner','Olive Ready','Pat Ready'][i]]);
 // The last Ready person only holds purchases, not repairs, inspections or the Ready schedule.
 const modules=i===PURCHASE_READY?['purchase-order']:DEFAULT_ROLE_MODULES[roles[i]];
 await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,unnest($2::text[])',[users[i],modules]);
}
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(i==='service'?{}:{sub:users[i],session_id:session(i)})]);await db.exec(i==='service'?'set role service_role':'set role authenticated');}
const rpc=async(name,args=[])=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
const owner=async(text,args=[])=>{await db.exec('reset role');return (await db.query(text,args)).rows;};
const operation=input=>rpc('workspace_operations_action',[{requestId:crypto.randomUUID(),...input}]);
const update=(w,step,data)=>operation({action:'updateOperation',workId:w.workId,version:w.version,step,data});
const finance=input=>rpc('workspace_finance_action',[{requestId:crypto.randomUUID(),...input}]);
const accounts=input=>rpc('workspace_accounts_action',[{requestId:crypto.randomUUID(),...input}]);
const financeRead=(section,{propertyId=null,period=null,id=null,status=null}={})=>rpc('workspace_finance_read',[section,propertyId,period,id,status]);
const teams=input=>rpc('workspace_teams_action',[{requestId:crypto.randomUUID(),...input}]);
const prepare=(input,id=crypto.randomUUID())=>rpc('workspace_prepare_upload',[{requestId:id,purpose:'expense',contentHash:'e'.repeat(64),...input}]);
const commit=async intent=>{await as('service');return rpc('integration_commit_upload',[intent.id,{assetId:'storage:'+intent.publicId+'.jpg',publicId:intent.publicId,version:1,format:'jpg',bytes:4096}]);};
// A verified repair or delivery photo, as the photo service would save it.
const photo=async(work,purpose,by)=>(await owner("insert into private.workspace_media_evidence(property_id,work_id,owner_id,purpose,provider_id,verified_at,provider_asset_id,asset_format,asset_bytes,asset_version) select property_id,id,$2,$3,'TEST-'||gen_random_uuid(),now(),'storage:test.jpg','jpg',2048,1 from public.workspace_work_items where id=$1 returning id",[work,by,purpose]))[0].id;
const today=(await db.query('select current_date::text d')).rows[0].d;
const dateAfter=async n=>(await db.query('select (current_date+$1::int)::text d',[n])).rows[0].d;

await as(ADMIN);
const property=await rpc('workspace_save_property',[{requestId:crypto.randomUUID(),name:'Harbour flat',address:'1 Harbour Road',region:'Edinburgh',bedrooms:2}]);
const otherProperty=await rpc('workspace_save_property',[{requestId:crypto.randomUUID(),name:'Hill cottage',address:'2 Hill Road',region:'Edinburgh',bedrooms:3}]);
for(const [i,kind] of [[STAYS,'staff'],[READY,'staff'],[OWNER,'client'],[PURCHASE_READY,'staff']])await rpc('workspace_assign_property',[property,users[i],kind]);
await rpc('workspace_assign_property',[otherProperty,users[OTHER_READY],'staff']);
await rpc('workspace_save_property_details',[property,1,'access',{accessInstructions:'Key safe by the back door, code 4321'}]);
beforeEach(async()=>{await db.exec('reset role');await db.exec('delete from private.workspace_write_limits');});
after(()=>db.close());

async function completedRepair(cost=18000){
 await as(STAYS);
 let repair=await operation({action:'createOperation',propertyId:property,kind:'maintenance',data:{issue:'Kitchen tap leaking under the sink',estimatedCostMinor:20000,hazard:false,repairType:'leak'}});
 if(repair.data.phase==='owner_approval'){await as(OWNER);repair=await update(repair,'approveBudget',{consent:true});await as(STAYS);}
 repair=await update(repair,'referReady',{troubleshooting:'Isolated the water under the sink',guestUpdate:'A plumber is on the way'});
 await as(READY);repair=await update(repair,'bookRepair',{repairOn:today,contractor:'Leith Plumbing',guestUpdate:'Plumber booked for today'});
 const before=await photo(repair.workId,'maintenance',users[READY]),afterPhoto=await photo(repair.workId,'maintenance',users[READY]);
 await as(READY);
 await assert.rejects(update(repair,'completeRepair',{report:'Replaced the tap washer and checked for leaks',actualCostMinor:cost,guestUpdate:'All fixed',photoIds:[crypto.randomUUID()]}),/photos saved on this repair/);
 repair=await update(repair,'completeRepair',{report:'Replaced the tap washer and checked for leaks',actualCostMinor:cost,guestUpdate:'All fixed',photoIds:[afterPhoto]});
 return {repair,before,afterPhoto};
}

test('a completed repair becomes a draft expense with its report and photos; approving it marks the repair paid',async()=>{
 const {repair,before,afterPhoto}=await completedRepair();
 assert.equal(repair.status,'completed');assert.deepEqual(repair.data.photoIds,[afterPhoto]);
 await as(ACCOUNTS);
 const drafts=await financeRead('expenses',{status:'draft'});
 const draft=drafts.find(e=>e.workId===repair.workId);
 assert.ok(draft,'Accounts see the draft');
 assert.equal(draft.status,'draft');assert.equal(draft.source,'repair');assert.equal(draft.amountMinor,18000);assert.equal(draft.supplier,'Leith Plumbing');assert.equal(draft.category,'maintenance');
 const full=await financeRead('expense',{id:draft.id});
 assert.deepEqual(full.evidence.map(v=>v.label).sort(),['After photo','Before photo','Repair completion report']);
 assert.equal(full.evidence.find(v=>v.mediaId===before).label,'Before photo');assert.equal(full.evidence.find(v=>v.kind==='report').note,'Replaced the tap washer and checked for leaks');
 assert.ok(full.hasProof&&!full.hasInvoice);
 assert.equal((await financeRead('overview',{period:today.slice(0,7)})).draftCount>=1,true);
 // The repair's photos are now visible to Accounts, through the expense.
 assert.equal((await rpc('workspace_media_asset',[before])).providerAssetId,'storage:test.jpg');
 // The invoice task is still raised as before.
 assert.ok((await rpc('workspace_operations_read',[property])).some(w=>w.kind==='maintenance_invoice'&&w.data.sourceWorkId===repair.workId));
 // A draft can't be approved; Accounts add the real invoice details and the invoice itself first.
 await assert.rejects(finance({action:'approveExpense',expenseId:draft.id,version:full.version}),/not awaiting approval/);
 const intent=await prepare({expenseId:draft.id});const scan=await commit(intent);
 await as(ACCOUNTS);
 let expense=await accounts({action:'attachExpensePhotos',expenseId:draft.id,kind:'invoice',label:'Leith Plumbing invoice',mediaIds:[scan]});
 assert.ok(expense.hasInvoice);
 await assert.rejects(accounts({action:'submitDraftExpense',expenseId:draft.id,version:expense.version-1,supplier:'Leith Plumbing',reference:'LP-881',amountMinor:18000,receivedOn:today,description:'Kitchen tap repair'}),/changed/);
 expense=await accounts({action:'submitDraftExpense',expenseId:draft.id,version:expense.version,supplier:'Leith Plumbing',reference:'LP-881',amountMinor:18000,receivedOn:today,description:'Kitchen tap repair'});
 assert.equal(expense.status,'to_approve');assert.equal(expense.reference,'LP-881');
 await as(ADMIN);await finance({action:'approveExpense',expenseId:draft.id,version:expense.version});
 await as(READY);
 const paid=(await rpc('workspace_operations_read',[property])).find(w=>w.workId===repair.workId);
 assert.ok(paid.data.paidAt,'the repair shows as paid');assert.equal(paid.data.paidVia,'expense');
 assert.ok((await rpc('workspace_ready_home')).stages.paid>=1);
});

test('expense paperwork: Accounts upload and attach photos, link the job; others cannot',async()=>{
 const {repair}=await completedRepair(9000);
 await as(ACCOUNTS);
 const expense=await finance({action:'createExpense',propertyId:property,supplier:'Harbour Glass',reference:'HG-12',category:'maintenance',description:'Bathroom mirror replaced',amountMinor:9000,receivedOn:today,source:'manual'});
 const jobs=await rpc('workspace_accounts_read',['jobs',property,null]);
 assert.ok(jobs.some(j=>j.workId===repair.workId&&j.kind==='maintenance'&&j.costMinor===9000&&j.supplier==='Leith Plumbing'));
 const linked=await accounts({action:'linkExpenseJob',expenseId:expense.id,version:expense.version,workId:repair.workId});
 assert.equal(linked.workId,repair.workId);
 await assert.rejects(accounts({action:'linkExpenseJob',expenseId:expense.id,version:linked.version,workId:crypto.randomUUID()}),/finished repair or delivered purchase/);
 const first=await prepare({expenseId:expense.id}),replayId=crypto.randomUUID();
 const second=await prepare({expenseId:expense.id},replayId);assert.deepEqual(await prepare({expenseId:expense.id},replayId),second,'a retried upload is the same upload');
 const [a,b]=[await commit(first),await commit(second)];
 assert.equal(await commit(second),b,'committing twice keeps one photo');
 await as(ACCOUNTS);
 const withPhotos=await accounts({action:'attachExpensePhotos',expenseId:expense.id,kind:'photo',label:'New mirror fitted',mediaIds:[a,b]});
 assert.deepEqual(withPhotos.evidence.filter(v=>v.mediaId).map(v=>v.label).sort(),['New mirror fitted','New mirror fitted (2)']);
 assert.ok(await rpc('workspace_media_asset',[a]));
 // Only photos saved on this expense (or its linked job) can be attached.
 const otherExpense=await finance({action:'createExpense',propertyId:property,supplier:'Harbour Glass',reference:'HG-13',category:'maintenance',description:'Second mirror',amountMinor:5000,receivedOn:today,source:'manual'});
 await assert.rejects(accounts({action:'attachExpensePhotos',expenseId:otherExpense.id,kind:'photo',label:'Wrong photo',mediaIds:[a]}),/saved on this expense/);
 for(const who of [STAYS,READY,OWNER]){
  await as(who);
  await assert.rejects(prepare({expenseId:expense.id}),/denied/);
  await assert.rejects(rpc('workspace_media_asset',[a]),/denied/);
  await assert.rejects(accounts({action:'attachExpensePhotos',expenseId:expense.id,kind:'photo',label:'Sneaky',mediaIds:[a]}),/access required/);
 }
 // Decided expenses take no more paperwork.
 await as(ACCOUNTS);await finance({action:'rejectExpense',expenseId:otherExpense.id,version:otherExpense.version,note:'Duplicate of HG-12'});
 await assert.rejects(prepare({expenseId:otherExpense.id}),/denied/);
});

test('Accounts record a delivered purchase supplier invoice as paid, then reconcile closes the purchase',async()=>{
 await as(STAYS);let purchase=await operation({action:'createOperation',propertyId:property,kind:'purchase',data:{requirements:'Two bedside lamps',budgetMinor:8000}});
 await as(ACCOUNTS);purchase=await update(purchase,'approvePurchase',{approvedAmountMinor:7000,approvalNote:'Two lamps within budget'});
 await assert.rejects(accounts({action:'recordPurchaseInvoice',purchaseId:purchase.workId,reference:'LAMPS-1',amountMinor:7000,paid:true}),/once the purchase has been delivered/);
 purchase=await update(purchase,'recordOrder',{orderReference:'ORDER-9',supplier:'Lamp shop'});
 const delivered=await photo(purchase.workId,'delivery',users[READY]);
 await as(READY);purchase=await update(purchase,'recordDelivery',{receivedOn:today,evidence:'Two lamps arrived, boxed and undamaged',photoIds:[delivered]});
 await assert.rejects(accounts({action:'recordPurchaseInvoice',purchaseId:purchase.workId,reference:'LAMPS-1',amountMinor:7000,paid:true}),/purchase access required/);
 await assert.rejects(prepare({workId:purchase.workId}),/denied/,'Ready do not add invoice scans');
 await as(ACCOUNTS);
 const scan=await commit(await prepare({workId:purchase.workId}));
 await as(ACCOUNTS);assert.ok((await rpc('workspace_media_read',[purchase.workId])).some(m=>m.id===scan&&m.purpose==='expense'),'the invoice scan is on the purchase');
 await assert.rejects(accounts({action:'recordPurchaseInvoice',purchaseId:purchase.workId,reference:'LAMPS-1',amountMinor:7001,paid:true}),/more than the approved amount/);
 const input={action:'recordPurchaseInvoice',requestId:crypto.randomUUID(),purchaseId:purchase.workId,reference:'LAMPS-1',amountMinor:6800,paid:true};
 const invoice=await rpc('workspace_accounts_action',[input]);
 assert.equal(invoice.status,'paid');assert.deepEqual(await rpc('workspace_accounts_action',[input]),invoice,'a retry returns the same invoice');
 assert.equal((await accounts({action:'recordPurchaseInvoice',purchaseId:purchase.workId,reference:'LAMPS-1',amountMinor:6800,paid:true})).invoiceId,invoice.invoiceId);
 await assert.rejects(accounts({action:'recordPurchaseInvoice',purchaseId:purchase.workId,reference:'LAMPS-2',amountMinor:6800,paid:true}),/Another invoice/);
 assert.ok((await db.query('select id from public.workspace_invoices where id=$1',[invoice.invoiceId])).rows.length,'Accounts see the invoice to pick it');
 purchase=await update(purchase,'reconcilePurchase',{invoiceId:invoice.invoiceId,reconciliation:'Invoice matches the order and the delivery'});
 assert.equal(purchase.status,'completed');assert.equal(purchase.data.phase,'reconciled');
});

test('Stays see and confirm the paid direct-booking invoice, still without owner statements',async()=>{
 const version=(await owner('select version from private.workspace_booking_policy where singleton'))[0].version;
 await as(ADMIN);await operation({action:'configureBookingPolicy',version,minimumNights:7,discountBps:1000,discountCapMinor:10000,confirmed:true});
 await as(STAYS);
 const r=await operation({action:'recordReservation',propertyId:property,reference:'RETURNING-GUEST',checkIn:await dateAfter(30),checkOut:await dateAfter(37),status:'confirmed'});
 let booking=(await rpc('workspace_operations_read',[property])).find(w=>w.workId===r.followUpWorkId);
 booking=await update(booking,'prepareQuote',{checkIn:await dateAfter(60),checkOut:await dateAfter(67),baseAmountMinor:150000});
 booking=await update(booking,'recordGuestAcceptance',{guestEvidence:'Guest accepted by email on Monday'});
 await as(ACCOUNTS);
 const issued=await rpc('workspace_controls_action',[{action:'issueOperationInvoice',requestId:crypto.randomUUID(),propertyId:property,workId:booking.workId,reference:'DIRECT-77',amountMinor:booking.data.quoteAmountMinor}]);
 await db.query("select public.workspace_set_invoice_status($1,1,'paid')",[issued.invoiceId]);
 // Another owner-statements invoice at the same property, not for a direct booking.
 const statementInvoice=await rpc('workspace_create_invoice',[{requestId:crypto.randomUUID(),propertyId:property,moduleId:'owner-statements',recipientId:users[OWNER],reference:'OWNER-BALANCE-1',amountMinor:2500,currency:'GBP'}]);
 await as(STAYS);
 const visible=(await db.query('select id from public.workspace_invoices')).rows.map(x=>x.id);
 assert.ok(visible.includes(issued.invoiceId),'Stays see the booking invoice');
 assert.ok(!visible.includes(statementInvoice),'but not other owner-statement invoices');
 booking=await update(booking,'confirmBooking',{invoiceId:issued.invoiceId,reference:'DIRECT-77'});
 assert.equal(booking.status,'completed');
 await assert.rejects(financeRead('statements',{period:today.slice(0,7)}),/Accounts access required/);
 assert.equal((await db.query("select private.has_workspace_module('owner-statements') v")).rows[0].v,false);
 await as(READY);assert.ok(!(await db.query('select id from public.workspace_invoices')).rows.some(x=>x.id===issued.invoiceId),'Ready do not see it');
});

test('Ready read the access instructions for properties they look after, not logins or finance',async()=>{
 await as(READY);
 assert.deepEqual(await rpc('workspace_property_details',[property,'access']),{accessInstructions:'Key safe by the back door, code 4321'});
 await assert.rejects(rpc('workspace_property_details',[property,'ota']),/OTA access denied/);
 await assert.rejects(rpc('workspace_property_details',[property,'finance']),/Financial access denied/);
 await as(OTHER_READY);await assert.rejects(rpc('workspace_property_details',[property,'access']),/Property access denied/,'not their property');
 await as(PURCHASE_READY);await assert.rejects(rpc('workspace_property_details',[property,'access']),/Property access denied/,'no repairs, inspections or schedule tool');
 await as(OWNER);await assert.rejects(rpc('workspace_property_details',[property,'access']),/Property access denied/);
});

test('routine visits are created on schedule for this month and next, once, with one reminder three days ahead',async()=>{
 await as(READY);
 const plan=await teams({action:'saveRoutinePlan',propertyId:property,moduleId:'routine-bin-garden-board',title:'Bins and garden',checklist:['Bins out','Lawn cut'],frequency:'monthly',dayOfMonth:10,assigneeId:users[READY],active:true});
 await teams({action:'saveRoutinePlan',propertyId:property,moduleId:'safety-maintenance',title:'Smoke alarm test',checklist:['Test alarms'],frequency:'quarterly',dayOfMonth:20,active:true});
 // Many more plans at another property, so one run can't create them all.
 await owner("insert into private.workspace_routine_plans(property_id,module_id,title,checklist,frequency,day_of_month,starts_on,created_by,request_id) select $1,'ready-schedule','Walk-round '||n,'[\"Walk round\"]','monthly',28,date_trunc('month',current_date)::date,$2,gen_random_uuid() from generate_series(1,21) n",[otherProperty,users[ADMIN]]);
 await as(READY);await assert.rejects(rpc('workspace_routine_auto'),/permission denied/,'only the server runs the schedule');
 // Run as if it were the 8th of this month: the bins visit on the 10th is three days away or less.
 const at=(await db.query("select (date_trunc('month',current_date)+interval '7 days 12 hours')::timestamp at time zone 'Europe/London' t")).rows[0].t;
 const run=async()=>{await as('service');return (await db.query('select private.workspace_routine_auto($1) r',[at])).rows[0].r;};
 const first=await run();
 assert.equal(first.created,40);assert.equal(first.remaining,5,'2 bins + 1 alarm + 42 walk-rounds, 40 per run');assert.equal(first.reminded,1);
 const second=await run();assert.equal(second.created,5);assert.equal(second.remaining,0);assert.equal(second.reminded,0,'reminded once');
 assert.deepEqual(await run(),{created:0,remaining:0,reminded:0});
 const reminders=await owner("select o.user_id from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where a.event_type='routine.visit_due'");
 assert.deepEqual(reminders.map(x=>x.user_id),[users[READY]]);
 const visits=await owner('select v.period_start::text p,w.due_on::text due,w.assignee_id from private.workspace_routine_visits v join public.workspace_work_items w on w.id=v.work_id where v.plan_id=$1 order by 1',[plan.id]);
 assert.equal(visits.length,2);assert.ok(visits.every(v=>v.due.endsWith('-10')&&v.assignee_id===users[READY]));
 // Creating this month's visits by hand finds nothing left to do.
 await as(READY);assert.equal((await teams({action:'generateRoutineVisits',period:today.slice(0,7)})).created.length,0);
 // Ready Home: this month's visits for the property they look after (not the other property).
 const home=await rpc('workspace_ready_home');
 const mine=home.visits.find(v=>v.propertyId===property);
 assert.deepEqual(mine.items.map(i=>i.title).sort(),['Bins and garden','Smoke alarm test']);
 assert.ok(!home.visits.some(v=>v.propertyId===otherProperty));
 await as(OWNER);await assert.rejects(rpc('workspace_ready_home'),/Ready access required/);
});
