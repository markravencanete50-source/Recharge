import type { WorkspaceAccount } from './workspace-account-policy';
import { REPAIR_GUIDES } from './repair-guides';
import { INSPECTION_CHECKS } from './onboarding-content';
import { SCOTTISH_REGIONS } from './regions';
import { workspaceDateKey } from './analytics';
import { HTTPS_LINK_MESSAGE, MAX_COMPARABLES, isHttpsLink } from './journey-policy';
import { ownCostFields, ownCostsFrom } from './own-costs';
import { agreementTemplateForms } from './agreement-template';
import { BATHROOM_CHOICES, BEDROOM_CHOICES, GARDEN_CHOICES, PARKING_CHOICES, PROPERTY_TYPES, WC_CHOICES, type Suggestion } from './property-listing';
export type WorkflowField={name:string;label:string;type?:'text'|'textarea'|'number'|'money'|'percent'|'date'|'checkbox'|'select'|'photos';options?:{value:string;label:string}[];required?:boolean;defaultValue?:string|boolean;help?:string;purpose?:'delivery'|'maintenance'|'licence'|'expense';
 // Quick picks under a text field (tapping one fills it, and any fields in `also`), and a postcode lookup on an address.
 suggestions?:Suggestion[];lookup?:'postcode';
 // `section` puts a small heading above this field, starting a group ("Comparable 1 (optional)"); `after` keeps the
 // field hidden until the named field has a value, so a second group appears once the first is started. `group` names
 // the group for screen readers ("Comparable 1 name") and drops "(optional)" from a short label the heading already covers.
 section?:string;after?:string;group?:string};
