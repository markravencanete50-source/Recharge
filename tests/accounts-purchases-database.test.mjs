import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Accounts work purchase requests against the budget chart; accepted cleans carry the cleaner's
// name for one invoice; "remove from the rota" takes effect.
const db=new PGlite();
const roles=['super_admin','accounts','stays','ready','cleans','cleaning_manager','client'];
const users=roles.map((_,i)=>`81000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const session=i=>users[i].replace('8100','8200');
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`accounts-flow${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1",[users[i],roles[i],['Admin','Aileen Accounts','Sam Stays','Rory Ready','Cara Cleaner','Mo Manager','Owen Owner'][i]]);
 await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features',[users[i]]);
}
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[i],session_id:session(i)})]);await db.exec('set role authenticated');}
beforeEach(async()=>{await db.exec('reset role');await db.exec('delete from private.workspace_write_limits');});
const action=async input=>(await db.query('select public.workspace_operations_action($1::jsonb) result',[JSON.stringify({requestId:crypto.randomUUID(),...input})])).rows[0].result;
const create=(kind,data)=>action({action:'createOperation',propertyId:property,kind,data});
const update=(w,step,data)=>action({action:'updateOperation',workId:w.workId,version:w.version,step,data});
const team=async input=>(await db.query('select public.workspace_teams_action($1::jsonb) result',[JSON.stringify({requestId:crypto.randomUUID(),...input})])).rows[0].result;
const teamRead=async section=>(await db.query('select public.workspace_teams_read($1,null,null,null,null) result',[section])).rows[0].result;
const owner=async sql=>{await db.exec('reset role');return (await db.query(sql.text,sql.args)).rows;};
const today=(await db.query("select (now() at time zone 'Europe/London')::date::text d")).rows[0].d;
let property,chair;
await as(0);property=(await db.query('select public.workspace_save_property($1::jsonb) id',[JSON.stringify({requestId:crypto.randomUUID(),name:'Accounts property',address:'Test address',region:'Glasgow',bedrooms:2})])).rows[0].id;
for(const [i,assignment] of [[2,'staff'],[3,'staff'],[4,'cleaner'],[5,'cleaning_manager'],[6,'client']])await db.query('select public.workspace_assign_property($1,$2,$3)',[property,users[i],assignment]);
await db.exec('reset role');

test('Accounts keep the budget chart; the team can read it; others cannot change it',async()=>{
 await as(1);chair=await team({action:'saveBudgetItem',item:'Dining chair',maxUnitMinor:6000,note:'Oak or similar'});
 await assert.rejects(team({action:'saveBudgetItem',item:'dining chair ',maxUnitMinor:5000}),/already in the budget chart/);
 const lamp=await team({action:'saveBudgetItem',item:'Bedside lamp',maxUnitMinor:2500});
 await team({action:'removeBudgetItem',id:lamp.id,version:lamp.version});
 await as(2);assert.deepEqual((await teamRead('budgetChart')).map(b=>b.item),['Dining chair']);
 await assert.rejects(team({action:'saveBudgetItem',item:'Sofa',maxUnitMinor:50000}),/Accounts access/);
 await as(6);await assert.rejects(teamRead('budgetChart'),/Team access/);
});

