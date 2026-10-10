import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Favorites: each person's saved places, read and changed only by themselves.
const db=new PGlite();
const roles=['super_admin','cleans','stays'];
const users=roles.map((_,i)=>`77000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const session=i=>users[i].replace('7700','7800');
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users on delete cascade,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`fav${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query("update public.workspace_profiles set status=$4,role=$2,full_name=$3 where user_id=$1",[users[i],roles[i],'Person '+i,i===2?'pending':'active']);
}
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[i],session_id:session(i)})]);await db.exec('set role authenticated');}
beforeEach(async()=>{await db.exec('reset role');});
const read=async()=>(await db.query('select public.workspace_favorites() r')).rows[0].r;
const save=async items=>(await db.query('select public.workspace_save_favorites($1::jsonb) r',[JSON.stringify({items})])).rows[0].r;

test('each person keeps their own favorites, in their order',async()=>{
 await as(0);
 assert.deepEqual(await read(),[]);
 const mine=[{key:'tool:queue',label:'Waiting on you'},{key:'property:7d0f3c2e-0000-4000-8000-000000000001',label:'Leith Walk'}];
 assert.deepEqual(await save(mine),mine);
 assert.deepEqual(await read(),mine);
 await save([...mine].reverse());
 assert.deepEqual((await read()).map(i=>i.key),['property:7d0f3c2e-0000-4000-8000-000000000001','tool:queue']);
 await as(1);
 assert.deepEqual(await read(),[],'someone else sees only their own');
 await save([{key:'view:cleans',label:'Cleans'}]);
 await as(0);
 assert.equal((await read()).length,2);
});

test('favorites are checked and private',async()=>{
 await as(0);
 await assert.rejects(save([{key:'tool:queue',label:'A'},{key:'tool:queue',label:'B'}]),/Check the favorites/);
 await assert.rejects(save([{key:'no colon',label:'A'}]),/Check the favorites/);
 await assert.rejects(save([{key:'tool:queue',label:'A',extra:true}]),/Check the favorites/);
 await assert.rejects(save([{key:'tool:queue',label:''}]),/Check the favorites/);
 await assert.rejects(save(Array.from({length:41},(_,i)=>({key:'tool:t'+i,label:'T'+i}))),/up to 40/);
 // Someone without active access cannot read or save.
 await as(2);
 await assert.rejects(read(),/Active workspace access/);
 // Nobody signed in reads the table directly.
 await db.exec('reset role');await db.exec('set role authenticated');
 await assert.rejects(db.query('select * from private.workspace_favorites'),/permission denied/);
 await db.exec('reset role');await db.exec('set role anon');
 await assert.rejects(db.query('select public.workspace_favorites()'),/permission denied/);
});
