import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin','stays','cleans','client','cleaning_manager','stays'];
const users = roles.map((_,i) => `71000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
for (let i=0;i<users.length;i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`controls${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[users[i].replace('7100','7200'),users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[users[i].replace('7100','7200'),users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1",[users[i],roles[i],`Test ${i}`]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features',[users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[i],session_id:users[i].replace('7100','7200')})]);
  await db.exec('set role authenticated');
}
const rpc=async(name,args=[]) => (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
const write=input=>rpc('workspace_controls_action',[{requestId:crypto.randomUUID(),...input}]);
const read=(section,propertyId=property,workId=null)=>rpc('workspace_controls_read',[section,propertyId,workId]);
await as(0);
const property=await rpc('workspace_save_property',[{requestId:crypto.randomUUID(),name:'Controls test property'}]);
for(let i=1;i<=4;i++) await rpc('workspace_assign_property',[property,users[i],i===2?'cleaner':i===3?'client':i===4?'cleaning_manager':'staff']);
const clean=await rpc('workspace_operations_action',[{requestId:crypto.randomUUID(),action:'createOperation',propertyId:property,kind:'cleaning',data:{dueOn:'2026-10-06',checklist:['Kitchen']}}]);
await rpc('workspace_assign_work',[clean.workId,clean.version,users[2]]);
beforeEach(async()=> {await db.exec('reset role');await db.exec('delete from private.workspace_write_limits');});
after(()=>db.close());

test('OTA permission is independent of property access; entry updates preserve OTA details',async()=> {
  await as(0);
  await rpc('workspace_save_property_details',[property,1,'ota',{otaInstructions:'Private OTA notes'}]);
  await rpc('workspace_save_property_details',[property,2,'access',{accessInstructions:'Private entry notes'}]);
  await db.exec('reset role');await db.query("delete from public.workspace_module_grants where user_id=$1 and module_id='ota-logins'",[users[1]]);
  await as(1);assert.deepEqual(await rpc('workspace_property_details',[property,'access']),{accessInstructions:'Private entry notes'});
  await assert.rejects(rpc('workspace_property_details',[property,'ota']),/OTA access denied/);
  await as(2);assert.deepEqual(await rpc('workspace_property_details',[property,'access']),{accessInstructions:'Private entry notes'});
  await assert.rejects(rpc('workspace_property_details',[property,'ota']),/OTA access denied/);
  await as(0);assert.deepEqual(await rpc('workspace_property_details',[property,'ota']),{otaInstructions:'Private OTA notes',otaAccounts:[]});
  await assert.rejects(rpc('workspace_save_property_details',[property,3,'access',{accessInstructions:'Entry',otaInstructions:'Injected'}]),/Unknown.*input/);
});

test('assignment candidates exclude unrelated users and never expose email or secrets',async()=> {
  await as(0);const candidates=await read('resources',property,clean.workId);
  assert.ok(candidates.some(p=>p.userId===users[2]));assert.ok(!candidates.some(p=>p.userId===users[3]||p.userId===users[5]));
  assert.ok(candidates.every(p=>Object.keys(p).every(k=>['userId','fullName','role'].includes(k))));
  await as(2);await assert.rejects(read('resources',property,clean.workId),/Assignment permission/);
  await as(1);await assert.rejects(read('resources'),/Assignment permission/);
  await as(5);await assert.rejects(read('resources',property,clean.workId),/Assignment permission/);
});

test('manual reservation updates version, invalidate old follow-ups and replay without duplication',async()=> {
  await as(1);
  const booking=await rpc('workspace_operations_action',[{action:'recordReservation',requestId:crypto.randomUUID(),propertyId:property,reference:'Control stay',checkIn:'2026-11-01',checkOut:'2026-11-10',status:'confirmed'}]);
  const row=(await read('reservations')).find(r=>r.reference==='Control stay');
  const input={action:'updateReservation',requestId:crypto.randomUUID(),propertyId:property,reservationId:row.id,version:row.version,checkIn:'2026-11-02',checkOut:'2026-11-11',status:'confirmed'};
  const result=await write(input);assert.equal(result.version,2);assert.ok(result.followUpWorkId);assert.deepEqual(await write(input),result);
  await assert.rejects(write({...input,checkOut:'2026-11-12'}),/identifier reused/);
  await assert.rejects(write({...input,requestId:crypto.randomUUID()}),/Reservation changed/);
  await db.exec('reset role');const previous=(await db.query('select status from public.workspace_work_items where id=$1',[booking.followUpWorkId])).rows[0];assert.equal(previous.status,'cancelled');
  await as(5);await assert.rejects(write({...input,requestId:crypto.randomUUID(),version:2}),/permission/);
});

test('overlaps and imported-source manual edits fail atomically',async()=> {
  await as(1);await rpc('workspace_operations_action',[{action:'recordReservation',requestId:crypto.randomUUID(),propertyId:property,reference:'Second stay',checkIn:'2026-12-01',checkOut:'2026-12-10',status:'confirmed'}]);
  const row=(await read('reservations')).find(r=>r.reference==='Control stay');
  await assert.rejects(write({action:'updateReservation',propertyId:property,reservationId:row.id,version:row.version,checkIn:'2026-12-05',checkOut:'2026-12-08',status:'confirmed'}),/overlaps/);
  assert.equal((await read('reservations')).find(r=>r.id===row.id).version,row.version);
  await db.exec('reset role');await db.query("update private.workspace_reservations set source='hostaway' where id=$1",[row.id]);
  await as(1);await assert.rejects(write({action:'updateReservation',propertyId:property,reservationId:row.id,version:row.version,checkIn:'2026-11-03',checkOut:'2026-11-12',status:'confirmed'}),/owning booking source/);
  await db.exec('reset role');await db.query("update private.workspace_reservations set source='manual' where id=$1",[row.id]);
});

test('paid booking prevents both manual changes and source imports from erasing payment evidence',async()=> {
  await as(1);const row=(await read('reservations')).find(r=>r.reference==='Control stay');
  await db.exec('reset role');const work=(await db.query("select w.id from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='direct_booking' and d.data->>'reservationId'=$1 and w.status<>'cancelled'",[row.id])).rows[0].id;
  // Trusted fixture represents an already completed payment-gated workflow.
  await db.query("update private.workspace_domain_details set data=data||'{\"workStatus\":\"completed\",\"phase\":\"confirmed\"}' where work_id=$1",[work]);
  await db.query("update public.workspace_work_items set status='completed' where id=$1",[work]);
  await as(1);await assert.rejects(write({action:'updateReservation',propertyId:property,reservationId:row.id,version:row.version,checkIn:'2026-11-03',checkOut:'2026-11-12',status:'cancelled'}),/paid or confirmed/);
  assert.equal((await read('reservations')).find(r=>r.id===row.id).version,row.version);
});

test('changing an unpaid quoted reservation voids the old invoice and preserves its audit record',async()=> {
 await as(1);const created=await rpc('workspace_operations_action',[{action:'recordReservation',requestId:crypto.randomUUID(),propertyId:property,reference:'Unpaid quote',checkIn:'2027-01-01',checkOut:'2027-01-10',status:'enquiry'}]);
 const row=(await read('reservations')).find(r=>r.reference==='Unpaid quote');
 await db.exec('reset role');await db.query("update private.workspace_domain_details set data=data||'{\"phase\":\"accepted\",\"workStatus\":\"approved\",\"quoteAmountMinor\":25000}' where work_id=$1",[created.followUpWorkId]);
 await db.query("update public.workspace_work_items set status='approved' where id=$1",[created.followUpWorkId]);
 await as(0);const invoice=await rpc('workspace_create_invoice',[{requestId:crypto.randomUUID(),propertyId:property,moduleId:'owner-statements',workId:created.followUpWorkId,recipientId:users[3],reference:'UNPAID-001',amountMinor:25000,currency:'GBP'}]);
 await as(1);const result=await write({action:'updateReservation',propertyId:property,reservationId:row.id,version:1,checkIn:'2027-01-01',checkOut:'2027-01-10',status:'cancelled'});assert.equal(result.followUpWorkId,null);
 await db.exec('reset role');const record=(await db.query('select status,amount_minor,version from public.workspace_invoices where id=$1',[invoice])).rows[0];assert.equal(record.status,'void');assert.equal(record.amount_minor,25000);assert.equal(record.version,2);
 assert.equal((await db.query('select status from public.workspace_work_items where id=$1',[created.followUpWorkId])).rows[0].status,'cancelled');
});

test('local event edits are scoped and versioned; archiving removes the event from weekly reports',async()=> {
  await as(1);
  const event=await rpc('workspace_portfolio_action',[{action:'recordLocalEvent',requestId:crypto.randomUUID(),propertyId:property,name:'Test festival',eventOn:'2026-10-20',sourceUrl:'https://example.com/event',opportunity:'Check demand with recorded evidence'}]);
  const input={action:'updateEvent',propertyId:property,eventId:event.eventId,version:1,name:'Updated festival',eventOn:'2026-10-21',sourceUrl:'https://example.com/updated',opportunity:'Review actual local demand'};
  assert.equal((await write(input)).version,2);await assert.rejects(write(input),/Event changed/);
  await as(5);await assert.rejects(write({...input,version:2}),/permission/);
  await as(1);const archive={action:'archiveEvent',requestId:crypto.randomUUID(),propertyId:property,eventId:event.eventId,version:2};
  const result=await write(archive);assert.deepEqual(await write(archive),result);assert.equal(result.version,3);
  const today=(await db.query("select (now() at time zone 'Europe/London')::date::text today")).rows[0].today;
  const report=await rpc('workspace_portfolio_read',['weekly',property,today,today]);assert.ok(!report.events.some(e=>e.name==='Updated festival'));
  await assert.rejects(write({...input,version:3}),/already archived/);
});

test('estimate projections use explicit assumptions and exact money without advancing onboarding',async()=> {
  await as(1);
  const assumptions={availableNights:100,occupancyBps:5000,directBookingBps:2000,otaFeeBps:1500,managementFeeBps:1000,lowRateMinor:10000,mediumRateMinor:12000,highRateMinor:15000};
  const input={action:'saveEstimate',requestId:crypto.randomUUID(),propertyId:property,version:0,assumptions};
  const result=await write(input);assert.equal(result.version,1);assert.equal(result.projection.occupiedNights,50);
  assert.deepEqual(result.projection.scenarios[0],{scenario:'low',grossMinor:500000,otaFeesMinor:60000,managementFeesMinor:50000,netBeforeOtherCostsMinor:390000});
  assert.match(result.projection.basis,/excludes/);assert.deepEqual(await write(input),result);
  const model=await read('estimate');assert.deepEqual(model.assumptions,assumptions);assert.equal(model.version,1);
  await assert.rejects(write({...input,requestId:crypto.randomUUID()}),/Estimate changed/);
  await assert.rejects(write({...input,requestId:crypto.randomUUID(),version:1,assumptions:{...assumptions,occupancyBps:10001}}),/Invalid estimate/);
  await as(3);await assert.rejects(read('estimate'),/access/);
});

test('operation invoices require evidence, preserve exact amounts, and prevent duplicate generic billing',async()=> {
  await as(0);
  const input={action:'issueOperationInvoice',requestId:crypto.randomUUID(),propertyId:property,workId:clean.workId,version:2,recipientId:users[3],reference:'CLEAN-001',amountMinor:12345};
  await assert.rejects(write(input),/financial evidence/);
  await assert.rejects(rpc('workspace_create_invoice',[{requestId:crypto.randomUUID(),propertyId:property,moduleId:'cleans-invoices',workId:clean.workId,recipientId:users[3],reference:'FORGED',amountMinor:12345,currency:'GBP'}]),/approved work/);
  await db.exec('reset role');await db.query("update private.workspace_domain_details set data=data||'{\"phase\":\"accepted\",\"workStatus\":\"completed\"}' where work_id=$1",[clean.workId]);
  await db.query("update public.workspace_work_items set status='completed' where id=$1",[clean.workId]);
  await as(4);const result=await write(input);assert.ok(result.invoiceId);assert.deepEqual(await write(input),result);
  await assert.rejects(write({...input,requestId:crypto.randomUUID()}),/Active invoice already exists/);
  await as(0);await assert.rejects(rpc('workspace_create_invoice',[{requestId:crypto.randomUUID(),propertyId:property,moduleId:'cleans-invoices',workId:clean.workId,recipientId:users[3],reference:'DUPLICATE',amountMinor:12345,currency:'GBP'}]),/Active invoice already exists/);
  await as(3);await assert.rejects(write(input),/Invoice work access/);
});

test('generic billing rejects missing phase, wrong module, wrong currency and unapproved amounts',async()=> {
  await db.exec('reset role');
  const work=(await db.query("insert into public.workspace_work_items(request_id,property_id,module_id,title,status,created_by) values($1,$2,'owner-statements','Billing test','approved',$3) returning id",[crypto.randomUUID(),property,users[0]])).rows[0].id;
  await db.query("insert into private.workspace_domain_details(work_id,kind,data) values($1,'direct_booking','{\"workStatus\":\"approved\",\"quoteAmountMinor\":25000}')",[work]);
  await as(0);const invoice={requestId:crypto.randomUUID(),propertyId:property,moduleId:'owner-statements',workId:work,recipientId:users[3],reference:'DIRECT-001',amountMinor:25000,currency:'GBP'};
  await assert.rejects(rpc('workspace_create_invoice',[invoice]),/financial evidence/);
  await db.exec('reset role');await db.query("update private.workspace_domain_details set data=data||'{\"phase\":\"accepted\"}' where work_id=$1",[work]);
  await as(0);
  for(const change of [{moduleId:'maintenance-reconciliation'},{currency:'USD'},{amountMinor:24999}])await assert.rejects(rpc('workspace_create_invoice',[{...invoice,...change}]),/financial evidence/);
  assert.ok(await rpc('workspace_create_invoice',[invoice]));
});

test('in-app read state belongs to one current recipient and never claims external delivery',async()=> {
  await db.exec('reset role');const event=(await db.query("insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values($1,$2,$3,'test.read') returning id",[users[0],property,clean.workId])).rows[0].id;
  await db.query('insert into private.workspace_notification_outbox(user_id,work_id,event_id) values($1,$2,$3)',[users[2],clean.workId,event]);
  await as(2);const input={action:'markNotificationRead',requestId:crypto.randomUUID(),eventId:String(event)};
  const result=await write(input);assert.ok(result.readAt);assert.deepEqual(await write(input),result);
  const notice=(await read('notifications',null)).find(n=>n.id===event);assert.equal(notice.status,'available_in_app');assert.ok(notice.read_at);
  await as(3);await assert.rejects(write(input),/Notification access/);
  await db.exec('reset role');await db.query('delete from public.workspace_property_assignments where property_id=$1 and user_id=$2',[property,users[2]]);
  await as(2);await assert.rejects(write(input),/Notification access/);
});

test('new private models and RPCs deny anonymous access and direct table reads',async()=> {
  await as(1);await assert.rejects(db.query('select * from private.workspace_estimate_models'),/permission denied/);
  await db.exec('reset role');const tables=(await db.query("select relrowsecurity from pg_class where oid='private.workspace_estimate_models'::regclass")).rows;assert.equal(tables[0].relrowsecurity,true);
  const functions=(await db.query("select prosecdef from pg_proc where pronamespace='public'::regnamespace and proname in ('workspace_controls_read','workspace_controls_action')")).rows;assert.ok(functions.every(f=>!f.prosecdef));
  await db.exec('set role anon');await assert.rejects(read('notifications',null),/permission denied/);
});
