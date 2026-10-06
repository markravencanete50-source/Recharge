import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const state={};globalThis.__phoneRecoveryTest=state;
const mocks={
 'auth-security':`const s=globalThis.__phoneRecoveryTest;export const requestQuota=async(...args)=>{s.quotas.push(args);return s.quota};export const securityHash=async(scope,value)=>{s.hashes.push([scope,value]);return 'a'.repeat(64)};export const recoveryPhase=async input=>{s.phases.push(input);return s.proofAllowed};`,
 'registration-provider':`const s=globalThis.__phoneRecoveryTest;export const registrationConfiguration=()=>s.config;export const registrationProvider=()=>({auth:{signInWithOtp:async input=>{s.requests.push(input);return {error:s.sendError}},verifyOtp:async input=>{s.verifies.push(input);return s.verified},getClaims:async()=>s.claims,updateUser:async input=>{s.updates.push(input);return {error:s.updateError}},signOut:async input=>{s.signouts.push(input);return {error:null}}}});`,
};
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},plugins:[{
 name:'phone-recovery-test',enforce:'pre',transform(code,id){if(!id.replaceAll('\\','/').endsWith('/lib/phone-recovery-server.ts'))return;
 for(const name of Object.keys(mocks))code=code.replaceAll(`from './${name}'`,`from 'phone-test:${name}'`);return {code,map:null};},
 resolveId:id=>id.startsWith('phone-test:')?'\0'+id:null,load:id=>id.startsWith('\0phone-test:')?mocks[id.slice(12)]:null,
}]});
after(async()=>{delete globalThis.__phoneRecoveryTest;await vite.close();});
const {phoneRecovery}=await vite.ssrLoadModule('/lib/phone-recovery-server.ts');
const phone='+447123456789',token='synthetic-access-token';
const user={id:'11111111-1111-4111-8111-111111111111',phone:phone.slice(1),phone_confirmed_at:'2026-10-06'};
const body={action:'verify',phone,code:'123456',password:'Synthetic-new-password'};
function reset(){Object.assign(state,{config:{origin:'https://recharge.example',phoneEnabled:true},quota:{allowed:true,retryAfter:0},requests:[],quotas:[],hashes:[],phases:[],verifies:[],updates:[],signouts:[],proofAllowed:true,sendError:null,updateError:null,verified:{data:{user,session:{access_token:token}},error:null},claims:{data:{claims:{sub:user.id,session_id:'22222222-2222-4222-8222-222222222222'}},error:null}});}
const request=(body,native=false,headers={})=>new Request('https://recharge.example'+(native?'/api/mobile/recovery':'/api/session/phone-recovery'),{method:'POST',headers:{'content-type':'application/json',...(native?{'x-recharge-client':'native'}:{origin:'https://recharge.example'}),...headers},body:JSON.stringify(body)});

test('SMS recovery stays disabled without configuration and refuses forged transports',async()=>{
 reset();state.config.phoneEnabled=false;assert.equal((await phoneRecovery(request(body))).status,503);assert.equal(state.verifies.length,0);
 reset();assert.equal((await phoneRecovery(request(body,false,{origin:'https://attacker.example'}))).status,403);
 assert.equal((await phoneRecovery(request(body,true,{cookie:'ambient=web'}),true)).status,403);assert.equal(state.verifies.length,0);
});
test('reset requests conceal account existence and never create an account',async()=>{
 for(const error of [null,{code:'user_not_found'}]){reset();state.sendError=error;const response=await phoneRecovery(request({action:'request',phone}));assert.equal(response.status,200);assert.deepEqual(state.requests,[{phone,options:{shouldCreateUser:false}}]);assert.ok(!(await response.text()).includes('user_not_found'));assert.equal(state.updates.length,0);}
});
test('bad OTPs, unconfirmed phones and mismatched sessions never change passwords',async()=>{
 for(const patch of [{error:{code:'otp_expired'}},{data:{user:{...user,phone_confirmed_at:undefined},session:{access_token:token}}},{data:{user:{...user,phone:'+447123456788'},session:{access_token:token}}}]){
 reset();state.verified={...state.verified,...patch};assert.equal((await phoneRecovery(request(body))).status,403);assert.equal(state.updates.length,0);assert.equal(state.phases.length,0);}
 reset();state.claims.data.claims.sub='33333333-3333-4333-8333-333333333333';assert.equal((await phoneRecovery(request(body))).status,403);assert.equal(state.updates.length,0);
});
test('successful SMS reset consumes a verified proof and returns no workspace token',async()=>{
 for(const native of [false,true]){reset();const response=await phoneRecovery(request(body,native),native);assert.equal(response.status,200);
 assert.deepEqual(state.phases.map(p=>p.phase),['create','begin','complete']);assert.deepEqual(state.updates,[{password:body.password}]);assert.deepEqual(state.signouts,[{scope:'global'}]);
 assert.equal(state.hashes.at(-1)[1],phone);assert.match(response.headers.get('cache-control'),/no-store/);assert.ok(!(await response.text()).includes(token));}
});
test('quotas and provider password failures release proofs without approving a session',async()=>{
 reset();state.quota={allowed:false,retryAfter:600};const limited=await phoneRecovery(request(body));assert.equal(limited.status,429);assert.equal(limited.headers.get('Retry-After'),'600');assert.equal(state.verifies.length,0);
 reset();state.updateError={code:'weak_password'};assert.equal((await phoneRecovery(request(body))).status,400);assert.deepEqual(state.phases.map(p=>p.phase),['create','begin','release']);assert.deepEqual(state.signouts,[{scope:'local'}]);
 reset();state.proofAllowed=false;assert.equal((await phoneRecovery(request(body))).status,503);assert.equal(state.updates.length,0);
});
