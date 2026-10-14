import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'vite';

// Repair approvals (20261020810000): under the company limit (£100 unless management change it) a quote is approved
// automatically; at or over it management approve first, then the owner; a contractor estimate always goes to
// management. Declines at each stage, the limit and who may change it, repairs already waiting, owner privacy, and the
// migration run a second time.
const root=fileURLToPath(new URL('..',import.meta.url));
const vite=await createServer({configFile:false,root,resolve:{alias:{'@':root}},server:{middlewareMode:true,hmr:false},logLevel:'error'});
const {operationsActionSchema}=await vite.ssrLoadModule('/lib/operations-policy.ts');
const MIGRATION='supabase/migrations/20261020810000_repair_approvals.sql';
const db=new PGlite();
const roles=['super_admin','admin','client','stays','ready','accounts','client'];
const [SUPER,ADMIN,OWNER,STAYS,READY,ACCOUNTS,PREAUTH_OWNER]=roles.map((_,i)=>i);
const users=roles.map((_,i)=>`81000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const session=i=>users[i].replace('8100','8200');
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`repair-approvals${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1",[users[i],roles[i],'Person '+i]);
 await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features',[users[i]]);
}
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[i],session_id:session(i)})]);await db.exec('set role authenticated');}
beforeEach(async()=>{await db.exec('reset role');await db.exec('delete from private.workspace_write_limits');});
after(async()=>{await db.close();await vite.close();});
// Every action goes through the HTTP schema first, as the route does.
const action=async input=>(await db.query('select public.workspace_operations_action($1::jsonb) result',[JSON.stringify(operationsActionSchema.parse({requestId:crypto.randomUUID(),...input}))])).rows[0].result;
const update=(w,step,data)=>action({action:'updateOperation',workId:w.workId,version:w.version,step,data});
const report=(propertyId,data)=>action({action:'createOperation',propertyId,kind:'maintenance',data:{hazard:false,repairType:'leak',issue:'Kitchen tap dripping all day',...data}});
const finance=async input=>(await db.query('select public.workspace_finance_action($1::jsonb) result',[JSON.stringify({requestId:crypto.randomUUID(),...input})])).rows[0].result;
const financeRead=async section=>(await db.query('select public.workspace_finance_read($1,null,null,null,null) result',[section])).rows[0].result;
const management=async()=>(await db.query("select public.workspace_teams_read('management',null,null,null,null) result")).rows[0].result;
const seen=async(i,w)=>{await as(i);return (await db.query('select public.workspace_operations_read($1) data',[w.propertyId])).rows[0].data.find(x=>x.workId===w.workId);};
const told=async(user,work,event)=>(await db.exec('reset role'),await db.query('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and o.work_id=$2 and a.event_type=$3',[user,work,event])).rows[0].n;
const policy=async()=>{await as(ADMIN);return financeRead('policy');};
const setLimit=async(minor,who=ADMIN)=>{const {version}=await policy();await as(who);return finance({action:'setRepairApprovalLimit',version,managementRepairLimitMinor:minor});};

await as(SUPER);
const saveProperty=async name=>(await db.query('select public.workspace_save_property($1::jsonb) id',[JSON.stringify({requestId:crypto.randomUUID(),name,address:'Test address',region:'Edinburgh',bedrooms:2})])).rows[0].id;
const home=await saveProperty('Approvals home'),trusted=await saveProperty('Pre-authorised home');
for(const [prop,i,assignment] of [[home,OWNER,'client'],[home,STAYS,'staff'],[home,READY,'staff'],[trusted,PREAUTH_OWNER,'client'],[trusted,STAYS,'staff'],[trusted,READY,'staff']])await db.query('select public.workspace_assign_property($1,$2,$3)',[prop,users[i],assignment]);
await db.exec('reset role');
// The owner of "Approvals home" pre-authorised nothing; the other owner pre-authorised repairs up to £500.
for(const [prop,i,form] of [[home,OWNER,{repairLimitMinor:0,fullRepairPermission:false}],[trusted,PREAUTH_OWNER,{repairLimitMinor:50000,fullRepairPermission:false}]]){
 const work=(await db.query("insert into public.workspace_work_items(property_id,module_id,title,created_by,request_id) values($1,'property-onboarding','Test journey',$2,$3) returning id",[prop,users[SUPER],crypto.randomUUID()])).rows[0].id;
 await db.query("insert into private.workspace_journeys(property_id,client_id,work_id,property_type,bathrooms,form) values($1,$2,$3,'Flat',1,$4::jsonb)",[prop,users[i],work,JSON.stringify(form)]);
}

