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

test('the Vrbo example is clearly an example and reads cleanly through the same upload',()=>{
 const vrbo=files.payoutExampleCheck('vrbo','2026-10');
 assert.equal(vrbo.source,'Vrbo');assert.equal(vrbo.error,undefined);
 assert.deepEqual(vrbo.rows.map(r=>[r.code,r.amountMinor]),[['HA-EXAMPLE1',44160],['HA-EXAMPLE2',23920]]);
 const example=files.payoutExampleCsv('vrbo','2026-10');
 assert.equal(example.fileName,'Example-Vrbo-payouts-2026-10.csv');
 const prepared=prepareFinanceAction({action:'importPayoutReport',requestId:crypto.randomUUID(),channel:'vrbo',fileName:example.fileName,csv:example.csv});
 assert.ok('input' in prepared,'the upload accepts the Vrbo example');
 assert.equal(prepared.input.lines.length,2);
 assert.equal(new Set(prepared.input.lines.map(l=>l.key)).size,2,'each line has its own key');
 // Net is the payout column, and gross less the fees is exactly that net (the file adds up).
 assert.deepEqual(prepared.input.lines.map(l=>[l.grossMinor,l.commissionMinor,l.paymentFeeMinor,l.amountMinor,l.paidOn]),[[48000,2400,1440,44160,'2026-10-10'],[26000,1300,780,23920,'2026-10-14']]);
 for(const l of prepared.input.lines) assert.equal(l.grossMinor-l.commissionMinor-l.paymentFeeMinor,l.amountMinor);
 assert.match(example.csv,/Reservation ID/);
});

const v2={...statement,id:'33333333-3333-4333-8333-333333333333',period:'2026-11',status:'issued',issuedAt:'2026-12-01T09:00:00Z',paidAt:null,payoutMethod:null,payoutReference:null,
 revenueMinor:162002,cleaningCount:3,cleaningMinor:18000,expensesMinor:8500,feeBps:1500,feeMinor:24300,payoutMinor:106342,
 periodStart:'2026-11-01',periodEnd:'2026-12-01',grossMinor:175374,otaFeesMinor:13372,vatRateBps:2000,vatMinor:4860,
 detail:{stays:[],expenses:[{supplier:'Boiler Co',reference:'B-1',amountMinor:8500}],cleaningCostMinor:6000}};

test('a statement with VAT and platform fees shows every line that comes off, and they add up to the payout',()=>{
 assert.equal(v2.grossMinor-v2.otaFeesMinor-v2.cleaningMinor-v2.expensesMinor-v2.feeMinor-v2.vatMinor,v2.payoutMinor);
 const csv=files.statementCsv(v2);
 assert.ok(csv.includes('"Period","November 2026"'));
 for(const row of ['"Gross booking income","1753.74"','"Platform fees","(133.72)"','"Cleaning (3 at £60.00)","(180.00)"','"Repairs and supplies","(85.00)"','"Management fee (15%)","(243.00)"','"VAT on the management fee (20%)","(48.60)"','"Due to owner","1063.42"']) assert.ok(csv.includes(row),row);
 assert.ok(!csv.includes('Payouts received'),'the v2 summary starts from gross');
 const html=files.statementDocument(v2,'owner');
 for(const text of ['November 2026','Gross booking income','Platform fees','VAT on the management fee (20%)','plus VAT','£1,063.42']) assert.ok(html.includes(text),text);
 const custom=files.statementCsv({...v2,periodStart:'2026-11-10',periodEnd:'2026-11-21'});
 assert.ok(custom.includes('"Period","10 Nov to 20 Nov"')||/"Period","10 Nov( 2026)? to 20 Nov( 2026)?"/.test(custom));
});

test('an older statement downloads exactly as before: no VAT row, still a month',()=>{
 const csv=files.statementCsv(statement);
 assert.ok(csv.includes('"Month","September 2026"')&&csv.includes('"Payouts received","1200.00"'));
 assert.ok(!csv.includes('VAT')&&!csv.includes('Gross booking income'));
 assert.ok(!files.statementDocument(statement,'owner').includes('VAT'));
});
