import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';

const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false}});
const search=await vite.ssrLoadModule('/lib/workspace-search.ts');
const {previewAccount,canViewAs,VIEW_AS_ROLES,viewOnlyMessage,viewAsGroups,viewAsKey,readSavedView,viewAsPeopleSchema}=await vite.ssrLoadModule('/lib/view-as.ts');
const {DEFAULT_ROLE_MODULES,MODULE_IDS}=await vite.ssrLoadModule('/lib/modules.ts');
const {teamsActionSchema,teamsReadSchema}=await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
await vite.close();

const properties=[
 {id:'11111111-1111-4111-8111-111111111111',name:'Harbour View',address:'12 Leith Walk, Edinburgh EH6 5AB',region:'Edinburgh',status:'active'},
 {id:'22222222-2222-4222-8222-222222222222',name:'Glen Cottage',address:'Main Street, Aviemore PH22 1RH',region:'Highlands',status:'onboarding'},
];
const work=[
 {workId:'33333333-3333-4333-8333-333333333333',title:'Boiler not heating',propertyId:properties[0].id,status:'reported',kind:'repair'},
 {workId:'44444444-4444-4444-8444-444444444444',title:'Turnover clean',propertyId:properties[1].id,status:'completed',kind:'clean'},
];
const invoices=[{id:'55555555-5555-4555-8555-555555555555',property_id:properties[0].id,reference:'INV-2041',amount_minor:12500,currency:'GBP',status:'issued'}];
const admin=search.buildSearchIndex({role:'super_admin',modules:MODULE_IDS,properties,work,invoices});

test('search finds pages, tools, properties, work and invoices by any word',()=>{
 const first=q=>search.searchWorkspace(admin,q).groups[0]?.entries[0];
 assert.equal(first('clean').key,'view:cleans','a Work view by its name');
 assert.equal(first('leith').key,'property:'+properties[0].id,'a property by its street');
 assert.equal(first('eh6').key,'property:'+properties[0].id,'or its postcode');
 assert.equal(first('boiler').key,'work:'+work[0].workId,'a job by its title');
 assert.equal(first('inv-2041').key,'invoice:'+invoices[0].id);
 assert.equal(first('chat').key,'section:inbox','other words for the same place');
 assert.equal(first('money').group,'Pages');
 assert.ok(search.searchWorkspace(admin,'access control').groups.some(g=>g.entries.some(e=>e.key==='tool:access')));
 assert.equal(search.searchWorkspace(admin,'zzzz').total,0);
 assert.equal(search.searchWorkspace(admin,'  ').total,0);
 // Open work comes before finished work.
 const jobs=admin.filter(e=>e.group==='Work');assert.equal(jobs[0].key,'work:'+work[0].workId);
 // One entry per key.
 assert.equal(new Set(admin.map(e=>e.key)).size,admin.length);
});

test('each role finds only what it can open',()=>{
 const cleaner=search.buildSearchIndex({role:'cleans',modules:DEFAULT_ROLE_MODULES.cleans,properties,work,invoices});
 assert.ok(!cleaner.some(e=>e.key==='view:accounts'||e.key==='tool:access'||e.group==='Invoices'));
 assert.ok(cleaner.some(e=>e.key==='section:favorites'));
 const accounts=search.buildSearchIndex({role:'accounts',modules:DEFAULT_ROLE_MODULES.accounts,properties,work,invoices});
 assert.ok(!accounts.some(e=>e.group==='Properties'||e.key==='section:properties'),'Accounts have no Properties page');
 assert.ok(accounts.some(e=>e.group==='Invoices'));
 const owner=search.buildSearchIndex({role:'client',modules:DEFAULT_ROLE_MODULES.client,properties,work});
 assert.ok(owner.some(e=>e.key==='section:favorites'),'owners have Favorites too (round 6)');
});

