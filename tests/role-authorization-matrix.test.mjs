import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Who may read what, for every role, run against the real database functions. A read is "allowed"
// when it answers; it is "blocked" when the access check refuses it. Any other error fails the test,
// so a misspelt section can never pass as allowed for everyone.
const db=new PGlite();
const roles=['super_admin','admin','stays','cleaning_manager','cleans','ready','accounts','client'];
const users=roles.map((_,i)=>`7d000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const session=i=>users[i].replace('7d00','7e00');
const {DEFAULT_ROLE_MODULES}=await (async()=>{const {createServer}=await import('vite');const v=await createServer({configFile:false,server:{middlewareMode:true,hmr:false}});const m=await v.ssrLoadModule('/lib/modules.ts');await v.close();return m;})();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users on delete cascade,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),auth.jwt()->>'sub')::uuid$$;`);
for(const f of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+f,'utf8'));
for(let i=0;i<roles.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`matrix${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1",[users[i],roles[i],'Person '+roles[i]]);
 for(const id of (roles[i]==='admin'||roles[i]==='super_admin')?[]:DEFAULT_ROLE_MODULES[roles[i]])await db.query('insert into public.workspace_module_grants(user_id,module_id) values($1,$2) on conflict do nothing',[users[i],id]);
}
await db.exec("insert into private.workspace_onboarding_done(user_id) select user_id from public.workspace_profiles on conflict do nothing");
const BLOCKED=/access required|Active access|permission denied|not allowed|^Only /i;
async function allowed(role,sql){
 await db.exec('reset role');
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[roles.indexOf(role)],session_id:session(roles.indexOf(role)),role:'authenticated'})]);
 await db.exec('set role authenticated');
 try{await db.query(sql);return true;}
 catch(e){if(e.code==='42501'||BLOCKED.test(e.message))return false;throw new Error(`${role}: ${sql}: ${e.message}`);}
 finally{await db.exec('reset role');}
}
const who=async sql=>{const out=[];for(const r of roles)if(await allowed(r,sql))out.push(r);return out;};
const teams=s=>`select public.workspace_teams_read('${s}',null,null,null,null)`;
const ADMINS=['super_admin','admin'], TEAM=roles.filter(r=>r!=='client');

test('administration and Access control are for admins (super admins keep the menu order and View as)',async()=>{
 assert.deepEqual(await who("select public.workspace_admin_read('people')"),ADMINS);
 assert.deepEqual(await who("select public.workspace_admin_read('properties')"),ADMINS);
 assert.deepEqual(await who("select public.workspace_admin_read('accessControl')"),ADMINS);
 assert.deepEqual(await who("select public.workspace_admin_read('accessHistory')"),ADMINS);
 assert.deepEqual(await who(teams('menuLayouts')),['super_admin']);
 assert.deepEqual(await who('select public.workspace_view_as_people()'),['super_admin']);
 assert.deepEqual(await who(teams('management')),ADMINS);
 assert.deepEqual(await who(teams('contracts')),ADMINS);
});

test('money screens are for admins and Accounts; owners see only their own statements',async()=>{
 assert.deepEqual(await who("select public.workspace_finance_read('expenses',null,null,null,null)"),['super_admin','admin','accounts']);
 assert.deepEqual(await who("select public.workspace_finance_read('policy',null,null,null,null)"),['super_admin','admin','accounts']);
 assert.deepEqual(await who("select public.workspace_finance_read('reconciliation',null,'2026-10',null,null)"),['super_admin','admin','accounts']);
 assert.deepEqual(await who("select public.workspace_finance_read('statements',null,'2026-10',null,null)"),['super_admin','admin','accounts','client']);
 assert.deepEqual(await who(teams('cleanerRates')),['super_admin','admin','cleaning_manager','accounts']);
});

test('each team role reads only the team screens for its work',async()=>{
 assert.deepEqual(await who(teams('hub')),TEAM,'every team role has the Hub, owners do not');
 assert.deepEqual(await who(teams('rota')),TEAM);
 assert.deepEqual(await who(teams('responsibilities')),TEAM);
 assert.deepEqual(await who(teams('signoff')),['super_admin','admin','stays']);
 assert.deepEqual(await who(teams('routines')),['super_admin','admin','stays','ready']);
 assert.deepEqual(await who('select public.workspace_ready_home()'),['super_admin','admin','stays','ready']);
 assert.deepEqual(await who(teams('defaultCleaners')),['super_admin','admin','stays','cleaning_manager']);
 assert.deepEqual(await who(teams('performance')),['super_admin','admin','stays','cleaning_manager','cleans']);
 assert.deepEqual(await who(teams('mailbox')),['super_admin','admin','stays','client']);
});

test('only a super admin sees other people, their tools and the access log',async()=>{
 for(const role of roles){
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[roles.indexOf(role)],session_id:session(roles.indexOf(role)),role:'authenticated'})]);
  await db.exec('set role authenticated');
  const profiles=Number((await db.query('select count(*) n from public.workspace_profiles')).rows[0].n);
  const grants=(await db.query('select distinct user_id from public.workspace_module_grants')).rows.map(r=>r.user_id);
  const events=Number((await db.query('select count(*) n from public.workspace_access_events')).rows[0].n);
  await db.exec('reset role');
  if(role==='super_admin'){assert.equal(profiles,roles.length);assert.ok(grants.length>1);}
  else{
   assert.equal(profiles,1,role+' sees only themselves');
   assert.ok(grants.every(g=>g===users[roles.indexOf(role)]),role+' sees only their own tools');
   assert.equal(events,0,role+' cannot read the access log');
  }
 }
});

test('properties: admins and Accounts see every property, everyone else only the ones given to them',async()=>{
 const everyProperty=[...ADMINS,'accounts'];
 await db.exec('reset role');
 const made=(await db.query("insert into public.workspace_properties(name,created_by,request_id) values('Given flat',$1,gen_random_uuid()),('Other flat',$1,gen_random_uuid()) returning id",[users[0]])).rows.map(r=>r.id);
 const kind={client:'client',cleans:'cleaner',cleaning_manager:'cleaning_manager'};
 for(const role of roles)if(!everyProperty.includes(role))await db.query('insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,$3,$4)',[made[0],users[roles.indexOf(role)],kind[role]??'staff',users[0]]);
 for(const role of roles){
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[roles.indexOf(role)],session_id:session(roles.indexOf(role)),role:'authenticated'})]);
  await db.exec('set role authenticated');
  const seen=(await db.query('select id from public.workspace_properties where id = any($1::uuid[])',[made])).rows.map(r=>r.id);
  await db.exec('reset role');
  assert.deepEqual(seen.sort(),everyProperty.includes(role)?[...made].sort():[made[0]],role);
 }
});
