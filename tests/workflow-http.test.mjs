import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const state={}; globalThis.__workflowHttp=state;
const mocks={
 'business-server':`const s=globalThis.__workflowHttp; export const businessContext=async()=>s.session;
 export const businessResponse=(body,status=200)=>Response.json(body,{status});
 export const databaseFailure=e=>Response.json({error:'Denied by database'},{status:e.code==='42501'?403:400});`,
 'auth-security':`const s=globalThis.__workflowHttp; export const authSecurityConfiguration=()=>({origin:'https://recharge.example'}); export const requestQuota=async()=>s.quota;`,
};
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},plugins:[{
 name:'isolated-workflow-http',enforce:'pre',transform(code,id){if(!/\/(journey|portfolio|workspace-controls)-server\.ts$/.test(id.replaceAll('\\','/')))return;
 for(const name of Object.keys(mocks))code=code.replaceAll(`from './${name}'`,`from 'workflow-test:${name}'`);return {code,map:null};},
 resolveId:id=>id.startsWith('workflow-test:')?'\0'+id:null,load:id=>id.startsWith('\0workflow-test:')?mocks[id.slice(15)]:null,
}]});
after(async()=>{delete globalThis.__workflowHttp;await vite.close();});
const {journeyRoute,operationsRoute}=await vite.ssrLoadModule('/lib/journey-server.ts');
const {portfolioRoute}=await vite.ssrLoadModule('/lib/portfolio-server.ts');
const {workspaceControls}=await vite.ssrLoadModule('/lib/workspace-controls-server.ts');
const {controlsActionSchema,controlsReadSchema}=await vite.ssrLoadModule('/lib/workspace-controls-policy.ts');
const {weeklyReportCsv}=await vite.ssrLoadModule('/lib/weekly-report.ts');
const {workflowValues,journeyForms}=await vite.ssrLoadModule('/lib/workflow-forms.ts');
const {onboardingFormSchema}=await vite.ssrLoadModule('/lib/journey-policy.ts');
const {estimateComparables}=await vite.ssrLoadModule('/lib/workspace-view.ts');
const routes=[journeyRoute,operationsRoute,portfolioRoute,workspaceControls];

