import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Access control for admins (20261022700000), run against the real database functions. An admin opens Access
// control and acts on accounts below admin; every admin and super admin account, promotions to admin and deleting
// stay with super admins. Super admins are unchanged, and every other role is still refused.
const db=new PGlite();
const roles=['super_admin','admin','admin','super_admin','stays','client','cleans','ready','stays','cleaning_manager','accounts','stays','client'];
const [SUPER,ADMIN,OTHER_ADMIN,OTHER_SUPER,STAYS,OWNER,CLEANER,READY,SPARE,MANAGER,ACCOUNTS,SECOND,THIRD]=roles.map((_,i)=>i);
const users=roles.map((_,i)=>`7a000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const session=i=>users[i].replace('7a00','7b00');
const MIGRATION='supabase/migrations/20261022700000_admin_access_control.sql';
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users on delete cascade,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`admin-access${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1",[users[i],roles[i],'Person '+i]);
 if(!['admin','super_admin'].includes(roles[i]))await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'cleaning-schedule')",[users[i]]);
}
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[i],session_id:session(i)})]);await db.exec('set role authenticated');}
beforeEach(async()=>{await db.exec('reset role');await db.exec('delete from private.workspace_write_limits');});
const read=async section=>(await db.query('select public.workspace_admin_read($1) r',[section])).rows[0].r;
const act=async input=>(await db.query('select public.workspace_admin_action($1::jsonb) r',[JSON.stringify(input)])).rows[0].r;
const owner=async(sql,args=[])=>(await db.exec('reset role'),(await db.query(sql,args)).rows);
const profile=async i=>(await owner('select role,status,full_name from public.workspace_profiles where user_id=$1',[users[i]]))[0];
const sessions=async i=>(await owner('select count(*)::int n from private.workspace_approved_sessions where user_id=$1',[users[i]]))[0].n;
const save=(i,role,status='active',modules=['cleaning-schedule'],name='Person '+i)=>act({action:'saveAccess',userId:users[i],fullName:name,role,status,modules,responsibilities:''});
// Every action Access control can send about one account.
const everyAction=i=>[
 {action:'setAccess',userId:users[i],role:'stays',modules:['cleaning-schedule']},
 {action:'block',userId:users[i]},{action:'unblock',userId:users[i]},{action:'signOut',userId:users[i]},
 {action:'revokePassword',userId:users[i]},{action:'passwordLinkCheck',userId:users[i]},{action:'deleteAccount',userId:users[i],confirm:true},
];

test('the migration is safe to run twice and leaves each patch in once',async()=>{
 const defs=async()=>(await owner(`select string_agg(pg_get_functiondef(f::regprocedure),'\n' order by f) d from unnest(array['private.workspace_access_control_read(text)','private.workspace_access_control_action(jsonb)','private.workspace_admin_action(jsonb)','private.workspace_access_check(uuid,text,text)']) f`))[0].d;
 const before=await defs();
 await db.exec(await fs.readFile(MIGRATION,'utf8'));
 assert.equal(await defs(),before);
 const action=(await owner("select pg_get_functiondef('private.workspace_access_control_action(jsonb)'::regprocedure) d"))[0].d;
 assert.equal(action.split('perform private.workspace_access_check(').length-1,1);
 assert.equal(action.split("elsif a='passwordLinkCheck'").length-1,1);
 const migration=(await fs.readFile(MIGRATION,'utf8')).split('\n').filter(l=>!l.trim().startsWith('--')).join('\n');
 assert.doesNotMatch(migration,/\bdrop\b|\bdelete\s+from\b/i,'no DROP, no DELETE');
 assert.match(migration,/revoke all on function private\.workspace_access_check\(uuid,text,text\) from public,anon,authenticated;/);
 assert.doesNotMatch(migration,/grant execute/i,'nothing new is granted');
});

test('an admin opens Access control: every account, super admins included, and the history',async()=>{
 await as(ADMIN);
 const people=await read('accessControl');
 assert.equal(people.length,users.length);
 for(const i of [SUPER,OTHER_SUPER,OTHER_ADMIN,ADMIN,STAYS,OWNER])assert.equal(people.find(p=>p.userId===users[i]).role,roles[i]);
 assert.ok(Array.isArray(await read('accessHistory')));
});

