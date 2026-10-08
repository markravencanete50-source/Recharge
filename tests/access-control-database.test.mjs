import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Super admin access control: see everyone, change role and tools, sign out, revoke a password,
// block and unblock, and delete (fully, or closed when the account has history).
const db=new PGlite();
const roles=['super_admin','admin','stays','client','cleans','stays'];
const users=roles.map((_,i)=>`75000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const session=i=>users[i].replace('7500','7600');
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users on delete cascade,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`access${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1",[users[i],roles[i],'Person '+i]);
 await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'cleaning-schedule')",[users[i]]);
}
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[i],session_id:session(i)})]);await db.exec('set role authenticated');}
beforeEach(async()=>{await db.exec('reset role');await db.exec('delete from private.workspace_write_limits');});
const read=async section=>(await db.query('select public.workspace_admin_read($1) r',[section])).rows[0].r;
const act=async input=>(await db.query('select public.workspace_admin_action($1::jsonb) r',[JSON.stringify(input)])).rows[0].r;
const sessions=async user=>(await db.exec('reset role'),(await db.query('select count(*)::int n from private.workspace_approved_sessions where user_id=$1',[user])).rows[0].n);

test('only a super admin sees access control, with every account',async()=>{
 await as(1);await assert.rejects(read('accessControl'),/Super admin/);await assert.rejects(act({action:'block',userId:users[2]}),/Super admin/);
 await as(0);const people=await read('accessControl');
 assert.equal(people.length,users.length);
 const stays=people.find(p=>p.userId===users[2]);
 assert.equal(stays.role,'stays');assert.equal(stays.activeSessions,1);assert.deepEqual(stays.modules,['cleaning-schedule']);assert.equal(stays.passwordRevoked,false);
 await assert.rejects(act({action:'block',userId:users[0]}),/own access/);
});

test('a super admin changes role and tools',async()=>{
 await as(0);
 const after=await act({action:'setAccess',userId:users[2],role:'ready',modules:['maintenance-reporting','ready-schedule']});
 assert.equal(after.role,'ready');assert.deepEqual(after.modules,['maintenance-reporting','ready-schedule']);
 const removed=await act({action:'setAccess',userId:users[2],role:'ready',modules:['maintenance-reporting']});
 assert.deepEqual(removed.modules,['maintenance-reporting'],'a tool can be taken away');
 const history=await read('accessHistory');assert.ok(history.some(h=>h.event==='tool_access_changed'&&h.target==='Person 2'));
});

test('sign out everywhere and revoke a password',async()=>{
 await as(0);
 let p=await act({action:'signOut',userId:users[5]});assert.equal(p.activeSessions,0);
 assert.equal(await sessions(users[5]),0);
 await as(0);p=await act({action:'revokePassword',userId:users[5]});assert.equal(p.passwordRevoked,true);
 // The old password no longer signs in; a reset clears the block. (The sign-in server has no user.)
 await db.exec('reset role');await db.query("select set_config('request.jwt.claims','',false)");
 await db.query("insert into auth.sessions(id,user_id) values('76000000-0000-4000-8000-000000000099',$1)",[users[5]]);
 const subject='a'.repeat(64),attempt=crypto.randomUUID();
 await db.query('select private.auth_server_begin_password($1,$2)',[subject,attempt]);
 const decision=(await db.query("select private.auth_server_finish_password($1,$2,'success',$3,'76000000-0000-4000-8000-000000000099') r",[subject,attempt,users[5]])).rows[0].r;
 assert.equal(decision.allowed,false);assert.equal(decision.passwordReset,true);
 assert.equal(await sessions(users[5]),0,'no session is approved');
 const proof='b'.repeat(64),lease=crypto.randomUUID();
 await db.query("select private.auth_server_recovery($1,$2,'76000000-0000-4000-8000-000000000099','create')",[proof,users[5]]);
 await db.query("select private.auth_server_recovery($1,$2,'76000000-0000-4000-8000-000000000099','begin',null,$3)",[proof,users[5],lease]);
 assert.equal((await db.query("select private.auth_server_recovery($1,$2,'76000000-0000-4000-8000-000000000099','complete',$3,$4) r",[proof,users[5],'c'.repeat(64),lease])).rows[0].r,true);
 assert.equal((await db.query('select count(*)::int n from private.workspace_password_revocations where user_id=$1',[users[5]])).rows[0].n,0,'a new password lifts the block');
});

test('block and unblock',async()=>{
 await as(0);
 let p=await act({action:'block',userId:users[4]});assert.equal(p.status,'revoked');assert.equal(p.activeSessions,0);
 await assert.rejects(act({action:'block',userId:users[4]}),/already blocked/);
 p=await act({action:'unblock',userId:users[4]});assert.equal(p.status,'active');
 const history=await read('accessHistory');assert.ok(['account_blocked','account_unblocked'].every(e=>history.some(h=>h.event===e)));
});

test('delete removes an account with no history, and closes one with history',async()=>{
 await as(0);
 await assert.rejects(act({action:'deleteAccount',userId:users[3]}),/confirm|Check|Confirm/i);
 const gone=await act({action:'deleteAccount',userId:users[3],confirm:true});
 assert.equal(gone.outcome,'deleted');
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from auth.users where id=$1',[users[3]])).rows[0].n,0);
 // An account that created work keeps its records, under "Deleted account".
 await as(0);const property=(await db.query('select public.workspace_save_property($1::jsonb) id',[JSON.stringify({requestId:crypto.randomUUID(),name:'History property',address:'Test address',region:'Edinburgh',bedrooms:1})])).rows[0].id;
 await db.exec('reset role');await db.query("insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by) values($1,$2,'cleaning-schedule','Made by Person 1',$3)",[crypto.randomUUID(),property,users[1]]);
 await as(0);const closed=await act({action:'deleteAccount',userId:users[1],confirm:true});
 assert.equal(closed.outcome,'closed');
 const people=await read('accessControl');const p=people.find(x=>x.userId===users[1]);
 assert.equal(p.fullName,'Deleted account');assert.equal(p.status,'revoked');assert.equal(p.closed,true);assert.deepEqual(p.modules,[]);assert.equal(p.passwordRevoked,true);
 await assert.rejects(act({action:'unblock',userId:users[1]}),/deleted/);
 assert.ok((await read('accessHistory')).some(h=>h.event==='account_deleted'));
});

test('one super admin can block another, but never themselves',async()=>{
 await db.exec('reset role');await db.query("update public.workspace_profiles set role='super_admin' where user_id=$1",[users[2]]);
 await as(2);
 await assert.rejects(act({action:'deleteAccount',userId:users[2],confirm:true}),/own access/);
 const blocked=await act({action:'block',userId:users[0]});assert.equal(blocked.status,'revoked');
 await as(0);await assert.rejects(read('accessControl'),/access required/,'a blocked super admin loses access at once');
});