test('the limit starts at £100, and only admins and super admins change it',async()=>{
 assert.equal((await policy()).managementRepairLimitMinor,10000,'set to £100 where it was empty');
 for(const who of [OWNER,STAYS,READY,ACCOUNTS]){
  const {version}=await policy();await as(who);
  await assert.rejects(finance({action:'setRepairApprovalLimit',version,managementRepairLimitMinor:50000}),/Management access|Unknown|access/i,roles[who]+' cannot change it');
 }
 assert.equal((await setLimit(25000,ADMIN)).managementRepairLimitMinor,25000);
 assert.equal((await setLimit(15000,SUPER)).managementRepairLimitMinor,15000);
 await as(ADMIN);await assert.rejects(finance({action:'setRepairApprovalLimit',version:1,managementRepairLimitMinor:10000}),/changed/i,'an out-of-date version is refused');
 // A repair under the new limit is approved automatically, recording the limit in force.
 await as(STAYS);const r=await report(home,{estimatedCostMinor:12000});
 assert.equal(r.data.phase,'triage');assert.equal(r.data.autoApprovedMinor,12000);assert.equal(r.data.autoApprovalLimitMinor,15000);
 // Emptied, it reads as £100 again.
 await setLimit(null);assert.equal((await policy()).managementRepairLimitMinor,null);
 await as(STAYS);assert.equal((await report(home,{estimatedCostMinor:12000})).data.phase,'management_approval');
 assert.equal((await report(home,{estimatedCostMinor:9999})).data.autoApprovalLimitMinor,10000);
 await setLimit(10000);
});

test('under the limit: approved automatically, and the owner sees it',async()=>{
 await as(STAYS);let r=await report(home,{estimatedCostMinor:9999});
 assert.equal(r.data.phase,'triage','straight on to the work, though the owner pre-authorised nothing');
 assert.equal(r.data.autoApprovedMinor,9999);assert.equal(r.data.autoApprovalLimitMinor,10000);assert.ok(r.data.autoApprovedAt);
 assert.equal(await told(users[OWNER],r.workId,'operations.createOperation'),1,'the owner is told about the repair');
 const theirs=await seen(OWNER,r);
 assert.equal(theirs.data.autoApprovedMinor,9999);assert.equal(theirs.data.reportedBy,undefined,'no staff identity');
 // The work is booked as normal.
 await as(STAYS);r=await update(r,'referReady',{troubleshooting:'Washer worn, tap dripping',guestUpdate:'A plumber is being arranged'});
 await as(READY);r=await update(r,'bookRepair',{repairOn:new Date().toISOString().slice(0,10),contractor:'Leith Plumbing',guestUpdate:'Plumber booked'});
 assert.equal(r.data.phase,'booked');
 // A cost not known yet (£0) is not an approval.
 await as(STAYS);const unknown=await report(home,{estimatedCostMinor:0});
 assert.equal(unknown.data.phase,'triage');assert.equal(unknown.data.autoApprovedMinor,undefined);
});

test('at the limit: management first, then the owner, whose approval books the work',async()=>{
 await as(STAYS);let r=await report(home,{estimatedCostMinor:10000});
 assert.equal(r.data.phase,'management_approval');assert.equal(r.data.autoApprovedMinor,undefined);
 assert.equal(await told(users[ADMIN],r.workId,'operations.createOperation'),1,'management are told');
 await as(OWNER);await assert.rejects(update(r,'approveBudget',{consent:true}),/consent/,'the owner is not asked yet');
 await as(STAYS);await assert.rejects(update(r,'approveManagement',{}),/Management approval/);
 await as(ADMIN);r=await update(r,'approveManagement',{note:'Checked against the last invoice'});
 assert.equal(r.data.phase,'owner_approval');assert.equal(r.data.resumePhase,'triage');assert.ok(r.data.ownerApprovalSince,'the owner wait starts now');
 assert.equal(await told(users[OWNER],r.workId,'operations.updateOperation.approveManagement'),1,'the owner is told');
 await as(OWNER);r=await update(r,'approveBudget',{consent:true});
 assert.equal(r.data.phase,'triage');assert.equal(r.data.ownerApprovedMinor,10000);assert.equal(r.data.managementApprovedMinor,10000);
});