test('Accounts are told about, approve against the chart, order and reconcile a purchase',async()=>{
 await as(2);let purchase=await create('purchase',{requirements:'Two dining chairs, one broke',budgetMinor:15000});
 assert.equal((await owner({text:"select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and o.work_id=$2 and a.event_type='operations.createOperation'",args:[users[1],purchase.workId]}))[0].n,1,'Accounts are told');
 await as(1);
 assert.ok((await db.query('select public.workspace_operations_read($1) data',[property])).rows[0].data.some(w=>w.workId===purchase.workId),'Accounts see the request');
 await assert.rejects(update(purchase,'approvePurchase',{approvedAmountMinor:13000,approvalNote:'Two chairs at the usual price',budgetItemId:chair.id,quantity:2}),/Over the budget chart/);
 await assert.rejects(update(purchase,'approvePurchase',{approvedAmountMinor:11000,approvalNote:'Missing quantity',budgetItemId:chair.id}),/budget chart item/);
 purchase=await update(purchase,'approvePurchase',{approvedAmountMinor:11000,approvalNote:'Two chairs within the chart',budgetItemId:chair.id,quantity:2});
 assert.equal(purchase.data.budgetItem,'Dining chair');assert.equal(purchase.data.budgetMaxMinor,12000);
 purchase=await update(purchase,'recordOrder',{orderReference:'ORDER-77',supplier:'Test supplier'});assert.equal(purchase.data.phase,'ordered');
 await db.exec('reset role');const photo=(await db.query("insert into private.workspace_media_evidence(property_id,work_id,owner_id,purpose,provider_id,verified_at) values($1,$2,$3,'delivery','TEST-ONLY-delivery',now()) returning id",[property,purchase.workId,users[3]])).rows[0].id;
 await as(3);purchase=await update(purchase,'recordDelivery',{receivedOn:today,evidence:'Two chairs delivered and checked',photoIds:[photo]});
 await as(1);const invoice=(await db.query('select public.workspace_create_invoice($1::jsonb) id',[JSON.stringify({requestId:crypto.randomUUID(),propertyId:property,moduleId:'purchase-order-accounts',workId:purchase.workId,recipientId:users[6],reference:'CHAIRS-1',amountMinor:11000,currency:'GBP'})])).rows[0].id;
 await db.query("select public.workspace_set_invoice_status($1,1,'paid')",[invoice]);
 purchase=await update(purchase,'reconcilePurchase',{invoiceId:invoice,reconciliation:'Invoice matches the order and the delivery'});
 assert.equal(purchase.status,'completed');
 await as(2);await assert.rejects(update(purchase,'approvePurchase',{approvedAmountMinor:1,approvalNote:'Closed already'}),/closed/);
});

test('an accepted clean carries the cleaner name and date for one invoice',async()=>{
 await as(5);let clean=await create('cleaning',{dueOn:today,checklist:['Kitchen']});
 await as(0);await db.query('select public.workspace_assign_work($1,$2,$3)',[clean.workId,clean.version,users[4]]);clean.version++;
 await db.exec('reset role');const photo=(await db.query("insert into private.workspace_media_evidence(property_id,work_id,owner_id,purpose,provider_id,verified_at) values($1,$2,$3,'cleaning','TEST-ONLY-clean',now()) returning id",[property,clean.workId,users[4]])).rows[0].id;
 await as(4);clean=await update(clean,'submitCleaning',{checks:['Kitchen'],report:'Kitchen cleaned',photoIds:[photo],mailAction:'none'});
 await as(5);await update(clean,'reviewCleaning',{accepted:true,guestFeedback:'Guest happy on arrival',reviewNote:'All good, photos checked'});
 await as(1);const invoiceTask=(await db.query('select public.workspace_operations_read($1) data',[property])).rows[0].data.find(w=>w.kind==='cleaning_invoice'&&w.data.sourceWorkId===clean.workId);
 assert.equal(invoiceTask.data.cleanerName,'Cara Cleaner');assert.equal(invoiceTask.data.cleanedOn,today);
});

test('removing a cleaner from the rota takes them off every property and frees their cleans',async()=>{
 await as(5);const clean=await create('cleaning',{dueOn:today,checklist:['Bathroom']});
 await as(0);await db.query('select public.workspace_assign_work($1,$2,$3)',[clean.workId,clean.version,users[4]]);
 await db.exec('reset role');const review=(await db.query("select private.workspace_handover($1,'cleaner-performance','Management review after repeated complaints','cleaner_management_review',jsonb_build_object('cleanerId',$2::text,'requiresManagementDecision',true)) id",[property,users[4]])).rows[0].id;
 await as(0);await team({action:'decideCleanerReview',workId:review,version:1,outcome:'removed_from_rota',note:'Third complaint this month'});
 assert.equal((await owner({text:"select count(*)::int n from public.workspace_property_assignments where user_id=$1 and assignment='cleaner'",args:[users[4]]}))[0].n,0);
 assert.equal((await owner({text:'select assignee_id from public.workspace_work_items where id=$1',args:[clean.workId]}))[0].assignee_id,null);
});
