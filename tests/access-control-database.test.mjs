import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false}});
const {DEFAULT_ROLE_MODULES}=await vite.ssrLoadModule('/lib/modules.ts');
await vite.close();

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

test('admins and super admins see access control, with every account; other roles do not',async()=>{
 // Admins open it too (20261022700000), but never act on a super admin; the rest is in admin-access-control-database.
 await as(1);assert.equal((await read('accessControl')).length,users.length);await assert.rejects(act({action:'block',userId:users[0]}),/Only a super admin/);
 await as(2);await assert.rejects(read('accessControl'),/Admin access required/);await assert.rejects(act({action:'block',userId:users[3]}),/Admin access required/);
 await as(0);const people=await read('accessControl');
 assert.equal(people.length,users.length);
 const stays=people.find(p=>p.userId===users[2]);
 assert.equal(stays.role,'stays');assert.equal(stays.activeSessions,1);assert.deepEqual(stays.modules,['cleaning-schedule']);assert.equal(stays.passwordRevoked,false);
 await assert.rejects(act({action:'block',userId:users[0]}),/own access/);
});

test('a super admin changes role and tools',async()=>{
 await as(0);
 // A new role brings exactly that role's usual tools, whatever the app sent.
 const after=await act({action:'setAccess',userId:users[2],role:'ready',modules:['maintenance-reporting']});
 assert.equal(after.role,'ready');assert.deepEqual([...after.modules].sort(),[...DEFAULT_ROLE_MODULES.ready].sort());
 // With the role unchanged, tools are fine-tuned one by one.
 const removed=await act({action:'setAccess',userId:users[2],role:'ready',modules:['maintenance-reporting','ready-schedule']});
 assert.deepEqual([...removed.modules].sort(),['maintenance-reporting','ready-schedule'],'a tool can be taken away');
 const history=await read('accessHistory');assert.ok(history.some(h=>h.event==='tool_access_changed'&&h.target==='Person 2'));
 // Promoted to admin: every tool by role, no grants kept. Moved back: the usual tools again.
 const promoted=await act({action:'setAccess',userId:users[2],role:'admin',modules:[]});
 assert.equal(promoted.role,'admin');
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from public.workspace_module_grants where user_id=$1',[users[2]])).rows[0].n,0);
 await as(0);
 const back=await act({action:'setAccess',userId:users[2],role:'stays',modules:['cleaning-schedule']});
 assert.deepEqual([...back.modules].sort(),[...DEFAULT_ROLE_MODULES.stays].sort());
});

test('the database gives each role the same usual tools as the app',async()=>{
 await db.exec('reset role');
 for(const role of Object.keys(DEFAULT_ROLE_MODULES)){
  const tools=(await db.query('select private.workspace_role_tools($1) t',[role])).rows[0].t;
  assert.deepEqual([...tools].sort(),['admin','super_admin'].includes(role)?[]:[...DEFAULT_ROLE_MODULES[role]].sort(),role);
 }
});

test('a new role brings its properties along, and is recorded',async()=>{
 // Person 4 is a cleaner on two properties; Person 3 owns one.
 await db.exec('reset role');
 const props=[];
 for(const name of ['Harbour View','Castle Wynd','Mill Lade'])props.push((await db.query("insert into public.workspace_properties(name,created_by,request_id) values($1,$2,gen_random_uuid()) returning id",[name,users[0]])).rows[0].id);
 await db.query("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$3,'cleaner',$4),($2,$3,'cleaner',$4)",[props[0],props[1],users[4],users[0]]);
 await db.query("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,'client',$3)",[props[2],users[3],users[0]]);
 const kinds=async user=>(await db.exec('reset role'),(await db.query('select assignment from public.workspace_property_assignments where user_id=$1 order by assignment',[user])).rows.map(r=>r.assignment));
 await as(0);
 await act({action:'setAccess',userId:users[4],role:'stays',modules:['listing-health']});
 assert.deepEqual(await kinds(users[4]),['staff','staff'],'a cleaner moved to Stays keeps both properties, as a team member');
 await as(0);
 const promoted=await act({action:'setAccess',userId:users[4],role:'admin',modules:[]});
 assert.equal(promoted.role,'admin');assert.equal(promoted.properties,2);
 await as(0);
 await act({action:'setAccess',userId:users[3],role:'stays',modules:['listing-health']});
 assert.deepEqual(await kinds(users[3]),[],'an owner made a team member is unassigned from the property they own');
 await as(0);
 const history=await read('accessHistory');
const moves=history.filter(h=>h.event==='role_changed'&&['Person 3','Person 4'].includes(h.target)).map(h=>[h.target,h.detail.from,h.detail.role]);
 assert.deepEqual(moves,[['Person 3','client','stays'],['Person 4','stays','admin'],['Person 4','cleans','stays']]);
 assert.deepEqual(history.find(h=>h.event==='role_changed'&&h.detail.from==='client').detail.properties,{unassigned:1});
 // Tools alone don't count as a role change.
 await as(0);await act({action:'setAccess',userId:users[3],role:'stays',modules:['listing-health','daily-pricing']});
 await as(0);assert.equal((await read('accessHistory')).filter(h=>h.event==='role_changed'&&h.target==='Person 3').length,1);
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
