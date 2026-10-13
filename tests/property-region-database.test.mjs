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

const {REGION_RULES}=await import('../lib/regions.ts');
const infer=async address=>(await db.query('select private.workspace_infer_region($1) r',[address])).rows[0].r;
// Checks one address in the app and in the database.
const both=async(address,area)=>{assert.equal(normaliseRegion('',address),area,'app: '+address);assert.equal(await infer(address),area,'database: '+address);};

// A live property in West Dunbartonshire was filed as East Lothian: "dunbar" matched inside the word.
test('Dunbartonshire is not East Lothian, Dunbar still is, and Innerleithen is not Edinburgh',async()=>{
 for(const [address,area] of [
  ['Main Street, West Dunbartonshire Council, G83 0AA','Dunbartonshire'],['12 Main St, Alexandria, West Dunbartonshire G83 0AA','Dunbartonshire'],
  ['West Dunbartonshire','Dunbartonshire'],['East Dunbartonshire','Dunbartonshire'],['5 Station Rd, Clydebank, West Dunbartonshire','Dunbartonshire'],
  ['1 High St, Dunbar EH42 1EN','East Lothian'],['Dunbar, East Lothian','East Lothian'],['Dunbar','East Lothian'],
  ['Innerleithen EH44 6HA','Scottish Borders'],['5 Great Junction St, Leith EH6 5LA','Edinburgh'],
 ])await both(address,area);
 assert.equal(await add('Flat W','Main Street, West Dunbartonshire Council, G83 0AA'),'Dunbartonshire','a new property is filed under its own area');
});

test('real Scottish addresses land in their own region, in the app and the database',async()=>{
 const real={
  'Edinburgh':['Palace of Holyroodhouse, Canongate, Edinburgh EH8 8DX','Ocean Terminal, Ocean Drive, Leith EH6 6JJ'],
  'Glasgow':['Kelvingrove Art Gallery, Argyle St, Glasgow G3 8AG','George Square, Glasgow G2 1DU'],
  'Aberdeen':['Marischal College, Broad St, Aberdeen AB10 1AB'],
  'Dundee':['V&A Dundee, 1 Riverside Esplanade, Dundee DD1 4EZ'],
  'Inverness and Highlands':['Inverness Castle, Castle Wynd, Inverness IV2 3EG','Portree Harbour, Portree, Isle of Skye IV51 9DD','Glenfinnan, Fort William PH37 4LT'],
  'Fife':['Old Course, St Andrews KY16 9JD','Dunfermline Abbey, St Margaret St, Dunfermline KY12 7PE'],
  'Perth and Kinross':['Scone Palace, Perth PH2 6BD','Blair Castle, Blair Atholl, Pitlochry, Perthshire PH18 5TL'],
  'Stirling and Falkirk':['Stirling Castle, Castle Wynd, Stirling FK8 1EJ','The Falkirk Wheel, Lime Rd, Falkirk FK1 4RS','Alloa Tower, Alloa, Clackmannanshire FK10 1PP'],
  'East Lothian':['Tantallon Castle, North Berwick EH39 5PN','John Muir Birthplace, 126 High St, Dunbar EH42 1JJ','Haddington, East Lothian EH41 3HA'],
  'Midlothian':['Dalkeith Country Park, Dalkeith EH22 1ST','Penicuik House, Penicuik, Midlothian EH26 9LA'],
  'West Lothian':['Linlithgow Palace, Kirkgate, Linlithgow EH49 7AL','Almondvale Stadium, Livingston EH54 7DN'],
  'Scottish Borders':['Abbotsford, Melrose TD6 9BQ','Traquair House, Innerleithen EH44 6PW','Floors Castle, Kelso, Roxburghshire TD5 7SF'],
  'Ayrshire':['Burns Cottage, Alloway, Ayr KA7 4PQ','Culzean Castle, Maybole, South Ayrshire KA19 8LE'],
  'Dumfries and Galloway':['Caerlaverock Castle, Glencaple, Dumfries DG1 4RU','Threave Castle, Castle Douglas, Dumfries and Galloway DG7 1TJ'],
  'Argyll and Bute':["McCaig's Tower, Duncraggan Rd, Oban PA34 5DP",'Inveraray Castle, Inveraray, Argyll PA32 8XE'],
  'Aberdeenshire and Moray':['Dunnottar Castle, Stonehaven AB39 2TL','Elgin Cathedral, King St, Elgin IV30 1HU','Peterhead Prison Museum, Peterhead AB42 2ZX'],
  'Angus':['Arbroath Abbey, Abbey St, Arbroath DD11 1JQ','Glamis Castle, Glamis, Forfar, Angus DD8 1RJ'],
  'Lanarkshire':['New Lanark Mills, Lanark ML11 9DB','Hamilton Mausoleum, Hamilton ML3 6BY','Summerlee, Heritage Way, Coatbridge, North Lanarkshire ML5 1QD'],
  'Renfrewshire and Inverclyde':['Paisley Abbey, Abbey Close, Paisley PA1 1JG','McLean Museum, 15 Kelly St, Greenock PA16 8JX'],
  'Dunbartonshire':['Dumbarton Castle, Castle Rd, Dumbarton G82 1JJ','The Hill House, Upper Colquhoun St, Helensburgh G84 9AJ','Mugdock Country Park, Milngavie, East Dunbartonshire G62 8EL'],
  'Scottish islands':['Calanais Standing Stones, Callanish, Isle of Lewis HS2 9DY','St Magnus Cathedral, Broad St, Kirkwall, Orkney KW15 1NX','Tobermory, Isle of Mull PA75 6NR','Lerwick, Shetland Islands ZE1 0LL'],
 };
 for(const [area,addresses] of Object.entries(real))for(const address of addresses)await both(address,area);
});

