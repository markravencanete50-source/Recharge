import { z } from 'zod';
import { csvCell } from './analytics-export';
const listing=z.object({checkedOn:z.string(),platform:z.string(),listingVisible:z.boolean(),reviewSentiment:z.string(),reviewAcknowledged:z.boolean(),suspended:z.boolean(),evidence:z.string()});
const pricing=z.object({night:z.string(),decision:z.string(),currentRateMinor:z.number(),proposedRateMinor:z.number(),reason:z.string(),phase:z.string(),appliedAt:z.string().nullable()});
const event=z.object({name:z.string(),eventOn:z.string(),sourceUrl:z.string(),opportunity:z.string()});
export const weeklyReportSchema=z.object({propertyId:z.string().uuid(),propertyName:z.string(),from:z.string(),to:z.string(),dateBasis:z.literal('Europe/London'),listingChecks:z.array(listing),pricing:z.array(pricing),events:z.array(event)});
export function weeklyReportCsv(value:unknown){
 const r=weeklyReportSchema.parse(value);
 const rows:(string|number)[][]=[['Recharge property performance'],['Property',r.propertyName],['From',r.from],['To',r.to],['Date basis',r.dateBasis],['Data','Recorded property checks and sourced events. No automated scan is connected.'],[],['Listing checks'],['Date','Platform','Visible','Review','Acknowledged','Suspended','Evidence'],
 ...r.listingChecks.map(x=>[x.checkedOn,x.platform,String(x.listingVisible),x.reviewSentiment,String(x.reviewAcknowledged),String(x.suspended),x.evidence]),[],['Pricing decisions'],['Night','Decision','Current GBP','Proposed GBP','Reason','Application status','Applied at'],
 ...r.pricing.map(x=>[x.night,x.decision,(x.currentRateMinor/100).toFixed(2),(x.proposedRateMinor/100).toFixed(2),x.reason,x.phase,x.appliedAt||'Not applied']),[],['Local events and opportunities'],['Event','Event date','Source','Opportunity'],
 ...r.events.map(x=>[x.name,x.eventOn,x.sourceUrl,x.opportunity])];
 return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}

