import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const state={env:{}};globalThis.__integrationHttp=state;
const mocks={
 'business-server':`const s=globalThis.__integrationHttp;export const businessContext=async()=>s.session;export const businessResponse=(body,status=200)=>Response.json(body,{status});export const databaseFailure=()=>Response.json({error:'denied'},{status:403});`,
 'auth-security':`const s=globalThis.__integrationHttp;export const authSecurityConfiguration=()=>({origin:'https://recharge.example'});export const requestQuota=async()=>s.quota;export const securityRpc=async(name,args)=>{s.calls.push({name,args});return 'verified-evidence';};`,
 'hostaway':`export const listHostawayReservations=async()=>{globalThis.__integrationHttp.providerCalls++;return [];};`,
 'integration-providers':`export const uploadPrivatePhoto=async(settings,publicId,bytes,format)=>{globalThis.__integrationHttp.providerCalls++;return {assetId:'verified',publicId,version:1,bytes:bytes.length,format};};export const deliverNotification=async()=>{throw Error('Unexpected delivery');};export const downloadPrivatePhoto=async()=>new Uint8Array([255,216,255,...Array(13).fill(0)]);`,
 'hostaway-sync':`const s=globalThis.__integrationHttp;export const hostawaySyncConfigured=()=>Boolean(s.env.HOSTAWAY_ACCOUNT_ID&&s.env.HOSTAWAY_API_KEY&&s.env.HOSTAWAY_SYNC_ENABLED==='true');export const runHostawaySync=async(trigger)=>{s.providerCalls++;s.calls.push({name:'runHostawaySync',args:{trigger}});return {newReservations:0};};`,
 'cloudflare:workers':`export const env=globalThis.__integrationHttp.env;`,
};
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},plugins:[{
 name:'isolated-integration-http',enforce:'pre',transform(code,id){if(!/\/(integration|media)-server\.ts$/.test(id.replaceAll('\\','/')))return;
 for(const name of Object.keys(mocks)){const original=name==='cloudflare:workers'?name:'./'+name;code=code.replaceAll(`from '${original}'`,`from 'integration-test:${name}'`);}return {code,map:null};},
 resolveId:id=>id.startsWith('integration-test:')?'\0'+id:null,load:id=>id.startsWith('\0integration-test:')?mocks[id.slice(18)]:null,
}]});
const {integrationRoute}=await vite.ssrLoadModule('/lib/integration-server.ts');
const {mediaRoute}=await vite.ssrLoadModule('/lib/media-server.ts');
after(async()=>{delete globalThis.__integrationHttp;await vite.close();});
const uuid='11111111-1111-4111-8111-111111111111';
function reset(role='super_admin',status='active'){
 for(const k of Object.keys(state.env))delete state.env[k];
 Object.assign(state,{calls:[],providerCalls:0,quota:{allowed:true},session:{account:{role,status,userId:uuid,modules:['direct-bookings']},client:{rpc:async(name,args)=>{state.calls.push({name,args});return {data:{id:uuid,publicId:'recharge/'+uuid},error:null};}}}});
}
const post=(value,origin='https://recharge.example')=>new Request('https://recharge.example/api/workspace/integrations',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
test('new web/native integration routes reject forged origins, unverified and inactive sessions',async()=>{
 for(const route of [integrationRoute,mediaRoute]){
  reset();assert.equal((await route(post({},'https://evil.example'))).status,403);assert.equal((await route(post({}),true)).status,403);
  state.session=null;assert.equal((await route(new Request('https://recharge.example/api/workspace/media'))).status,401);
  for(const status of ['pending','revoked']){reset('super_admin',status);assert.equal((await route(new Request('https://recharge.example/api/workspace/media'))).status,403);assert.equal(state.calls.length,0);}
 }
});
test('unconfigured services neither send notifications nor upload/import provider data',async()=>{
 reset();const response=await integrationRoute(post({action:'dispatchNotifications'}));assert.deepEqual(await response.json(),{mode:'unconfigured',processed:0});
 assert.equal((await integrationRoute(post({action:'importReservations',propertyId:uuid}))).status,503);
 assert.equal((await mediaRoute(post({}))).status,503);assert.equal(state.providerCalls,0);assert.equal(state.calls.length,0);
});
test('notifications are admin-only; imports require Stays permissions; unknown fields and quotas fail closed',async()=>{
 reset('client');assert.equal((await integrationRoute(post({action:'dispatchNotifications'}))).status,403);
 assert.equal((await integrationRoute(post({action:'importReservations',propertyId:uuid}))).status,403);
 reset();assert.equal((await integrationRoute(post({action:'dispatchNotifications',destination:'evil@example.com'}))).status,400);
 state.quota.allowed=false;assert.equal((await integrationRoute(post({action:'dispatchNotifications'}))).status,429);assert.equal(state.calls.length,0);
});
function enableMedia(){Object.assign(state.env,{MEDIA_UPLOADS_ENABLED:'true',CLOUDINARY_CLOUD_NAME:'test',CLOUDINARY_API_KEY:'test',CLOUDINARY_API_SECRET:'test'});}
function photoForm(bytes=new Uint8Array([255,216,255,...Array(13).fill(0)])){
 const form=new FormData();form.set('workId',uuid);form.set('requestId',uuid);form.set('purpose','cleaning');form.set('photo',new Blob([bytes]),'file.jpg');return form;
}
const photoRequest=form=>new Request('https://recharge.example/api/workspace/media',{method:'POST',headers:{origin:'https://recharge.example'},body:form});
test('multipart upload rejects URLs, active files, duplicate fields and oversized streams',async()=>{
 reset('cleans');enableMedia();assert.equal((await mediaRoute(post({photo:'https://evil.example/photo.jpg'}))).status,400);
 assert.equal((await mediaRoute(photoRequest(photoForm(new TextEncoder().encode('<svg><script>bad</script></svg>'))))).status,400);
 const duplicate=photoForm();duplicate.append('workId',uuid);assert.equal((await mediaRoute(photoRequest(duplicate))).status,400);
 const large=new Request('https://recharge.example/api/workspace/media',{method:'POST',headers:{origin:'https://recharge.example','Content-Type':'multipart/form-data; boundary=test'},body:new Uint8Array(8*1024*1024+100000)});assert.equal((await mediaRoute(large)).status,413);
 assert.equal(state.providerCalls,0);assert.equal(state.calls.length,0);
});
test('photo commit follows database permission approval and returns only verified evidence ID',async()=>{
 reset('cleans');enableMedia();const response=await mediaRoute(photoRequest(photoForm()));assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{id:'verified-evidence',verified:true});assert.equal(state.calls[0].name,'workspace_prepare_upload');assert.match(state.calls[0].args.input.contentHash,/^[a-f0-9]{64}$/);
 assert.equal(state.calls[1].name,'integration_commit_upload');assert.equal(state.providerCalls,1);
 reset('cleans');enableMedia();state.session.client.rpc=async()=>({error:{code:'42501'}});assert.equal((await mediaRoute(photoRequest(photoForm()))).status,403);assert.equal(state.providerCalls,0);
});
test('Sync now is admin-only and waits for the Hostaway keys',async()=>{
 reset('stays');assert.equal((await integrationRoute(post({action:'syncHostaway'}))).status,403);
 reset();assert.equal((await integrationRoute(post({action:'syncHostaway'}))).status,503);assert.equal(state.providerCalls,0);
 Object.assign(state.env,{HOSTAWAY_ACCOUNT_ID:'1',HOSTAWAY_API_KEY:'k'});assert.equal((await integrationRoute(post({action:'syncHostaway'}))).status,503,'switched off by default');
 state.env.HOSTAWAY_SYNC_ENABLED='true';
 const response=await integrationRoute(post({action:'syncHostaway'}));
 assert.equal(response.status,200);assert.deepEqual(state.calls,[{name:'runHostawaySync',args:{trigger:'manual'}}]);
});
