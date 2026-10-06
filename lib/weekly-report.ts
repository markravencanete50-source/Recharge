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
