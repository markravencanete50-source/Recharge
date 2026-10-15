import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Repairs with contractors (20261021200000): one contractor (a Ready user) per job, assigned when Stays refer the
// repair; only that contractor sees the job, its photos, files, chat, calendar entry and notices. The contractor's
// estimate goes to the team's review, then within the owner's limit it is approved straight away, otherwise the owner
// is asked; once approved the contractor is told to book. Booking takes a time window and warns about guest stays.
// Invoices go onto the draft expense. Limit Changer sets the owner's limit per property (super admin only) and
// approves waiting estimates now within it. Ready lockdown: no guest names, no owner details from onboarding.
// The calls go straight to the database: the new fields reach the HTTP schema with Dev2's change.
const MIGRATION='supabase/migrations/20261021200000_repair_contractors.sql';
const db=new PGlite();
const roles=['super_admin','admin','client','stays','ready','ready','ready','accounts'];
const [SUPER,ADMIN,OWNER,STAYS,READY_A,READY_B,READY_C,ACCOUNTS]=roles.map((_,i)=>i);
const users=roles.map((_,i)=>`85000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const session=i=>users[i].replace('8500','8600');
const READY_MODULES=['ready-schedule','safety-maintenance','purchase-order','maintenance-reporting','property-furnishing-board','new-property-inspection-board','routine-bin-garden-board'];
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`repair-contractors${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1",[users[i],roles[i],['Alex Super','Admin Person','Olivia Owner','Sam Stays','Andy Plumber','Bea Electrician','Cal Joiner','Acc Ounts'][i]]);
 // Contractor A has the default Ready tools; B has every tool, to show the rule does not rest on tool grants.
 if(i===READY_A||i===READY_C)await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,unnest($2::text[])',[users[i],READY_MODULES]);
 else await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features',[users[i]]);
}
let current=null;
async function as(i){current=i;await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[i],session_id:session(i)})]);await db.exec('set role authenticated');}
beforeEach(async()=>{await db.exec('reset role');await db.exec('delete from private.workspace_write_limits');});
after(async()=>{await db.close();});
const call=async(fn,input)=>(await db.query(`select public.${fn}($1::jsonb) result`,[JSON.stringify({requestId:crypto.randomUUID(),...input})])).rows[0].result;
const action=input=>call('workspace_operations_action',input);
const update=(w,step,data)=>action({action:'updateOperation',workId:w.workId,version:w.version,step,data});
const report=(propertyId,data)=>action({action:'createOperation',propertyId,kind:'maintenance',data:{hazard:false,repairType:'leak',issue:'Kitchen tap dripping all day',estimatedCostMinor:0,...data}});
const limits=input=>call('workspace_repair_limits_action',{action:'setRepairLimit',...input});
const limitsRead=async()=>(await db.query('select public.workspace_repair_limits_read() r')).rows[0].r;
const list=async(i,prop=null)=>{await as(i);return (await db.query('select public.workspace_operations_read($1) data',[prop])).rows[0].data;};
const seen=async(i,w)=>(await list(i,w.propertyId)).find(x=>x.workId===w.workId);
const fresh=async w=>{const back=current;await as(STAYS);const r=(await db.query('select public.workspace_operation_read($1) r',[w.workId])).rows[0].r;if(back!==null)await as(back);return r;};
const told=async(user,work,event)=>(await db.exec('reset role'),await db.query('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and o.work_id=$2 and a.event_type=$3',[user,work,event])).rows[0].n;
const LIMIT_KEYS=['ownerLimitMinor','ownerFullPermission','ownerLimitSource','autoApprovalLimitMinor','autoApprovalSource'];
const today=(await db.query("select (now() at time zone 'Europe/London')::date::text d")).rows[0].d;
const plus=n=>new Date(Date.parse(today+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
// A verified upload on a repair, through the real prepare and commit, as photo or PDF.
async function upload(i,w,format='jpg',purpose='maintenance'){
 await as(i);
 const intent=(await db.query('select public.workspace_prepare_upload($1::jsonb) r',[JSON.stringify({requestId:crypto.randomUUID(),workId:w.workId,purpose,contentHash:'a'.repeat(64)})])).rows[0].r;
 await db.exec('reset role');
 return (await db.query('select private.integration_commit_upload($1,$2::jsonb) id',[intent.id,JSON.stringify({assetId:'asset-'+intent.id,publicId:intent.publicId,version:1,format,bytes:2048})])).rows[0].id;
}

await as(SUPER);
const saveProperty=async name=>(await db.query('select public.workspace_save_property($1::jsonb) id',[JSON.stringify({requestId:crypto.randomUUID(),name,address:'Test address',region:'Edinburgh',bedrooms:2})])).rows[0].id;
const home=await saveProperty('Contractors home'),other=await saveProperty('Other home'),second=await saveProperty('Second home'),far=await saveProperty('Far home');
for(const [prop,i,assignment] of [[home,OWNER,'client'],[home,STAYS,'staff'],[home,READY_A,'staff'],[home,READY_B,'staff'],[other,STAYS,'staff'],[other,READY_C,'staff'],[second,OWNER,'client'],[second,STAYS,'staff'],[second,READY_A,'staff']])
 await db.query('select public.workspace_assign_property($1,$2,$3)',[prop,users[i],assignment]);
await db.exec('reset role');
// The owner pre-authorised nothing on the set-up form; the enquiry and estimate are owner details Ready must not get.
for(const [prop,form] of [[home,{repairLimitMinor:0,fullRepairPermission:false,warrantyDetails:''}],[second,{repairLimitMinor:20000,fullRepairPermission:false}]]){
 const work=(await db.query("insert into public.workspace_work_items(property_id,module_id,title,created_by,request_id) values($1,'property-onboarding','Test journey',$2,$3) returning id",[prop,users[SUPER],crypto.randomUUID()])).rows[0].id;
 await db.query("insert into private.workspace_journeys(property_id,client_id,work_id,property_type,bathrooms,form,enquiry,estimate) values($1,$2,$3,'Flat',1,$4::jsonb,$5::jsonb,$6::jsonb)",
  [prop,users[OWNER],work,JSON.stringify(form),JSON.stringify({contactName:'Olivia Owner',email:'olivia@example.com',phone:'07700 900000'}),JSON.stringify({annualRevenueMinor:4200000})]);
}
// A guest stay arriving in ten days, and its guest conversation.
const stayDay=plus(10);
const stay=(await db.query("insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,created_by) values($1,'HMSTAY1',$2,$3,'confirmed','manual',$4) returning id",[home,stayDay,plus(13),users[SUPER]])).rows[0].id;
const thread=(await db.query("insert into private.workspace_guest_threads(source,thread_ref,property_id,channel,guest_name,reservation_ref,guest_email,last_message_at) values('manual','repair-t1',null,'email','Gina Guest','HMSTAY1','gina@example.com',now()) returning id")).rows[0].id;
const otherThread=(await db.query("insert into private.workspace_guest_threads(source,thread_ref,property_id,channel,guest_name,last_message_at) values('manual','repair-t2',$1,'email','Other Guest',now()) returning id",[other])).rows[0].id;

test('the contractor picker: Ready users on the property, for Stays and management only',async()=>{
 const picker=async i=>{await as(i);return (await db.query('select public.workspace_repair_contractors($1) r',[home])).rows[0].r;};
 assert.deepEqual((await picker(STAYS)).map(x=>x.name),['Andy Plumber','Bea Electrician']);
 assert.deepEqual(Object.keys((await picker(ADMIN))[0]).sort(),['id','name','trade']);
 for(const who of [READY_A,OWNER,ACCOUNTS])await assert.rejects(picker(who),/Stays or management/,roles[who]+' is refused');
 await as(STAYS);await assert.rejects(db.query('select public.workspace_repair_contractors($1) r',[far]),/Stays or management/,'not their property');
 await db.exec('reset role');await db.exec('set role anon');await assert.rejects(db.query('select public.workspace_repair_contractors($1)',[home]),/permission/,'not for anon');
});

test('a repair from a guest conversation picks up the stay; the conversation must be for this property',async()=>{
 await as(STAYS);
 const r=await report(home,{guestConversationId:thread});
 assert.equal(r.data.guestConversationId,thread);assert.equal(r.data.reservationId,stay,'the stay comes from the booking code on the conversation');
 await assert.rejects(report(home,{guestConversationId:otherThread}),/another property/);
 await assert.rejects(report(home,{guestConversationId:crypto.randomUUID()}),/not found/);
 await assert.rejects(report(home,{guestConversationId:'nope'}),/guest conversation/);
 await as(OWNER);await assert.rejects(report(home,{guestConversationId:thread}),/guest team/,'owners cannot');
});

let job;
test('one contractor per job: only the assigned contractor sees it, its photos, chat and notices',async()=>{
 await as(STAYS);job=await report(home,{issue:'Shower not draining at all'});
 const photo=await upload(STAYS,job);
 const refer=data=>update(job,'referReady',{troubleshooting:'Plunged the drain, still blocked',guestUpdate:'A plumber is being arranged',...data});
 await assert.rejects(refer({}),/Choose the contractor/,'a contractor is required');
 for(const who of [OWNER,READY_C,STAYS])await assert.rejects(refer({readyUserId:users[who]}),/works on this property/,roles[who]+' is not a contractor here');
 job=await refer({readyUserId:users[READY_A]});
 assert.equal(job.data.phase,'referred');assert.equal(job.data.assignedReadyId,users[READY_A]);assert.equal(job.data.assignedReadyName,'Andy Plumber');assert.equal(job.data.readyUserId,undefined);
 assert.equal(await told(users[READY_A],job.workId,'operations.updateOperation.referReady'),1,'the contractor is told');
 assert.equal(await told(users[READY_B],job.workId,'operations.updateOperation.referReady'),0,'the other contractor is not');
 // A sees it; B does not, anywhere.
 assert.ok(await seen(READY_A,job));
 assert.equal(await seen(READY_B,job),undefined);
 await assert.rejects(db.query('select public.workspace_operation_read($1)',[job.workId]),/not found/);
 assert.equal((await db.query('select count(*)::int n from public.workspace_work_items where id=$1',[job.workId])).rows[0].n,0,'work item RLS');
 assert.equal((await db.query('select count(*)::int n from public.workspace_activity where work_id=$1',[job.workId])).rows[0].n,0,'activity RLS');
 await assert.rejects(db.query('select public.workspace_media_read($1)',[job.workId]),/Media access denied/);
 await assert.rejects(db.query('select public.workspace_media_asset($1)',[photo]),/Media access denied/);
 await assert.rejects(update(job,'bookRepair',{repairOn:plus(1),visitFrom:'09:00',visitTo:'11:00',contractor:'Bea',guestUpdate:'Booked in'}),/access denied/i);
 const stages=async i=>{await as(i);return (await db.query('select public.workspace_ready_home() r')).rows[0].r.stages;};
 assert.equal((await stages(READY_B)).referred,undefined,'Ready Home counts only their jobs');
 assert.equal((await stages(READY_A)).referred,1);
 await as(READY_A);
 assert.equal((await db.query('select jsonb_array_length(public.workspace_media_read($1)) n',[job.workId])).rows[0].n,1,'A sees the photo');
 // Push and uploads use the same rule.
 await db.exec('reset role');
 const canWork=async i=>(await db.query('select private.integration_can_work($1,$2) ok',[users[i],job.workId])).rows[0].ok;
 assert.equal(await canWork(READY_A),true);assert.equal(await canWork(READY_B),false);
 // The repair's team chat: A is in it, B is not and cannot open it.
 await as(STAYS);const chat=(await db.query('select public.workspace_chat_action($1::jsonb) r',[JSON.stringify({action:'startProperty',propertyId:home,workId:job.workId})])).rows[0].r;
 await db.exec('reset role');
 const conversation=(await db.query('select id from private.chat_conversations where work_id=$1',[job.workId])).rows[0].id;
 const canChat=async i=>(await db.query('select private.chat_can($1,$2) ok',[conversation,users[i]])).rows[0].ok;
 assert.ok(chat);assert.equal(await canChat(READY_A),true);assert.equal(await canChat(READY_B),false);assert.equal(await canChat(STAYS),true);
 // A repair referred before contractors were assigned keeps the old rule.
 await as(STAYS);let legacy=await report(home,{issue:'Old repair from before'});
 legacy=await update(legacy,'referReady',{troubleshooting:'Checked it over',guestUpdate:'Someone is coming',readyUserId:users[READY_A]});
 await db.exec('reset role');await db.query("update private.workspace_domain_details set data=data-'assignedReadyId'-'assignedReadyName' where work_id=$1",[legacy.workId]);
 assert.ok(await seen(READY_B,legacy),'legacy referred repairs stay visible to the property’s Ready team');
});

test('reassigning the job: Stays move it to another contractor, both are told, the first loses it',async()=>{
 await as(READY_A);await assert.rejects(update(job,'reassignReady',{readyUserId:users[READY_B],reason:'Andy is away this week'}),/another contractor/,'contractors cannot');
 await as(STAYS);
 await assert.rejects(update(job,'reassignReady',{readyUserId:users[READY_A],reason:'Same person again'}),/already has the job/);
 await assert.rejects(update(job,'reassignReady',{readyUserId:users[READY_B]}),/reason/i);
 job=await update(job,'reassignReady',{readyUserId:users[READY_B],reason:'Andy is away this week'});
 assert.equal(job.data.assignedReadyId,users[READY_B]);assert.equal(job.data.previousReadyId,users[READY_A]);assert.equal(job.data.phase,'referred');
 assert.equal(await told(users[READY_A],job.workId,'operations.updateOperation.reassignReady'),1);
 assert.equal(await told(users[READY_B],job.workId,'operations.updateOperation.reassignReady'),1);
 assert.equal(await seen(READY_A,job),undefined,'A no longer sees it');
 assert.ok(await seen(READY_B,job));
 await db.exec('reset role');
 const conversation=(await db.query('select id from private.chat_conversations where work_id=$1',[job.workId])).rows[0].id;
 assert.deepEqual((await db.query('select private.chat_can($1,$2) a,private.chat_can($1,$3) b',[conversation,users[READY_A],users[READY_B]])).rows[0],{a:false,b:true},'the chat follows the job');
 // Back to A for the rest of the tests.
 await as(STAYS);job=await update(job,'reassignReady',{readyUserId:users[READY_A],reason:'Andy is back now'});
 await as(STAYS);await assert.rejects(update((await report(home,{issue:'Never referred repair'})),'reassignReady',{readyUserId:users[READY_B],reason:'Not referred yet'}),/with a contractor/);
});

test('the contractor’s estimate: team review, then the owner (outside their limit), then approved to book',async()=>{
 // A Ready estimate is always a contractor estimate, with its quote file (a PDF).
 const pdf=await upload(READY_A,job,'pdf');
 await as(READY_A);
 await assert.rejects(update(job,'reviseQuote',{quoteMinor:25000,reason:'New waste pipe needed',quoteFileIds:[crypto.randomUUID()]}),/saved on this repair/);
 job=await update(job,'reviseQuote',{quoteMinor:25000,reason:'New waste pipe needed',quoteSource:'team',quoteFileIds:[pdf]});
 assert.equal(job.data.phase,'team_review');assert.equal(job.data.resumePhase,'referred');assert.equal(job.data.quoteSource,'contractor');assert.equal(job.data.teamReview,true);
 assert.deepEqual(job.data.quoteFileIds,[pdf]);
 for(const key of LIMIT_KEYS)assert.equal(key in job.data,false,key+' is not sent to the contractor');
 assert.equal(await told(users[ADMIN],job.workId,'operations.updateOperation.estimateToReview'),1,'management are asked to review it');
 assert.equal(await told(users[SUPER],job.workId,'operations.updateOperation.estimateToReview'),1);
 assert.equal(await told(users[STAYS],job.workId,'operations.updateOperation.reviseQuote'),1,'Stays are told for information');
 assert.equal(await told(users[STAYS],job.workId,'operations.updateOperation.estimateToReview'),0);
 // The team see the owner's limit as it is now (the set-up form: always ask).
 let team=await fresh(job);
 assert.equal(team.data.ownerLimitMinor,0);assert.equal(team.data.ownerFullPermission,false);assert.equal(team.data.ownerLimitSource,'form');
 for(const who of [STAYS,OWNER,READY_A,ACCOUNTS]){await as(who);await assert.rejects(update(job,'reviewDone',{}),/Only management|denied/,roles[who]+' cannot approve it');}
 await as(ADMIN);job=await update(job,'reviewDone',{note:'Price checked against the last pipe job'});
 assert.equal(job.data.phase,'owner_approval');assert.equal(job.data.resumePhase,'referred');assert.equal(job.data.reviewNote,'Price checked against the last pipe job');
 assert.equal(job.data.autoApprovedAt??null,null);assert.equal(job.data.bookingApprovedAt??null,null);
 assert.equal(await told(users[SUPER],job.workId,'operations.updateOperation.reviewDone'),1,'the rest of management are told');
 assert.equal(await told(users[OWNER],job.workId,'operations.updateOperation.reviewDone'),1,'the owner is asked');
 assert.equal(await told(users[STAYS],job.workId,'operations.updateOperation.reviewDone'),1,'Stays are told the outcome');
 assert.equal(await told(users[READY_A],job.workId,'operations.updateOperation.reviewDone'),1,'the contractor: waiting for the owner');
 await as(ADMIN);await assert.rejects(update(job,'approveManagement',{}),/Management approval/,'no management step');
 await as(OWNER);job=await update(job,'approveBudget',{consent:true});
 assert.equal(job.data.phase,'referred','the owner’s approval does not go on to management');assert.ok(job.data.bookingApprovedAt);
 assert.equal(await told(users[READY_A],job.workId,'operations.updateOperation.approvedToBook'),1,'the contractor: approved, please book');
 assert.equal(await told(users[ADMIN],job.workId,'operations.updateOperation.approveBudget'),1,'Alex is told');
 const theirs=await seen(READY_A,job);assert.ok(theirs.data.bookingApprovedAt);for(const key of LIMIT_KEYS)assert.equal(key in theirs.data,false,key);
 // A new estimate clears the approval to book.
 await as(READY_A);let again=await update(theirs,'reviseQuote',{quoteMinor:26000,reason:'Extra fitting needed now'});
 assert.equal(again.data.phase,'team_review');assert.equal(again.data.bookingApprovedAt,null);
 // An owner decline tells the contractor, the team and Alex.
 await as(ADMIN);again=await update(again,'reviewDone',{});
 await as(OWNER);again=await update(again,'declineBudget',{reason:'Too much for a drain'});
 for(const who of [READY_A,STAYS,ADMIN])assert.equal(await told(users[who],again.workId,'operations.updateOperation.declineBudget'),1,roles[who]);
 // ...and after a no, the owner is asked again even within their limit.
 await as(SUPER);await limits({propertyIds:[home],limitMinor:100000,fullPermission:false});
 await as(STAYS);again=await update(again,'reviseQuote',{quoteMinor:20000,reason:'Cheaper fitting from the merchant'});
 assert.equal(again.data.phase,'management_approval','a team estimate keeps today’s rules: management first');assert.equal(again.data.teamReview,false);
 await as(ADMIN);again=await update(again,'approveManagement',{});
 assert.equal(again.data.phase,'owner_approval','after a no, the owner is asked again even within their limit');
 await as(OWNER);job=await update(again,'approveBudget',{consent:true});assert.equal(job.data.phase,'referred');assert.ok(job.data.bookingApprovedAt);
 await as(SUPER);await limits({propertyIds:[home],limitMinor:null,fullPermission:false});
});

test('review done within the owner’s limit: approved straight away; the contractor never sees the limit',async()=>{
 await as(SUPER);await limits({propertyIds:[second],limitMinor:50000,fullPermission:false});
 await as(STAYS);let w=await report(second,{issue:'Boiler pressure keeps dropping'});
 w=await update(w,'referReady',{troubleshooting:'Topped up the pressure twice',guestUpdate:'A heating engineer is coming',readyUserId:users[READY_A]});
 await as(READY_A);w=await update(w,'reviseQuote',{quoteMinor:30000,reason:'Replace the expansion vessel'});
 assert.equal(w.data.phase,'team_review');
 assert.equal((await fresh(w)).data.ownerLimitMinor,50000,'the Limit Changer value beats the set-up form');
 // reviewDone decides on the limit as it is now, never the stored snapshot.
 await db.exec('reset role');await db.query("update private.workspace_domain_details set data=data||'{\"ownerLimitMinor\":1}'::jsonb where work_id=$1",[w.workId]);
 await as(SUPER);w=await update(await fresh(w),'reviewDone',{});
 assert.equal(w.data.phase,'referred');assert.equal(w.data.autoApprovedMinor,30000);assert.equal(w.data.autoApprovalLimitMinor,50000);assert.equal(w.data.autoApprovalSource,'set');
 assert.ok(w.data.bookingApprovedAt);assert.ok(w.data.autoApprovedAt);
 assert.equal(await told(users[READY_A],w.workId,'operations.updateOperation.approvedToBook'),1);
 assert.equal(await told(users[ADMIN],w.workId,'operations.updateOperation.reviewDone'),1,'Alex is told');
 assert.equal(await told(users[STAYS],w.workId,'operations.updateOperation.reviewDone'),1,'Stays are told');
 assert.equal(await told(users[READY_A],w.workId,'operations.updateOperation.reviewDone'),0,'the contractor gets "please book" instead');
 assert.equal(await told(users[OWNER],w.workId,'operations.updateOperation.reviewDone'),1,'the owner, for information');
 const theirs=await seen(READY_A,w);
 for(const key of LIMIT_KEYS)assert.equal(key in theirs.data,false,key+' is hidden from the contractor');
 await as(READY_A);
 const one=(await db.query('select public.workspace_operation_read($1) r',[w.workId])).rows[0].r;
 for(const key of LIMIT_KEYS)assert.equal(key in one.data,false,key+' (single read)');
 const notices=JSON.stringify((await db.query('select public.workspace_notifications_read(null) r')).rows[0].r);
 assert.equal(notices.includes('50000'),false,'not in the notices either');
 // Full permission: always within.
 await as(SUPER);await limits({propertyIds:[second],limitMinor:null,fullPermission:true});
 await as(READY_A);w=await update(theirs,'reviseQuote',{quoteMinor:900000,reason:'Whole new boiler after all'});
 await as(ADMIN);w=await update(w,'reviewDone',{});assert.equal(w.data.phase,'referred');assert.equal(w.data.autoApprovalLimitMinor,null);
});

test('a limit change approves waiting estimates now within it, and refreshes estimates under review',async()=>{
 await as(SUPER);await limits({propertyIds:[second],limitMinor:10000,fullPermission:false});
 await as(STAYS);let w=await report(second,{issue:'Dishwasher leaking water'});
 w=await update(w,'referReady',{troubleshooting:'Cleaned the filter and seal',guestUpdate:'An engineer will come',readyUserId:users[READY_A]});
 await as(READY_A);w=await update(w,'reviseQuote',{quoteMinor:40000,reason:'New pump for the dishwasher'});
 await as(ADMIN);w=await update(w,'reviewDone',{});assert.equal(w.data.phase,'owner_approval');
 // Another estimate still in review.
 await as(STAYS);let r=await report(second,{issue:'Window latch is broken'});
 r=await update(r,'referReady',{troubleshooting:'Latch will not close',guestUpdate:'A joiner will come',readyUserId:users[READY_A]});
 await as(READY_A);r=await update(r,'reviseQuote',{quoteMinor:60000,reason:'New window frame needed'});
 assert.equal((await fresh(r)).data.ownerLimitMinor,10000);
 await as(SUPER);const result=await limits({propertyIds:[second],limitMinor:50000,fullPermission:false});
 assert.deepEqual(result.autoApproved,[w.workId]);
 assert.equal(result.properties[0].limitMinor,50000);assert.equal(result.properties[0].source,'set');assert.equal(result.properties[0].updatedBy,users[SUPER]);assert.equal(result.properties[0].updatedByName,'Alex Super');
 w=await fresh(w);
 assert.equal(w.data.phase,'referred');assert.ok(w.data.bookingApprovedAt);assert.equal(w.data.autoApprovedMinor,40000);assert.equal(w.data.autoApprovalSource,'set');
 for(const who of [READY_A,ADMIN,OWNER])assert.equal(await told(users[who],w.workId,'operations.repairLimit.autoApproved'),1,roles[who]+' is told');
 assert.equal((await fresh(r)).data.ownerLimitMinor,50000,'the estimate in review shows the new limit');
 assert.equal((await fresh(r)).data.phase,'team_review','the team still review it');
 // The same request again returns the same answer and changes nothing.
 const again=await (async()=>{const requestId=crypto.randomUUID();const input={requestId,action:'setRepairLimit',propertyIds:[second],limitMinor:50000,fullPermission:false};
  const a=(await db.query('select public.workspace_repair_limits_action($1::jsonb) r',[JSON.stringify(input)])).rows[0].r;
  const b=(await db.query('select public.workspace_repair_limits_action($1::jsonb) r',[JSON.stringify(input)])).rows[0].r;return [a,b];})();
 assert.deepEqual(again[0],again[1]);
 await db.exec('reset role');
 assert.ok((await db.query('select count(*)::int n from private.workspace_repair_limit_history where property_id=$1',[second])).rows[0].n>=4,'every change is kept');
});

test('Limit Changer: super admins change limits; admins only read; owners grouped with their properties',async()=>{
 for(const who of [ADMIN,STAYS,READY_A,OWNER,ACCOUNTS]){
  await as(who);await assert.rejects(limits({propertyIds:[home],limitMinor:5000,fullPermission:false}),/super admin/,roles[who]+' is refused');
 }
 await as(SUPER);
 await assert.rejects(limits({propertyIds:[home],limitMinor:5000,fullPermission:true}),/not both/);
 await assert.rejects(limits({propertyIds:[],limitMinor:5000,fullPermission:false}),/properties/);
 await assert.rejects(limits({propertyIds:[crypto.randomUUID()],limitMinor:5000,fullPermission:false}),/not found/);
 await assert.rejects(limits({propertyIds:[home],limitMinor:-1,fullPermission:false}),/Integer/);
 await as(ADMIN);const view=await limitsRead();
 assert.equal(view.canEdit,false);assert.equal(view.companyLimitMinor,10000);
 const olivia=view.owners.find(o=>o.ownerKey==='user:'+users[OWNER]);
 assert.equal(olivia.ownerName,'Olivia Owner');assert.deepEqual(olivia.properties.map(p=>p.propertyName),['Contractors home','Second home']);
 const homeRow=olivia.properties.find(p=>p.propertyId===home);
 assert.equal(homeRow.source,'set');assert.equal(homeRow.limitMinor,null);assert.equal(homeRow.fullPermission,false,'"Always ask"');
 assert.ok(view.owners.find(o=>o.ownerKey==='property:'+other),'a property with no owner recorded stands alone');
 await as(SUPER);assert.equal((await limitsRead()).canEdit,true);
 for(const who of [STAYS,READY_A,OWNER,ACCOUNTS]){await as(who);await assert.rejects(limitsRead(),/Management access/,roles[who]);}
});

test('booking: a time window is required, guests’ stays that day are warned about without names',async()=>{
 await as(STAYS);let w=await report(home,{issue:'Front door lock sticking'});
 w=await update(w,'referReady',{troubleshooting:'Lubricated the lock',guestUpdate:'A locksmith is coming',readyUserId:users[READY_A]});
 await as(READY_A);
 await assert.rejects(update(w,'bookRepair',{repairOn:stayDay,guestUpdate:'Locksmith booked in'}),/visit time/);
 await assert.rejects(update(w,'bookRepair',{repairOn:stayDay,visitFrom:'15:00',visitTo:'13:00',guestUpdate:'Locksmith booked in'}),/end after/);
 await assert.rejects(update(w,'bookRepair',{repairOn:stayDay,visitFrom:'9am',visitTo:'13:00',guestUpdate:'Locksmith booked in'}),/visit time/);
 await as(READY_B);await assert.rejects(update(w,'bookRepair',{repairOn:stayDay,visitFrom:'13:00',visitTo:'15:00',guestUpdate:'Locksmith booked in'}),/access denied/i,'not their job');
 await as(READY_A);w=await update(w,'bookRepair',{repairOn:stayDay,visitFrom:'13:00',visitTo:'15:00',guestUpdate:'Locksmith booked in'});
 assert.equal(w.data.phase,'booked');assert.equal(w.data.visitFrom,'13:00');assert.equal(w.data.visitTo,'15:00');assert.equal(w.data.contractor,'Andy Plumber','the contractor’s name by default');
 assert.deepEqual(w.clashes,[{checkIn:stayDay,checkOut:plus(13),label:'Guest stay, check-in 14:00'}]);assert.deepEqual(w.data.clashes,w.clashes);
 assert.equal(JSON.stringify(w).includes('Gina'),false,'no guest name');
 assert.equal(w.dueOn,stayDay);assert.equal(w.dueTime,'13:00');assert.equal(w.endTime,'15:00');
 assert.equal(await told(users[STAYS],w.workId,'operations.updateOperation.bookRepair'),1,'Stays are told, to tell the guest');
 // Windows against the same stay.
 await db.exec('reset role');
 const clashes=async(day,from,to)=>(await db.query('select private.workspace_repair_clashes($1,$2::date,$3::time,$4::time) c',[home,day,from,to])).rows[0].c.map(c=>c.label);
 assert.deepEqual(await clashes(stayDay,'09:00','12:00'),[],'done before check-in');
 assert.deepEqual(await clashes(plus(11),'09:00','10:00'),['Guest stay, guests in all day']);
 assert.deepEqual(await clashes(plus(13),'09:00','11:00'),['Guest stay, check-out 10:00']);
 assert.deepEqual(await clashes(plus(13),'10:00','12:00'),[],'after check-out');
 // Stays may book too; a reassigned booked job goes back to be booked by the new contractor.
 await as(STAYS);w=await update(w,'reassignReady',{readyUserId:users[READY_B],reason:'Bea is nearer this week'});
 assert.equal(w.data.phase,'referred');assert.equal(w.dueOn,null);assert.equal(w.data.visitFrom,null);
 w=await update(w,'bookRepair',{repairOn:plus(2),visitFrom:'10:00',visitTo:'11:30',guestUpdate:'Locksmith booked in again'});
 assert.equal(w.data.contractor,'Bea Electrician');assert.deepEqual(w.clashes,[]);
});

test('completion: the contractor’s invoice and estimate files go on the draft expense, not as photos',async()=>{
 const after=await upload(READY_A,job);const invoice=await upload(READY_A,job,'pdf');
 const quote=await upload(READY_A,job,'pdf');
 job=await seen(READY_A,job);
 await as(READY_A);job=await update(job,'reviseQuote',{quoteMinor:20000,reason:'Final price for the pipe work',quoteFileIds:[quote]});
 await as(ADMIN);job=await update(job,'reviewDone',{});
 assert.equal(job.data.phase,'referred','the owner already approved this amount, so it is approved straight away');assert.ok(job.data.bookingApprovedAt);
 job=await seen(READY_A,job);
 job=await update(job,'bookRepair',{repairOn:plus(1),visitFrom:'08:00',visitTo:'09:30',guestUpdate:'Plumber booked for tomorrow'});
 await assert.rejects(update(job,'completeRepair',{report:'Replaced the waste pipe and tested',actualCostMinor:20000,guestUpdate:'All fixed now',photoIds:[invoice]}),/After photos/,'a PDF is not a photo');
 await assert.rejects(update(job,'completeRepair',{report:'Replaced the waste pipe and tested',actualCostMinor:20000,guestUpdate:'All fixed now',invoiceFileIds:['x']}),/saved on this repair/);
 job=await update(job,'completeRepair',{report:'Replaced the waste pipe and tested',actualCostMinor:20000,guestUpdate:'All fixed now',photoIds:[after],invoiceFileIds:[invoice]});
 assert.equal(job.status,'completed');assert.deepEqual(job.data.invoiceFileIds,[invoice]);
 await db.exec('reset role');
 const evidence=(await db.query("select v.kind,v.label,v.media_id from private.workspace_expense_evidence v join private.workspace_expenses x on x.id=v.expense_id where x.work_id=$1 and x.source='repair' order by v.kind,v.label",[job.workId])).rows;
 assert.deepEqual(evidence.filter(e=>e.kind==='invoice').map(e=>e.media_id),[invoice]);
 assert.deepEqual(evidence.filter(e=>e.kind==='quote').map(e=>e.media_id),[quote],'the contractor’s estimate file');
 assert.deepEqual(evidence.filter(e=>e.kind==='photo').map(e=>e.label).sort(),['After photo','Before photo'],'only the photos count as photos');
});

test('PDF files are accepted only as a repair’s own files',async()=>{
 await as(STAYS);const w=await report(home,{issue:'Extractor fan very noisy'});
 assert.ok(await upload(STAYS,w,'pdf'));
 await assert.rejects(upload(STAYS,w,'gif'),/Invalid verified asset/);
 // Not for cleaning photos.
 await as(SUPER);
 const clean=await action({action:'createOperation',propertyId:home,kind:'cleaning',data:{dueOn:plus(1),checklist:['Kitchen']}});
 await db.exec('reset role');await db.query('update public.workspace_work_items set assignee_id=$2 where id=$1',[clean.workId,users[STAYS]]);
 const intent=(await db.query("insert into private.workspace_upload_intents(id,owner_id,request_id,work_id,purpose,content_hash,public_id) values(gen_random_uuid(),$1,gen_random_uuid(),$2,'maintenance',$3,'recharge/x-'||gen_random_uuid()::text) returning id,public_id",[users[STAYS],clean.workId,'c'.repeat(64)])).rows[0];
 await assert.rejects(db.query('select private.integration_commit_upload($1,$2::jsonb)',[intent.id,JSON.stringify({assetId:'a1',publicId:intent.public_id,version:1,format:'pdf',bytes:2048})]),/Invalid verified asset|permission/);
});

test('Ready lockdown: no guest names on the calendar, only the inspection part of onboarding',async()=>{
 const schedule=async i=>{await as(i);return (await db.query("select public.workspace_teams_read('schedule',$1::date,$2::date,null,null) r",[today,plus(20)])).rows[0].r;};
 const mine=(await schedule(READY_A)).stays.find(s=>s.reservationId===stay);
 assert.ok(mine,'Ready still see the stay and its dates');assert.equal(mine.guestName??null,null,'but not the guest’s name');
 assert.equal((await schedule(STAYS)).stays.find(s=>s.reservationId===stay).guestName,'Gina Guest','Stays still do');
 await as(READY_A);
 const journeys=(await db.query('select public.workspace_journey_read($1) r',[home])).rows[0].r;
 assert.equal(journeys.length,1);
 assert.deepEqual(Object.keys(journeys[0]).sort(),['bathrooms','inspectionChecks','inspectionCompletedAt','inspectionOn','inspectionReport','propertyId','propertyType','stage','version','workId']);
 const text=JSON.stringify(journeys);
 for(const secret of ['olivia@example.com','07700','4200000','Olivia'])assert.equal(text.includes(secret),false,secret);
 await as(STAYS);const full=(await db.query('select public.workspace_journey_read($1) r',[home])).rows[0].r[0];
 for(const key of ['estimate','enquiry','form','questions','agreement','signedName','feedback','invoiceId'])assert.ok(key in full,'Stays still get '+key);
});

test('safe to run twice: the patches are not applied again and limits are kept',async()=>{
 const names=['private.workspace_operations_action(jsonb)','private.workspace_can_work(uuid)','private.workspace_operation_access(uuid)','private.workspace_operation_view(uuid)','private.integration_can_work(uuid,uuid)',
  'private.chat_can(uuid,uuid)','private.chat_start_property(jsonb)','private.workspace_ready_home()','private.workspace_repair_requote(uuid,bigint,jsonb,jsonb)','private.workspace_repair_needs_management(bigint,jsonb)',
  'private.workspace_repair_needs_owner(uuid,bigint,jsonb)','private.workspace_repair_draft_expense(uuid,bigint,jsonb)','private.workspace_check_repair_photos(uuid,jsonb)','private.integration_commit_upload(uuid,jsonb)',
  'private.workspace_guest_name_visible(text)','private.workspace_journey_view(private.workspace_journeys)'];
 const definitions=async()=>{await db.exec('reset role');return (await db.query('select array_agg(pg_get_functiondef(n::regprocedure) order by n) d from unnest($1::text[]) n',[names])).rows[0].d;};
 const before=await definitions();
 const rows=async()=>(await db.query('select count(*)::int n from private.workspace_repair_limits')).rows[0].n;
 const kept=await rows();
 await db.exec(await fs.readFile(MIGRATION,'utf8'));
 assert.deepEqual(await definitions(),before);
 assert.equal(await rows(),kept);
 const ops=(await definitions())[names.slice().sort().indexOf('private.workspace_operations_action(jsonb)')];
 for(const marker of ["step='reassignReady'","step='reviewDone'","data:=private.workspace_repair_guest_thread(prop,data);","private.workspace_repair_visit(prop,d.data,data)","private.workspace_repair_after_step(step,d.data,data)"])
  assert.equal(ops.split(marker).length-1,1,marker);
});