test('internal controls reject impossible dates, extra privileges, invented assumptions and embedded source credentials',()=>{
 const reservation={action:'updateReservation',requestId:uuid,propertyId:uuid,reservationId:uuid,version:1,checkIn:'2026-11-01',checkOut:'2026-11-05',status:'confirmed'};
 assert.ok(controlsActionSchema.safeParse(reservation).success);
 for(const patch of [{checkOut:'2026-11-01'},{checkIn:'2026-02-30'},{role:'super_admin'},{status:'paid'},{checkOut:'2027-11-03'}])assert.equal(controlsActionSchema.safeParse({...reservation,...patch}).success,false);
 assert.equal(controlsReadSchema.safeParse({section:'resources'}).success,false);
 assert.equal(controlsActionSchema.safeParse({action:'saveEstimate',requestId:uuid,propertyId:uuid,version:0,assumptions:{}}).success,false);
 const event={action:'updateEvent',requestId:uuid,propertyId:uuid,eventId:uuid,version:1,name:'Example event',eventOn:'2026-11-01',sourceUrl:'https://user:password@example.com',opportunity:'Recorded demand'};
 assert.equal(controlsActionSchema.safeParse(event).success,false);
});
const uuid='11111111-1111-4111-8111-111111111111';
test('comparable links exclude unsafe schemes, embedded credentials and malformed provider data',()=>{
 const comparable={name:'Recorded comparable',url:'https://example.com/listing',adrMinor:12299};
 assert.deepEqual(estimateComparables({comparables:[comparable]}),[comparable]);
 for(const url of ['javascript:alert(1)','http://example.com','https://user:password@example.com','not a URL'])assert.deepEqual(estimateComparables({comparables:[{...comparable,url}]}),[]);
 assert.deepEqual(estimateComparables(null),[]);assert.deepEqual(estimateComparables({comparables:[{...comparable,adrMinor:'invented'}]}),[]);
});
test('web and native setup accept blank optional dates, exact penny amounts and enforce consent',()=>{
 const spec=journeyForms({role:'client',userId:uuid,modules:['property-onboarding']},{clientId:uuid,propertyId:uuid,stage:'form',version:1}).find(f=>f.key==='submitForm');
 const input={businessName:'Test owner',bankAccountName:'Test owner',bankAccountNumber:'12345678',bankSortCode:'12-34-56',accessDate:'2026-10-12',accessInfo:'Private test access',utilitiesConnected:true,utilityInstallDate:'',prepaymentMeters:false,creditSwitchDate:'',broadbandConnected:true,broadbandInstallDate:'',hasGarden:false,mailPreference:'leave_safely',warrantyDetails:'',preferredRepairContact:'',repairLimitMinor:'12.29',fullRepairPermission:false,furnishingChoice:'self',licensingRequired:false};
 const values=workflowValues(spec.fields,input);assert.equal(values.repairLimitMinor,1229);assert.equal(values.utilityInstallDate,null);assert.ok(onboardingFormSchema.safeParse(values).success);
 assert.equal(onboardingFormSchema.safeParse({...values,utilitiesConnected:false}).success,false);
 assert.throws(()=>workflowValues([{name:'amount',label:'Budget',type:'money'}],{amount:'12.299'}),/valid amount/);
 assert.throws(()=>workflowValues([{name:'consent',label:'Agreement',type:'checkbox',required:true}],{consent:false}),/confirm/);
});
function reset(status='active'){Object.assign(state,{calls:[],quota:{allowed:true,retryAfter:0},session:{account:{userId:uuid,status},client:{rpc:async(name,args)=>{state.calls.push({name,args});return {data:[],error:null};}}}});}
function request(body,origin='https://recharge.example'){return new Request('https://recharge.example/api/workspace/operations',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});}
test('workflow HTTP handlers refuse forged web and browser-shaped native requests before RPC access',async()=>{
 for(const route of routes){reset();assert.equal((await route(request({},'https://attacker.example'))).status,403);assert.equal((await route(request({}),true)).status,403);assert.equal(state.calls.length,0);}
});
test('workflow HTTP handlers refuse absent, pending and revoked sessions before RPC access',async()=>{
 for(const route of routes){reset();state.session=null;assert.equal((await route(new Request('https://recharge.example/api/workspace'))).status,401);
 for(const status of ['pending','revoked']){reset(status);assert.equal((await route(new Request('https://recharge.example/api/workspace'))).status,403);assert.equal(state.calls.length,0);}}
});
test('strict bodies and shared quotas protect all workflow writes',async()=>{
 for(const route of routes){reset();assert.equal((await route(request({sql:'select secret'}))).status,400);assert.equal(state.calls.length,0);
 state.quota={allowed:false,retryAfter:42};const response=await route(request({}));assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'42');assert.equal(state.calls.length,0);}
});
test('weekly report refuses inverted dates, invalid dates and unauthorised download sections before RPC',async()=>{
 for(const query of ['section=weekly&propertyId='+uuid+'&from=2026-10-05&to=2026-10-01','section=weekly&propertyId='+uuid+'&from=2026-02-30&to=2026-03-01','section=onboardingPayout&propertyId='+uuid+'&download=csv']){
 reset();assert.equal((await portfolioRoute(new Request('https://recharge.example/api/workspace/portfolio?'+query))).status,400);assert.equal(state.calls.length,0);}
});
test('weekly CSV neutralises spreadsheet formulas and preserves actual proposed versus applied evidence',()=>{
 const csv=weeklyReportCsv({propertyId:uuid,propertyName:'=HYPERLINK("https://example.com")',from:'2026-10-01',to:'2026-10-05',dateBasis:'Europe/London',listingChecks:[],pricing:[{night:'2026-10-06',decision:'change',currentRateMinor:15000,proposedRateMinor:14000,reason:'+SUM(1,2)',phase:'proposed',appliedAt:null}],events:[{name:'@unsafe',eventOn:'2026-10-08',sourceUrl:'https://example.com/event',opportunity:'Recorded local opportunity'}]});
 assert.match(csv,/'=HYPERLINK/);assert.match(csv,/'\+SUM/);assert.match(csv,/'@unsafe/);assert.match(csv,/"proposed","Not applied"/);assert.match(csv,/"150\.00","140\.00"/);assert.doesNotMatch(csv,/bankAccount|sortCode/);
});
