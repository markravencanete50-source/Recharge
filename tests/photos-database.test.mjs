import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Photos on the onboarding journey (the owner's set-up photos, Ready's inspection photos) and
// post photos from a clean, which the owner sees in their Mailbox.
const db=new PGlite();
const roles=['super_admin','client','stays','ready','client','cleans'];
const users=roles.map((_,i)=>`93000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const session=i=>users[i].replace('9300','9400');
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
for(let i=0;i<users.length;i++){
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`photos${i}@example.com`]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)',[session(i),users[i]]);
 await db.query("update public.workspace_profiles set status='active',role=$2 where user_id=$1",[users[i],roles[i]]);
 await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features',[users[i]]);
}
async function as(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(i==='service'?{}:{sub:users[i],session_id:session(i)})]);await db.exec(i==='service'?'set role service_role':'set role authenticated');}
beforeEach(async()=>{await db.exec('reset role');await db.exec('delete from private.workspace_write_limits');});
const rpc=async(name,args=[])=>{const placeholders=args.map((_,i)=>'$'+(i+1)).join(',');return (await db.query(`select public.${name}(${placeholders}) result`,args)).rows[0].result;};
const owner=async(text,args=[])=>{await db.exec('reset role');return (await db.query(text,args)).rows;};
const prepare=(workId,purpose,id=crypto.randomUUID())=>rpc('workspace_prepare_upload',[{requestId:id,workId,purpose,contentHash:'c'.repeat(64)}]);
const commit=async intent=>{await as('service');return rpc('integration_commit_upload',[intent.id,{assetId:'storage:'+intent.publicId+'.jpg',publicId:intent.publicId,version:1,format:'jpg',bytes:2048}]);};

await as(1);
const journey=(await db.query('select public.workspace_journey_action($1::jsonb) result',[JSON.stringify({requestId:crypto.randomUUID(),action:'createEnquiry',name:'Photo flat',address:'Example photo address',propertyType:'Flat',bedrooms:2,bathrooms:1})])).rows[0].result;
await owner("update private.workspace_journeys set stage='form',form=jsonb_build_object('mailPreference','photograph') where work_id=$1",[journey.workId]);
await owner("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,'staff',$4),($1,$3,'cleaner',$4) on conflict do nothing",[journey.propertyId,users[3],users[5],users[0]]);

test('the owner adds set-up photos to their own onboarding; nobody else can',async()=>{
 await as(1);const intent=await prepare(journey.workId,'setup');
 await as(4);await assert.rejects(prepare(journey.workId,'setup'),/denied/,'another owner');
 await as(3);await assert.rejects(prepare(journey.workId,'setup'),/denied/,'Ready adds inspection photos, not set-up ones');
 await as(1);await assert.rejects(prepare(journey.workId,'inspection'),/denied/,'owners do not add inspection photos');
 const id=await commit(intent);
 await as(1);assert.deepEqual((await rpc('workspace_media_read',[journey.workId])).map(x=>[x.id,x.purpose]),[[id,'setup']]);
 assert.equal((await rpc('workspace_media_asset',[id])).providerAssetId,'storage:'+intent.publicId+'.jpg');
 await as(2);assert.equal((await rpc('workspace_media_read',[journey.workId])).length,1,'Stays on the property see it');
 await as(4);await assert.rejects(rpc('workspace_media_read',[journey.workId]),/denied/);await assert.rejects(rpc('workspace_media_asset',[id]),/denied/);
});

test('Ready adds inspection photos once the inspection is booked',async()=>{
 await as(3);await assert.rejects(prepare(journey.workId,'inspection'),/denied/,'not before it is booked');
 await owner("update private.workspace_journeys set stage='inspection_booked' where work_id=$1",[journey.workId]);
 await as(3);const id=await commit(await prepare(journey.workId,'inspection'));
 await as(1);assert.ok((await rpc('workspace_media_read',[journey.workId])).some(x=>x.id===id&&x.purpose==='inspection'),'the owner sees the inspection photos');
 await owner("update private.workspace_journeys set inspection_on=current_date-1 where work_id=$1",[journey.workId]);await owner("update private.workspace_journeys set stage='inspection_complete' where work_id=$1",[journey.workId]);
 await as(1);await assert.rejects(prepare(journey.workId,'setup'),/denied/,'set-up photos close once the inspection is complete');
 await as(3);assert.ok(await prepare(journey.workId,'inspection'),'Ready can still add to the inspection');
});

test('a cleaner attaches post photos; the owner sees them in Mailbox, but not the clean photos',async()=>{
 await as(0);
 const clean=await rpc('workspace_operations_action',[{action:'createOperation',requestId:crypto.randomUUID(),propertyId:journey.propertyId,kind:'cleaning',data:{dueOn:'2026-10-09',checklist:['Kitchen']}}]);
 await rpc('workspace_assign_work',[clean.workId,clean.version,users[5]]);
 await as(5);const photo=await commit(await prepare(clean.workId,'cleaning'));
 await as(5);const post=await commit(await prepare(clean.workId,'mailbox'));
 await as(5);const current=(await rpc('workspace_operations_read',[journey.propertyId])).find(x=>x.workId===clean.workId);
 const submit=data=>rpc('workspace_operations_action',[{action:'updateOperation',requestId:crypto.randomUUID(),workId:clean.workId,version:current.version,step:'submitCleaning',data:{checks:['Kitchen'],report:'Kitchen cleaned',photoIds:[photo],...data}}]);
 await assert.rejects(submit({mailAction:'photograph',mailPhotoIds:[photo]}),/Post photos/,'a clean photo is not a post photo');
 await assert.rejects(submit({mailAction:'none',mailPhotoIds:[post]}),/Post photos/,'only when photographing post');
 await submit({mailAction:'photograph',mailNote:'Two letters',mailPhotoIds:[post]});
 await as(1);const mailbox=(await db.query("select public.workspace_teams_read('mailbox',null,null,null,null) result")).rows[0].result;
 assert.deepEqual(mailbox.find(m=>m.workId===clean.workId).photoIds,[post]);
 assert.deepEqual((await rpc('workspace_media_read',[clean.workId])).map(x=>x.id),[post],'the owner sees only the post photos');
 assert.ok(await rpc('workspace_media_asset',[post]));
 await assert.rejects(rpc('workspace_media_asset',[photo]),/denied/);
 await as(4);await assert.rejects(rpc('workspace_media_asset',[post]),/denied/,'another owner');
});
