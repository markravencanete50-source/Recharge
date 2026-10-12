import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';

// Example payout files read back exactly as an upload would; owner statements download as a
// spreadsheet and open as a page that escapes everything entered.
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false}});
after(()=>vite.close());
const files=await vite.ssrLoadModule('/lib/accounts-files.ts');
const {prepareFinanceAction}=await vite.ssrLoadModule('/lib/workspace-finance-policy.ts');

test('the example payout files are read by the same upload as a real report',()=>{
 const airbnb=files.payoutExampleCheck('airbnb','2026-10');
 assert.equal(airbnb.source,'Airbnb');assert.equal(airbnb.error,undefined);
 // The payout summary line is skipped; an adjustment adds to its stay.
 assert.deepEqual(airbnb.rows.map(r=>[r.code,r.amountMinor]),[['HMEXAMPLE01',44740],['HMEXAMPLE02',20000]]);
 const booking=files.payoutExampleCheck('booking_com','2026-10');
 assert.equal(booking.source,'Booking.com');assert.deepEqual(booking.rows.map(r=>[r.code,r.amountMinor]),[['1000000001',40128],['1000000002',21736]]);
 for(const channel of ['airbnb','booking_com']){
  const example=files.payoutExampleCsv(channel,'2026-10');
  assert.match(example.fileName,/^Example-(Airbnb|Booking\.com)-payouts-2026-10\.csv$/);
  const prepared=prepareFinanceAction({action:'importPayoutReport',requestId:crypto.randomUUID(),channel,fileName:example.fileName,csv:example.csv});
  // Every coded line is sent on its own (Airbnb's adjustment too), each with its own key.
  assert.ok('input' in prepared,'the upload accepts the example');assert.equal(prepared.input.lines.length,channel==='airbnb'?3:2);
  assert.equal(new Set(prepared.input.lines.map(l=>l.key)).size,prepared.input.lines.length);
 }
});

const statement={id:'11111111-1111-4111-8111-111111111111',propertyId:'22222222-2222-4222-8222-222222222222',propertyName:'Leith <Harbour> Flat',period:'2026-09',status:'paid',
 revenueMinor:120000,cleaningCount:3,cleaningMinor:13500,expensesMinor:18000,feeBps:2000,feeMinor:24000,payoutMinor:64500,payoutMethod:'bank_transfer',payoutReference:'BACS-881',
 paidAt:'2026-10-03T09:00:00Z',issuedAt:'2026-10-01T09:00:00Z',version:3,
 detail:{stays:[{reference:'HM123',channel:'airbnb',checkIn:'2026-09-04',checkOut:'2026-09-07',amountMinor:120000}],expenses:[{supplier:'=Leith "Plumbing"',reference:'LP-881',amountMinor:18000}],cleaningCostMinor:4500}};

test('a statement downloads as a spreadsheet with its lines and totals',()=>{
 const csv=files.statementCsv(statement);
 assert.ok(csv.startsWith('\uFEFF"Recharge owner statement"'));
 assert.ok(csv.includes('"HM123","Airbnb","2026-09-04","2026-09-07","1200.00"'));
 assert.ok(csv.includes(`"'=Leith ""Plumbing""","LP-881","(180.00)"`),'formulas are neutralised and quotes escaped');
 assert.ok(csv.includes('"Management fee (20%)","(240.00)"')&&csv.includes('"Due to owner","645.00"'));
 assert.equal(files.statementFileName('Leith <Harbour> Flat','2026-09','csv'),'Recharge-statement-Leith-Harbour-Flat-2026-09.csv');
});

test('the printable statement is branded, plain English and escaped',()=>{
 const html=files.statementDocument(statement,'owner');
 assert.ok(html.startsWith('<!doctype html>')&&html.includes('Recharge · Owner statement'));
 assert.ok(html.includes('Leith &lt;Harbour&gt; Flat')&&!html.includes('<Harbour>'));
 assert.ok(html.includes('£1,200.00')&&html.includes('£645.00')&&html.includes('your payout'));
 assert.ok(html.includes('Paid by bank transfer on 3 Oct 2026, reference BACS-881.'));
 const accounts=files.statementDocument({...statement,status:'issued',payoutMinor:-5000},'accounts');
 assert.ok(accounts.includes('owner owes')&&accounts.includes('Owner owes'));
 const draft=files.statementDocument({...statement,status:'draft',detail:{...statement.detail,stays:[],expenses:[]}},'accounts');
 assert.ok(draft.includes('Draft, not yet issued')&&draft.includes('No stays this month.')&&draft.includes('No repairs or supplies this month.'));
});
