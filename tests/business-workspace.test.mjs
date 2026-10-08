import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db=new PGlite();
const ids=Array.from({length:7},(_,i)=>`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const sessions=ids.map(id=>id.replace('10000000','20000000'));
const [owner,admin,cleaner,otherCleaner,client,otherClient,manager]=ids;
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb); $$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid; $$;`);
for(const f of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile(`supabase/migrations/${f}`,'utf8'));
for(let i=0;i<ids.length;i++){
 await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",[ids[i],`person${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[sessions[i],ids[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[sessions[i],ids[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2 where user_id=$1",[ids[i],['super_admin','admin','cleans','cleans','client','client','cleaning_manager'][i]]);
 for(const m of i===4||i===5?['client-property-maintenance','client-purchase-order-quotes','client-dashboard','client-mailbox']:['cleaning-schedule','cleans-invoices','guest-communication','property-database','maintenance-reporting'])
  await db.query('insert into public.workspace_module_grants(user_id,module_id) values($1,$2)',[ids[i],m]);
}
async function as(id){await db.exec('reset role');const n=ids.indexOf(id);await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,session_id:sessions[n]})]);await db.exec('set role authenticated');}
const rpc=async(name,input)=>(await db.query(`select public.${name}($1::jsonb) id`,[JSON.stringify(input)])).rows[0].id;
await as(owner);
const firstProperty={name:'First property',requestId:crypto.randomUUID()};
const p1=await rpc('workspace_save_property',firstProperty),p2=await rpc('workspace_save_property',{name:'Other property',requestId:crypto.randomUUID()});
for(const [p,u,kind] of [[p1,cleaner,'cleaner'],[p2,otherCleaner,'cleaner'],[p1,client,'client'],[p2,otherClient,'client'],[p1,manager,'cleaning_manager']])await db.query('select public.workspace_assign_property($1,$2,$3)',[p,u,kind]);
const workInput={requestId:crypto.randomUUID(),propertyId:p1,moduleId:'cleaning-schedule',title:'Assigned clean',assigneeId:cleaner};
const w1=await rpc('workspace_create_work',workInput);
const w2=await rpc('workspace_create_work',{...workInput,requestId:crypto.randomUUID(),propertyId:p2,assigneeId:otherCleaner});
const repair=await rpc('workspace_create_work',{requestId:crypto.randomUUID(),propertyId:p1,moduleId:'maintenance-reporting',title:'Visible repair',clientVisible:true});
const hiddenRepair=await rpc('workspace_create_work',{requestId:crypto.randomUUID(),propertyId:p1,moduleId:'maintenance-reporting',title:'Staff-only discussion'});
const transition=(id,version,status,note='',key=crypto.randomUUID())=>db.query('select public.workspace_transition_work($1,$2,$3,$4,$5) id',[id,version,status,note,key]);
after(()=>db.close());