test('over the limit: the order is management, then the owner; the owner never sees management’s note or names',async()=>{
 await as(STAYS);let r=await report(home,{estimatedCostMinor:25000,repairType:'heating',issue:'Boiler losing pressure every day'});
 assert.equal(r.data.phase,'management_approval');
 await as(ADMIN);
 const waiting=(await management()).repairApprovals.find(x=>x.workId===r.workId);
 assert.ok(waiting);assert.equal(waiting.limitMinor,10000);assert.equal(waiting.quoteSource,'team');assert.equal(waiting.ownerNext,true);
 r=await update(r,'approveManagement',{note:'Internal: supplier owes us a favour'});
 assert.equal(r.data.phase,'owner_approval');
 const theirs=await seen(OWNER,r);
 for(const key of ['managementNote','managementApprovedBy','reportedBy'])assert.equal(theirs.data[key],undefined,key+' is not sent to the owner');
 assert.equal(theirs.data.managementApprovedMinor,25000,'the owner can see management checked it');
 assert.equal((await seen(STAYS,r)).data.managementNote,'Internal: supplier owes us a favour','the team still see it');
 // Pre-authorised by the owner on their set-up form: management only, then the work.
 await as(STAYS);let pre=await report(trusted,{estimatedCostMinor:40000});
 assert.equal(pre.data.phase,'management_approval');
 await as(ADMIN);assert.equal((await management()).repairApprovals.find(x=>x.workId===pre.workId).ownerNext,false);
 pre=await update(pre,'approveManagement',{});assert.equal(pre.data.phase,'triage');
 // Over the owner's own amount, they are asked after management.
 await as(STAYS);let big=await report(trusted,{estimatedCostMinor:60000});
 await as(ADMIN);big=await update(big,'approveManagement',{});assert.equal(big.data.phase,'owner_approval');
});

test('a contractor estimate goes to management even under the limit, and the owner is not asked',async()=>{
 await as(STAYS);
 await assert.rejects(report(home,{estimatedCostMinor:5000,quoteSource:'friend'}),/Invalid|quote/i,'only team or contractor');
 await assert.rejects(db.query('select public.workspace_operations_action($1::jsonb)',[JSON.stringify({requestId:crypto.randomUUID(),action:'createOperation',propertyId:home,kind:'maintenance',data:{hazard:false,issue:'Kitchen tap dripping',estimatedCostMinor:5000,quoteSource:'friend'}})]),/Ready team or a contractor/,'the database refuses it too');
 let r=await report(home,{estimatedCostMinor:5000,quoteSource:'contractor'});
 assert.equal(r.data.phase,'management_approval');assert.equal(r.data.quoteSource,'contractor');assert.equal(r.data.autoApprovedMinor,undefined);
 await as(ADMIN);assert.equal((await management()).repairApprovals.find(x=>x.workId===r.workId).quoteSource,'contractor');
 r=await update(r,'approveManagement',{});
 assert.equal(r.data.phase,'triage','under the limit, the owner is not asked');
 // A contractor's re-quote on a repair in progress goes to management too, even when it is lower.
 await as(STAYS);let t=await report(home,{estimatedCostMinor:8000});assert.equal(t.data.phase,'triage');
 t=await update(t,'referReady',{troubleshooting:'Checked the tap and the valve',guestUpdate:'A plumber is being arranged'});
 await as(READY);t=await update(t,'reviseQuote',{quoteMinor:7000,reason:'Contractor quoted for the part',quoteSource:'contractor'});
 assert.equal(t.data.phase,'management_approval');assert.equal(t.data.resumePhase,'referred');
 await as(ADMIN);t=await update(t,'approveManagement',{});assert.equal(t.data.phase,'referred');
 // A later Ready team quote that is lower carries on.
 await as(READY);t=await update(t,'reviseQuote',{quoteMinor:6000,reason:'Ready team will fit the part'});
 assert.equal(t.data.phase,'referred');assert.equal(t.data.quoteSource,'team');
});

