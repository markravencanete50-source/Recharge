import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {normaliseRegion} from '../lib/regions.ts';

// A property with no area is given one from its address, by the same rules the app uses.
const db=new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
after(()=>db.close());
const add=async(name,address,region='')=>(await db.query('insert into public.workspace_properties(request_id,name,address,region) values(gen_random_uuid(),$1,$2,$3) returning region',[name,address,region])).rows[0].region;

test('an address gives the property its area',async()=>{
 assert.equal(await add('Flat A','12 Wardlaw Terrace, Edinburgh EH11 1TW, UK'),'Edinburgh');
 assert.equal(await add('Flat B','27 Maukinfauld Rd, Glasgow G32 8TH, UK'),'Glasgow');
 assert.equal(await add('Flat C','1 Shore Road, Portobello, UK'),'Edinburgh','towns are grouped');
 assert.equal(await add('Flat D','5 High Street, Elgin, Moray'),'Aberdeenshire and Moray','the longer name wins before the shorter one');
 assert.equal(await add('Flat E','9 Union St, Aberdeen AB10, UK'),'Aberdeen');
});

test('a region someone set is kept, and an address that matches nothing stays blank',async()=>{
 assert.equal(await add('Flat F','12 Wardlaw Terrace, Edinburgh','Fife'),'Fife');
 assert.equal(await add('Flat G','Somewhere with no known town'),'');
});

test('editing an address fills a blank area but never replaces one',async()=>{
 await db.query("insert into public.workspace_properties(request_id,name,address,region) values(gen_random_uuid(),'Flat H','Unknown','')");
 await db.query("update public.workspace_properties set address='3 Bridge St, Dundee' where name='Flat H'");
 assert.equal((await db.query("select region from public.workspace_properties where name='Flat H'")).rows[0].region,'Dundee');
 await db.query("update public.workspace_properties set address='1 High St, Glasgow' where name='Flat H'");
 assert.equal((await db.query("select region from public.workspace_properties where name='Flat H'")).rows[0].region,'Dundee','a set area is not overwritten');
});

test('the database rules match the app rules for every address in the sample',async()=>{
 const samples=['Leith Walk, Edinburgh','Paisley Road West, Glasgow','Pitlochry Perthshire','Kirkcaldy, Fife','Oban, Argyll','Dalkeith Midlothian','Hamilton ML3','Stornoway, Isle of Lewis','Greenock PA15','Peebles EH45','Montrose DD10','Nowhere','Duke St, Hawick TD9 9PY, UK','Armadale, Bathgate EH48 3NE','Rutherglen G73 4NN','Bornisketaig, Portree IV51 9YS','Prestonpans EH32 0QF','Main St, Prestwick KA9 1PB','Townend Rd, Dumbarton G82 2BA','75 George St, Huntly AB54 8HJ','Deanpark Bank, Balerno EH14 7LG','De Quincey Road, Polton EH18 1DP','Sydney Drive, East Kilbride G75','Main St, Alexandria, West Dunbartonshire G83 0AA','Kirkintilloch, East Dunbartonshire','1 High St, Dunbar EH42 1EN','Dunbar Road, Haddington','Innerleithen EH44 6HA','5 Great Junction St, Leith EH6 5LA'];
 for(const a of samples){
  const expected=normaliseRegion('',a);
  const got=(await db.query('select private.workspace_infer_region($1) r',[a])).rows[0].r;
  assert.equal(got,expected,a);
 }
});

// A live property in West Dunbartonshire was filed as East Lothian: "dunbar" matched inside the word.
test('Dunbartonshire is not East Lothian and Innerleithen is not Edinburgh, in the app and the database',async()=>{
 const cases=[
  ['12 Main St, Alexandria, West Dunbartonshire G83 0AA','Dunbartonshire'],['West Dunbartonshire','Dunbartonshire'],['East Dunbartonshire','Dunbartonshire'],
  ['5 Station Rd, Clydebank, West Dunbartonshire','Dunbartonshire'],['1 High St, Dunbar EH42 1EN','East Lothian'],['Dunbar, East Lothian','East Lothian'],
  ['Innerleithen EH44 6HA','Scottish Borders'],['5 Great Junction St, Leith EH6 5LA','Edinburgh'],['Leith Walk, Edinburgh','Edinburgh'],
 ];
 for(const [address,area] of cases){
  assert.equal(normaliseRegion('',address),area,'app: '+address);
  assert.equal((await db.query('select private.workspace_infer_region($1) r',[address])).rows[0].r,area,'database: '+address);
 }
 assert.equal(await add('Flat W','12 Main St, Alexandria, West Dunbartonshire G83 0AA'),'Dunbartonshire','a new property is filed under its own area');
});

test('every place name in the rules, and every council, maps to its own area',async()=>{
 const src=await fs.readFile('lib/regions.ts','utf8');
 for(const m of src.matchAll(/\[\/([^/]+)\/i, '([^']+)'\]/g))for(const name of m[1].replaceAll('\\b','').split('|'))assert.equal(normaliseRegion('',name),m[2],name);
 const councils={'Aberdeen City':'Aberdeen',Aberdeenshire:'Aberdeenshire and Moray',Angus:'Angus','Argyll and Bute':'Argyll and Bute','City of Edinburgh':'Edinburgh','Dumfries and Galloway':'Dumfries and Galloway','Dundee City':'Dundee','East Ayrshire':'Ayrshire','East Dunbartonshire':'Dunbartonshire','East Lothian':'East Lothian','East Renfrewshire':'Renfrewshire and Inverclyde',Falkirk:'Stirling and Falkirk',Fife:'Fife','Glasgow City':'Glasgow',Highland:'Inverness and Highlands',Inverclyde:'Renfrewshire and Inverclyde',Midlothian:'Midlothian',Moray:'Aberdeenshire and Moray','North Ayrshire':'Ayrshire','North Lanarkshire':'Lanarkshire','Orkney Islands':'Scottish islands','Perth and Kinross':'Perth and Kinross',Renfrewshire:'Renfrewshire and Inverclyde','Scottish Borders':'Scottish Borders','Shetland Islands':'Scottish islands','South Ayrshire':'Ayrshire','South Lanarkshire':'Lanarkshire',Stirling:'Stirling and Falkirk','West Dunbartonshire':'Dunbartonshire','West Lothian':'West Lothian'};
 for(const [council,area] of Object.entries(councils)){
  assert.equal(normaliseRegion(council,council),area,'app: '+council);
  assert.equal((await db.query('select private.workspace_infer_region($1) r',[council])).rows[0].r,area,'database: '+council);
 }
});
