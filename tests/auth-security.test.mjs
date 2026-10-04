import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { boundedJson, isSameOrigin, emailSchema, newPasswordSchema } from '../lib/auth-security-policy.ts';

test('request validation blocks cross-origin, oversized and malformed authentication bodies', async () => {
  const make = (body, origin='https://recharge.example', type='application/json') => new Request('https://recharge.example/api/session',{method:'POST',headers:{origin,'content-type':type},body});
  assert.equal(isSameOrigin(make('{}')),true);
  assert.equal(isSameOrigin(make('{}','https://attacker.example')),false);
  assert.equal(isSameOrigin(make('{}'),'https://wrong.example'),false);
  assert.equal(await boundedJson(make('x'.repeat(20_000))),null);
  assert.equal(await boundedJson(make('{}',undefined,'text/plain')),null);
  assert.equal(await boundedJson(make('{broken')),null);
  assert.deepEqual(await boundedJson(make('{"email":"staff@example.com"}')),{email:'staff@example.com'});
  assert.equal(emailSchema.parse('  STAFF@EXAMPLE.COM  '),'staff@example.com');
  assert.equal(newPasswordSchema.safeParse({password:'short'}).success,false);
  assert.equal(newPasswordSchema.safeParse({password:'synthetic-long-test-password'}).success,true);
  assert.equal(newPasswordSchema.safeParse({password:'😀'.repeat(24)}).success,false);
  assert.equal(await boundedJson(make('{}',undefined,'application/json-invalid')),null);
});