// The weekly owner report as a page to read, print or save as a PDF: what the team did on the
// property that week (listing checks, pricing decisions) and local events that could bring
// bookings. Built from the same data as the spreadsheet download.
const esc=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
const day=(iso:string)=>new Date(iso.slice(0,10)+'T12:00:00Z').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'});
const pounds=(minor:number)=>'£'+(minor/100).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});
const PLATFORM:Record<string,string>={airbnb:'Airbnb',booking_com:'Booking.com',vrbo:'Vrbo',direct:'Direct',other:'Other'};
export function weeklyReportFileName(propertyName:string,from:string,to:string){
 const slug=propertyName.trim().replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'property';
 return `Recharge-weekly-report-${slug}-${from}-to-${to}.html`;
}
export function weeklyReportDocument(value:unknown){
 const r=weeklyReportSchema.parse(value);
 const changed=r.pricing.filter(x=>x.decision!=='hold'&&x.proposedRateMinor!==x.currentRateMinor);
 const applied=r.pricing.filter(x=>x.appliedAt).length;
 const issues=r.listingChecks.filter(x=>!x.listingVisible||x.suspended||x.reviewSentiment==='bad');
 const tile=(n:number|string,label:string)=>`<div class="tile"><b>${n}</b><span>${label}</span></div>`;
 const empty=(text:string)=>`<p class="empty">${text}</p>`;
 const listing=r.listingChecks.length?`<table><thead><tr><th>Date</th><th>Platform</th><th>Listing</th><th>Review</th><th>Notes</th></tr></thead><tbody>${r.listingChecks.map(x=>`<tr><td>${day(x.checkedOn)}</td><td>${esc(PLATFORM[x.platform]??x.platform)}</td><td>${x.suspended?'<em class="bad">Suspended</em>':x.listingVisible?'Visible':'<em class="bad">Hidden</em>'}</td><td>${x.reviewSentiment==='none'?'None':esc(x.reviewSentiment)+(x.reviewAcknowledged?', answered':'')}</td><td>${esc(x.evidence)}</td></tr>`).join('')}</tbody></table>`:empty('No listing checks were recorded this week.');
 const pricing=r.pricing.length?`<table><thead><tr><th>Night</th><th>Decision</th><th class="num">Was</th><th class="num">Now</th><th>Why</th></tr></thead><tbody>${r.pricing.map(x=>`<tr><td>${day(x.night)}</td><td>${x.decision==='hold'?'Kept the price':'Changed the price'}${x.appliedAt?'':' <span class="muted">(not applied yet)</span>'}</td><td class="num">${pounds(x.currentRateMinor)}</td><td class="num">${pounds(x.proposedRateMinor)}</td><td>${esc(x.reason)}</td></tr>`).join('')}</tbody></table>`:empty('No pricing decisions were needed this week.');
 const events=r.events.length?`<table><thead><tr><th>Date</th><th>Event</th><th>Why it matters</th></tr></thead><tbody>${r.events.map(x=>`<tr><td>${day(x.eventOn)}</td><td><a href="${esc(x.sourceUrl)}">${esc(x.name)}</a></td><td>${esc(x.opportunity)}</td></tr>`).join('')}</tbody></table>`:empty('No local events were noted for this period.');
 return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Weekly report: ${esc(r.propertyName)}</title>
<style>
:root{--ink:#17302A;--muted:#5B6B65;--line:#DDD5C6;--wash:#F3EEE4;--forest:#1D4038;--bad:#8A3B3B}
*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font:15px/1.55 "Segoe UI",Helvetica,Arial,sans-serif;padding:0 16px}
.wrap{max-width:860px;margin:0 auto;padding:28px 0 48px;display:flex;flex-direction:column;gap:26px}
header{background:var(--forest);color:#F3EEE4;border-radius:20px;padding:24px}header small{letter-spacing:.12em;text-transform:uppercase;color:#B9C9C1;font-weight:700;font-size:12px}
h1{margin:6px 0 4px;font-size:26px;line-height:1.2}header p{margin:0;color:#B9C9C1}
h2{font-size:18px;margin:0 0 10px}.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.tile{border:1px solid var(--line);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:2px}.tile b{font-size:24px;font-variant-numeric:tabular-nums}.tile span{color:var(--muted);font-size:13px}
@media(max-width:620px){.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
.box{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px;min-width:520px}th,td{text-align:left;padding:9px 10px;border-top:1px solid var(--line);vertical-align:top}
thead th{border-top:0;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em}.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.muted,.empty{color:var(--muted)}.bad{color:var(--bad);font-style:normal;font-weight:700}a{color:var(--forest)}
footer{color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:14px}
@media print{body{padding:0}.wrap{padding:0}header{-webkit-print-color-adjust:exact;print-color-adjust:exact}tr,.tile{break-inside:avoid}table{min-width:0}}
</style></head><body><div class="wrap">
<header><small>Recharge · Weekly report</small><h1>${esc(r.propertyName)}</h1><p>${day(r.from)} to ${day(r.to)}</p></header>
<section><div class="tiles">${tile(r.listingChecks.length,'listing checks')}${tile(changed.length,'prices changed')}${tile(applied,'price decisions applied')}${tile(r.events.length,'local events noted')}</div>
${issues.length?`<p class="bad" style="margin-top:12px">${issues.length} check${issues.length===1?'':'s'} found something to fix, shown below with what was done.</p>`:''}</section>
<section><h2>Listing checks</h2><div class="box">${listing}</div></section>
<section><h2>Pricing</h2><div class="box">${pricing}</div></section>
<section><h2>Local events and opportunities</h2><div class="box">${events}</div></section>
<footer>Prepared by Recharge from the work recorded in the Recharge app. Dates are in UK time. Questions? Message us in the app.</footer>
</div></body></html>
`;
}