test('a street named after a town loses to the town the address is in',async()=>{
 for(const [address,area] of [
  ['10 Huntly Terrace, Paisley PA2 6TZ','Renfrewshire and Inverclyde'],['Huntly Ave, Livingston EH54 8NG, UK, West Lothian','West Lothian'],
  ['Moray Place, Edinburgh EH3 6DS','Edinburgh'],['Glasgow Road, Dumbarton G82 1RE','Dunbartonshire'],['Perth Road, Dundee DD1 4JT','Dundee'],
  ['Dunbar Road, Haddington','East Lothian'],['Stirling Road, Edinburgh EH5 3JA','Edinburgh'],['Galloway Street, Glasgow G21','Glasgow'],
  ['Leith Walk, Edinburgh EH6 8RG','Edinburgh'],['Fife Street, Bathgate, West Lothian','West Lothian'],
 ])await both(address,area);
});

test('every name in the rules, and every council, maps to its own area in the app and the database',async()=>{
 for(const rule of REGION_RULES)for(const name of [...rule.councils,...rule.places])await both(name,rule.area);
 const councils={'Aberdeen City':'Aberdeen',Aberdeenshire:'Aberdeenshire and Moray',Angus:'Angus','Argyll and Bute':'Argyll and Bute','City of Edinburgh':'Edinburgh',Clackmannanshire:'Stirling and Falkirk','Dumfries and Galloway':'Dumfries and Galloway','Dundee City':'Dundee','East Ayrshire':'Ayrshire','East Dunbartonshire':'Dunbartonshire','East Lothian':'East Lothian','East Renfrewshire':'Renfrewshire and Inverclyde',Falkirk:'Stirling and Falkirk',Fife:'Fife','Glasgow City':'Glasgow',Highland:'Inverness and Highlands',Inverclyde:'Renfrewshire and Inverclyde',Midlothian:'Midlothian',Moray:'Aberdeenshire and Moray','Na h-Eileanan Siar':'Scottish islands','North Ayrshire':'Ayrshire','North Lanarkshire':'Lanarkshire','Orkney Islands':'Scottish islands','Perth and Kinross':'Perth and Kinross',Renfrewshire:'Renfrewshire and Inverclyde','Scottish Borders':'Scottish Borders','Shetland Islands':'Scottish islands','South Ayrshire':'Ayrshire','South Lanarkshire':'Lanarkshire',Stirling:'Stirling and Falkirk','West Dunbartonshire':'Dunbartonshire','West Lothian':'West Lothian'};
 assert.equal(Object.keys(councils).length,32);
 for(const [council,area] of Object.entries(councils))await both(council,area);
 for(const blank of ['','Nowhere','Somewhere with no known town','Islington, London'])assert.equal(await infer(blank),normaliseRegion('',blank),blank);
});

test('the migration holds exactly the app\'s name lists',async()=>{
 const sql=await fs.readFile('supabase/migrations/20261014200000_region_whole_words.sql','utf8');
 const rows=[...REGION_RULES.map((r,i)=>`(1, ${i+1}, '${r.area}', '${r.councils.join('|')}')`),...REGION_RULES.map((r,i)=>`(2, ${i+1}, '${r.area}', '${r.places.join('|')}')`)];
 const found=[...sql.matchAll(/^\s*\((\d), (\d+), '[^']*', '[^']*'\)/gm)].map(m=>m[0].trim());
 assert.deepEqual(found,rows);
});
