import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const users=['30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003'];
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 const id=users[i],session=id.replace('30000000','40000000');
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,`journey${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,id]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session,id]);
 await db.query("update public.workspace_profiles set status='active',role=$2 where user_id=$1",[id,i===0?'super_admin':'client']);
 for(const m of ['property-onboarding','client-dashboard'])await db.query('insert into public.workspace_module_grants(user_id,module_id) values($1,$2)',[id,m]);
}
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[i],session_id:users[i].replace('30000000','40000000')})]);await db.exec('set role authenticated');}
const action=async input=>(await db.query('select public.workspace_journey_action($1::jsonb) result',[JSON.stringify({requestId:crypto.randomUUID(),...input})])).rows[0].result;
const read=async id=>(await db.query('select public.workspace_journey_read($1) result',[id||null])).rows[0].result;
let journey;
after(()=>db.close());
test('owner enquiry creates one shared property; retries do not duplicate and other owner cannot read',async()=>{
 await as(1);const input={action:'createEnquiry',requestId:crypto.randomUUID(),name:'Edinburgh flat',address:'Example property address',region:'Edinburgh',propertyType:'Flat',bedrooms:2,bathrooms:1};
 journey=await action(input);assert.equal(journey.stage,'enquiry');assert.deepEqual(await action(input),journey);
 await as(0);await assert.rejects(db.query('select public.workspace_save_property($1::jsonb)',[JSON.stringify({id:journey.propertyId,version:1,name:'Edinburgh flat',address:'Example property address',region:'Edinburgh',bedrooms:2,status:'active'})]),/onboarding journey/);await as(1);
 await db.exec('reset role');const notifications=await db.query('select user_id from private.workspace_notification_outbox where work_id=$1',[journey.workId]);
 assert.deepEqual(new Set(notifications.rows.map(r=>r.user_id)),new Set([users[0],users[1]]));
 await as(0);await assert.rejects(db.query("select public.workspace_transition_work($1,1,'in_progress','', $2)",[journey.workId,crypto.randomUUID()]),/onboarding journey/);await as(1);
 await assert.rejects(action({...input,name:'Different property'}),/reused/);
 await as(2);assert.deepEqual(await read(journey.propertyId),[]);
 await assert.rejects(action({action:'createEnquiry',...input,requestId:crypto.randomUUID(),clientId:users[1]}),/Active client/);
});
test('estimate and owner decision require correct actor and version',async()=>{
 await as(1);await assert.rejects(action({action:'publishEstimate',propertyId:journey.propertyId,version:journey.version,lowRateMinor:10000,mediumRateMinor:12000,highRateMinor:15000,comparables:[]}),/denied/);
 await as(0);journey=await action({action:'publishEstimate',propertyId:journey.propertyId,version:journey.version,lowRateMinor:10000,mediumRateMinor:12000,highRateMinor:15000,comparables:[],comments:'Real estimate'});
 await as(1);await assert.rejects(action({action:'decideEstimate',propertyId:journey.propertyId,version:journey.version,decision:'review'}),/follow-up/);
 await assert.rejects(action({action:'decideEstimate',propertyId:journey.propertyId,version:1,decision:'proceed'}),/changed/);
 journey=await action({action:'decideEstimate',propertyId:journey.propertyId,version:journey.version,decision:'proceed'});assert.equal(journey.stage,'agreement');
});
test('owner decline archives the shared property and enquiry in both views',async()=>{
 await as(1);let archived=await action({action:'createEnquiry',name:'Declined property',address:'Example declined address',propertyType:'Flat',bedrooms:1,bathrooms:1});
 await as(0);archived=await action({action:'publishEstimate',propertyId:archived.propertyId,version:archived.version,lowRateMinor:10000,mediumRateMinor:12000,highRateMinor:15000,comparables:[]});
 await as(1);archived=await action({action:'decideEstimate',propertyId:archived.propertyId,version:archived.version,decision:'decline'});assert.equal(archived.stage,'archived');
 assert.equal((await db.query('select status from public.workspace_properties where id=$1',[archived.propertyId])).rows[0].status,'archived');
 await as(0);assert.equal((await read(archived.propertyId))[0].stage,'archived');assert.equal((await db.query('select status from public.workspace_work_items where id=$1',[archived.workId])).rows[0].status,'declined');
});
test('agreement consent freezes published revision, creates invoice task exactly once, owner submits private form',async()=>{
 await as(1);await assert.rejects(action({action:'signAgreement',propertyId:journey.propertyId,version:journey.version,agreementRevision:0,signedName:'Owner',consent:true}),/consent/);
 await as(0);journey=await action({action:'publishAgreement',propertyId:journey.propertyId,version:journey.version,agreement:'Test-only agreement supplied by the parties. Not a production contract.'});
 await assert.rejects(action({action:'signAgreement',propertyId:journey.propertyId,version:journey.version,agreementRevision:1,signedName:'Staff',consent:true}),/Owner consent/);
 await as(1);const sign={action:'signAgreement',requestId:crypto.randomUUID(),propertyId:journey.propertyId,version:journey.version,agreementRevision:1,signedName:'Owner',consent:true};journey=await action(sign);assert.deepEqual(await action(sign),journey);
 const form={businessName:'Example Owner',bankAccountName:'Example Owner',bankAccountNumber:'12345678',bankSortCode:'12-34-56',accessDate:(await db.query('select current_date::text d')).rows[0].d,accessInfo:'Private access instructions',utilitiesConnected:true,prepaymentMeters:false,broadbandConnected:true,hasGarden:true,mailPreference:'photograph',warrantyDetails:'Warranty contact',repairLimitMinor:10000,fullRepairPermission:false,furnishingChoice:'recharge',licensingRequired:true};
 journey=await action({action:'submitForm',propertyId:journey.propertyId,version:journey.version,form});assert.equal(journey.stage,'invoice');assert.equal(journey.form.bankAccountNumber,undefined);assert.equal(journey.form.accessInfo,undefined);
 await as(0);const tasks=(await db.query('select module_id from public.workspace_work_items where property_id=$1',[journey.propertyId])).rows.map(r=>r.module_id);
 for(const module of ['onboarding-invoices','licensing','routine-bin-garden-board','property-furnishing-board','clean-property-onboarding'])assert.equal(tasks.filter(m=>m===module).length,1,module);
 await assert.rejects(db.query('select * from private.workspace_journeys'),/permission denied/);
});
test('unpaid invoice blocks inspection; real settlement advances both owner and staff; booking is not completion',async()=>{
 await as(0);await assert.rejects(action({action:'bookInspection',propertyId:journey.propertyId,version:journey.version,inspectionOn:(await db.query('select current_date::text d')).rows[0].d}),/Paid invoice/);
 const id=(await db.query('select public.workspace_create_invoice($1::jsonb) id',[JSON.stringify({requestId:crypto.randomUUID(),propertyId:journey.propertyId,moduleId:'onboarding-invoices',recipientId:users[1],reference:'TEST-ONBOARD-1',amountMinor:47500,currency:'GBP'})])).rows[0].id;
 journey=await action({action:'linkInvoice',propertyId:journey.propertyId,version:journey.version,invoiceId:id});
 await db.query("select public.workspace_set_invoice_status($1,1,'paid')",[id]);journey=(await read(journey.propertyId))[0];assert.equal(journey.stage,'inspection_to_book');
 await db.exec('reset role');const inspection=await db.query("select w.id,w.version,d.data from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.property_id=$1 and d.kind='inspection'",[journey.propertyId]);
 assert.equal(inspection.rows.length,1);assert.equal(inspection.rows[0].data.phase,'ready_to_book');
 await assert.rejects(db.query("update public.workspace_work_items set status='completed' where id=$1",[inspection.rows[0].id]),/inspection report/);
 await as(1);assert.equal((await read(journey.propertyId))[0].stage,'inspection_to_book');
 await as(0);await assert.rejects(action({action:'bookInspection',propertyId:journey.propertyId,version:journey.version,inspectionOn:(await db.query('select (current_date-1)::text d')).rows[0].d}),/access date/);
 await db.exec('begin');const future=await action({action:'bookInspection',propertyId:journey.propertyId,version:journey.version,inspectionOn:(await db.query('select (current_date+2)::text d')).rows[0].d});
 await assert.rejects(action({action:'completeInspection',propertyId:journey.propertyId,version:future.version,report:'Test future inspection report.'}),/date has not arrived/);await db.exec('rollback');
 journey=await action({action:'bookInspection',propertyId:journey.propertyId,version:journey.version,inspectionOn:(await db.query('select current_date::text d')).rows[0].d});assert.equal(journey.inspectionCompletedAt,null);
 await db.exec('reset role');const booked=await db.query("select w.id,d.data from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.property_id=$1 and d.kind='inspection'",[journey.propertyId]);assert.equal(booked.rows.length,1);assert.equal(booked.rows[0].id,inspection.rows[0].id);assert.equal(booked.rows[0].data.phase,'booked');await as(0);
 journey=await action({action:'completeInspection',propertyId:journey.propertyId,version:journey.version,report:'Actual test inspection report with required findings.'});assert.equal(journey.stage,'inspection_complete');
});
test('live listing requires completed connected handovers and never invents listing links',async()=>{
 await as(0);await assert.rejects(action({action:'makeLive',propertyId:journey.propertyId,version:journey.version,listingLinks:[{platform:'Airbnb',url:'https://www.airbnb.com/rooms/test-only'}]}),/handovers|licen/i);
 const operations=(await db.query('select public.workspace_operations_read($1) result',[journey.propertyId])).rows[0].result;
 const today=(await db.query('select current_date::text d')).rows[0].d;
 for(const w of operations){
  if(['cleaning_setup','garden_setup','furnishing_quote'].includes(w.kind))await db.query('select public.workspace_operations_action($1::jsonb)',[JSON.stringify({action:'updateOperation',requestId:crypto.randomUUID(),workId:w.workId,version:w.version,step:'completeHandover',data:{evidence:'Test-only completed team handover evidence.'}})]);
  if(w.kind==='licensing')await db.query('select public.workspace_operations_action($1::jsonb)',[JSON.stringify({action:'updateOperation',requestId:crypto.randomUUID(),workId:w.workId,version:w.version,step:'recordGranted',data:{reference:'TEST-LICENCE',grantedOn:today,checklist:{application:true,safetyChecks:true,authorityGrant:true},evidence:'Test-only authority grant evidence.'}})]);
 }
 journey=await action({action:'makeLive',propertyId:journey.propertyId,version:journey.version,listingLinks:[{platform:'Airbnb',url:'https://www.airbnb.com/rooms/test-only'}]});assert.equal(journey.stage,'live');
 await as(1);assert.equal((await read(journey.propertyId))[0].stage,'live');assert.equal((await db.query('select status from public.workspace_properties where id=$1',[journey.propertyId])).rows[0].status,'active');
});
