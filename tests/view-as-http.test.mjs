import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';

// View as over HTTP: a super admin's reads carry the person's id to the database; anyone else's
// header is refused; anything sent is always done as the super admin themselves.
const root=fileURLToPath(new URL('..',import.meta.url));
const state={};globalThis.__viewAsHttp=state;
const mocks={
 'auth-security':`const s=globalThis.__viewAsHttp;export const authSecurityConfiguration=()=>({origin:'https://recharge.example'});export const requestQuota=async()=>({allowed:true,retryAfter:0});`,
 'supabase-server':`const s=globalThis.__viewAsHttp;export const verifiedWorkspaceUser=async()=>({id:s.own.userId});export const workspaceSupabase=async()=>s.client('own');
  export const workspaceSupabaseViewing=async target=>{s.viewing.push(target);return s.client('viewing:'+target);};`,
 'native-session':`const s=globalThis.__viewAsHttp;export {workspaceAccountSchema} from '/lib/workspace-account-policy.ts';
  export const nativeWorkspace=async()=>({account:s.own,client:s.client('own')});
  export const nativeProvider=(token,headers)=>{s.native.push(headers);return s.client('viewing:'+headers['x-recharge-view-as']);};`,
};
const vite=await createServer({configFile:false,appType:'custom',root,resolve:{alias:{'@':root}},server:{middlewareMode:true,hmr:false},plugins:[{
 name:'view-as-http-test',enforce:'pre',transform(code,id){if(!/\/lib\/(business-server|workspace-rpc-route)\.ts$/.test(id.replaceAll('\\','/')))return null;
  for(const name of Object.keys(mocks))for(const quote of ["'",'"'])code=code.replaceAll(`from ${quote}./${name}${quote}`,`from 'view-as-test:${name}'`);return {code,map:null};},
 resolveId:id=>id.startsWith('view-as-test:')?'\0'+id:null,load:id=>id.startsWith('\0view-as-test:')?mocks[id.slice(14)]:null,
}]});
after(async()=>{delete globalThis.__viewAsHttp;await vite.close();});
const {workspaceTeams}=await vite.ssrLoadModule('/lib/workspace-finance-server.ts');
const admin='11111111-1111-4111-8111-111111111111', cleaner='22222222-2222-4222-8222-222222222222';
const account=(userId,role)=>({userId,email:role+'@example.com',fullName:role,responsibilities:'',role,status:'active',modules:[]});
function reset(role='super_admin'){
 Object.assign(state,{own:account(admin,role),calls:[],viewing:[],native:[],viewError:null});
 state.client=who=>({rpc:async(name,args)=>{state.calls.push([who,name,args]);
  if(name==='workspace_account')return who==='own'?{data:state.own,error:null}:state.viewError?{data:null,error:state.viewError}:{data:account(cleaner,'cleans'),error:null};
  return {data:{from:who},error:null};}});
}
const web=(path,headers={},init={})=>new Request('https://recharge.example'+path,{...init,headers:{origin:'https://recharge.example',...headers,...init.headers}});
const read=(headers={})=>web('/api/workspace/teams?section=favorites',headers);

test('a super admin viewing as someone reads through the database as that person',async()=>{
 reset();
 const response=await workspaceTeams(read({'x-recharge-view-as':cleaner}));
 assert.equal(response.status,200);
 assert.deepEqual((await response.json()).data,{from:'viewing:'+cleaner});
 assert.deepEqual(state.viewing,[cleaner]);
 assert.ok(state.calls.some(c=>c[0]==='viewing:'+cleaner&&c[1]==='workspace_favorites'));
 // Without the header everything is their own.
 reset();
 assert.deepEqual((await (await workspaceTeams(read())).json()).data,{from:'own'});
 assert.equal(state.viewing.length,0);
});

test('anyone else, a bad id or an ended view is refused with a clear message',async()=>{
 for(const [role,id] of [['admin',cleaner],['super_admin','not-a-uuid']]){
  reset(role);
  const response=await workspaceTeams(read({'x-recharge-view-as':id}));
  assert.equal(response.status,409);assert.match((await response.json()).error,/Viewing as this person has ended/);
  assert.ok(!state.calls.some(c=>c[1]==='workspace_favorites'),'nothing read');
 }
 reset();state.viewError={code:'42501',message:'Viewing as this person has ended. Choose them again to carry on.'};
 assert.equal((await workspaceTeams(read({'x-recharge-view-as':cleaner}))).status,409);
 assert.ok(!state.calls.some(c=>c[1]==='workspace_favorites'));
});

test('changes are always sent as the super admin themselves',async()=>{
 reset();
 const response=await workspaceTeams(web('/api/workspace/teams',{'x-recharge-view-as':cleaner,'content-type':'application/json'},{method:'POST',body:JSON.stringify({action:'startViewAs',userId:cleaner})}));
 assert.equal(response.status,200);
 assert.equal(state.viewing.length,0);
 assert.deepEqual(state.calls.at(-1).slice(0,2),['own','workspace_view_as_start']);
 reset();
 await workspaceTeams(web('/api/workspace/teams',{'content-type':'application/json'},{method:'POST',body:JSON.stringify({action:'stopViewAs'})}));
 assert.deepEqual(state.calls.at(-1).slice(0,2),['own','workspace_view_as_stop']);
});

test('the phone app carries the person too',async()=>{
 reset();
 const request=new Request('https://recharge.example/api/mobile/teams?section=favorites',{headers:{'x-recharge-client':'native',authorization:'Bearer header.payload.signature-for-tests','x-recharge-view-as':cleaner}});
 const response=await workspaceTeams(request,true);
 assert.equal(response.status,200);
 assert.deepEqual(state.native,[{'x-recharge-view-as':cleaner}]);
 assert.deepEqual((await response.json()).data,{from:'viewing:'+cleaner});
});
