import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Privacy: deleting your own account, owners' bank details in their own table, "download my
// data" and the retention job.
const db=new PGlite();
const roles=['super_admin','admin','accounts','client','stays','client','cleans'];
const users=roles.map((_,i)=>`91000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const session=i=>users[i].replace('9100','9200');
const [SUPER,ADMIN,ACCOUNTS,OWNER,STAYS,OTHER_OWNER,CLEANER]=[0,1,2,3,4,5,6];
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users on delete cascade,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const migrations=(await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
for(const file of migrations)await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
const modules={accounts:['owner-statements'],client:['property-onboarding','client-dashboard'],stays:['property-onboarding','property-database'],cleans:['cleaning-schedule']};
for(let i=0;i<users.length;i++){
 await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),'{\"full_name\":\"Someone\"}')",[users[i],`privacy${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3,responsibilities='Private note' where user_id=$1",[users[i],roles[i],'Person '+i]);
 for(const m of modules[roles[i]]??[])await db.query('insert into public.workspace_module_grants(user_id,module_id) values($1,$2)',[users[i],m]);
 await db.query('insert into private.workspace_onboarding_done(user_id) values($1) on conflict do nothing',[users[i]]);
}
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[i],session_id:session(i)})]);await db.exec('set role authenticated');}
// The server's own connection: the service key, with no signed-in person.
async function server(){await db.exec('reset role');await db.query("select set_config('request.jwt.claims','',false)");}
after(()=>db.close());
beforeEach(async()=>{await db.exec('reset role');await db.exec('delete from private.workspace_write_limits');});
const one=async(sql,params=[])=>(await db.query(sql,params)).rows[0];
const journeyAction=async input=>(await db.query('select public.workspace_journey_action($1::jsonb) r',[JSON.stringify(input)])).rows[0].r;
const payout=async property=>(await db.query("select public.workspace_portfolio_read('onboardingPayout',$1) r",[property])).rows[0].r;
const privacy=async section=>(await db.query('select public.workspace_privacy_read($1) r',[section])).rows[0].r;

// A property owned by OWNER whose journey is waiting for the set-up form.
async function ownedProperty(owner,name){
 await server();
 const property=(await one("insert into public.workspace_properties(name,address,region,created_by,request_id,status) values($1,'1 Example Street','Edinburgh',$2,gen_random_uuid(),'active') returning id",[name,users[SUPER]])).id;
 const work=(await one("insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by,client_visible) values(gen_random_uuid(),$1,'property-onboarding','Property onboarding',$2,true) returning id",[property,users[owner]])).id;
 await db.query("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,'client',$3)",[property,users[owner],users[SUPER]]);
 await db.query("insert into private.workspace_journeys(property_id,client_id,work_id,stage,property_type,bathrooms,signed_name,signed_at,signed_revision,agreement,agreement_revision) values($1,$2,$3,'form','Flat',1,'Owner',now(),1,'Agreement',1)",[property,users[owner],work]);
 return {property,work};
}
const form=today=>({businessName:'Example Owner',bankAccountName:'Example Owner',bankAccountNumber:'12345678',bankSortCode:'12-34-56',accessDate:today,accessInfo:'Key safe 1234',utilitiesConnected:true,prepaymentMeters:false,broadbandConnected:true,hasGarden:false,mailPreference:'photograph',warrantyDetails:'',repairLimitMinor:10000,fullRepairPermission:false,furnishingChoice:'self',licensingRequired:false});
let home;

