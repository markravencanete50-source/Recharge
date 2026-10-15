import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Repairs (20261021700000, Lee 15 October 2026): owners see the contractor's name on their repair (assignedReadyName),
// and nothing else about the contractor: not the id, not the contractor before, not why it moved, not the review note,
// not the guest conversation, never an email or phone. The visit clash warning uses each stay's own check-in and
// check-out times from Hostaway, and 14:00 / 10:00 when the stay has none. Safe to run twice.
const MIGRATION='supabase/migrations/20261021700000_repair_owner_contractor_times.sql';
const CONTRACTORS='supabase/migrations/20261021200000_repair_contractors.sql';
const db=new PGlite();
const roles=['super_admin','client','stays','ready','ready'];
const [SUPER,OWNER,STAYS,READY_A,READY_B]=roles.map((_,i)=>i);
const names=['Alex Super','Olivia Owner','Sam Stays','Andy Plumber','Bea Electrician'];
const users=roles.map((_,i)=>`87100000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const session=i=>users[i].replace('8710','8720');
const email=i=>`owner-contractor-times${i}@example.com`;
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],email(i)]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1",[users[i],roles[i],names[i]]);
 await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features',[users[i]]);
}
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[i],session_id:session(i)})]);await db.exec('set role authenticated');}
beforeEach(async()=>{await db.exec('reset role');await db.exec('delete from private.workspace_write_limits');});
after(async()=>{await db.close();});
const call=async(fn,input)=>(await db.query(`select public.${fn}($1::jsonb) result`,[JSON.stringify({requestId:crypto.randomUUID(),...input})])).rows[0].result;
const action=input=>call('workspace_operations_action',input);
const update=(w,step,data)=>action({action:'updateOperation',workId:w.workId,version:w.version,step,data});
const report=(propertyId,data)=>action({action:'createOperation',propertyId,kind:'maintenance',data:{hazard:false,repairType:'leak',issue:'Kitchen tap dripping all day',estimatedCostMinor:0,...data}});
const seen=async(i,w)=>{await as(i);return (await db.query('select public.workspace_operations_read($1) data',[w.propertyId])).rows[0].data.find(x=>x.workId===w.workId);};
const today=(await db.query("select (now() at time zone 'Europe/London')::date::text d")).rows[0].d;
const plus=n=>new Date(Date.parse(today+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);

await as(SUPER);
const home=(await db.query('select public.workspace_save_property($1::jsonb) id',[JSON.stringify({requestId:crypto.randomUUID(),name:'Owner contractor home',address:'Test address',region:'Edinburgh',bedrooms:2})])).rows[0].id;
for(const [i,assignment] of [[OWNER,'client'],[STAYS,'staff'],[READY_A,'staff'],[READY_B,'staff']])await db.query('select public.workspace_assign_property($1,$2,$3)',[home,users[i],assignment]);
await db.exec('reset role');
// Stays from Hostaway with their own times (15:00 in, 11:00 out), and a manual stay with none.
const stayAt=async(ref,from,to,inTime,outTime)=>(await db.query("insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,created_by,check_in_time,check_out_time) values($1,$2,$3,$4,'confirmed','manual',$5,$6::time,$7::time) returning id",[home,ref,from,to,users[SUPER],inTime,outTime])).rows[0].id;
await stayAt('HMTIMED',plus(10),plus(13),'15:00','11:00');
await stayAt('HMUNTIMED',plus(20),plus(23),null,null);
const thread=(await db.query("insert into private.workspace_guest_threads(source,thread_ref,property_id,channel,guest_name,reservation_ref,guest_email,last_message_at) values('manual','owner-contractor-t1',null,'email','Gina Guest','HMTIMED','gina@example.com',now()) returning id")).rows[0].id;

test('the owner sees the contractor’s name on the repair, and nothing else about the contractor',async()=>{
 await as(STAYS);let w=await report(home,{issue:'Shower not draining at all',guestConversationId:thread});
 w=await update(w,'referReady',{troubleshooting:'Plunged the drain, still blocked',guestUpdate:'A plumber is being arranged',readyUserId:users[READY_A]});
 let mine=await seen(OWNER,w);
 assert.equal(mine.kind,'maintenance');
 assert.equal(mine.data.assignedReadyName,'Andy Plumber','the owner sees who is doing the repair');
 for(const key of ['assignedReadyId','guestConversationId','troubleshooting','reportedBy','referredBy'])assert.ok(!(key in mine.data),'not '+key);
 assert.ok(!JSON.stringify(mine).includes(users[READY_A]),'not the contractor’s id');
 assert.ok(!JSON.stringify(mine).includes(email(READY_A)),'not the contractor’s email');
 // Stays still see everything.
 const staff=await seen(STAYS,w);
 assert.equal(staff.data.assignedReadyId,users[READY_A]);assert.equal(staff.data.guestConversationId,thread);
 // Moved to another contractor: the owner sees the new name only, not the one before or why.
 await as(STAYS);w=await update(w,'reassignReady',{readyUserId:users[READY_B],reason:'SECRET Andy is away this week'});
 mine=await seen(OWNER,w);
 assert.equal(mine.data.assignedReadyName,'Bea Electrician');
 for(const key of ['assignedReadyId','previousReadyId','previousReadyName','reassignReason','reviewNote','guestConversationId'])assert.ok(!(key in mine.data),'not '+key);
 const text=JSON.stringify(mine);
 for(const secret of ['Andy Plumber','SECRET',users[READY_A],users[READY_B],email(READY_A),email(READY_B),'Sam Stays',users[STAYS]])assert.ok(!text.includes(secret),'not '+secret);
 assert.equal((await seen(STAYS,w)).data.previousReadyName,'Andy Plumber','Stays still see who had it');
});

test('the owner filter keeps only a plain-text name and strips the rest',async()=>{
 const filter=async data=>(await db.query('select private.workspace_owner_work_data($1::jsonb) v',[JSON.stringify(data)])).rows[0].v;
 assert.deepEqual(await filter({issue:'x',assignedReadyId:'i',assignedReadyName:'Bea Electrician',previousReadyId:'p',previousReadyName:'Andy Plumber',reassignReason:'r',reviewNote:'n',guestConversationId:'g',assignedBy:'b',managementNote:'m'}),
  {issue:'x',assignedReadyName:'Bea Electrician'});
 assert.deepEqual(await filter({issue:'x',assignedReadyName:{email:'a@example.com',phone:'07700 900000'}}),{issue:'x'},'never an object under the name');
 assert.deepEqual(await filter({issue:'x',assignedReadyName:null}),{issue:'x'});
 assert.deepEqual(await filter({issue:'x'}),{issue:'x'});
 assert.equal((await db.query("select private.workspace_owner_work_data('null'::jsonb) v")).rows[0].v,null);
 for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'private.workspace_owner_work_data(jsonb)','execute') a",[role])).rows[0].a,false,role);
});

test('clashes use the stay’s own check-in and check-out times',async()=>{
 const clashes=async(day,from,to)=>(await db.query('select private.workspace_repair_clashes($1,$2::date,$3::time,$4::time) c',[home,day,from,to])).rows[0].c.map(c=>c.label);
 // Check-in at 15:00: a visit to 14:30 is clear (it would have clashed at 14:00); to 15:30 is not.
 assert.deepEqual(await clashes(plus(10),'13:00','14:30'),[],'done before the 15:00 check-in');
 assert.deepEqual(await clashes(plus(10),'13:00','15:30'),['Guest stay, check-in 15:00']);
 assert.deepEqual(await clashes(plus(11),'09:00','10:00'),['Guest stay, guests in all day']);
 // Check-out at 11:00: a visit from 10:30 clashes (it would have been clear at 10:00); from 11:00 is clear.
 assert.deepEqual(await clashes(plus(13),'10:30','12:00'),['Guest stay, check-out 11:00']);
 assert.deepEqual(await clashes(plus(13),'11:00','12:00'),[],'after the 11:00 check-out');
 // The booked repair carries the label, without the guest's name.
 await as(STAYS);let w=await report(home,{issue:'Front door lock sticking'});
 w=await update(w,'referReady',{troubleshooting:'Lubricated the lock',guestUpdate:'A locksmith is coming',readyUserId:users[READY_A]});
 await as(READY_A);w=await update(w,'bookRepair',{repairOn:plus(10),visitFrom:'14:30',visitTo:'16:00',guestUpdate:'Locksmith booked in'});
 assert.deepEqual(w.clashes,[{checkIn:plus(10),checkOut:plus(13),label:'Guest stay, check-in 15:00'}]);
 assert.equal(JSON.stringify(w).includes('Gina'),false,'no guest name');
});

test('clashes fall back to 14:00 in and 10:00 out when the stay has no times',async()=>{
 await db.exec('reset role');
 const clashes=async(day,from,to)=>(await db.query('select private.workspace_repair_clashes($1,$2::date,$3::time,$4::time) c',[home,day,from,to])).rows[0].c.map(c=>c.label);
 assert.deepEqual(await clashes(plus(20),'13:00','14:00'),[],'done by 14:00');
 assert.deepEqual(await clashes(plus(20),'13:00','14:30'),['Guest stay, check-in 14:00']);
 assert.deepEqual(await clashes(plus(23),'09:00','11:00'),['Guest stay, check-out 10:00']);
 assert.deepEqual(await clashes(plus(23),'10:00','12:00'),[],'after the 10:00 check-out');
 // One stay with only a check-out time: check-in falls back, check-out does not.
 await db.query("update private.workspace_reservations set check_out_time='09:30' where reference='HMUNTIMED'");
 assert.deepEqual(await clashes(plus(23),'09:30','11:00'),[],'after the 09:30 check-out');
 assert.deepEqual(await clashes(plus(23),'09:00','11:00'),['Guest stay, check-out 09:30']);
 assert.deepEqual(await clashes(plus(20),'13:00','14:30'),['Guest stay, check-in 14:00']);
 await db.query("update private.workspace_reservations set check_out_time=null where reference='HMUNTIMED'");
});

test('safe to run twice, and after 20261021200000 runs again',async()=>{
 const names=['private.workspace_owner_work_data(jsonb)','private.workspace_repair_clashes(uuid,date,time,time)'];
 const definitions=async()=>{await db.exec('reset role');return (await db.query('select array_agg(pg_get_functiondef(n::regprocedure) order by n) d from unnest($1::text[]) n',[names])).rows[0].d;};
 const before=await definitions();
 assert.equal(before[0].split("jsonb_build_object('assignedReadyName',item->'assignedReadyName')").length-1,1,'patched once');
 await db.exec(await fs.readFile(MIGRATION,'utf8'));
 assert.deepEqual(await definitions(),before);
 // The earlier migration still runs (its own patch is skipped), and this one puts the real times back after it.
 await db.exec(await fs.readFile(CONTRACTORS,'utf8'));
 await db.exec(await fs.readFile(MIGRATION,'utf8'));
 assert.deepEqual(await definitions(),before);
 for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'private.workspace_repair_clashes(uuid,date,time,time)','execute') a",[role])).rows[0].a,false,role);
});
