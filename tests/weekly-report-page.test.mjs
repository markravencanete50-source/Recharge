import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';

// The weekly owner report page: the week's work in plain words, safe to open anywhere.
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false}});
const {weeklyReportDocument,weeklyReportFileName}=await vite.ssrLoadModule('/lib/weekly-report.ts');
after(()=>vite.close());
const report={propertyId:'11111111-1111-4111-8111-111111111111',propertyName:'Leith <Harbour> Flat',from:'2026-10-01',to:'2026-10-07',dateBasis:'Europe/London',
 listingChecks:[{checkedOn:'2026-10-02',platform:'airbnb',listingVisible:true,reviewSentiment:'bad',reviewAcknowledged:true,suspended:false,evidence:'Replied to the guest about the shower'}],
 pricing:[{night:'2026-10-04',decision:'change',currentRateMinor:12000,proposedRateMinor:10500,reason:'Quiet weekend nearby',phase:'applied',appliedAt:'2026-10-02T10:00:00Z'},
  {night:'2026-10-05',decision:'hold',currentRateMinor:11000,proposedRateMinor:11000,reason:'Already competitive',phase:'proposed',appliedAt:null}],
 events:[{name:'Edinburgh Marathon',eventOn:'2026-10-06',sourceUrl:'https://example.com/marathon?a=1&b=2',opportunity:'Busy weekend; keep prices up'}]};

test('the report reads as plain English and escapes everything entered',()=>{
 const html=weeklyReportDocument(report);
 assert.ok(html.startsWith('<!doctype html>'));
 assert.ok(html.includes('Leith &lt;Harbour&gt; Flat')&&!html.includes('<Harbour>'),'names are escaped');
 assert.ok(html.includes('£120.00')&&html.includes('£105.00'));
 assert.ok(html.includes('Changed the price')&&html.includes('Kept the price')&&html.includes('(not applied yet)'));
 assert.ok(html.includes('href="https://example.com/marathon?a=1&amp;b=2"'));
 assert.ok(html.includes('1 check found something to fix'),'a bad review is flagged');
 assert.ok(/<b>1<\/b><span>prices changed/.test(html));
 assert.equal(weeklyReportFileName('Leith <Harbour> Flat','2026-10-01','2026-10-07'),'Recharge-weekly-report-Leith-Harbour-Flat-2026-10-01-to-2026-10-07.html');
 const quiet=weeklyReportDocument({...report,listingChecks:[],pricing:[],events:[]});
 assert.ok(quiet.includes('No listing checks were recorded')&&quiet.includes('No local events were noted'));
});