test('an admin does the everyday actions on an account below admin',async()=>{
 await as(ADMIN);
 // Role among the roles below admin: a new role brings its usual tools; then tools one by one.
 let p=await act({action:'setAccess',userId:users[STAYS],role:'ready',modules:[]});
 assert.equal(p.role,'ready');assert.ok(p.modules.length>0);
 p=await act({action:'setAccess',userId:users[STAYS],role:'ready',modules:['maintenance-reporting','ready-schedule']});
 assert.deepEqual([...p.modules].sort(),['maintenance-reporting','ready-schedule'],'tools are granted and removed');
 p=await act({action:'setAccess',userId:users[STAYS],role:'client',modules:[]});
 assert.equal(p.role,'client');
 p=await act({action:'setAccess',userId:users[STAYS],role:'stays',modules:[]});
 assert.equal(p.role,'stays');
 p=await act({action:'signOut',userId:users[CLEANER]});assert.equal(p.activeSessions,0);assert.equal(await sessions(CLEANER),0);
 await as(ADMIN);p=await act({action:'revokePassword',userId:users[READY]});assert.equal(p.passwordRevoked,true);
 await as(ADMIN);p=await act({action:'block',userId:users[OWNER]});assert.equal(p.status,'revoked');
 p=await act({action:'unblock',userId:users[OWNER]});assert.equal(p.status,'active');
 p=await act({action:'passwordLinkCheck',userId:users[MANAGER]});assert.equal(p.userId,users[MANAGER]);
 await assert.rejects(act({action:'passwordLinkCheck',userId:users[MANAGER],extra:true}),/./,'the check takes only the account');
 // People (approve, edit the name, revoke) keeps working for accounts below admin.
 await owner("update public.workspace_profiles set status='pending' where user_id=$1",[users[ACCOUNTS]]);
 await as(ADMIN);await save(ACCOUNTS,'accounts','active',['owner-statements'],'Renamed Person');
 assert.deepEqual(await profile(ACCOUNTS),{role:'accounts',status:'active',full_name:'Renamed Person'},'a sign-up is approved and renamed');
 await as(ADMIN);
 const history=await read('accessHistory');
 for(const e of ['role_changed','tool_access_changed','signed_out_everywhere','password_revoked','account_blocked','account_unblocked'])
  assert.ok(history.some(h=>h.event===e&&h.actor==='Person 1'),e+' is recorded as the admin');
});

test('an admin never changes, blocks, signs out or links an admin or super admin, nor themselves',async()=>{
 for(const target of [SUPER,OTHER_SUPER,OTHER_ADMIN,ADMIN]){
  const before=await profile(target),live=await sessions(target);
  for(const input of everyAction(target)){
   await as(ADMIN);
   await assert.rejects(act(input),/Only a super admin|own access/,`${input.action} on ${roles[target]} ${target}`);
  }
  // People's save is refused for them too.
  await as(ADMIN);await assert.rejects(save(target,'stays'),/Only a super admin|own access/);
  assert.deepEqual(await profile(target),before,'nothing changed');
  assert.equal(await sessions(target),live,'still signed in');
 }
 assert.equal((await owner('select count(*)::int n from private.workspace_password_revocations where user_id = any($1::uuid[])',[[SUPER,OTHER_SUPER,OTHER_ADMIN,ADMIN].map(i=>users[i])]))[0].n,0);
});

test('an admin never makes anyone an admin or super admin, nor deletes an account',async()=>{
 for(const role of ['admin','super_admin']){
  await as(ADMIN);await assert.rejects(act({action:'setAccess',userId:users[SPARE],role,modules:[]}),/Only a super admin/,role);
  await as(ADMIN);await assert.rejects(save(SPARE,role,'active',[]),/Only a super admin/,role);
 }
 assert.equal((await profile(SPARE)).role,'stays');
 await as(ADMIN);await assert.rejects(act({action:'deleteAccount',userId:users[SPARE],confirm:true}),/Only a super admin can delete/);
 assert.equal((await owner('select count(*)::int n from auth.users where id=$1',[users[SPARE]]))[0].n,1,'the account is still there');
 assert.equal((await profile(SPARE)).status,'active');
});

