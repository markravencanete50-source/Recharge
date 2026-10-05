import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const vite=await createServer({configFile:false,appType:'custom',root,resolve:{alias:{'@':root}},optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,ws:false}});
after(()=>vite.close());
const {todayPresentation,todayColors}=await vite.ssrLoadModule('/lib/today-presentation.ts');
const {reportPresentation}=await vite.ssrLoadModule('/lib/report-presentation.ts');
const {snapshotFor,roles}=await vite.ssrLoadModule('/mobile/src/model.ts');
const {designTokens}=await vite.ssrLoadModule('/lib/design-tokens.ts');

test('Today and Reports match for every role and custom period, using the same snapshot',()=>{
  for(const role of roles)for(const period of [{from:'2026-09-06',to:'2026-10-05'},{from:'2026-10-01',to:'2026-10-02'}]){
    const snapshot=snapshotFor(role.value),today=todayPresentation(snapshot,period),reports=reportPresentation(snapshot,period);
    assert.deepEqual(today.current,reports.current);
    assert.equal(today.open,reports.current.total-reports.current.complete);
    assert.equal(today.waiting,reports.current.waiting);
    assert.equal(today.properties,reports.current.properties);
    assert.equal(today.percent,reports.current.total?Math.round(reports.current.complete/reports.current.total*100):0);
    assert.ok(today.waiting<=today.open);
  }
});
const snapshot=records=>({title:'Test',description:'',propertyLabel:'Properties',propertyCount:2,propertyAvailable:true,sources:[{key:'workflows',name:'Workflows',available:true,records}]});
test('The seven days plot currently open records by date, excluding closed and out-of-range records',()=>{
  const data=todayPresentation(snapshot([
    {date:'2026-09-29',status:'waiting'},{date:'2026-09-29',status:'progress'},
    {date:'2026-09-29',status:'complete'},{date:'2026-10-05',status:'waiting'},
    {date:'2026-10-06',status:'waiting'},{date:'2026-09-28',status:'progress'},
  ]),{from:'2026-09-29',to:'2026-10-05'});
  assert.deepEqual(data.days.map(d=>d.value),[2,0,0,0,0,0,1]);
  assert.deepEqual(data.days.map(d=>d.date),['2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05']);
  assert.equal(data.open,3);assert.equal(data.waiting,2);assert.equal(data.waitingShare,2/3);
});
test('Weekly comparison expresses fewer as good, more as unfavourable and equal plainly',()=>{
  for(const [current,before,good,direction,label] of [[2,5,true,'down','3 fewer than last week'],[5,2,false,'up','3 more than last week'],[2,2,true,'same','Same as last week']]){
    const records=[...Array.from({length:current},()=>({date:'2026-10-05',status:'waiting'})),...Array.from({length:before},()=>({date:'2026-09-28',status:'waiting'}))];
    const data=todayPresentation(snapshot(records),{from:'2026-10-01',to:'2026-10-05'});
    assert.equal(data.good,good);assert.equal(data.direction,direction);assert.equal(data.changeLabel,label);
  }
});
test('Empty and unavailable sources do not produce a fabricated trend or invalid share',()=>{
  const empty=snapshot([]),data=todayPresentation(empty,{from:'2026-10-01',to:'2026-10-05'});
  assert.equal(data.open,0);assert.equal(data.percent,0);assert.equal(data.waitingShare,0);
  assert.deepEqual(data.days.map(d=>d.value),[0,0,0,0,0,0,0]);
  empty.sources[0].available=false;
  const unavailable=todayPresentation(empty,{from:'2026-10-01',to:'2026-10-05'});
  assert.equal(unavailable.available,false);assert.equal(unavailable.changeLabel,'Data unavailable');
});
const rgb=hex=>hex.slice(1,7).match(/../g).map(h=>parseInt(h,16));
const mix=(a,b,alpha)=>a.map((v,i)=>v*alpha+b[i]*(1-alpha));
const lum=rgb=>rgb.map(v=>{const c=v/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[0.2126,0.7152,0.0722][i],0);
const ratio=(a,b)=>(Math.max(lum(a),lum(b))+0.05)/(Math.min(lum(a),lum(b))+0.05);
test('Today text, chart strokes, change arrows and tile icons meet contrast targets in both themes',()=>{
  for(const theme of ['light','dark']){
    const colors=todayColors[theme],bg=rgb(colors.waitingBg),amber=rgb('#FFB547');
    for(let i=0;i<=100;i++){
      const gradient=mix(rgb(colors.heroStart),rgb(colors.heroEnd),i/100);
      for(const text of [colors.heroText,colors.heroMuted])assert.ok(ratio(rgb(text),gradient)>=4.5,`${theme} hero text`);
    }
    for(const background of [colors.trendBg,colors.chipBg,colors.selectedBg,colors.ringBg]){
      assert.ok(ratio(rgb(colors.heroText),rgb(background))>=4.5,`${theme} chart/control text`);
    }
    assert.ok(ratio(rgb(colors.mint),rgb(colors.ringTrack))>=3,`${theme} progress ring`);
    for(const ink of [colors.mint,colors.unfavourable])assert.ok(ratio(rgb(ink),rgb(colors.chipBg))>=3,`${theme} change arrow`);
    assert.ok(ratio(rgb(colors.spark),rgb(colors.trendBg))>=3,`${theme} trend line`);
    assert.ok(ratio(rgb(colors.selectionLine),rgb(colors.trendBg))>=3,`${theme} selected date guide`);
    assert.ok(ratio(rgb(designTokens[theme].text),bg)>=4.5);
    assert.ok(ratio(rgb(designTokens[theme].text),rgb(colors.propertyBg))>=4.5);
    assert.ok(ratio(rgb(colors.waitingFill),mix(amber,bg,0.2))>=3);
    for(const [ink,background] of [[colors.waitingIcon,colors.waitingBg],[colors.propertyIcon,colors.propertyBg]]){
      assert.ok(ratio(rgb(ink),mix(rgb(ink),rgb(background),theme==='dark'?41/255:16/255))>=3);
      assert.ok(ratio(rgb(ink),rgb(background))>=3);
    }
  }
});
