import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),state={};globalThis.__nativeAuthTest=state;
const identity={user:{id:'11111111-1111-4111-8111-111111111111',email:'person@example.com',email_confirmed_at:'2026-10-06'},sessionId:'22222222-2222-4222-8222-222222222222'};
const mocks={
 '@/lib/auth-security':`const s=globalThis.__nativeAuthTest;export const authSecurityConfiguration=()=>s.config;export const requestQuota=async()=>s.quota;export const securityHash=async(scope,value)=>{s.hash=[scope,value];return 'a'.repeat(64)};export const passwordDecision=async(name,args)=>{s.calls.push([name,args]);return name.endsWith('begin_password')?s.begin:s.finish};`,
 '@/lib/native-session':`const s=globalThis.__nativeAuthTest;export const nativeIdentity=async()=>s.identity;export const nativeWorkspace=async()=>s.workspace;
 const client={auth:{signInWithPassword:async args=>{s.signins++;s.credentials=args;return s.provider},refreshSession:async args=>{s.refreshes++;return s.provider},signOut:async()=>{s.signouts++;return {error:null}},admin:{signOut:async(token,scope)=>{s.signouts++;s.logout=[token,scope];return {error:s.logoutError}}},},rpc:async name=>name==='workspace_session_allowed'?{data:s.allowed,error:null}:{data:s.account,error:s.accountError}};export const nativeProvider=()=>client;`,
};
const vite=await createServer({configFile:false,appType:'custom',root,resolve:{alias:{'@':root}},server:{middlewareMode:true,hmr:false},plugins:[{name:'native-auth-test',enforce:'pre',transform(code,id){if(!id.replaceAll('\\','/').endsWith('/app/api/mobile/session/route.ts'))return null;for(const key of Object.keys(mocks))code=code.replaceAll('from "'+key+'"','from "native-test:'+key+'"');return {code,map:null}},resolveId:id=>id.startsWith('native-test:')?'\0'+id:null,load:id=>id.startsWith('\0native-test:')?mocks[id.slice(13)]:null}]});
after(async()=>{delete globalThis.__nativeAuthTest;await vite.close()});
const route=await vite.ssrLoadModule('/app/api/mobile/session/route.ts');
const policy=await vite.ssrLoadModule('/lib/native-request-policy.ts');
const accessToken='synthetic.access.'+'a'.repeat(40),refreshToken='r'.repeat(40);
function reset(){Object.assign(state,{config:{origin:'https://recharge.example'},quota:{allowed:true,retryAfter:0},begin:{allowed:true,retryAfter:0},finish:{allowed:true,retryAfter:0},identity,provider:{data:{session:{access_token:accessToken,refresh_token:refreshToken,expires_at:1880000000}},error:null},allowed:true,signins:0,signouts:0,refreshes:0,calls:[],account:{userId:identity.user.id,email:identity.user.email,fullName:'Example',responsibilities:'',modules:[],role:'client',status:'pending'},accountError:null,logoutError:null,workspace:null})}
function request(body,headers={}){return new Request('https://recharge.example/api/mobile/session',{method:'POST',headers:{'content-type':'application/json','x-recharge-client':'native',...headers},body:JSON.stringify(body)});}
const login={action:'login',email:' PERSON@EXAMPLE.COM ',password:'synthetic-password'};
test('native transport cannot bypass cookie CSRF or impersonate another API route',async()=>{
 reset();for(const header of [{origin:'https://attacker.example'},{cookie:'ambient=web'},{'sec-fetch-site':'same-origin'},{'x-recharge-client':'web'}])assert.equal((await route.POST(request(login,header))).status,403);
 assert.equal(state.signins,0);assert.equal(policy.isNativeRequest(new Request('https://recharge.example/api/access',{headers:{'x-recharge-client':'native'}})),false);
 assert.equal(policy.bearerToken(request({}, {authorization:'Bearer invalid token'})),null);
});
test('native login shares the durable five-attempt account lock and conceals passwords',async()=>{
 reset();state.begin={allowed:false,locked:true,retryAfter:86400};const blocked=await route.POST(request(login));assert.equal(blocked.status,429);assert.equal(state.signins,0);
 reset();state.identity=null;state.provider.error={code:'invalid_credentials',message:'private details'};state.finish={allowed:false,locked:true,retryAfter:86400};const failed=await route.POST(request(login));assert.equal(failed.status,429);assert.equal(state.calls[1][1].outcome,'failure');assert.equal(state.hash[1],'person@example.com');assert.ok(!JSON.stringify(state.calls).includes(login.password));
});
test('unverified provider sessions never receive approved workspace tokens',async()=>{
 reset();state.identity=null;const response=await route.POST(request(login));assert.equal(response.status,503);assert.equal(state.calls[1][1].outcome,'unavailable');assert.equal(state.signouts,1);assert.ok(!(await response.text()).includes(accessToken));
});
test('guarded success returns only the required session and account with no-store caching',async()=>{
 reset();const response=await route.POST(request(login));assert.equal(response.status,200);const data=await response.json();assert.equal(data.session.accessToken,accessToken);assert.equal(data.session.refreshToken,refreshToken);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.headers.get('set-cookie'),null);assert.equal(data.account.status,'pending');assert.equal(state.calls[1][1].session_id,identity.sessionId);
});

