import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('verified phone-only users share session approval, five failures and one-time recovery',async()=> {
 const db=new PGlite(),user=crypto.randomUUID(),session=crypto.randomUUID(),subject='d'.repeat(64);
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
   create table auth.users(id uuid primary key,email text,phone text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,phone_confirmed_at timestamptz);
   create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
   create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
   create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
  for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
  await db.query("insert into auth.users(id,phone) values($1,'+447123456789')",[user]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,user]);
  await db.query("update public.workspace_profiles set status='active',role='client' where user_id=$1",[user]);
  const service=async()=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims','{}',false)");await db.exec('set role service_role');};
  const caller=async()=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,session_id:session})]);await db.exec('set role authenticated');};
  const begin=async()=>{const id=crypto.randomUUID();const result=(await db.query('select public.auth_server_begin_password($1,$2) result',[subject,id])).rows[0].result;return {id,result};};
  const finish=async(id,outcome)=> (await db.query('select public.auth_server_finish_password($1,$2,$3,$4,$5) result',[subject,id,outcome,user,session])).rows[0].result;
  await service();let attempt=await begin();await assert.rejects(finish(attempt.id,'success'),/Verified session required/);
  await finish(attempt.id,'unavailable');
  await caller();assert.equal((await db.query('select public.workspace_session_allowed() allowed')).rows[0].allowed,false);
  await db.exec('reset role');await db.query('update auth.users set phone_confirmed_at=now() where id=$1',[user]);
  await service();attempt=await begin();assert.equal((await finish(attempt.id,'success')).allowed,true);
  await caller();assert.equal((await db.query('select public.workspace_session_allowed() allowed')).rows[0].allowed,true);assert.equal((await db.query('select public.workspace_account() account')).rows[0].account.email,null);
  await db.exec('reset role');await db.query('update auth.users set phone_confirmed_at=null where id=$1',[user]);
  await caller();assert.equal((await db.query('select public.workspace_session_allowed() allowed')).rows[0].allowed,false);
  await db.exec('reset role');await db.query('update auth.users set phone_confirmed_at=now() where id=$1',[user]);
  await service();for(let n=0;n<5;n++){attempt=await begin();await finish(attempt.id,'failure');}assert.equal((await begin()).result.locked,true);
  const proof='e'.repeat(64),lease=crypto.randomUUID();
  for(const phase of ['create','begin','complete'])assert.equal((await db.query('select public.auth_server_recovery($1,$2,$3,$4,$5,$6) allowed',[proof,user,session,phase,subject,lease])).rows[0].allowed,true);
  assert.equal((await db.query('select public.auth_server_recovery($1,$2,$3,$4,$5,$6) allowed',[proof,user,session,'complete',subject,lease])).rows[0].allowed,false);
  assert.equal((await begin()).result.allowed,true);
  await caller();assert.equal((await db.query('select public.workspace_session_allowed() allowed')).rows[0].allowed,false);
 }finally{await db.close();}
});
