import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Team beta: while the switch is on, nobody can be made an active owner, however it is attempted.
// Staff are unaffected, a pending request is harmless, and turning the switch off lets owners in.
const db=new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
const users=[0,1,2].map(i=>`97000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
for(let i=0;i<users.length;i++)await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`beta${i}@example.com`]);
after(()=>db.close());
const setBeta=on=>db.query('update private.workspace_beta_mode set team_only=$1',[on]);
const activate=(i,role)=>db.query("update public.workspace_profiles set status='active',role=$2 where user_id=$1",[users[i],role]);

test('the beta switch ships off, so a fresh database behaves as before',async()=>{
 assert.equal((await db.query('select team_only from private.workspace_beta_mode')).rows[0].team_only,false);
 await activate(0,'client');
 assert.equal((await db.query('select role,status from public.workspace_profiles where user_id=$1',[users[0]])).rows[0].status,'active');
});

test('with the switch on, an owner cannot be activated or created',async()=>{
 await setBeta(true);
 await assert.rejects(activate(1,'client'),/switched off while the team beta runs/);
 await assert.rejects(db.query("update public.workspace_profiles set role='client' where user_id=$1 and status='active'",[users[0]]).then(()=>activate(0,'client')),/team beta/,'an existing account cannot be re-activated as an owner either');
 await activate(1,'stays');
 await assert.rejects(db.query("update public.workspace_profiles set role='client' where user_id=$1",[users[1]]),/team beta/,'changing a team member into an owner is refused');
});

test('with the switch on, staff and pending requests are unaffected',async()=>{
 await setBeta(true);
 for(const role of ['cleans','ready','accounts','admin'])await activate(2,role);
 await db.query("update public.workspace_profiles set status='pending',role='client' where user_id=$1",[users[2]]);
 assert.equal((await db.query('select role,status from public.workspace_profiles where user_id=$1',[users[2]])).rows[0].status,'pending');
 await db.query("update public.workspace_profiles set full_name='Renamed' where user_id=$1",[users[2]]);
});

test('turning the switch off lets owners in',async()=>{
 await setBeta(false);
 await activate(2,'client');
 assert.equal((await db.query('select role from public.workspace_profiles where user_id=$1',[users[2]])).rows[0].role,'client');
});

test('the switch is not readable or writable by signed-in users',async()=>{
 await db.exec('set role authenticated');
 await assert.rejects(db.query('select * from private.workspace_beta_mode'),/permission denied/);
 await db.exec('reset role');
});