test('favorites keep order, toggle, move and survive things going away',()=>{
 let items=[];
 const queue=admin.find(e=>e.key==='tool:queue'),place=admin.find(e=>e.group==='Properties');
 items=search.toggleFavorite(items,queue);items=search.toggleFavorite(items,place);
 assert.deepEqual(items.map(i=>i.key),['tool:queue',place.key]);
 items=search.moveFavorite(items,place.key,0);
 assert.deepEqual(items.map(i=>i.key),[place.key,'tool:queue']);
 items=search.toggleFavorite(items,queue);assert.deepEqual(items.map(i=>i.key),[place.key]);
 const gone=[...items,{key:'work:99999999-9999-4999-8999-999999999999',label:'An old job'}];
 const resolved=search.resolveFavorites(gone,admin);
 assert.equal(resolved[0].entry.key,place.key);assert.equal(resolved[1].entry,null);assert.equal(resolved[1].item.label,'An old job');
 assert.ok(search.suggestedFavorites(admin,items).every(e=>e.key.startsWith('tool:')));
 let many=[];for(let i=0;i<45;i++)many=search.toggleFavorite(many,{key:'tool:t'+i,label:'T'});
 assert.equal(many.length,search.MAX_FAVORITES);
});

test('favorites travel through the teams route as one checked list',()=>{
 assert.ok(teamsReadSchema.safeParse({section:'favorites'}).success);
 assert.ok(teamsActionSchema.safeParse({action:'saveFavorites',items:[{key:'tool:queue',label:'Waiting on you'}]}).success);
 assert.ok(!teamsActionSchema.safeParse({action:'saveFavorites',items:[{key:'tool:queue',label:'A'},{key:'tool:queue',label:'B'}]}).success);
 assert.ok(!teamsActionSchema.safeParse({action:'saveFavorites',items:[{key:'Bad Key',label:'A'}]}).success);
 assert.ok(!teamsActionSchema.safeParse({action:'saveFavorites',items:Array.from({length:41},(_,i)=>({key:'tool:t'+i,label:'T'}))}).success);
});

test('only a super admin can view as another role, with that role’s tools',()=>{
 const me={userId:'66666666-6666-4666-8666-666666666666',email:'a@example.com',fullName:'Mark',role:'super_admin',status:'active',modules:[...MODULE_IDS]};
 assert.ok(canViewAs(me));
 const cleaner=previewAccount(me,'cleans');
 assert.equal(cleaner.role,'cleans');assert.deepEqual(cleaner.modules,[...DEFAULT_ROLE_MODULES.cleans]);assert.equal(cleaner.userId,me.userId);
 assert.deepEqual(previewAccount(me,'admin').modules,[...MODULE_IDS]);
 assert.equal(previewAccount(me,null),me);
 const adminAccount={...me,role:'admin'};
 assert.ok(!canViewAs(adminAccount));assert.equal(previewAccount(adminAccount,'cleans'),adminAccount,'an admin cannot preview');
 assert.ok(!VIEW_AS_ROLES.some(r=>r.role==='super_admin'));
 assert.match(viewOnlyMessage({role:'ready',person:null}),/viewing as the Ready role, so nothing is saved/);
 assert.match(viewOnlyMessage({role:'cleans',person:{userId:me.userId,fullName:'Ana Ruiz'}}),/viewing as Ana Ruiz \(Cleaner\)/);
});

test('View as lists people under their role and remembers the view for the tab',()=>{
 const id=n=>`70000000-0000-4000-8000-00000000000${n}`;
 const people=viewAsPeopleSchema.parse([{userId:id(1),fullName:'Zoe',role:'cleans'},{userId:id(2),fullName:'Ana',role:'cleans'},{userId:id(3),fullName:'Bo',role:'client'}]);
 const groups=viewAsGroups(people);
 assert.deepEqual(groups.map(g=>g.role),VIEW_AS_ROLES.map(r=>r.role));
 assert.deepEqual(groups.find(g=>g.role==='cleans').people.map(p=>p.fullName),['Ana','Zoe']);
 assert.equal(groups.find(g=>g.role==='stays').people.length,0,'a role nobody has is still offered');
 assert.throws(()=>viewAsPeopleSchema.parse([{userId:id(4),fullName:'Me',role:'super_admin'}]),'super admins are never offered');
 assert.equal(viewAsKey(null),'self');assert.equal(viewAsKey({role:'stays',person:null}),'role:stays');assert.equal(viewAsKey({role:'cleans',person:{userId:id(1),fullName:'Zoe'}}),id(1));
 assert.deepEqual(readSavedView(JSON.stringify({role:'cleans',person:{userId:id(1),fullName:'Zoe'}})),{role:'cleans',person:{userId:id(1),fullName:'Zoe'}});
 assert.equal(readSavedView('cleans'),null,'the older saved form is ignored');
 assert.equal(readSavedView(JSON.stringify({role:'super_admin',person:null})),null);
 assert.equal(readSavedView(null),null);
});