test('bank details from the set-up form go to their own table, never into the form or the receipt',async()=>{
 home=await ownedProperty(OWNER,'Harbour flat');
 const today=(await one('select current_date::text d')).d;
 await as(OWNER);
 const input={action:'submitForm',requestId:crypto.randomUUID(),propertyId:home.property,version:1,form:form(today)};
 const saved=await journeyAction(input);
 assert.equal(saved.stage,'invoice');
 assert.deepEqual(await journeyAction(input),saved,'a repeated tap replays the same result');
 await server();
 const stored=await one('select form from private.workspace_journeys where property_id=$1',[home.property]);
 for(const key of ['bankAccountName','bankAccountNumber','bankSortCode'])assert.equal(stored.form[key],undefined,key);
 assert.equal(stored.form.businessName,'Example Owner');
 const receipt=await one('select input from private.workspace_action_receipts where request_id=$1',[input.requestId]);
 assert.equal(JSON.stringify(receipt.input).includes('12345678'),false);
 assert.deepEqual(await one('select owner_id,account_name,sort_code,account_number from private.workspace_bank_details where property_id=$1',[home.property]),
  {owner_id:users[OWNER],account_name:'Example Owner',sort_code:'123456',account_number:'12345678'});
});

test('accounts and admins read bank details in full, the owner masked, others not at all',async()=>{
 for(const who of [ACCOUNTS,ADMIN,SUPER]){
  await as(who);assert.deepEqual(await payout(home.property),{bankAccountName:'Example Owner',bankAccountNumber:'12345678',bankSortCode:'12-34-56',masked:false},roles[who]);
 }
 await as(OWNER);assert.deepEqual(await payout(home.property),{bankAccountName:'Example Owner',bankAccountNumber:'•••• 5678',bankSortCode:'••-••-56',masked:true});
 for(const who of [STAYS,OTHER_OWNER,CLEANER]){await as(who);await assert.rejects(payout(home.property),/denied|required/,roles[who]);}
 // Nothing reaches the tables directly.
 await as(ACCOUNTS);await assert.rejects(db.query('select * from private.workspace_bank_details'),/permission denied/);
});

test('bank details already saved in forms are moved and blanked when the migration runs',async()=>{
 const legacy=await ownedProperty(OTHER_OWNER,'Legacy cottage');
 await server();
 await db.query("update private.workspace_journeys set form=$2::jsonb,stage='invoice',submitted_at=now() where property_id=$1",[legacy.property,JSON.stringify({businessName:'Legacy',bankAccountName:'Legacy Owner',bankAccountNumber:'87654321',bankSortCode:'654321'})]);
 await db.query("insert into private.workspace_action_receipts(actor_id,request_id,actor_role,input,result) values($1,gen_random_uuid(),'client',$2::jsonb,'{}')",[users[OTHER_OWNER],JSON.stringify({action:'submitForm',form:{bankAccountNumber:'87654321',businessName:'Legacy'}})]);
 await db.exec(await fs.readFile('supabase/migrations/'+migrations.find(f=>f.includes('privacy_compliance')),'utf8'));
 assert.deepEqual((await one('select form from private.workspace_journeys where property_id=$1',[legacy.property])).form,{businessName:'Legacy'});
 assert.equal((await one("select count(*)::int n from private.workspace_action_receipts where input::text like '%87654321%'")).n,0);
 assert.deepEqual(await one('select owner_id,account_name,sort_code,account_number from private.workspace_bank_details where property_id=$1',[legacy.property]),
  {owner_id:users[OTHER_OWNER],account_name:'Legacy Owner',sort_code:'654321',account_number:'87654321'});
});

