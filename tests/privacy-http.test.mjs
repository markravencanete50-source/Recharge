import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';

// "Delete my account" and "Download my data" over HTTP: transport, session, quota, the typed
// DELETE, the password lockout guard, the server-only deletion and removing the sign-in.
const root=fileURLToPath(new URL('..',import.meta.url));
const state={};globalThis.__privacyHttpTest=state;
const mocks={
 'auth-security':`const s=globalThis.__privacyHttpTest;
  export const authSecurityConfiguration=()=>s.config;
  export const requestQuota=async(request,scope)=>{s.quotas.push(scope);return s.quota};
  export const securityHash=async()=>'a'.repeat(64);
  export const passwordDecision=async(name,args)=>{s.events.push([name,args]);return name==='auth_server_begin_password'?s.begin:s.finish};`,
 'supabase-server':`const s=globalThis.__privacyHttpTest;export const verifiedWorkspaceUser=async()=>s.signedIn?s.user:null;export const workspaceSupabase=async()=>s.client;`,
 'native-session':`const s=globalThis.__privacyHttpTest;export {workspaceAccountSchema} from '/lib/workspace-account-policy.ts';
  export const nativeWorkspace=async()=>s.signedIn?{account:s.account,client:s.client}:null;
  export const nativeProvider=()=>s.verifier;
  export const nativeIdentity=async()=>s.verifiedAs?{user:{id:s.verifiedAs},sessionId:'33333333-3333-4333-8333-333333333333'}:null;`,
 '@supabase/supabase-js':`const s=globalThis.__privacyHttpTest;export const createClient=()=>s.service;`,
};
const vite=await createServer({configFile:false,appType:'custom',root,resolve:{alias:{'@':root}},server:{middlewareMode:true,hmr:false},plugins:[{
 name:'privacy-http-test',enforce:'pre',transform(code,id){if(!/\/lib\/(privacy-server|business-server)\.ts$/.test(id.replaceAll('\\','/')))return null;
  for(const name of Object.keys(mocks))for(const quote of ["'",'"'])code=code.replaceAll(`from ${quote}${name.startsWith('@')?name:'./'+name}${quote}`,`from 'privacy-test:${name}'`);return {code,map:null};},
 resolveId:id=>id.startsWith('privacy-test:')?'\0'+id:null,load:id=>id.startsWith('\0privacy-test:')?mocks[id.slice(14)]:null,
}]});
after(async()=>{delete globalThis.__privacyHttpTest;await vite.close();});
const web=await vite.ssrLoadModule('/app/api/session/delete-account/route.ts');
const app=await vite.ssrLoadModule('/app/api/workspace/privacy/route.ts');
const phone=await vite.ssrLoadModule('/app/api/mobile/privacy/route.ts');
const userId='11111111-1111-4111-8111-111111111111';
const token='header.payload.signature-for-tests';
function reset(){
 Object.assign(state,{config:{origin:'https://recharge.example',url:'https://db.example',key:'sb_secret_test'},quota:{allowed:true,retryAfter:0},quotas:[],events:[],calls:[],deletes:[],signOuts:0,
  begin:{allowed:true,retryAfter:0},finish:{allowed:true,retryAfter:0},signedIn:true,verifiedAs:userId,passwordError:null,
  user:{id:userId,email:'Owner@Example.com',email_confirmed_at:'2026-10-01'},
  account:{userId,email:'owner@example.com',fullName:'Owner',responsibilities:'',role:'client',status:'active',modules:['client-dashboard']},
  summary:{role:'client',status:'active',lastSuperAdmin:false,properties:2,liveProperties:1},deleteResult:{data:{userId,removable:false,propertiesKept:2},error:null},hardDeleteError:null,softDeleteError:null});
 state.client={rpc:async(name,args)=>{state.calls.push([name,args]);
   if(name==='workspace_account')return {data:state.account,error:null};
   if(name==='workspace_privacy_read')return {data:args.section==='deletion'?state.summary:{profile:{userId}},error:null};
   return {data:null,error:{code:'42883'}};},
  auth:{getUser:async jwt=>{state.calls.push(['getUser',jwt??null]);return {data:{user:state.user},error:null};},signOut:async()=>{state.signOuts++;return {error:null};}}};
 state.verifier={auth:{signInWithPassword:async input=>{state.calls.push(['signIn',input.email??input.phone]);return state.passwordError?{data:{session:null},error:state.passwordError}:{data:{session:{access_token:'verification-token'}},error:null};},signOut:async()=>({error:null})}};
 state.service={rpc:async(name,args)=>{state.calls.push(['service:'+name,args]);return name==='workspace_delete_own_account'?state.deleteResult:{data:null,error:null};},
  auth:{admin:{deleteUser:async(id,soft)=>{state.deletes.push([id,Boolean(soft)]);return {data:{},error:soft?state.softDeleteError:state.hardDeleteError};}}}};
}
const body={confirm:'DELETE',password:'synthetic-test-password'};
const webPost=(input=body,origin='https://recharge.example')=>new Request('https://recharge.example/api/session/delete-account',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(input)});
const nativePost=(input=body)=>new Request('https://recharge.example/api/mobile/privacy',{method:'POST',headers:{'x-recharge-client':'native',authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(input)});
const serviceCalls=()=>state.calls.filter(c=>c[0].startsWith('service:')).map(c=>c[0]);

test('deletion needs a same-origin POST (or the native transport) and a signed-in session',async()=>{
 reset();assert.equal((await web.POST(webPost(body,'https://attacker.example'))).status,403);assert.equal(state.calls.length,0);
 reset();assert.equal((await phone.POST(new Request('https://recharge.example/api/mobile/privacy',{method:'POST',headers:{origin:'https://recharge.example','content-type':'application/json'},body:JSON.stringify(body)}))).status,403,'a browser cannot use the phone route');
 reset();state.signedIn=false;assert.equal((await web.POST(webPost())).status,401);assert.equal(state.events.length,0);
 reset();state.config=null;assert.equal((await app.POST(webPost())).status,503);
});

test('deletion is rate limited per person and needs DELETE typed exactly',async()=>{
 reset();state.quota={allowed:false,retryAfter:1200};const limited=await web.POST(webPost());
 assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'1200');assert.deepEqual(state.quotas,['account-deletion-user']);assert.equal(state.events.length,0);
 for(const bad of [{...body,confirm:'delete'},{confirm:'DELETE'},{...body,extra:true}]){reset();const response=await web.POST(webPost(bad));assert.equal(response.status,400,JSON.stringify(bad));assert.equal(state.events.length,0);}
 reset();assert.match((await (await web.POST(webPost({...body,confirm:'yes'}))).json()).error,/Type DELETE/);
});