test('declined at each stage: by management, by the owner after management, and re-quoted',async()=>{
 // Management decline: Stays re-quote or close.
 await as(STAYS);let r=await report(home,{estimatedCostMinor:30000});
 await as(ADMIN);r=await update(r,'declineManagement',{reason:'Get a second quote first'});
 assert.equal(r.data.phase,'management_declined');assert.equal(r.status,'waiting');
 const theirs=await seen(OWNER,r);assert.equal(theirs.data.managementDeclinedReason,undefined,'the owner does not get management’s reason');
 await as(OWNER);await assert.rejects(update(r,'approveBudget',{consent:true}),/consent/);
 await as(STAYS);let cheaper=await update(r,'reviseQuote',{quoteMinor:9000,reason:'Second quote from another firm'});
 assert.equal(cheaper.data.phase,'triage','under the limit after a management decline: approved automatically');assert.equal(cheaper.data.autoApprovedMinor,9000);
 let second=await report(home,{estimatedCostMinor:30000});
 await as(ADMIN);second=await update(second,'declineManagement',{reason:'Not worth repairing'});
 await as(STAYS);second=await update(second,'reviseQuote',{quoteMinor:28000,reason:'Revised quote, still over'});
 assert.equal(second.data.phase,'management_approval','still over: management again');
 await as(ADMIN);second=await update(second,'declineManagement',{reason:'Still too much'});
 await as(STAYS);second=await update(second,'closeRepair',{note:'Closed after management declined'});
 assert.equal(second.status,'cancelled');assert.equal(second.data.phase,'closed');

 // Owner decline after management approved: the owner is asked again whatever the new quote.
 let o=await report(home,{estimatedCostMinor:25000});
 await as(ADMIN);o=await update(o,'approveManagement',{});
 await as(OWNER);o=await update(o,'declineBudget',{reason:'Too expensive for now'});
 assert.equal(o.data.phase,'owner_declined');
 assert.equal(await told(users[STAYS],o.workId,'operations.updateOperation.declineBudget'),1);
 await as(STAYS);let lower=await update(o,'reviseQuote',{quoteMinor:8000,reason:'Patch repair instead'});
 assert.equal(lower.data.phase,'owner_approval','the owner said no, so they are asked again even under the limit');
 assert.equal(lower.data.autoApprovedMinor,undefined);
 await as(OWNER);lower=await update(lower,'approveBudget',{consent:true});assert.equal(lower.data.phase,'triage');
 // A higher quote after an owner decline: management first, then the owner again.
 let p=await report(home,{estimatedCostMinor:20000});
 await as(ADMIN);p=await update(p,'approveManagement',{});
 await as(OWNER);p=await update(p,'declineBudget',{reason:'Wait until the next guest leaves'});
 await as(STAYS);p=await update(p,'reviseQuote',{quoteMinor:26000,reason:'Price went up with the new part'});
 assert.equal(p.data.phase,'management_approval');
 await as(ADMIN);p=await update(p,'approveManagement',{});assert.equal(p.data.phase,'owner_approval');
 await as(OWNER);p=await update(p,'approveBudget',{consent:true});assert.equal(p.data.phase,'triage');assert.equal(p.data.ownerApprovedMinor,26000);
 // An owner decline can also be closed.
 let q=await report(home,{estimatedCostMinor:15000});
 await as(ADMIN);q=await update(q,'approveManagement',{});
 await as(OWNER);q=await update(q,'declineBudget',{reason:'I will arrange this myself'});
 await as(STAYS);q=await update(q,'closeRepair',{note:'Owner arranging it themselves'});assert.equal(q.data.phase,'closed');
});

test('repairs already waiting when this goes live keep working',async()=>{
 await as(STAYS);
 // Waiting for the owner under the old order (owner first): once they approve, management approve next.
 let legacy=await report(home,{estimatedCostMinor:20000});
 await db.exec('reset role');
 await db.query("update private.workspace_domain_details set data=data||'{\"phase\":\"owner_approval\",\"resumePhase\":null}'::jsonb where work_id=$1",[legacy.workId]);
 legacy=await seen(OWNER,legacy);
 legacy=await update(legacy,'approveBudget',{consent:true});
 assert.equal(legacy.data.phase,'management_approval');
 await as(ADMIN);legacy=await update(legacy,'approveManagement',{});
 assert.equal(legacy.data.phase,'triage','the owner already approved this amount, so they are not asked twice');
 // Waiting for management with the owner's approval already given: carries on once approved.
 await as(STAYS);let old=await report(home,{estimatedCostMinor:20000});
 await db.exec('reset role');
 await db.query("update private.workspace_domain_details set data=data||jsonb_build_object('ownerApprovedMinor',20000,'ownerApprovedAt',now()) where work_id=$1",[old.workId]);
 old=await seen(ADMIN,old);old=await update(old,'approveManagement',{});
 assert.equal(old.data.phase,'triage');
});

test('safe to run twice: the patches are not applied again and a changed limit is kept',async()=>{
 await setLimit(20000);
 const definitions=async()=>(await db.exec('reset role'),await db.query("select pg_get_functiondef('private.workspace_operations_action(jsonb)'::regprocedure) a,pg_get_functiondef('private.workspace_repair_decision(text,uuid,jsonb,jsonb)'::regprocedure) b")).rows[0];
 const before=await definitions();
 await db.exec('reset role');await db.exec(await fs.readFile(MIGRATION,'utf8'));
 const again=await definitions();
 assert.equal(again.a,before.a);assert.equal(again.b,before.b);
 for(const marker of ["'urgent','quoteSource']","data:=data||entry;data:=data||private.workspace_repair_requote(","private.workspace_repair_route(prop,amount,data,'triage')"])assert.equal(again.a.split(marker).length-1,1,marker);
 assert.equal((await policy()).managementRepairLimitMinor,20000,'the migration only fills an empty limit');
 await as(STAYS);
 assert.equal((await report(home,{estimatedCostMinor:19999})).data.phase,'triage');
 assert.equal((await report(home,{estimatedCostMinor:20000})).data.phase,'management_approval');
 await setLimit(10000);
});