test('download my data holds only the person\'s own records',async()=>{
 await server();
 const conversation=(await one("insert into private.chat_conversations(kind,owner_id,created_by) values('owner',$1,$1) returning id",[users[OWNER]])).id;
 await db.query("insert into private.chat_messages(conversation_id,author_id,body,request_id) values($1,$2,'Owner wrote this',gen_random_uuid()),($1,$3,'Stays wrote this',gen_random_uuid())",[conversation,users[OWNER],users[STAYS]]);
 await db.query("insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by,assignee_id) values(gen_random_uuid(),$1,'property-database','Stays private task',$2,$2)",[home.property,users[STAYS]]);
 await db.query("insert into private.workspace_owner_statements(property_id,period_start,status,revenue_minor,cleaning_count,cleaning_minor,expenses_minor,fee_bps,fee_minor,payout_minor,detail,prepared_by,issued_at) values($1,'2026-09-01','issued',100000,2,8000,0,2000,20000,72000,'{}',$2,now()),($1,'2026-08-01','draft',1,0,0,0,0,0,1,'{}',$2,null)",[home.property,users[ACCOUNTS]]);
 const ev=(await one("insert into public.workspace_activity(event_type) values('reports.weekly_ready') returning id")).id;
 await db.query('insert into private.workspace_notification_outbox(user_id,event_id) values($1,$3),($2,$3)',[users[OWNER],users[STAYS],ev]);
 await as(OWNER);
 const mine=await privacy('export');
 assert.equal(mine.profile.userId,users[OWNER]);assert.equal(mine.profile.email,'privacy3@example.com');
 assert.deepEqual(mine.messages.map(m=>m.body),['Owner wrote this']);
 // Their onboarding, and the hand-over task their set-up form created.
 assert.deepEqual(mine.workItems.map(w=>w.title),['Property onboarding','Review cleaning setup and mailbox preference']);
 assert.ok(mine.notifications.some(n=>n.type==='reports.weekly_ready'));
 await server();const ownCount=(await one('select count(*)::int n from private.workspace_notification_outbox where user_id=$1',[users[OWNER]])).n;await as(OWNER);
 assert.equal(mine.notifications.length,ownCount);
 assert.deepEqual(mine.ownerStatements.map(s=>s.periodStart),['2026-09-01'],'draft statements are left out');
 assert.equal(mine.propertyOnboarding.length,1);assert.equal(mine.propertyOnboarding[0].setUpForm.bankAccountNumber,undefined);
 assert.equal(mine.propertyOnboarding[0].payoutDetails.accountNumber,'•••• 5678');
 assert.deepEqual(mine.propertyAssignments.map(a=>a.property),['Harbour flat']);
 const text=JSON.stringify(mine);
 for(const other of ['Stays wrote this','Stays private task','privacy4@example.com','Legacy'])assert.equal(text.includes(other),false,other);
 await as(STAYS);const theirs=await privacy('export');
 assert.deepEqual(theirs.workItems.map(w=>w.title),['Stays private task']);assert.deepEqual(theirs.ownerStatements,[]);assert.deepEqual(theirs.propertyOnboarding,[]);
 await server();await assert.rejects(privacy('export'),/sign-in required/i,'no signed-in person, no data');
 await as(OWNER);await assert.rejects(privacy('everything'),/Unknown privacy section/);
});

test('the deletion summary warns the last super admin and tells an owner about their properties',async()=>{
 await as(SUPER);assert.equal((await privacy('deletion')).lastSuperAdmin,true);
 await as(OWNER);const owner=await privacy('deletion');assert.equal(owner.lastSuperAdmin,false);assert.equal(owner.properties,1);assert.equal(owner.liveProperties,1);
 await as(STAYS);assert.equal((await privacy('deletion')).properties,0);
});

const deleteAccount=async i=>(await server(),(await db.query('select public.workspace_delete_own_account($1) r',[users[i]])).rows[0].r);

test('only the server can delete, and the last super admin cannot delete themselves',async()=>{
 await as(STAYS);await assert.rejects(db.query('select public.workspace_delete_own_account($1)',[users[STAYS]]),/permission denied/);
 await assert.rejects(deleteAccount(SUPER),/only super admin/);
 await server();assert.equal((await one('select status from public.workspace_profiles where user_id=$1',[users[SUPER]])).status,'active');
 assert.equal((await one('select count(*)::int n from private.workspace_account_deletions')).n,0,'a refused deletion leaves no audit row');
});