test('the last super admin is refused before any password check',async()=>{
 reset();state.summary={...state.summary,role:'super_admin',lastSuperAdmin:true};
 const response=await web.POST(webPost());assert.equal(response.status,409);assert.match((await response.json()).error,/only super admin/);
 assert.equal(state.events.length,0);assert.deepEqual(serviceCalls(),[]);assert.deepEqual(state.deletes,[]);
});

test('the password goes through the lockout guard; a wrong one deletes nothing',async()=>{
 reset();state.passwordError={code:'invalid_credentials'};state.verifiedAs=null;state.finish={allowed:false,retryAfter:0};
 const response=await web.POST(webPost());assert.equal(response.status,401);
 assert.deepEqual(state.events.map(e=>e[0]),['auth_server_begin_password','auth_server_finish_password']);assert.equal(state.events[1][1].outcome,'failure');
 assert.ok(state.calls.some(c=>c[0]==='signIn'&&c[1]==='owner@example.com'),'checked against the account’s own email');
 assert.ok(!JSON.stringify(state.events).includes(body.password));assert.deepEqual(serviceCalls(),[]);assert.deepEqual(state.deletes,[]);
 reset();state.begin={allowed:false,locked:true,retryAfter:86400};const locked=await web.POST(webPost());
 assert.equal(locked.status,429);assert.equal(locked.headers.get('retry-after'),'86400');assert.equal(state.calls.filter(c=>c[0]==='signIn').length,0);
});

test('a confirmed deletion anonymises in the database, then closes the sign-in and signs out',async()=>{
 reset();const response=await web.POST(webPost());assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
 assert.equal(state.events[1][1].outcome,'success');
 assert.deepEqual(state.calls.find(c=>c[0]==='service:workspace_delete_own_account')[1],{target:userId});
 assert.deepEqual(state.deletes,[[userId,true]],'records refer to the person, so the sign-in is closed, not removed');
 assert.deepEqual(state.calls.find(c=>c[0]==='service:workspace_account_deletion_signin')[1],{target:userId,outcome:'closed'});
 assert.equal(state.signOuts,1,'this browser’s cookies are cleared');
 // Nobody else's id can be sent: the target always comes from the session.
 reset();state.user={...state.user,id:'99999999-9999-4999-8999-999999999999'};assert.equal((await web.POST(webPost())).status,401);assert.deepEqual(serviceCalls(),[]);
});