export type WorkflowForm={key:string;title:string;description?:string;endpoint:'journeys'|'operations'|'workspace'|'portfolio'|'controls'|'finance';fields:WorkflowField[];build:(values:Record<string,unknown>,requestId:string)=>Record<string,unknown>;unavailable?:string;workId?:string};
export type JourneyView={propertyId:string;clientId:string|null;workId:string;stage:string;version:number;agreement:string;agreementRevision:number;signedName:string|null;signedAt?:string|null;signedRevision?:number|null;inspectionOn?:string|null;inspectionReport:string|null;invoiceId:string|null;estimate:Record<string,unknown>|null;form:Record<string,unknown>|null;followUpOn?:string|null;feedback?:string;questions?:{id:string;question:string;askedAt:string;askedByOwner:boolean;answer:string|null;answeredAt:string|null}[];inspectionChecks?:{checks?:Record<string,boolean>;issues?:string};propertyType?:string|null;bathrooms?:number|null;enquiry?:EnquiryDetails;ownerAccount?:boolean;invoiceOutsideAt?:string|null;invoiceOutsideNote?:string;estimateDelivery?:import('./estimate-link').EstimateDelivery|null};
export type EnquiryDetails={contactName?:string;companyName?:string;email?:string;phone?:string;existingClient?:boolean;wcs?:number;parking?:string;garden?:string;photoLink?:string;notes?:string};
export type OperationView={workId:string;propertyId:string;moduleId:string;title:string;kind:string;status:string;version:number;assigneeId:string|null;dueOn?:string|null;dueTime?:string|null;endTime?:string|null;createdAt?:string;updatedAt?:string;updatedBy?:string|null;updatedEvent?:string|null;lastActivityAt?:string|null;data:Record<string,unknown>};
const field=(name:string,label:string,type:WorkflowField['type']='text',required=true):WorkflowField=>({name,label,type,required});
const select=(name:string,label:string,values:string[]):WorkflowField=>({...field(name,label,'select'),options:values.map(value=>({value,label:value.replaceAll('_',' ')}))});
const actorIs=(a:WorkspaceAccount,...roles:string[])=>roles.includes(a.role);
const admin=(a:WorkspaceAccount)=>actorIs(a,'admin','super_admin');
// Both clients use exact minor units and normalize empty optional dates to null.
export function workflowValues(fields:WorkflowField[],raw:Record<string,unknown>):Record<string,unknown>{
 const values:Record<string,unknown>={};
 for(const f of fields){
  // Photos are saved as they are chosen; the form sends the saved photos' ids.
  if(f.type==='photos'){const ids=Array.isArray(raw[f.name])?(raw[f.name] as unknown[]).filter((x):x is string=>typeof x==='string'):[];if(f.required&&!ids.length)throw new Error('Add at least one photo: '+f.label);values[f.name]=ids;continue;}
  if(f.type==='checkbox'){values[f.name]=raw[f.name]===true||raw[f.name]==='on';if(f.required&&!values[f.name])throw new Error('Please confirm: '+f.label);continue;}
  const text=String(raw[f.name]??'').trim();if(f.required&&!text)throw new Error('Please enter: '+f.label);
  if(f.type==='date'){values[f.name]=text||null;continue;}
  if(f.type==='money'||f.type==='number'||f.type==='percent'){
   if(!text){values[f.name]=undefined;continue;}
   const decimal=f.type!=='number',plain=text.replace(/%$/,'').trim();
   if(!(decimal?/^\d+(\.\d{1,2})?$/:/^\d+$/).test(plain))throw new Error('Enter a valid '+(f.type==='percent'?'percentage':'amount')+' for '+f.label);
   const [whole,fraction='']=plain.split('.');const value=decimal?Number(whole)*100+Number(fraction.padEnd(2,'0')):Number(whole);
   // Percentages are kept as basis points: 18.5% is 1850.
   if(f.type==='percent'&&value>10000)throw new Error(f.label+' must be 100% or less');
   if(!Number.isSafeInteger(value))throw new Error('The value is too large for '+f.label);values[f.name]=value;continue;
  }
  if(f.type==='select'&&f.options&&!f.options.some(o=>o.value===text))throw new Error('Choose an option for '+f.label);
  values[f.name]=text;
 }
 return values;
}
const ENQUIRY_KEYS=['contactName','companyName','email','phone','wcs','parking','garden','photoLink','notes'] as const;
// The enquiry form. The team fills it in for someone who has asked for an estimate (by message or
// phone), so it starts with their contact details; an owner signed in to their account skips those.
// No "Existing client?" any more (Alex, as on the landlord's form): older enquiries keep their answer (EnquiryDetails).
export function newEnquiryForm(team=false):WorkflowForm{
 const contact:WorkflowField[]=team?[field('contactName','Full name'),{...field('companyName','Company name','text',false),help:'If the property is owned by a company.'},{...field('email','Email','text',false),help:'An email or phone number is needed.'},field('phone','Contact number','text',false)]:[];
 const property:WorkflowField[]=[{...field('address','Full property address','textarea'),lookup:'postcode',help:'Include the postcode: the area and map position are found from it.'},{...field('name','Property name'),help:'A short name the team will recognise, e.g. "Leith Walk flat".'},{...field('region','Area','select',false),defaultValue:'',options:[{value:'',label:'Work it out from the address'},...SCOTTISH_REGIONS.map(value=>({value,label:value}))]},{...field('propertyType','Property type'),suggestions:PROPERTY_TYPES},{...field('bedrooms','Bedrooms','number'),suggestions:BEDROOM_CHOICES},{...field('wcs','WCs','number',false),suggestions:WC_CHOICES},{...field('bathrooms','Full bathrooms','number'),suggestions:BATHROOM_CHOICES},{...field('parking','Parking','text',false),suggestions:PARKING_CHOICES},{...field('garden','Garden','text',false),suggestions:GARDEN_CHOICES},{...field('photoLink','Link to photos or videos','text',false),help:'An https:// link, e.g. a shared album.'},field('notes','Anything else to know','textarea',false)];
 return {key:'enquiry',title:team?'Add a new property enquiry':'Add a property enquiry',description:team?'From the new property enquiry form: what we need to prepare the free performance estimate.':undefined,endpoint:'journeys',fields:[...contact,...property],build:v=>{
  const enquiry=Object.fromEntries(ENQUIRY_KEYS.filter(k=>v[k]!==undefined&&v[k]!=='').map(k=>[k,v[k]]));
  const rest=Object.fromEntries(Object.entries(v).filter(([k])=>!(ENQUIRY_KEYS as readonly string[]).includes(k)));
  return {action:'createEnquiry',...rest,...(Object.keys(enquiry).length?{enquiry}:{})};
 }};
}
// The estimate's comparables, checked before sending (Lee's live hotfix): each one is all three of the name, an https link
// and the nightly rate, or left empty. A filled field on its own says which comparable needs the rest.
export function estimateComparables(v:Record<string,unknown>):{name:string;url:string;adrMinor:number}[]{
 return Array.from({length:MAX_COMPARABLES},(_,i)=>i).flatMap(i=>{
  const name=String(v[`name${i}`]??'').trim(),url=String(v[`url${i}`]??'').trim(),rate=v[`adrMinor${i}`],n='Comparable '+(i+1);
  if(!name&&!url&&typeof rate!=='number')return [];
  if(/^(https?:|www\.)/i.test(name))throw new Error(n+' name: Put the link in the link field');
  if(!name||!url||typeof rate!=='number')throw new Error(n+': add the name, an https:// link and the nightly rate, or leave all three empty');
  if(!isHttpsLink(url))throw new Error(n+' link: '+HTTPS_LINK_MESSAGE);
  return [{name,url,adrMinor:rate}];
 });
}
export function journeyForms(a:WorkspaceAccount,j:JourneyView,today=workspaceDateKey(Date.now())):WorkflowForm[]{
 if(!admin(a)&&!a.modules.includes('property-onboarding')&&!(a.role==='ready'&&a.modules.includes('new-property-inspection-board')))return [];
 const forms:WorkflowForm[]=[],team=admin(a)||a.role==='stays',noOwner=j.ownerAccount===false||!j.clientId;
 // Without an owner account (the team beta) the team records the owner's steps for them.
 const owner=(a.role==='client'&&a.userId===j.clientId)||(team&&noOwner);
 const add=(action:string,title:string,fields:WorkflowField[],transform=(v:Record<string,unknown>)=>v,endpoint:WorkflowForm['endpoint']='journeys')=>forms.push({key:action,title,endpoint,fields,build:v=>({action,propertyId:j.propertyId,version:j.version,...transform(v)})});
 if(team&&['enquiry','estimate','reviewing'].includes(j.stage))add('publishEstimate','Publish the estimate',[field('lowRateMinor','Low nightly rate, GBP','money'),field('mediumRateMinor','Expected nightly rate, GBP','money'),field('highRateMinor','High nightly rate, GBP','money'),field('comments','Estimate notes','textarea',false),{...field('occupancyBps','Expected occupancy, %','percent',false),help:'The owner starts the explorer here, e.g. 70.'},{...field('directBookingBps','Expected direct bookings, %','percent',false),help:'Share of nights booked direct, with no platform fee, e.g. 10.'},{...field('otaFeeBps','Platform fee, %','percent',false),help:'Airbnb or Booking.com fee on platform bookings, e.g. 15.'},{...field('managementFeeBps','Recharge management fee, %','percent',false),help:'Charged on booking income. With the platform fee, this lets the owner see their earnings.'},...Array.from({length:MAX_COMPARABLES},(_,i)=>{const group='Comparable '+(i+1),after=i?{after:`name${i-1}`}:{};return [{...field(`name${i}`,'Name','text',false),group,section:group+' (optional)',...after},{...field(`url${i}`,'Link (https://)','text',false),group,...after},{...field(`adrMinor${i}`,'Nightly rate, GBP','money',false),group,...after}];}).flat(),...ownCostFields(j)],v=>({lowRateMinor:v.lowRateMinor,mediumRateMinor:v.mediumRateMinor,highRateMinor:v.highRateMinor,comments:v.comments||'',...Object.fromEntries(['occupancyBps','directBookingBps','otaFeeBps','managementFeeBps'].filter(k=>typeof v[k]==='number').map(k=>[k,v[k]])),comparables:estimateComparables(v),...ownCostsFrom(j,v)}));
 if(owner&&['estimate','reviewing'].includes(j.stage))add('decideEstimate',noOwner?'Record the owner\'s decision on the estimate':'Review your estimate',[{...field('decision',noOwner?'The owner\'s decision':'Your decision','select'),options:[{value:'proceed',label:'Proceed'},{value:'decline',label:'No, thank you'},{value:'review',label:'Thank you, I’ll be in touch'}]},field('feedback','Questions or feedback','textarea',false),{...field('followUpOn','Follow-up date','date',false),help:'Required with “Thank you, I’ll be in touch”.'}],v=>({...v,followUpOn:v.followUpOn||null}));
 if(team&&j.stage==='agreement')add('publishAgreement','Publish the management agreement',[{...field('agreement','Agreement supplied by Recharge','textarea'),help:'Use the actual approved contract. The app does not generate legal terms.'}]);
 if(owner&&j.stage==='agreement'&&j.agreementRevision>0)add('signAgreement',noOwner?'Record the signed agreement':'Accept the published agreement',noOwner?[field('signedName','Owner\'s full name as signed'),{...field('consent','The owner has signed the management agreement shown above','checkbox'),help:'Keep the signed copy with the property\'s files.'}]:[field('signedName','Your full name'),{...field('consent','I have read and agree to the management agreement shown above','checkbox'),help:'Your acceptance is saved with this exact agreement revision.'}],v=>({...v,agreementRevision:j.agreementRevision}));
 if(owner&&j.stage==='form')add('submitForm',noOwner?'Enter the property onboarding form':'Complete property setup',[
  field('businessName','Business or owner name'),{...field('bankAccountName','Bank account holder'),help:'Payout details: the account the owner wants payouts paid into.'},field('bankAccountNumber','UK account number, 8 digits'),field('bankSortCode','UK sort code'),{...field('accessDate','First access date','date'),help:'From when we can access the property for the first inspection.'},{...field('accessInfo','Access instructions','textarea'),help:'Is there a keybox? Where it is and its codes, or how we get keys. Kept private.'},
  {...field('gasElectricMeters','Gas and electric','textarea',false),help:'Connected? What meters (prepayment, smart)?'},{...field('operatingStatus','Current operating status','textarea',false),help:'Any current bookings, and their dates, so we can plan.'},
  field('utilitiesConnected','Utilities are connected','checkbox',false),{...field('utilityInstallDate','Planned utility connection','date',false),help:'Required if utilities are not connected.'},field('prepaymentMeters','The property has prepayment meters','checkbox',false),field('creditSwitchDate','Planned switch to credit meter','date',false),
  field('broadbandConnected','Broadband is connected','checkbox',false),field('broadbandInstallDate','Planned broadband installation','date',false),field('hasGarden','The property has a garden','checkbox',false),select('mailPreference','Mailbox permission',['photograph','open_and_photograph','leave_safely']),field('warrantyDetails','Warranty details','textarea',false),field('preferredRepairContact','Preferred repair contact','textarea',false),field('repairLimitMinor','Automatic repair budget per request, GBP','money'),field('fullRepairPermission','Authorise repairs without a budget limit','checkbox',false),select('furnishingChoice','Furnishing',['self','recharge']),field('licensingRequired','Licensing support is required','checkbox',false)
 ],v=>({form:v}));
 if(admin(a)&&noOwner&&!!j.signedAt&&!j.invoiceOutsideAt&&['form','invoice'].includes(j.stage))add('recordInvoiceOutside','Record the onboarding invoice (handled outside the app)',[{...field('note','Invoice reference and status','text'),help:'For example: "Xero INV-0123, paid 10 Oct". With no owner account the invoice is raised and paid outside the app.'}]);
 if(admin(a)&&!noOwner&&!j.invoiceId&&['form','invoice'].includes(j.stage)){
  forms.push({key:'createOnboardingInvoice',title:'Record the issued onboarding invoice',description:'This records the invoice. Sending it requires your email provider or manual delivery.',endpoint:'workspace',fields:[field('reference','Invoice reference'),field('amountMinor','Invoice amount, GBP','money')],build:(v,requestId)=>({action:'createInvoice',input:{...v,requestId,propertyId:j.propertyId,moduleId:'onboarding-invoices',recipientId:j.clientId,currency:'GBP'}})});
  add('linkInvoice','Link the onboarding invoice',[field('invoiceId','Issued onboarding invoice','select')]);
 }
 if((team||a.role==='ready')&&j.stage==='inspection_to_book')add('bookInspection','Book the property inspection',[field('inspectionOn','Inspection date','date')]);
 // The report opens on the booked inspection day; the database refuses it before then.
 if((team||a.role==='ready')&&j.stage==='inspection_booked'&&!!j.inspectionOn&&j.inspectionOn<=today)add('completeInspection','Submit the inspection report',[...INSPECTION_CHECKS.map(c=>field('check_'+c.key,c.label,'checkbox',false)),field('issues','Issues found (optional)','textarea',false),field('report','Findings and required work','textarea')],v=>({report:v.report,checks:Object.fromEntries(INSPECTION_CHECKS.map(c=>[c.key,v['check_'+c.key]===true])),...(typeof v.issues==='string'&&v.issues?{issues:v.issues}:{})}));
 if((owner||team)&&j.stage!=='live')add('askQuestion',owner?'Ask Recharge a question':'Add a question to this onboarding',[field('question','Your question','textarea')]);
 if(team)for(const q of (j.questions??[]).filter(q=>!q.answeredAt))forms.push({key:'answer-'+q.id,title:'Answer: '+(q.question.length>60?q.question.slice(0,57)+'…':q.question),endpoint:'journeys',fields:[field('answer','Your answer','textarea')],build:v=>({action:'answerQuestion',propertyId:j.propertyId,version:j.version,questionId:q.id,answer:v.answer})});
 if(team&&j.stage==='inspection_complete')add('makeLive','Record the live listing',[select('platform','Platform',['Airbnb','Booking.com','Direct','Comfy Workers']),field('url','Live listing HTTPS address')],v=>({listingLinks:[v]}));
 return forms;
}
// Before the booked inspection day, the date the report can be filed from (for those who will file
// it), shown where the form would be.
export function inspectionReportFrom(a:WorkspaceAccount,j:JourneyView,today=workspaceDateKey(Date.now())):string|null{
 if(j.stage!=='inspection_booked'||!j.inspectionOn||j.inspectionOn<=today)return null;
 return journeyForms(a,j,j.inspectionOn).some(f=>f.key==='completeInspection')?j.inspectionOn:null;
}
// While owner accounts are off (team beta), Stays and admins act for the owner on repair costs.
export const ownerByTeam=(a:WorkspaceAccount)=>a.teamOnly===true&&(admin(a)||a.role==='stays');
export function operationForms(a:WorkspaceAccount,w:OperationView):WorkflowForm[]{
 if(['completed','cancelled'].includes(w.status))return [];
 const forms:WorkflowForm[]=[],stays=admin(a)||a.role==='stays',ready=admin(a)||actorIs(a,'stays','ready');
 const add=(step:string,title:string,fields:WorkflowField[],transform=(v:Record<string,unknown>)=>v,unavailable?:string)=>forms.push({key:step,title,endpoint:'operations',fields,unavailable,workId:w.workId,build:v=>({action:'updateOperation',workId:w.workId,version:w.version,step,data:transform(v)})});
 if(w.kind==='daily_pricing'&&stays&&w.data.phase==='proposed')add('recordApplied','Record the applied pricing decision',[field('evidence','Where and when the price was held or changed','textarea')]);
 if(w.kind==='licensing'&&stays&&!w.data.phase)add('submitApplication','Record the submitted licence application',[field('authority','Licensing authority (council)'),field('applicationReference','Application reference'),field('submittedOn','Date submitted','date')]);
 if(w.kind==='licensing'&&stays&&w.data.phase==='applied')add('recordSafetyChecks','Record the safety checks',[field('gasSafety','Gas safety certificate','checkbox'),field('electrical','Electrical safety (EICR and PAT)','checkbox'),field('alarms','Smoke, heat and carbon monoxide alarms','checkbox'),field('legionella','Legionella risk assessment','checkbox'),field('epc','Energy performance certificate','checkbox'),field('insurance','Buildings and public liability insurance','checkbox'),field('evidence','Certificates and where they are filed','textarea')],v=>({checks:{gasSafety:v.gasSafety,electrical:v.electrical,alarms:v.alarms,legionella:v.legionella,epc:v.epc,insurance:v.insurance},evidence:v.evidence}));
 if(w.kind==='licensing'&&stays&&(!w.data.phase||w.data.phase==='checks_done'))add('recordGranted','Record an authority licence grant',[field('reference','Licence reference'),field('grantedOn','Grant date','date'),field('application','Application is complete','checkbox'),field('safetyChecks','Required safety checks are complete','checkbox'),field('authorityGrant','Authority has granted the licence','checkbox'),field('evidence','Actual grant evidence','textarea')],v=>({reference:v.reference,grantedOn:v.grantedOn,evidence:v.evidence,checklist:{application:v.application,safetyChecks:v.safetyChecks,authorityGrant:v.authorityGrant}}));
 if(w.kind==='relisting'&&stays&&(!w.data.phase||w.data.phase==='to_relist'))add('startRelisting','Start re-listing',[field('note','What is being done (new listing, photos, title)','textarea')]);
 if(['cleaning_setup','garden_setup','furnishing_quote','relisting'].includes(w.kind)&&!actorIs(a,'client','cleans'))add('completeHandover',w.kind==='relisting'?'Mark the property re-listed':'Complete this handover',[field('evidence',w.kind==='relisting'?'The new listing and what changed':'What was completed and supporting evidence','textarea')]);
 // Accounts raise the invoice from their task (the recipient is picked for them), then mark it done.
 const finance=admin(a)||a.role==='accounts';
 const minor=(k:string)=>typeof w.data[k]==='number'?((w.data[k] as number)/100).toFixed(2):undefined;
 if(finance&&['direct_booking_invoice','maintenance_invoice','cleaning_invoice'].includes(w.kind)&&typeof w.data.sourceWorkId==='string'){
  const amount=minor(w.kind==='maintenance_invoice'?'actualCostMinor':w.kind==='direct_booking_invoice'?'quoteAmountMinor':'');
  forms.push({key:'issueInvoice',title:'Issue the invoice',endpoint:'controls',
   description:w.kind==='cleaning_invoice'?'Addressed to the cleaner for this accepted clean.':w.kind==='maintenance_invoice'?'Addressed to the owner, for the actual repair cost.':'Addressed to the owner, for the agreed direct-booking amount.',
   fields:[field('reference','Invoice reference'),{...field('amountMinor','Invoice amount, GBP','money'),defaultValue:amount}],
   build:(v,requestId)=>({action:'issueOperationInvoice',requestId,propertyId:w.propertyId,workId:w.data.sourceWorkId,reference:v.reference,amountMinor:v.amountMinor})});
 }
 if(finance&&w.kind==='onboarding_invoice'&&typeof w.data.recipientId==='string')forms.push({key:'createOnboardingInvoice',title:'Record the onboarding invoice',endpoint:'workspace',
  description:'Addressed to the owner. It links to their onboarding, which moves on to the inspection once you record the payment in Reports.',
  fields:[field('reference','Invoice reference'),field('amountMinor','Invoice amount, GBP','money')],
  build:(v,requestId)=>({action:'createInvoice',input:{reference:v.reference,amountMinor:v.amountMinor,requestId,propertyId:w.propertyId,moduleId:'onboarding-invoices',recipientId:w.data.recipientId,currency:'GBP'}})});
 if(['onboarding_invoice','direct_booking_invoice','maintenance_invoice','cleaning_invoice'].includes(w.kind)&&!actorIs(a,'client','cleans'))add('completeHandover','Mark this invoice as done',[field('evidence','Invoice reference and how it was issued or recorded','textarea')]);
 if(w.kind==='direct_booking'&&stays){
  if(w.data.phase==='follow_up')add('prepareQuote','Prepare a direct-booking offer',[field('checkIn','Arrival','date'),field('checkOut','Departure','date'),field('baseAmountMinor','Original price, GBP','money')]);
  if(w.data.phase==='quoted')add('recordGuestAcceptance','Record guest acceptance',[field('guestEvidence','Guest agreement reference and notes','textarea')]);
  if(w.data.phase==='follow_up'||w.data.phase==='quoted')add('recordGuestDecline','The guest said no',[field('reason','What the guest said','textarea')]);
  if(w.data.phase==='accepted')add('confirmBooking','Confirm the paid booking',[{...field('invoiceId','Matching paid invoice','select'),help:'Accounts issue the booking invoice and record the payment; it then appears here.'},field('reference','Direct booking reference')]);
 }
 if(w.kind==='maintenance'){
  if(a.role==='client'&&w.data.phase==='owner_approval')add('approveBudget','Approve the quoted repair budget',[field('consent','I approve the estimated repair cost shown above','checkbox')]);
  if(a.role==='client'&&w.data.phase==='owner_approval')add('declineBudget','Decline the repair cost',[{...field('reason','Why you are declining','textarea'),help:'Shared with Recharge, who can get a new quote or close the repair.'}]);
  // Team beta: owners have no accounts, so the team records the owner's answer.
  if(ownerByTeam(a)&&w.data.phase==='owner_approval')add('approveBudget',"Record the owner's approval",[{...field('ownerAgreement','How the owner agreed','textarea'),help:'For example: by phone with the owner on 10 October.'},field('consent','The owner approved the estimated repair cost shown above','checkbox')]);
  if(ownerByTeam(a)&&w.data.phase==='owner_approval')add('declineBudget',"Record that the owner declined",[{...field('reason','What the owner said','textarea'),help:'The repair can then be re-quoted or closed.'}]);
  if(admin(a)&&w.data.phase==='management_approval'){
   add('approveManagement','Approve the repair cost (management)',[field('note','Note for the team','textarea',false)],v=>typeof v.note==='string'&&v.note?{note:v.note}:{});
   add('declineManagement','Decline the repair cost (management)',[{...field('reason','Why it is declined','textarea'),help:'Shared with Stays, who can re-quote or close the repair.'}]);
  }
  if(stays&&['owner_declined','management_declined'].includes(String(w.data.phase)))add('closeRepair','Close the declined repair',[field('note','Why it is closed without the work','textarea')]);
  if(stays&&w.data.phase==='triage')add('referReady','Refer the unresolved repair to Ready',[{...field('troubleshooting','Basic checks and outcome','textarea'),help:'Record safe user-facing checks only. For a suspected hazard, stop troubleshooting and escalate.'},field('warrantyContactEvidence','Warranty or preferred contact outcome','textarea',Boolean(w.data.warrantyRequired)),field('guestUpdate','Update for the guest','textarea'),{...field('urgent','Urgent: the guest cannot use the property properly until it is fixed','checkbox',false),defaultValue:w.data.urgent===true}]);
  if(ready&&w.data.phase==='referred')add('bookRepair','Book the repair',[field('repairOn','Repair date','date'),field('contractor','Repair contractor'),field('guestUpdate','Guest booking update','textarea')]);
  if(ready&&w.data.phase==='booked')add('completeRepair','Record the completed repair',[field('report','Repair completion report','textarea'),field('actualCostMinor','Actual repair cost, GBP','money'),field('guestUpdate','Guest completion update','textarea')]);
 }
 if(w.kind==='cleaning'){
  if(a.role==='cleans'&&w.assigneeId===a.userId&&w.data.phase==='assigned')add('submitCleaning','Submit your clean',[field('report','Cleaning report','textarea')],v=>v,'Open this clean from Cleans to tick the checklist and add your photos.');
  if((admin(a)||actorIs(a,'stays','cleaning_manager'))&&w.data.phase==='review')add('reviewCleaning','Review the clean and guest feedback',[field('accepted','Accept the completed clean','checkbox',false),field('guestFeedback','Guest feedback','textarea'),field('reviewNote','Management review','textarea')]);
 }
 if(w.kind==='purchase'){
  const purchasing=admin(a)||(a.role==='accounts'&&a.modules.includes('purchase-order-accounts'));
  if(purchasing&&w.data.phase==='requested')add('approvePurchase','Approve the purchase budget',[{...field('budgetItemId','Budget chart item (optional)','select',false),help:'Approving against the chart checks the amount is within the most each item should cost.'},{...field('quantity','How many','number',false),defaultValue:'1'},field('approvedAmountMinor','Approved amount, GBP','money'),field('approvalNote','Budget decision and reason','textarea')],v=>({approvedAmountMinor:v.approvedAmountMinor,approvalNote:v.approvalNote,...(typeof v.budgetItemId==='string'&&v.budgetItemId?{budgetItemId:v.budgetItemId,quantity:typeof v.quantity==='number'?v.quantity:1}:{})}));
  if(purchasing&&w.data.phase==='approved')add('recordOrder','Record the order',[field('orderReference','Order reference'),field('supplier','Supplier')]);
  if((admin(a)||a.role==='ready')&&w.data.phase==='ordered')add('recordDelivery','Record delivery',[field('receivedOn','Date received','date'),field('evidence','Delivery evidence','textarea'),{...field('photoIds','Photos of what arrived','photos'),purpose:'delivery',help:'Take a photo of each item, and the delivery note if there is one.'}]);
  // The supplier's invoice is recorded (and marked paid) first; reconciling then picks it.
  if(purchasing&&w.data.phase==='delivered')forms.push({key:'recordPurchaseInvoice',title:'Record the supplier invoice',endpoint:'finance',workId:w.workId,
   description:'The invoice from '+(typeof w.data.supplier==='string'?w.data.supplier:'the supplier')+', up to the approved amount. Reconcile the purchase once it is paid.',
   fields:[field('reference','Supplier invoice number'),{...field('amountMinor','Invoice amount, GBP','money'),defaultValue:minor('approvedAmountMinor')},{...field('paid','The supplier has been paid','checkbox',false),defaultValue:true},
    {...field('photoIds','Photo of the invoice (optional)','photos',false),purpose:'expense',help:'Photos and screenshots are saved with the purchase as you add them.'}],
   build:(v,requestId)=>({action:'recordPurchaseInvoice',requestId,purchaseId:w.workId,reference:v.reference,amountMinor:v.amountMinor,paid:v.paid===true})});
  if(purchasing&&w.data.phase==='delivered')add('reconcilePurchase','Reconcile the delivered purchase',[{...field('invoiceId','Paid purchase invoice','select'),help:'Record the supplier invoice first; once it is paid it appears here.'},field('reconciliation','Invoice and delivery checks','textarea')]);
 }
 return forms;
}
export function createOperationForms(a:WorkspaceAccount,propertyId:string):WorkflowForm[]{
 const forms:WorkflowForm[]=[],stays=admin(a)||a.role==='stays';
 const add=(kind:string,title:string,fields:WorkflowField[])=>forms.push({key:kind,title,endpoint:'operations',fields,build:v=>({action:'createOperation',propertyId,kind,data:v})});
 if(stays){
  add('listing_health','Record a listing health check',[field('checkedOn','Date checked','date'),select('platform','Listing platform',['Airbnb','Booking.com','Direct','Comfy Workers']),field('listingVisible','Listing is visible','checkbox',false),select('reviewSentiment','New review',['none','positive','negative']),field('reviewAcknowledged','The new review has been acknowledged','checkbox',false),field('suspended','Listing is suspended','checkbox',false),{...field('relist','Re-list this property','checkbox',false),help:'Hidden or suspended listings are re-listed automatically. Tick this to re-list after a really bad review.'},field('evidence','Check and review evidence','textarea')]);
  forms.push({key:'guest_review',title:'Log a guest review',endpoint:'operations',fields:[select('platform','Platform',['Airbnb','Booking.com','Direct','Comfy Workers']),field('reviewedOn','Review date','date'),{...field('rating','Rating','number'),help:'Stars on Airbnb (out of 5), score on Booking.com (out of 10).'},{...select('outOf','Out of',['5','10']),defaultValue:'5'},{...field('sentiment','Good or bad','select'),options:[{value:'positive',label:'Good'},{value:'neutral',label:'Mixed'},{value:'negative',label:'Bad'}]},field('summary','What the guest said','textarea'),field('response','How it was handled (optional)','textarea',false),{...field('relist','Re-list the property because of this review','checkbox',false),help:'Only for a bad review that will hurt the listing.'}],
   build:v=>({action:'createOperation',propertyId,kind:'guest_review',data:{platform:v.platform,reviewedOn:v.reviewedOn,rating:v.rating,outOf:Number(v.outOf),sentiment:v.sentiment,summary:v.summary,relist:v.relist===true,...(typeof v.response==='string'&&v.response?{response:v.response}:{})}})});
  add('daily_pricing','Record a vacant-night pricing decision',[field('night','Vacant night in the next seven days','date'),field('currentRateMinor','Current nightly rate, GBP','money'),field('proposedRateMinor','Proposed nightly rate, GBP','money'),select('decision','Pricing decision',['hold','change']),field('reason','Reason for this decision','textarea')]);
 }
 if(stays||a.role==='client')add('maintenance','Request reactive maintenance',[{...field('repairType','Type of repair','select'),options:Object.entries(REPAIR_GUIDES).map(([value,g])=>({value,label:g.label})),defaultValue:'other'},field('issue','What needs repairing?','textarea'),field('estimatedCostMinor','Estimated cost, GBP','money'),field('hazard','A hazard is suspected','checkbox',false),field('urgent','Urgent: guests cannot use the property properly until it is fixed','checkbox',false)]);
 if(stays||actorIs(a,'client','ready'))add('purchase','Request a property purchase',[field('requirements','Items needed and why','textarea'),field('budgetMinor','Maximum budget, GBP','money')]);
 if(stays||a.role==='cleaning_manager')forms.push({key:'cleaning',title:'Create a cleaning job',endpoint:'operations',fields:[field('dueOn','Cleaning date','date'),{...field('checklist','Required checks, one per line','textarea'),help:'Include the checks needed for this property, such as broadband and room readiness.'}],build:v=>({action:'createOperation',propertyId,kind:'cleaning',data:{dueOn:v.dueOn,checklist:String(v.checklist).split('\n').map(s=>s.trim()).filter(Boolean)}})});
 const feature:Record<string,string>={listing_health:'listing-health',guest_review:'listing-health',daily_pricing:'daily-pricing',maintenance:a.role==='client'?'client-property-maintenance':'stays-maintenance-reporting',purchase:a.role==='client'?'client-purchase-order-quotes':a.role==='ready'?'purchase-order':'purchase-order-requests',cleaning:'cleaning-schedule'};
 return forms.filter(f=>admin(a)||a.modules.some(m=>m===feature[f.key]));
}