test('a team member who deletes their account is anonymised, loses all access, and their work stays',async()=>{
 await server();
 await db.query("insert into private.workspace_web_push(user_id,endpoint,p256dh,auth) values($1,'https://push.example.com/subscription/1',$2,$3)",[users[STAYS],'k'.repeat(87),'a'.repeat(22)]);
 await db.query("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,'staff',$3) on conflict do nothing",[home.property,users[STAYS],users[SUPER]]);
 const result=await deleteAccount(STAYS);
 assert.equal(result.removable,false,'their work still refers to them');
 const profile=await one('select full_name,status,responsibilities,role from public.workspace_profiles where user_id=$1',[users[STAYS]]);
 assert.deepEqual(profile,{full_name:'Deleted user',status:'revoked',responsibilities:'',role:'stays'});
 assert.deepEqual(await one('select email,raw_user_meta_data from auth.users where id=$1',[users[STAYS]]),{email:null,raw_user_meta_data:{}});
 for(const [table,column] of [['public.workspace_module_grants','user_id'],['public.workspace_property_assignments','user_id'],['private.workspace_approved_sessions','user_id'],['auth.sessions','user_id'],['private.workspace_web_push','user_id'],['private.workspace_notification_outbox','user_id'],['private.workspace_action_receipts','actor_id']])
  assert.equal((await one(`select count(*)::int n from ${table} where ${column}=$1`,[users[STAYS]])).n,0,table);
 assert.equal((await one('select count(*)::int n from public.workspace_work_items where created_by=$1',[users[STAYS]])).n,1,'work stays on record');
 assert.equal((await one('select count(*)::int n from private.chat_messages where author_id=$1',[users[STAYS]])).n,1,'messages in business conversations stay');
 assert.equal((await one('select count(*)::int n from private.workspace_closed_accounts where user_id=$1',[users[STAYS]])).n,1);
 assert.equal((await one('select count(*)::int n from private.workspace_password_revocations where user_id=$1',[users[STAYS]])).n,1);
 assert.deepEqual(await one('select role,properties_kept,sign_in from private.workspace_account_deletions where user_id=$1',[users[STAYS]]),{role:'stays',properties_kept:0,sign_in:'pending'});
 // Admins are told; the notice names nobody.
 const told=(await db.query("select o.user_id from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where a.event_type='account.staff_deleted' order by o.user_id")).rows.map(r=>r.user_id);
 assert.deepEqual(told,[users[SUPER],users[ADMIN]]);
 await db.query("select public.workspace_account_deletion_signin($1,'closed')",[users[STAYS]]);
 assert.equal((await one('select sign_in from private.workspace_account_deletions where user_id=$1',[users[STAYS]])).sign_in,'closed');
 // The old session no longer reaches anything.
 await as(STAYS);await assert.rejects(privacy('export'),/sign-in required/i);
 // Asking again does nothing more.
 assert.equal((await deleteAccount(STAYS)).alreadyDeleted,true);
 assert.equal((await one('select count(*)::int n from private.workspace_account_deletions where user_id=$1',[users[STAYS]])).n,1);
});

test('an owner can delete their account; their properties stay with the business, unlinked',async()=>{
 const result=await deleteAccount(OWNER);
 assert.equal(result.propertiesKept,1);assert.equal(result.removable,false);
 assert.equal((await one('select status from public.workspace_properties where id=$1',[home.property])).status,'active');
 assert.equal((await one('select count(*)::int n from public.workspace_property_assignments where property_id=$1 and assignment=$2',[home.property,'client'])).n,0);
 assert.equal((await one('select client_id from private.workspace_journeys where property_id=$1',[home.property])).client_id,users[OWNER],'the onboarding record still reads "Deleted user"');
 assert.equal((await one('select owner_id from private.workspace_bank_details where property_id=$1',[home.property])).owner_id,null);
 assert.equal((await one("select count(*)::int n from private.workspace_owner_statements where property_id=$1",[home.property])).n,2,'statements are kept');
 assert.equal((await one("select count(*)::int n from public.workspace_activity where event_type='account.owner_deleted'")).n,1);
 await as(ACCOUNTS);assert.equal((await payout(home.property)).bankAccountNumber,'12345678','Accounts can still pay what is owed');
});

