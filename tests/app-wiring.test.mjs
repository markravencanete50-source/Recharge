import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createServer} from 'vite';

// Every section a screen reads and every action it sends exists on the backend, so no button in
// the app leads to "Check the update" or "Unknown section".
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false}});
after(()=>vite.close());
const load=path=>vite.ssrLoadModule(path);
const {teamsReadSchema,teamsActionSchema}=await load('/lib/workspace-teams-policy.ts');
const {financeReadSchema,financeActionSchema}=await load('/lib/workspace-finance-policy.ts');
const {adminReadSchema,adminActionSchema}=await load('/lib/workspace-admin-policy.ts');
const {chatReadSchema,chatActionSchema}=await load('/lib/workspace-chat-policy.ts');
const {controlsReadSchema,controlsActionSchema}=await load('/lib/workspace-controls-policy.ts');
const {portfolioReadSchema,portfolioActionSchema}=await load('/lib/portfolio-policy.ts');
const {operationsActionSchema}=await load('/lib/operations-policy.ts');
const {journeyActionSchema}=await load('/lib/journey-policy.ts');
const {businessWriteSchema}=await load('/lib/business-policy.ts');
const {inboxReadSchema,inboxActionSchema}=await load('/lib/guest-inbox-policy.ts');
const {ownerReadSchema}=await load('/lib/owner-policy.ts');
const {oversightReadSchema,oversightActionSchema}=await load('/lib/oversight-policy.ts');
const {checklistReadSchema,checklistActionSchema}=await load('/lib/clean-checklist-policy.ts');

const sources=readdirSync('mobile/src').filter(f=>/\.tsx?$/.test(f)).map(f=>[f,readFileSync('mobile/src/'+f,'utf8')]);
const found=re=>sources.flatMap(([f,s])=>[...s.matchAll(re)].map(m=>[f,m[1]]));
// A value the schema rejects because of the section or action itself (not other missing fields).
const rejectsKey=(schema,input,key)=>{const r=schema.safeParse(input);return !r.success&&r.error.issues.some(i=>i.path[0]===key&&['invalid_enum_value','invalid_union_discriminator','invalid_literal'].includes(i.code));};
const discriminators=(schema,key)=>schema.optionsMap?[...schema.optionsMap.keys()]:schema.options.map(o=>o.shape?.[key]?.value).filter(Boolean);

test('every section the screens read is one the backend accepts',()=>{
 const reads=[
  [/readTeams\(\{ ?section: ?"([A-Za-z]+)"/g,teamsReadSchema],[/readFinance\(\{ ?section: ?"([A-Za-z]+)"/g,financeReadSchema],
  [/readAdmin\("([A-Za-z]+)"\)/g,adminReadSchema],[/readChat\(\{ ?section: ?"([A-Za-z]+)"/g,chatReadSchema],[/readInbox\(\{ ?section: ?"([A-Za-z]+)"/g,inboxReadSchema],
  [/readControls\(\{ ?section: ?"([A-Za-z]+)"/g,controlsReadSchema],[/readOwner\(\{ ?section: ?"([A-Za-z]+)"/g,ownerReadSchema],[/readOversight\(\{ ?section: ?"([A-Za-z]+)"/g,oversightReadSchema],[/readChecklists\(\{ ?section: ?"([A-Za-z]+)"/g,checklistReadSchema],[/portfolio\?(?:" \+ new URLSearchParams\(\{ ?)?section[=:] ?"?([A-Za-z]+)/g,portfolioReadSchema],
 ];
 let checked=0;
 for(const [re,schema] of reads)for(const [file,section] of found(re)){checked++;assert.ok(!rejectsKey(schema,{section},'section'),`${file} reads unknown section "${section}"`);}
 assert.ok(checked>=25,`checked ${checked} reads`);
});

test('every action the screens send is one the backend accepts',()=>{
 const writes=[
  [/writeTeams\(\{ ?action: ?"([A-Za-z]+)"/g,teamsActionSchema],[/writeFinance\(\{ ?action: ?"([A-Za-z]+)"/g,financeActionSchema],
  [/writeAdmin\(\{ ?action: ?"([A-Za-z]+)"/g,adminActionSchema],[/writeChat\(\{ ?action: ?"([A-Za-z]+)"/g,chatActionSchema],[/writeInbox\(\{ ?action: ?"([A-Za-z]+)"/g,inboxActionSchema],
  [/writeControls\(\{ ?action: ?"([A-Za-z]+)"/g,controlsActionSchema],[/writeOversight\(\{ ?action: ?"([A-Za-z]+)"/g,oversightActionSchema],[/writeChecklists\(\{ ?action: ?"([A-Za-z]+)"/g,checklistActionSchema],[/writeWorkspace\(\{ ?action: ?"([A-Za-z]+)"/g,businessWriteSchema],
  [/"\/api\/mobile\/portfolio", \{ ?action: ?"([A-Za-z]+)"/g,portfolioActionSchema],
 ];
 let checked=0;
 for(const [re,schema] of writes)for(const [file,action] of found(re)){checked++;assert.ok(!rejectsKey(schema,{action},'action'),`${file} sends unknown action "${action}"`);}
 // Operation steps sent directly by screens.
 const steps=new Set(discriminators(operationsActionSchema,'step'));
 for(const [file,step] of found(/step: ?"([A-Za-z]+)"/g)){checked++;assert.ok(steps.has(step),`${file} sends unknown step "${step}"`);}
 assert.ok(checked>=30,`checked ${checked} actions`);
});

test('every guided form in the app sends an action or step the backend accepts',()=>{
 const forms=readFileSync('lib/workflow-forms.ts','utf8');
 const steps=new Set(discriminators(operationsActionSchema,'step'));
 const journeyActions=new Set(discriminators(journeyActionSchema,'action'));
 const opSection=forms.slice(forms.indexOf('export function operationForms'),forms.indexOf('export function createOperationForms'));
 const journeySection=forms.slice(forms.indexOf('export function journeyForms'),forms.indexOf('export function operationForms'));
 const opSteps=[...opSection.matchAll(/add\('([A-Za-z]+)'/g)].map(m=>m[1]);
 const jActions=[...journeySection.matchAll(/add\('([A-Za-z]+)'/g)].map(m=>m[1]);
 assert.ok(opSteps.length>=15&&jActions.length>=8);
 for(const s of opSteps)assert.ok(steps.has(s),`operation form "${s}" has no backend step`);
 for(const a of jActions)assert.ok(journeyActions.has(a),`onboarding form "${a}" has no backend action`);
 // Forms that post to the portfolio or controls endpoints use real actions too.
 for(const [file,action] of found(/endpoint: "portfolio",[^]*?action: "([A-Za-z]+)"/g))assert.ok(!rejectsKey(portfolioActionSchema,{action},'action'),`${file}: ${action}`);
});