// The steps a work item offers in its own sheet: its own steps, plus the steps elsewhere that move
// it on. The onboarding root item carries the whole journey; a Ready inspection ticket carries the
// booking and report steps; a purchase delivery ticket carries its purchase's delivery step. Each of
// those steps also closes the ticket.
const INSPECTION_STEPS=['bookInspection','completeInspection'];
export function workItemForms(a:WorkspaceAccount,w:OperationView,journeys:readonly JourneyView[],work:readonly OperationView[]=[]):WorkflowForm[]{
 const own=operationForms(a,w);
 if(['completed','cancelled'].includes(w.status))return own;
 if(w.kind==='purchase_delivery'){
  const source=work.find(x=>x.workId===w.data.sourceWorkId&&x.kind==='purchase');
  return source?[...own,...operationForms(a,source).filter(f=>f.key==='recordDelivery')]:own;
 }
 const j=journeys.find(x=>x.propertyId===w.propertyId);
 if(!j)return own;
 // The onboarding ticket offers "Publish the agreement from the contract" too, wherever it is opened (the onboarding
 // tracker, All work, Home), not only on the property's page.
 if(j.workId===w.workId)return [...own,...agreementTemplateForms(a,j),...journeyForms(a,j)];
 if(w.kind==='inspection')return [...own,...journeyForms(a,j).filter(f=>INSPECTION_STEPS.includes(f.key))];
 return own;
}

// Direct-booking offers wait for the confirmed discount policy, so that step shows as unavailable until then.
export const DISCOUNT_POLICY_WAITING='The discount policy awaits confirmation.';
export function gateDiscountPolicy(forms:readonly WorkflowForm[],policyConfirmed:boolean):WorkflowForm[]{
  return forms.map(f=>f.key==='prepareQuote'&&!policyConfirmed&&!f.unavailable?{...f,unavailable:DISCOUNT_POLICY_WAITING}:f);
}
