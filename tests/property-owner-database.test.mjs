import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Owner contact details on the property page: admins, assigned Stays and Accounts only.
const db=new PGlite();
const roles=['super_admin','client','stays','stays','accounts','ready','cleans','client'];
const users=roles.map((_,i)=>`61000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`owner-test${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[users[i].replace('6100','6200'),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[users[i].replace('6100','6200'),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1",[users[i],roles[i],'Test person '+i]);
 await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features',[users[i]]);
}
// Staff pass onboarding in this test: no contracts or required courses exist.
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[i],session_id:users[i].replace('6100','6200')})]);await db.exec('set role authenticated');}
const owner=async i=>{await as(i);try{return (await db.query("select public.workspace_property_details($1,'owner') data",[property])).rows[0].data;}finally{await db.exec('reset role');}};
let property;
await as(0);property=(await db.query('select public.workspace_save_property($1::jsonb) id',[JSON.stringify({requestId:crypto.randomUUID(),name:'Owner test property',address:'Test address',region:'Edinburgh',bedrooms:2})])).rows[0].id;
for(const [i,assignment] of [[1,'client'],[2,'staff'],[5,'staff'],[6,'cleaner']])await db.query('select public.workspace_assign_property($1,$2,$3)',[property,users[i],assignment]);
await db.exec('reset role');
after(()=>db.close());

test('admins, assigned Stays and Accounts see the owner name and email',async()=>{
 const expected={owners:[{name:'Test person 1',email:'owner-test1@example.com'}]};
 assert.deepEqual(await owner(0),expected);
 assert.deepEqual(await owner(2),expected);
 assert.deepEqual(await owner(4),expected);
});

test('nobody else can read owner details',async()=>{
 for(const i of [1,3,5,6,7])await assert.rejects(owner(i),/denied|access/i,roles[i]+' '+i);
});

test('a property with no owner returns an empty list, and other sections still work',async()=>{
 await as(0);const empty=(await db.query('select public.workspace_save_property($1::jsonb) id',[JSON.stringify({requestId:crypto.randomUUID(),name:'No owner yet',address:'Test address',region:'Edinburgh',bedrooms:1})])).rows[0].id;
 assert.deepEqual((await db.query("select public.workspace_property_details($1,'owner') data",[empty])).rows[0].data,{owners:[]});
 assert.ok((await db.query("select public.workspace_property_details($1,'access') data",[empty])).rows[0].data);
 await db.exec('reset role');
});