test('someone with no history can have their sign-in removed outright',async()=>{
 const result=await deleteAccount(CLEANER);
 assert.equal(result.removable,true);
 await server();
 assert.equal((await one('select count(*)::int n from private.workspace_closed_accounts where user_id=$1',[users[CLEANER]])).n,0);
 // What the sign-in service's delete does: the profile goes with the sign-in.
 await db.query('delete from auth.users where id=$1',[users[CLEANER]]);
 assert.equal((await one('select count(*)::int n from public.workspace_profiles where user_id=$1',[users[CLEANER]])).n,0);
 assert.equal((await one('select role from private.workspace_account_deletions where user_id=$1',[users[CLEANER]])).role,'cleans','the audit row outlives the account');
});

test('retention deletes only old records, once a day',async()=>{
 await server();
 const at=new Date('2027-03-01T12:00:00Z');
 const old=new Date(at.getTime()-400*86400000).toISOString(),recent=new Date(at.getTime()-30*86400000).toISOString();
 const evOld=(await one("insert into public.workspace_activity(event_type,created_at) values('reports.weekly_ready',$1) returning id",[old])).id;
 const evNew=(await one("insert into public.workspace_activity(event_type,created_at) values('reports.weekly_ready',$1) returning id",[recent])).id;
 const evOldUnread=(await one("insert into public.workspace_activity(event_type,created_at) values('reports.weekly_ready',$1) returning id",[old])).id;
 await db.query('insert into private.workspace_notification_outbox(user_id,event_id,read_at) values($1,$2,$4),($1,$3,$5),($1,$6,null)',[users[ADMIN],evOld,evNew,old,recent,evOldUnread]);
 const hash=n=>String(n).repeat(64);
 await db.query("insert into private.auth_login_state(subject_hash,failures,updated_at,window_started_at) values($1,2,$3,$3),($2,1,$4,$4)",[hash(1),hash(2),old,recent]);
 await db.query("insert into private.authentication_events(event_type,subject_hash,occurred_at) values('password_failed',$1,$2),('password_failed',$1,$3)",[hash(1),old,recent]);
 await db.query("insert into private.auth_recovery_proofs(proof_hash,session_id,user_id,expires_at) values($1,$3,$4,$5),($2,$3,$4,$6)",[hash(3),hash(4),session(ADMIN),users[ADMIN],old,'2027-03-02T00:00:00Z']);
 const run=async when=>(await db.query('select private.workspace_privacy_retention($1) r',[when])).rows[0].r;
 const summary=await run(at.toISOString());
 assert.equal(summary.notifications,1);assert.equal(summary.loginRecords,1);assert.equal(summary.signInEvents,1);assert.equal(summary.recoveryProofs,1);
 const left=(await db.query('select event_id from private.workspace_notification_outbox where user_id=$1 and event_id = any($2) order by event_id',[users[ADMIN],[evOld,evNew,evOldUnread]])).rows.map(r=>Number(r.event_id));
 assert.deepEqual(left,[Number(evNew),Number(evOldUnread)],'recent and unread notifications stay');
 assert.deepEqual((await db.query('select subject_hash from private.auth_login_state where subject_hash in ($1,$2)',[hash(1),hash(2)])).rows.map(r=>r.subject_hash),[hash(2)]);
 assert.equal((await one('select count(*)::int n from private.auth_recovery_proofs where proof_hash=$1',[hash(4)])).n,1);
 // Work and money are not touched by retention.
 assert.equal((await one('select count(*)::int n from private.workspace_owner_statements')).n,2);
 assert.equal((await run(at.toISOString())).skipped,true,'runs once a day');
 // Leftovers on a deleted account are swept up.
 await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'listing-health')",[users[STAYS]]);
 const next=await run(new Date(at.getTime()+86400000).toISOString());
 assert.equal(next.deletedAccounts,1);
 assert.equal((await one('select count(*)::int n from public.workspace_module_grants where user_id=$1',[users[STAYS]])).n,0);
 // Only the server runs it.
 await as(ADMIN);await assert.rejects(db.query('select public.workspace_privacy_retention()'),/permission denied/);
});
