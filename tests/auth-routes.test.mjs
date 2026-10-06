import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const state={}; globalThis.__rechargeSecurityTest=state;
const user={id:'11111111-1111-4111-8111-111111111111',email:'staff@example.com',email_confirmed_at:'2026-10-06'};
const identity={user,sessionId:'22222222-2222-4222-8222-222222222222'};
const mocks={
  '@/lib/auth-security': `const s=globalThis.__rechargeSecurityTest;
    export const authSecurityConfiguration=()=>s.config;
    export const requestQuota=async()=>{if(s.quotaError)throw Error('outage');return s.quota};
    export const securityHash=async(scope,value)=>{s.hashInputs.push([scope,value]);return 'a'.repeat(64)};
    export const providerIdentity=async()=>s.identity;
    export const passwordDecision=async(name,args)=>{s.events.push([name,args]);return name==='auth_server_begin_password'?s.begin:s.finish};
    export const recoveryPhase=async input=>{s.events.push([input.phase,input]);return input.phase==='begin'?s.proofAllowed:true};`,
  '@/lib/supabase-server': `const s=globalThis.__rechargeSecurityTest;
    export const supabaseConfiguration=()=>null;
    export const workspaceSupabase=async()=>({auth:{
      signInWithPassword:async input=>{s.authCalls++;s.providerInput=input;return {error:s.providerError}},
      resetPasswordForEmail:async(email,options)=>{s.authCalls++;s.providerInput={email,options};return {error:s.providerError}},
      updateUser:async input=>{s.authCalls++;s.events.push(['update-password']);return {error:s.providerError}},
      signOut:async()=>{s.signOutCalls++;return {error:null}}
    }});`,
  'next/headers': `export const cookies=async()=>({get:()=>({value:globalThis.__rechargeSecurityTest.proof})});`,
};
const vite=await createServer({configFile:false,appType:'custom',root,resolve:{alias:{'@':root}},server:{middlewareMode:true,hmr:false},plugins:[{
  name:'isolated-auth-provider',enforce:'pre',
  transform(code,id){const path=id.replaceAll('\\','/');if(!path.includes('/app/api/session/')&&!path.endsWith('/proxy.ts'))return null;for(const key of Object.keys(mocks))code=code.replaceAll('from "'+key+'"','from "security-test:'+key+'"');return {code,map:null};},
  resolveId(id){return id.startsWith('security-test:')?'\0'+id:null;},
  load(id){return id.startsWith('\0security-test:')?mocks[id.slice(15)]:null;},
}]});
after(async()=>{delete globalThis.__rechargeSecurityTest;await vite.close();});
const login=await vite.ssrLoadModule('/app/api/session/route.ts');
const recovery=await vite.ssrLoadModule('/app/api/session/recovery/route.ts');
const password=await vite.ssrLoadModule('/app/api/session/password/route.ts');
const {proxy}=await vite.ssrLoadModule('/proxy.ts');
function reset(){Object.assign(state,{config:{origin:'https://recharge.example'},quota:{allowed:true,retryAfter:0},begin:{allowed:true,retryAfter:0},finish:{allowed:true,retryAfter:0},identity,providerError:null,quotaError:false,authCalls:0,signOutCalls:0,events:[],hashInputs:[],proofAllowed:true,proof:'33333333-3333-4333-8333-333333333333'});}
function request(path,body,origin='https://recharge.example'){return new Request('https://recharge.example'+path,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});}
const credentials={email:' STAFF@EXAMPLE.COM ',password:'synthetic-test-password'};
test('login refuses forged origins and missing security configuration before provider access',async()=>{
  reset();assert.equal((await login.POST(request('/api/session',credentials,'https://attacker.example'))).status,403);assert.equal(state.authCalls,0);
  state.config=null;assert.equal((await login.POST(request('/api/session',credentials))).status,503);assert.equal(state.authCalls,0);
});
test('locked account cannot try even a correct password or obtain a new provider session',async()=>{
  reset();state.begin={allowed:false,locked:true,retryAfter:86400};const response=await login.POST(request('/api/session',credentials));
  assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'86400');assert.equal(state.authCalls,0);assert.match((await response.json()).error,/reset your password/);
});
test('invalid credentials count as a failure and the fifth failure returns the 24-hour lock',async()=>{
  reset();state.providerError={code:'invalid_credentials',message:'private provider details'};state.identity=null;state.finish={allowed:false,locked:true,retryAfter:86400};
  const response=await login.POST(request('/api/session',credentials));assert.equal(response.status,429);
  assert.equal(state.providerInput.email,'staff@example.com');assert.equal(state.events[1][1].outcome,'failure');assert.ok(!JSON.stringify(state.events).includes(credentials.password));assert.ok(!(await response.text()).includes('private provider details'));
});
test('provider outages and quota outages fail closed without treating them as bad passwords',async()=>{
  reset();state.providerError={code:'unexpected_failure'};state.identity=null;state.finish={allowed:false,retryAfter:0};
  assert.equal((await login.POST(request('/api/session',credentials))).status,503);assert.equal(state.events[1][1].outcome,'unavailable');
  reset();state.quotaError=true;assert.equal((await login.POST(request('/api/session',credentials))).status,503);assert.equal(state.authCalls,0);
});
test('login succeeds only after the verified session is approved by the durable guard',async()=>{
  reset();assert.equal((await login.POST(request('/api/session',credentials))).status,200);assert.equal(state.events[1][1].session_id,identity.sessionId);
  reset();state.finish={allowed:false,locked:true,retryAfter:86400};assert.equal((await login.POST(request('/api/session',credentials))).status,429);assert.equal(state.signOutCalls,1);
});
test('recovery sends a canonical redirect and conceals existence and provider delivery failures',async()=>{
  reset();state.providerError={message:'unknown private account'};const response=await recovery.POST(request('/api/session/recovery',{email:'staff@example.com'}));
  assert.equal(response.status,200);assert.equal(state.providerInput.options.redirectTo,'https://recharge.example/auth/recovery');assert.ok(!(await response.text()).includes('unknown private account'));
  reset();state.quota={allowed:false,retryAfter:3600};assert.equal((await recovery.POST(request('/api/session/recovery',{email:'staff@example.com'}))).status,429);assert.equal(state.authCalls,0);
});
test('a missing or invalid recovery proof cannot change a password or unlock an account',async()=>{
  reset();state.proof='invalid';assert.equal((await password.POST(request('/api/session/password',{password:'synthetic-new-password'}))).status,403);assert.equal(state.authCalls,0);
  reset();state.proofAllowed=false;assert.equal((await password.POST(request('/api/session/password',{password:'synthetic-new-password'}))).status,403);assert.equal(state.authCalls,0);assert.deepEqual(state.events.map(e=>e[0]),['begin']);
});
test('only successful password replacement clears lockout, invalidates sessions and consumes the proof',async()=>{
  reset();const response=await password.POST(request('/api/session/password',{password:'synthetic-new-password'}));assert.equal(response.status,200);assert.deepEqual(state.events.map(e=>e[0]),['begin','update-password','complete']);assert.equal(state.signOutCalls,1);assert.match(response.headers.get('set-cookie'),/Max-Age=0/i);
  reset();state.providerError={message:'weak password'};assert.equal((await password.POST(request('/api/session/password',{password:'synthetic-new-password'}))).status,400);assert.deepEqual(state.events.map(e=>e[0]),['begin','update-password','release']);assert.equal(state.signOutCalls,0);
});
test('global API limiter blocks cross-origin mutations and excessive reads before route handling',async()=>{
  reset();const bad=new NextRequest('https://recharge.example/api/property-database',{method:'POST',headers:{origin:'https://attacker.example'}});assert.equal((await proxy(bad)).status,403);
  state.quota={allowed:false,retryAfter:42};const r=await proxy(new NextRequest('https://recharge.example/api/property-database'));assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'42');
  state.config=null;assert.equal((await proxy(new NextRequest('https://recharge.example/api/access'))).status,503);
});
test('page protections do not overwrite private API file sandbox/frame policies',async()=>{
  reset();const page=await proxy(new NextRequest('https://recharge.example/sign-in'));assert.equal(page.headers.get('x-frame-options'),'DENY');assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const file=await proxy(new NextRequest('https://recharge.example/api/onboarding/files/test'));assert.equal(file.headers.get('content-security-policy'),null);assert.equal(file.headers.get('x-frame-options'),null);assert.equal(file.headers.get('referrer-policy'),'no-referrer');assert.equal(file.headers.get('cache-control'),'private, no-store');
});
