import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const state={};globalThis.__propertyDetailsTest=state;
const mocks={
 'supabase-server':`const s=globalThis.__propertyDetailsTest;export const verifiedWorkspaceUser=async()=>s.user;export const workspaceSupabase=async()=>s.client;`,
 'native-session':`const s=globalThis.__propertyDetailsTest;export {workspaceAccountSchema} from '/lib/workspace-account-policy.ts';export const nativeWorkspace=async()=>s.user?{account:s.account,client:s.client}:null;`,
 'auth-security':`export const authSecurityConfiguration=()=>({origin:'https://recharge.example'});export const requestQuota=async()=>({allowed:true,retryAfter:0});`,
};
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},plugins:[{
 name:'property-details-test',enforce:'pre',transform(code,id){if(!/\/(business-server|business-private-routes)\.ts$/.test(id.replaceAll('\\','/')))return;
 for(const name of Object.keys(mocks))for(const quote of ["'",'"'])code=code.replaceAll(`from ${quote}./${name}${quote}`,`from 'details-test:${name}'`);return {code,map:null};},
 resolveId:id=>id.startsWith('details-test:')?'\0'+id:null,load:id=>id.startsWith('\0details-test:')?mocks[id.slice(14)]:null,
}]});
after(async()=>{delete globalThis.__propertyDetailsTest;await vite.close();});
const {propertyDetails}=await vite.ssrLoadModule('/lib/business-private-routes.ts');
const id='11111111-1111-4111-8111-111111111111';
function reset(){Object.assign(state,{user:{id},version:{data:1,error:null},account:{userId:id,email:'test@example.com',fullName:'Test',responsibilities:'',role:'admin',status:'active',modules:[]},writes:0,calls:[]});state.client={rpc:async(name,args)=>{state.calls.push({name,args});if(name==='workspace_account')return {data:state.account,error:null};if(name==='workspace_controls_version')return state.version;if(name==='workspace_save_property_details')state.writes++;return {data:{accessInstructions:'Entry',otaInstructions:'Hidden OTA credential',managementFeeBps:1000,paymentNotes:'Hidden finance note'},error:null};}};}
const body={propertyId:id,version:1,section:'access',input:{accessInstructions:'Updated entry'}};
const post=input=>new Request('https://recharge.example/api/workspace/property-details',{method:'POST',headers:{origin:'https://recharge.example','content-type':'application/json'},body:JSON.stringify(input)});

test('access HTTP responses strip unrelated legacy OTA and financial data before migration installation',async()=>{
 reset();const response=await propertyDetails(new Request('https://recharge.example/api/workspace/property-details?propertyId='+id+'&section=access'));
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{data:{accessInstructions:'Entry'}});assert.match(response.headers.get('cache-control'),/no-store/);
});
test('property writes fail safely while the split-field database migration is unavailable',async()=>{
 for(const version of [{data:null,error:{code:'PGRST202'}},{data:null,error:null},{data:0,error:null}]){reset();state.version=version;assert.equal((await propertyDetails(post(body))).status,503);assert.equal(state.writes,0);}
 reset();assert.equal((await propertyDetails(post(body))).status,200);assert.equal(state.writes,1);assert.deepEqual(state.calls.at(-1).args.input,{accessInstructions:'Updated entry'});
 reset();assert.equal((await propertyDetails(post({...body,input:{...body.input,otaInstructions:'Unexpected credential'}}))).status,400);assert.equal(state.writes,0);
});
test('revoked and pending accounts cannot use property details or migration capability reads',async()=>{
 for(const status of ['pending','revoked']){reset();state.account.status=status;assert.equal((await propertyDetails(post(body))).status,403);assert.equal(state.writes,0);assert.ok(state.calls.every(c=>c.name==='workspace_account'));}
});