test('phone login uses the same lockout and requires the submitted contact to be verified',async()=>{
 reset();const phone='+447123456789';state.identity={...identity,user:{id:identity.user.id,phone:phone.slice(1),phone_confirmed_at:'2026-10-06'}};state.account.email=null;
 const input={action:'loginPhone',phone,password:'synthetic-password'};
 const response=await route.POST(request(input));assert.equal(response.status,200);assert.equal(state.hash[1],phone);assert.deepEqual(state.credentials,{phone,password:input.password});
 reset();state.identity={...identity,user:{...identity.user,phone}};
 assert.equal((await route.POST(request(input))).status,503);assert.equal(state.calls[1][1].outcome,'unavailable');
 reset();state.begin={allowed:false,locked:true,retryAfter:86400};assert.equal((await route.POST(request(input))).status,429);assert.equal(state.signins,0);
 for(const invalid of [{...input,phone:'07123456789'},{...input,email:'person@example.com'}]){reset();assert.equal((await route.POST(request(invalid))).status,400);assert.equal(state.signins,0);}
});
test('refresh cannot approve a token obtained by bypassing guarded sign-in',async()=>{
 reset();state.allowed=false;const response=await route.POST(request({action:'refresh',refreshToken}));assert.equal(response.status,401);assert.equal(state.signouts,1);assert.equal(state.calls.length,0);assert.ok(!(await response.text()).includes(accessToken));
});
test('refresh returns current database account access and fails closed on invalid access data',async()=>{
 reset();state.account.status='revoked';const response=await route.POST(request({action:'refresh',refreshToken}));assert.equal(response.status,200);assert.equal((await response.json()).account.status,'revoked');
 reset();state.account={role:'super_admin'};const failed=await route.POST(request({action:'refresh',refreshToken}));assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes(accessToken));assert.equal(state.signouts,1);
});
test('quota and provider outages fail closed and do not count as incorrect passwords',async()=>{
 reset();state.quota={allowed:false,retryAfter:42};assert.equal((await route.POST(request(login))).status,429);assert.equal(state.signins,0);
 reset();state.identity=null;state.provider.error={code:'unexpected_failure'};assert.equal((await route.POST(request(login))).status,503);assert.equal(state.calls[1][1].outcome,'unavailable');
});
test('sign-out requires the verified caller and revokes only their current provider session',async()=>{
 reset();assert.equal((await route.POST(request({action:'logout'}))).status,401);
 state.workspace={client:{auth:{admin:{signOut:async(token,scope)=>{state.logout=[token,scope];return {error:null}}}}}};
 const response=await route.POST(request({action:'logout'},{authorization:'Bearer '+accessToken}));assert.equal(response.status,200);assert.deepEqual(state.logout,[accessToken,'local']);
});
