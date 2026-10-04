import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false}});
after(()=>vite.close());
const {orderedPins,movePin}=await vite.ssrLoadModule('/lib/pinned-tools.ts');
const {findTools}=await vite.ssrLoadModule('/lib/tool-finder.ts');
const {MODULES,defaultModulesForRole}=await vite.ssrLoadModule('/lib/modules.ts');
const {WORKSPACE_MAP}=await vite.ssrLoadModule('/lib/workspace-map.ts');
const {tiltPosition}=await vite.ssrLoadModule('/lib/building-glyph.ts');
test('reordering preserves pin membership, rejects unknown keys and clamps targets',()=>{
  const saved=['a','b','c'];
  assert.deepEqual(movePin(saved,'a',2),['b','c','a']);
  assert.deepEqual(movePin(saved,'c',-8),['c','a','b']);
  assert.deepEqual(movePin(saved,'a',500),['b','c','a']);
  assert.deepEqual(movePin(saved,'unpermitted',1),saved);
  assert.deepEqual(movePin(saved,'a',NaN),saved);
  assert.deepEqual(saved,['a','b','c']);
});
test('each role retains only permitted pins in user order, including stale or duplicate stored keys',()=>{
  for(const role of ['super_admin','admin','stays','ready','cleans','cleaning_manager','client']){
    const allowed=defaultModulesForRole(role);
    const entries=MODULES.filter(tool=>allowed.includes(tool.id)).map(tool=>({key:tool.id,name:tool.name,tone:WORKSPACE_MAP[tool.id].tone,tool}));
    const pins=orderedPins(entries,[...MODULES.map(tool=>tool.id).reverse(),'unpermitted',MODULES[0].id]);
    assert.equal(pins.length,entries.length);
    assert(pins.every(entry=>allowed.includes(entry.key)));
    assert.deepEqual(pins.map(entry=>entry.key),MODULES.map(tool=>tool.id).reverse().filter(key=>allowed.includes(key)));
    assert.equal(findTools(entries,'').length,allowed.length);
    assert(findTools(entries,'routine').every(entry=>entry.name.toLowerCase().includes('routine')));
  }
});
test('a hundred saved tools keep their order without a pin cap',()=>{
  const entries=Array.from({length:100},(_,i)=>({key:'tool-'+i,name:'Tool '+i,tone:'stays',tool:{id:i}}));
  const saved=entries.map(entry=>entry.key);
  assert.equal(orderedPins(entries,saved).length,100);
  assert.equal(orderedPins(entries,movePin(saved,'tool-99',0))[0].key,'tool-99');
});
test('pointer tilt stays bounded and invalid dimensions cannot create an unsafe transform',()=>{
  assert.deepEqual(tiltPosition(50,50,100,100),{x:0,y:0});
  assert.deepEqual(tiltPosition(500,-500,100,100),{x:1,y:-1});
  assert.deepEqual(tiltPosition(NaN,Infinity,0,0),{x:0,y:0});
});
