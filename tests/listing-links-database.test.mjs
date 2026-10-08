import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Each property's listings: platform, link and listing ID, kept up to date by Stays and admins.
const db=new PGlite();
const roles=['super_admin','stays','client','stays'];
const users=roles.map((_,i)=>`99000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`),session=i=>users[i].replace('9900','9910');
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`listing${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2 where user_id=$1",[users[i],roles[i]]);
 await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features',[users[i]]);
}
async function as(i){await db.exec('reset role');await db.exec('delete from private.workspace_write_limits');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[i],session_id:session(i)})]);await db.exec('set role authenticated');}
const act=async input=>(await db.query('select public.workspace_portfolio_action($1::jsonb) r',[JSON.stringify({requestId:crypto.randomUUID(),...input})])).rows[0].r;
await as(0);
const property=(await db.query('select public.workspace_save_property($1) r',[{requestId:crypto.randomUUID(),name:'Listing flat',address:'Example listing address',region:'Glasgow',bedrooms:2}])).rows[0].r;
await db.query('select public.workspace_assign_property($1,$2,$3)',[property,users[1],'staff']);
await db.query('select public.workspace_assign_property($1,$2,$3)',[property,users[2],'client']);

test('Stays record listings with links and IDs; the portfolio shows them',async()=>{
 await as(1);
 const saved=await act({action:'saveListingLinks',propertyId:property,links:[{platform:'Airbnb',url:'https://www.airbnb.co.uk/rooms/123',listingId:'123'},{platform:'Channel manager',url:'',listingId:'UPL-889'}]});
 assert.deepEqual(saved.links,[{platform:'Airbnb',url:'https://www.airbnb.co.uk/rooms/123',listingId:'123'},{platform:'Channel manager',listingId:'UPL-889'}]);
 const portfolio=(await db.query("select public.workspace_portfolio_read('portfolio',$1,null,null) r",[property])).rows[0].r;
 assert.equal(portfolio.properties[0].listingLinks.length,2);
});

test('bad listings, other properties and owners are refused',async()=>{
 await as(1);
 await assert.rejects(act({action:'saveListingLinks',propertyId:property,links:[{platform:'Airbnb',url:'http://insecure.example',listingId:''}]}),/https/);
 await assert.rejects(act({action:'saveListingLinks',propertyId:property,links:[{platform:'Airbnb',url:'',listingId:''}]}),/link or an ID/);
 await assert.rejects(act({action:'saveListingLinks',propertyId:property,links:[{platform:'MySpace',url:'https://example.com',listingId:''}]}),/platform/);
 await assert.rejects(act({action:'saveListingLinks',propertyId:property,links:[{platform:'Vrbo',url:'',listingId:'bad id!'}]}),/Listing IDs/);
 await as(3);await assert.rejects(act({action:'saveListingLinks',propertyId:property,links:[]}),/permission|denied|Property/i,'Stays not on the property');
 await as(2);await assert.rejects(act({action:'saveListingLinks',propertyId:property,links:[]}),/permission/i,'owners');
});