test('with no history the sign-in is removed outright, falling back to closing it',async()=>{
 reset();state.deleteResult={data:{userId,removable:true},error:null};assert.equal((await app.POST(webPost())).status,200);
 assert.deepEqual(state.deletes,[[userId,false]]);assert.equal(state.calls.find(c=>c[0]==='service:workspace_account_deletion_signin')[1].outcome,'deleted');
 reset();state.deleteResult={data:{userId,removable:true},error:null};state.hardDeleteError={message:'Database error deleting user'};
 assert.equal((await app.POST(webPost())).status,200);assert.deepEqual(state.deletes,[[userId,false],[userId,true]]);
});

test('a database refusal is passed on and the sign-in is left alone',async()=>{
 reset();state.deleteResult={data:null,error:{code:'42501',message:'You are the only super admin. Make someone else a super admin first, then delete your account.'}};
 const response=await web.POST(webPost());assert.equal(response.status,403);assert.match((await response.json()).error,/only super admin/);assert.deepEqual(state.deletes,[]);
});

test('the phone app deletes with its own token and never touches cookies',async()=>{
 reset();const response=await phone.POST(nativePost());assert.equal(response.status,200);
 assert.ok(state.calls.some(c=>c[0]==='getUser'&&c[1]===token));assert.equal(state.signOuts,0);assert.deepEqual(state.deletes,[[userId,true]]);
});

test('download my data is the person’s own copy, a few times an hour',async()=>{
 reset();const response=await app.GET(new Request('https://recharge.example/api/workspace/privacy?section=export'));
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{data:{profile:{userId}}});assert.deepEqual(state.quotas,['data-export-user']);
 assert.match(response.headers.get('cache-control'),/no-store/);
 reset();state.quota={allowed:false,retryAfter:600};assert.equal((await app.GET(new Request('https://recharge.example/api/workspace/privacy?section=export'))).status,429);
 reset();assert.equal((await app.GET(new Request('https://recharge.example/api/workspace/privacy?section=deletion'))).status,200);assert.deepEqual(state.quotas,[],'the deletion summary is a light read');
 reset();assert.equal((await app.GET(new Request('https://recharge.example/api/workspace/privacy?section=everything'))).status,400);
 reset();state.signedIn=false;assert.equal((await phone.GET(new Request('https://recharge.example/api/mobile/privacy?section=export'))).status,401);
});

test('policy schemas, copy, legal details and routing',async()=>{
 const {deleteAccountSchema,privacyReadSchema,deletionCopy,exportFileName}=await vite.ssrLoadModule('/lib/privacy-policy.ts');
 assert.equal(deleteAccountSchema.safeParse(body).success,true);
 assert.equal(deleteAccountSchema.safeParse({...body,userId}).success,false,'no other account can be named');
 assert.equal(privacyReadSchema.safeParse({section:'export',userId}).success,false);
 const owner=deletionCopy({role:'client',properties:2,lastSuperAdmin:false});
 assert.match(owner.properties,/2 properties stay/);assert.match(owner.properties,/does not end your management agreement/);assert.match(owner.kept.join(' '),/6 years/);
 assert.equal(deletionCopy({role:'stays',properties:0,lastSuperAdmin:false}).properties,'');
 assert.match(deletionCopy({role:'super_admin',properties:0,lastSuperAdmin:true}).blocked,/only super admin/);
 assert.equal(exportFileName(new Date('2026-10-10T09:00:00Z')),'Recharge-my-data-2026-10-10.json');
 const legal=await vite.ssrLoadModule('/lib/legal-details.ts');
 assert.deepEqual(Object.keys(legal.legalDetails).sort(),['companyNumber','contactEmail','dataProtectionContact','icoRegistrationNumber','lastUpdated','legalName','registeredAddress','tradingName']);
 assert.equal(legal.legalDetails.tradingName,'Recharge');
 assert.equal(legal.legalDetailsComplete,Object.values(legal.legalDetails).every(v=>v!=='TO BE CONFIRMED'));
 const {backendRouteAllowed}=await vite.ssrLoadModule('/worker/backend-route-policy.ts');
 for(const path of ['/privacy','/terms','/delete-account','/api/session/delete-account','/api/workspace/privacy','/api/mobile/privacy'])assert.equal(backendRouteAllowed(path),true,path);
 const {noticeCopy}=await vite.ssrLoadModule('/lib/notice-copy.ts');
 for(const type of ['account.owner_deleted','account.staff_deleted'])assert.notEqual(noticeCopy(type).title,'Update in Recharge',type);
});