test('persistent password guard, session approval and recovery execute in PostgreSQL', async t => {
  const db=new PGlite(); const user=randomUUID(); const session=randomUUID(); const subject='a'.repeat(64);
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; grant usage on schema auth to authenticated;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb); $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid; $$;`);
  for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()) await db.exec(await fs.readFile(`supabase/migrations/${file}`,'utf8'));
  await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,'staff@example.com',now());`,[user]);
  await db.query(`insert into auth.sessions(id,user_id) values($1,$2)`,[session,user]);
  await db.query(`update public.workspace_profiles set status='active',role='stays' where user_id=$1`,[user]);
  const service=()=>db.exec("reset role; select set_config('request.jwt.claims','{}',false); set role service_role");
  async function asUser(){await db.exec('reset role');await db.query(`select set_config('request.jwt.claims',$1,false)`,[JSON.stringify({sub:user,session_id:session})]);await db.exec('set role authenticated');}
  async function begin(key=subject){const id=randomUUID();const r=await db.query('select public.auth_server_begin_password($1,$2) result',[key,id]);return {id,...r.rows[0].result};}
  async function finish(id,outcome='failure',key=subject){return (await db.query('select public.auth_server_finish_password($1,$2,$3,$4,$5) result',[key,id,outcome,outcome==='success'?user:null,outcome==='success'?session:null])).rows[0].result;}
  async function attempt(key=subject,outcome='failure'){const b=await begin(key);assert.equal(b.allowed,true);return finish(b.id,outcome,key);}
  await t.test('a direct provider token has no profile or workspace access',async()=>{
    await asUser(); assert.equal((await db.query('select public.workspace_session_allowed() allowed')).rows[0].allowed,false);
    assert.equal((await db.query('select count(*)::int n from public.workspace_profiles')).rows[0].n,0);
    await assert.rejects(db.query('select public.workspace_account()'),/Verified sign-in required/);
    await assert.rejects(db.query('select public.auth_server_begin_password($1,$2)',[subject,randomUUID()]),/permission denied/);
    await db.exec('reset role; set role anon'); await assert.rejects(db.query('select public.auth_server_rate_limit($1,20,60)',[subject]),/permission denied/);
  });
  await t.test('five failures lock all new attempts for 24 hours, including correct passwords',async()=>{
    await service(); for(let n=1;n<5;n++){const r=await attempt();assert.equal(r.locked,false);}
    const fifth=await attempt();assert.equal(fifth.locked,true);assert.equal(fifth.retryAfter,86400);
    const blocked=await begin();assert.equal(blocked.allowed,false);assert.equal(blocked.locked,true);assert.ok(blocked.retryAfter>86390);
    await db.exec('reset role'); assert.equal((await db.query('select failures from private.auth_login_state where subject_hash=$1',[subject])).rows[0].failures,5);
  });
  await t.test('24-hour expiry automatically starts a fresh attempt window',async()=>{
    await db.query(`update private.auth_login_state set locked_until=now()-interval '1 second' where subject_hash=$1`,[subject]);
    await service(); const b=await begin();assert.equal(b.allowed,true);await finish(b.id,'unavailable');
    await db.exec('reset role');assert.equal((await db.query('select failures from private.auth_login_state where subject_hash=$1',[subject])).rows[0].failures,0);
  });
  await t.test('reservations stop parallel requests exceeding five, and outages do not consume failures',async()=>{
    await service();const pending=[];for(let n=0;n<5;n++){const b=await begin();assert.equal(b.allowed,true);pending.push(b.id);}
    const blocked=await begin();assert.equal(blocked.allowed,false);assert.equal(blocked.locked,false);
    for(const id of pending)await finish(id,'unavailable');
    await db.exec('reset role');assert.equal((await db.query('select failures from private.auth_login_state where subject_hash=$1',[subject])).rows[0].failures,0);
  });
  await t.test('successful guarded login resets failures and approves only its verified session',async()=>{
    await service();for(let n=0;n<4;n++)await attempt();const ok=await attempt(subject,'success');assert.equal(ok.allowed,true);
    await asUser();assert.equal((await db.query('select public.workspace_session_allowed() allowed')).rows[0].allowed,true);
    assert.equal((await db.query('select count(*)::int n from public.workspace_profiles')).rows[0].n,1);
    await service();await assert.rejects(db.query('select * from private.workspace_approved_sessions'),/permission denied/);
  });
  await t.test('expired or replayed attempts cannot approve a session',async()=>{
    await service();const b=await begin();await finish(b.id,'unavailable');await assert.rejects(finish(b.id,'success'),/expired or already completed/);
    const old=await begin();await db.exec('reset role');await db.query(`update private.auth_login_attempts set expires_at=now()-interval '1 second' where attempt_id=$1`,[old.id]);await service();await assert.rejects(finish(old.id,'success'),/expired or already completed/);
  });
  await t.test('rate limits persist per bucket and expire independently',async()=>{
    const key='b'.repeat(64); await service();for(let i=0;i<2;i++)assert.equal((await db.query('select public.auth_server_rate_limit($1,2,60) result',[key])).rows[0].result.allowed,true);
    assert.equal((await db.query('select public.auth_server_rate_limit($1,2,60) result',[key])).rows[0].result.allowed,false);
    await db.exec('reset role');await db.query(`update private.auth_request_limits set expires_at=now()-interval '1 second' where bucket_hash=$1`,[key]);await service();assert.equal((await db.query('select public.auth_server_rate_limit($1,2,60) result',[key])).rows[0].result.allowed,true);
  });
  await t.test('verified one-time recovery unlocks login and invalidates approved sessions without restoring revoked access',async()=>{
    const proof='c'.repeat(64);const lease=randomUUID();const rpc=(phase,sessionId=session,leaseId=lease)=>db.query('select public.auth_server_recovery($1,$2,$3,$4,$5,$6) allowed',[proof,user,sessionId,phase,subject,leaseId]);
    await db.exec('reset role');await db.query(`update public.workspace_profiles set status='revoked' where user_id=$1`,[user]);
    await service();for(let n=0;n<5;n++)await attempt();assert.equal((await rpc('create')).rows[0].allowed,true);
    assert.equal((await rpc('begin',randomUUID())).rows[0].allowed,false);
    assert.equal((await rpc('begin')).rows[0].allowed,true);assert.equal((await rpc('begin')).rows[0].allowed,false);
    assert.equal((await rpc('complete',session,randomUUID())).rows[0].allowed,false);
    assert.equal((await rpc('complete')).rows[0].allowed,true);assert.equal((await rpc('complete')).rows[0].allowed,false);
    await asUser();assert.equal((await db.query('select public.workspace_session_allowed() allowed')).rows[0].allowed,false);
    await db.exec('reset role');assert.equal((await db.query('select failures from private.auth_login_state where subject_hash=$1',[subject])).rows[0].failures,0);
    assert.equal((await db.query('select status from public.workspace_profiles where user_id=$1',[user])).rows[0].status,'revoked');
    assert.equal((await db.query(`select count(*)::int n from private.authentication_events where event_type='password_reset'`)).rows[0].n,1);
  });
  await t.test('all new security tables have RLS and public functions are invokers',async()=>{
    assert.equal((await db.query(`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('private','public') and c.relkind='r' and not c.relrowsecurity`)).rows[0].n,0);
    assert.equal((await db.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef`)).rows[0].n,0);
  });
  await db.close();
});