test('business data starts empty before fixture inserts and uses UUID assignments',async()=>{
 await as(owner);assert.equal((await db.query('select count(*)::int n from public.workspace_features')).rows[0].n,37);
 assert.equal((await db.query('select count(*)::int n from public.workspace_properties')).rows[0].n,2);
 await assert.rejects(db.query('select public.workspace_assign_property($1,$2,$3)',[p1,client,'staff']),/matching assignment/);
});
test('cleaners see only their own work, cannot create jobs, approve or change assignments',async()=>{
 await as(cleaner);assert.deepEqual((await db.query('select id from public.workspace_work_items')).rows.map(r=>r.id),[w1]);
 assert.deepEqual((await db.query('select id from public.workspace_properties')).rows.map(r=>r.id),[p1]);
 await assert.rejects(transition(w2,1,'in_progress'),/Work access denied/);
 await assert.rejects(rpc('workspace_create_work',{...workInput,requestId:crypto.randomUUID()}),/Work access denied/);
 await assert.rejects(transition(w1,1,'approved'),/Cleaner can only/);
 await assert.rejects(db.query('select public.workspace_assign_property($1,$2,$3)',[p2,cleaner,'cleaner']),/Admin access required/);
 await assert.rejects(db.query('update public.workspace_work_items set assignee_id=$1',[cleaner]),/permission denied/);
});
test('clients cannot list another owner or internal work, assign jobs or self-approve requests',async()=>{
 await as(client);assert.deepEqual((await db.query('select id from public.workspace_work_items')).rows.map(r=>r.id),[repair]);
 assert.deepEqual((await db.query('select id from public.workspace_properties')).rows.map(r=>r.id),[p1]);
 await assert.rejects(transition(hiddenRepair,1,'in_progress'),/Work access denied/);
 await assert.rejects(rpc('workspace_create_work',{requestId:crypto.randomUUID(),propertyId:p2,moduleId:'maintenance-reporting',title:'Cross-owner request'}),/Work access denied/);
 await assert.rejects(rpc('workspace_create_work',{requestId:crypto.randomUUID(),propertyId:p1,moduleId:'maintenance-reporting',title:'Forged assignment',assigneeId:cleaner}),/Only staff/);
 const id=await rpc('workspace_create_work',{requestId:crypto.randomUUID(),propertyId:p1,moduleId:'maintenance-reporting',title:'My request'});
 await assert.rejects(transition(id,1,'approved'),/Client action denied/);
 await transition(id,1,'cancelled');
});
test('retried creates and transitions do not duplicate records or activity; stale writes fail',async()=>{
 await as(owner);assert.equal(await rpc('workspace_create_work',workInput),w1);
 await assert.rejects(rpc('workspace_create_work',{...workInput,title:'Changed retry'}),/identifier already used/);
 await as(cleaner);const key=crypto.randomUUID();const first=await transition(w1,1,'in_progress','Starting',key);
 const again=await transition(w1,1,'in_progress','Starting',key);assert.equal(first.rows[0].id,again.rows[0].id);
 await assert.rejects(transition(w1,1,'in_review'),/Record changed/);
 await transition(w1,2,'in_review');
 await as(manager);await transition(w1,3,'approved');await transition(w1,4,'completed');
 assert.equal((await db.query('select count(*)::int n from public.workspace_work_updates where work_id=$1',[w1])).rows[0].n,4);
});
test('assignment removal and access revocation take effect without waiting for JWT refresh',async()=>{
 await as(owner);await db.query('select public.workspace_unassign_property($1,$2)',[p1,cleaner]);
 await as(cleaner);assert.equal((await db.query('select count(*)::int n from public.workspace_work_items')).rows[0].n,0);
 await as(owner);await db.query('select public.workspace_assign_property($1,$2,$3)',[p1,cleaner,'cleaner']);
 await db.exec('reset role');await db.query("update public.workspace_profiles set status='revoked' where user_id=$1",[cleaner]);
 await as(cleaner);assert.equal((await db.query('select count(*)::int n from public.workspace_work_items')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from public.workspace_properties')).rows[0].n,0);
});
test('no direct financial, access-code, notification, activity or privilege writes',async()=>{
 await as(admin);for(const table of ['workspace_property_secrets','workspace_property_financials','workspace_device_tokens','workspace_notification_outbox'])await assert.rejects(db.query(`select * from private.${table}`),/permission denied/);
 await assert.rejects(db.query("insert into public.workspace_activity(event_type) values('fake')"),/permission denied/);
 await assert.rejects(db.query("update public.workspace_invoices set status='paid'"),/permission denied/);
 await assert.rejects(rpc('workspace_save_property',{id:p1,version:1,name:'Injected',accessCode:'1234'}),/Invalid property fields/);
});
test('client approvals require an explicit staff request and cannot approve internal work',async()=>{
 await as(owner);await transition(repair,1,'in_progress');await db.query('select public.workspace_request_client_approval($1,$2)',[repair,2]);
 await as(otherClient);await assert.rejects(transition(repair,3,'approved'),/Work access denied/);
 await as(client);await transition(repair,3,'approved','Accepted');
 await as(owner);assert.equal((await db.query('select status from public.workspace_work_items where id=$1',[repair])).rows[0].status,'approved');
});
test('invoice amounts use integer minor units, own recipients are scoped, and payments require admin',async()=>{
 await as(owner);const input={requestId:crypto.randomUUID(),propertyId:p1,moduleId:'onboarding-invoices',recipientId:client,reference:'TEST-001',amountMinor:47500,currency:'GBP'};
 const invoice=await rpc('workspace_create_invoice',input);assert.equal(await rpc('workspace_create_invoice',input),invoice);
 await assert.rejects(rpc('workspace_create_invoice',{...input,amountMinor:1}),/identifier already used/);
 await assert.rejects(rpc('workspace_create_invoice',{...input,requestId:crypto.randomUUID(),reference:'TEST-002',recipientId:otherClient}),/active property access/);
 await as(client);assert.equal((await db.query('select amount_minor from public.workspace_invoices where id=$1',[invoice])).rows[0].amount_minor,47500);
 await assert.rejects(db.query('select public.workspace_set_invoice_status($1,$2,$3)',[invoice,1,'paid']),/payment confirmation required/);
 await as(otherClient);assert.equal((await db.query('select count(*)::int n from public.workspace_invoices')).rows[0].n,0);
 await as(admin);await db.query('select public.workspace_set_invoice_status($1,$2,$3)',[invoice,1,'paid']);
 await assert.rejects(db.query('select public.workspace_set_invoice_status($1,$2,$3)',[invoice,1,'void']),/Record changed/);
});
test('thread and message retries remain unique and cross-owner messaging is denied',async()=>{
 await as(client);const key=crypto.randomUUID();const make=()=>db.query('select public.workspace_create_thread($1,$2,$3,$4) id',[p1,'My question',false,key]);
 const thread=(await make()).rows[0].id;assert.equal((await make()).rows[0].id,thread);
 const request=crypto.randomUUID();const send=()=>db.query('select public.workspace_send_message($1,$2,$3) id',[thread,'Hello team',request]);
 const message=(await send()).rows[0].id;assert.equal((await send()).rows[0].id,message);
 await as(otherClient);await assert.rejects(db.query('select public.workspace_send_message($1,$2,$3)',[thread,'Cross-account text',crypto.randomUUID()]),/Communication access denied/);
 assert.equal((await db.query('select count(*)::int n from public.workspace_messages')).rows[0].n,0);
 await as(owner);assert.equal((await db.query('select count(*)::int n from public.workspace_messages')).rows[0].n,1);
});
test('restricted property fields are absent from ordinary rows and cleaner access expires after submission',async()=>{
 await as(owner);await db.query('select public.workspace_save_property_details($1,$2,$3,$4)',[p2,1,'access',JSON.stringify({accessInstructions:'Synthetic access code'})]);
 await assert.rejects(db.query('select public.workspace_save_property_details($1,$2,$3,$4)',[p2,1,'access','{}']),/Property changed/);
 await as(otherCleaner);const details=(await db.query('select public.workspace_property_details($1,$2) data',[p2,'access'])).rows[0].data;
 assert.deepEqual(details,{accessInstructions:'Synthetic access code'});
 await assert.rejects(db.query('select public.workspace_property_details($1,$2)',[p1,'access']),/Property access denied/);
 const row=(await db.query('select * from public.workspace_properties where id=$1',[p2])).rows[0];assert.ok(!JSON.stringify(row).includes('Synthetic'));
 await transition(w2,1,'in_progress');await transition(w2,2,'in_review');
 await assert.rejects(db.query('select public.workspace_property_details($1,$2)',[p2,'access']),/Property access denied/);
 await as(client);await assert.rejects(db.query('select public.workspace_property_details($1,$2)',[p1,'finance']),/Financial access denied/);
});
test('push tokens are self-owned, private, validated and cannot be removed by another account',async()=>{
 await as(client);const device=crypto.randomUUID();await db.query('select public.workspace_register_device($1,$2,$3)',[device,'ExpoPushToken[syntheticDeviceToken1234]','ios']);
 await assert.rejects(db.query('select public.workspace_register_device($1,$2,$3)',[device,'https://attacker.example/token','ios']),/Invalid device/);
 await as(otherClient);await db.query('select public.workspace_unregister_device($1)',[device]);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from private.workspace_device_tokens where user_id=$1',[client])).rows[0].n,1);
 await as(client);await db.query('select public.workspace_unregister_device($1)',[device]);
});
test('reports aggregate only RLS-visible work, omit cancelled records and reject unbounded dates',async()=>{
 await as(client);const result=(await db.query("select public.workspace_report(current_date-30,current_date+1) data")).rows[0].data;
 assert.equal(result.propertyCount,1);assert.equal(result.series.reduce((n,r)=>n+r.count,0),1);
 assert.ok(!JSON.stringify(result).includes('Visible repair')); // No titles/contacts in aggregate.
 await assert.rejects(db.query("select public.workspace_report(current_date-1000,current_date)"),/Invalid report period/);
 await as(owner);const all=(await db.query("select public.workspace_report(current_date-30,current_date+1) data")).rows[0].data;assert.equal(all.series.reduce((n,r)=>n+r.count,0),4);
});
test('editable appearance cannot change a role, status, assignment or grants',async()=>{
 await db.exec('reset role');await db.query("update auth.users set raw_user_meta_data=$2::jsonb where id=$1",[client,JSON.stringify({display_name:'Changed profile name',avatar_preset:'plum',role:'super_admin',status:'active'})]);
 await as(client);const account=(await db.query('select public.workspace_account() data')).rows[0].data;assert.equal(account.fullName,'Changed profile name');assert.equal(account.role,'client');
});
test('direct authenticated RPC calls cannot bypass the database write quota',async()=>{
 await db.exec('reset role');await db.query('delete from private.workspace_write_limits where user_id=$1',[owner]);
 await as(owner);
 for(let i=0;i<60;i++)await rpc('workspace_save_property',{requestId:crypto.randomUUID(),name:`Quota fixture ${i}`});
 await assert.rejects(rpc('workspace_save_property',{requestId:crypto.randomUUID(),name:'Blocked fixture'}),error=>error.code==='P0429');
 await db.exec('reset role');await db.query("update private.workspace_write_limits set window_started_at=clock_timestamp()-interval '2 minutes' where user_id=$1",[owner]);
 await as(owner);assert.ok(await rpc('workspace_save_property',{requestId:crypto.randomUUID(),name:'Window expired fixture'}));
});

test('device registration is bounded even without the HTTP server',async()=>{
 await as(client);
 for(let i=0;i<10;i++)await db.query('select public.workspace_register_device($1,$2,$3)',[crypto.randomUUID(),`ExpoPushToken[syntheticDeviceToken${i}]`,'ios']);
 await assert.rejects(db.query('select public.workspace_register_device($1,$2,$3)',[crypto.randomUUID(),'ExpoPushToken[syntheticDeviceTokenOverflow]','ios']),/Remove an old device/);
 await assert.rejects(db.query('select public.workspace_register_device($1,$2,$3)',[crypto.randomUUID(),'ExpoPushToken['+'a'.repeat(250)+']','ios']),/workspace_push_token_size|Remove an old device/);
});

test('anonymous and unapproved sessions cannot access business RPCs or rows',async()=>{
 await db.exec('reset role;set role anon');await assert.rejects(rpc('workspace_save_property',{name:'Forged'}),/permission denied/);
 await db.exec('reset role');await db.query('delete from private.workspace_approved_sessions where user_id=$1',[otherCleaner]);
 await as(otherCleaner);assert.equal((await db.query('select count(*)::int n from public.workspace_work_items')).rows[0].n,0);
 await assert.rejects(transition(w2,1,'in_progress'),/Work access denied/);
});