test('adding a person: an admin adds team members and owners, never admins',async()=>{
 // The server creates the sign-in, then saves access through the database as the admin who asked.
 const fresh=['7a000000-0000-4000-8000-0000000000a1','7a000000-0000-4000-8000-0000000000a2','7a000000-0000-4000-8000-0000000000a3'];
 for(const [n,id] of fresh.entries())await owner('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,`new${n}@example.com`]);
 await as(ADMIN);
 await act({action:'saveAccess',userId:fresh[0],fullName:'New Stays',role:'stays',status:'active',modules:['listing-health'],responsibilities:''});
 for(const [n,role] of ['admin','super_admin'].entries()){
  await as(ADMIN);
  await assert.rejects(act({action:'saveAccess',userId:fresh[n+1],fullName:'New Admin',role,status:'active',modules:[],responsibilities:''}),/Only a super admin/,role);
 }
 const made=await owner('select user_id,role,status from public.workspace_profiles where user_id = any($1::uuid[]) order by user_id',[fresh]);
 assert.deepEqual(made.map(r=>[r.role,r.status]),[['stays','active'],['client','pending'],['client','pending']]);
});

test('the menu order stays with super admins',async()=>{
 await as(ADMIN);
 await assert.rejects(db.query("select public.workspace_teams_read('menuLayouts',null,null,null,null)"),/Only super admins/);
 await assert.rejects(db.query(`select public.workspace_teams_action($1::jsonb)`,[JSON.stringify({requestId:crypto.randomUUID(),action:'resetMenuLayout',role:'stays',version:0})]),/Only super admins/);
});

test('super admins keep everything: admin accounts, promotions and deleting',async()=>{
 await as(SUPER);
 let p=await act({action:'setAccess',userId:users[SECOND],role:'admin',modules:[]});assert.equal(p.role,'admin');
 await as(SUPER);p=await act({action:'setAccess',userId:users[SECOND],role:'stays',modules:[]});assert.equal(p.role,'stays');
 await as(SUPER);p=await act({action:'signOut',userId:users[OTHER_ADMIN]});assert.equal(p.activeSessions,0);
 await as(SUPER);p=await act({action:'block',userId:users[OTHER_ADMIN]});assert.equal(p.status,'revoked');
 await as(SUPER);p=await act({action:'unblock',userId:users[OTHER_ADMIN]});assert.equal(p.status,'active');
 await as(SUPER);p=await act({action:'passwordLinkCheck',userId:users[OTHER_ADMIN]});assert.equal(p.role,'admin');
 await as(SUPER);p=await act({action:'revokePassword',userId:users[OTHER_SUPER]});assert.equal(p.passwordRevoked,true);
 await as(SUPER);assert.equal((await act({action:'deleteAccount',userId:users[THIRD],confirm:true})).outcome,'deleted');
 await as(SUPER);await assert.rejects(act({action:'block',userId:users[SUPER]}),/own access/,'still never their own account');
});

test('every other role is still refused Access control entirely',async()=>{
 for(const i of [STAYS,OWNER,CLEANER,READY,MANAGER,ACCOUNTS]){
  await as(i);
  await assert.rejects(read('accessControl'),/Admin access required/,roles[i]);
  await as(i);await assert.rejects(read('accessHistory'),/Admin access required/,roles[i]);
  for(const input of everyAction(SPARE)){await as(i);await assert.rejects(act(input),/Admin access required/,`${roles[i]} ${input.action}`);}
 }
 assert.equal((await profile(SPARE)).status,'active');
 // A blocked admin loses it at once.
 await as(SUPER);await act({action:'block',userId:users[OTHER_ADMIN]});
 await as(OTHER_ADMIN);await assert.rejects(read('accessControl'),/Admin access required/);
});
