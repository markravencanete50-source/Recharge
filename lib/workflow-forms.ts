import type { WorkspaceAccount } from './workspace-account-policy';
export type WorkflowField={name:string;label:string;type?:'text'|'textarea'|'number'|'money'|'date'|'checkbox'|'select';options?:{value:string;label:string}[];required?:boolean;defaultValue?:string|boolean;help?:string};
export type WorkflowForm={key:string;title:string;description?:string;endpoint:'journeys'|'operations'|'workspace'|'portfolio';fields:WorkflowField[];build:(values:Record<string,unknown>,requestId:string)=>Record<string,unknown>;unavailable?:string};
export type JourneyView={propertyId:string;clientId:string;workId:string;stage:string;version:number;agreement:string;agreementRevision:number;signedName:string|null;inspectionReport:string|null;invoiceId:string|null;estimate:Record<string,unknown>|null;form:Record<string,unknown>|null};
export type OperationView={workId:string;propertyId:string;moduleId:string;title:string;kind:string;status:string;version:number;assigneeId:string|null;data:Record<string,unknown>};
const field=(name:string,label:string,type:WorkflowField['type']='text',required=true):WorkflowField=>({name,label,type,required});
const select=(name:string,label:string,values:string[]):WorkflowField=>({...field(name,label,'select'),options:values.map(value=>({value,label:value.replaceAll('_',' ')}))});
const actorIs=(a:WorkspaceAccount,...roles:string[])=>roles.includes(a.role);
const admin=(a:WorkspaceAccount)=>actorIs(a,'admin','super_admin');
// Both clients use exact minor units and normalize empty optional dates to null.
export function workflowValues(fields:WorkflowField[],raw:Record<string,unknown>):Record<string,unknown>{
 const values:Record<string,unknown>={};
 for(const f of fields){
  if(f.type==='checkbox'){values[f.name]=raw[f.name]===true||raw[f.name]==='on';if(f.required&&!values[f.name])throw new Error('Please confirm: '+f.label);continue;}
  const text=String(raw[f.name]??'').trim();if(f.required&&!text)throw new Error('Please enter: '+f.label);
  if(f.type==='date'){values[f.name]=text||null;continue;}
  if(f.type==='money'||f.type==='number'){
   if(!text){values[f.name]=undefined;continue;}
   if(!(f.type==='money'?/^\d+(\.\d{1,2})?$/:/^\d+$/).test(text))throw new Error('Enter a valid amount for '+f.label);
   const [whole,fraction='']=text.split('.');const value=f.type==='money'?Number(whole)*100+Number(fraction.padEnd(2,'0')):Number(whole);
   if(!Number.isSafeInteger(value))throw new Error('The value is too large for '+f.label);values[f.name]=value;continue;
  }
  if(f.type==='select'&&f.options&&!f.options.some(o=>o.value===text))throw new Error('Choose an option for '+f.label);
  values[f.name]=text;
 }
 return values;
}
export function newEnquiryForm():WorkflowForm{return {key:'enquiry',title:'Add a property enquiry',endpoint:'journeys',fields:[field('name','Property name'),field('address','Full property address','textarea'),field('region','Region'),field('propertyType','Property type'),field('bedrooms','Bedrooms','number'),field('bathrooms','Bathrooms','number')],build:v=>({action:'createEnquiry',...v})};}
export function journeyForms(a:WorkspaceAccount,j:JourneyView):WorkflowForm[]{
 if(!admin(a)&&!a.modules.includes('property-onboarding')&&!(a.role==='ready'&&a.modules.includes('new-property-inspection-board')))return [];
 const forms:WorkflowForm[]=[],team=admin(a)||a.role==='stays',owner=a.role==='client'&&a.userId===j.clientId;
 const add=(action:string,title:string,fields:WorkflowField[],transform=(v:Record<string,unknown>)=>v,endpoint:WorkflowForm['endpoint']='journeys')=>forms.push({key:action,title,endpoint,fields,build:v=>({action,propertyId:j.propertyId,version:j.version,...transform(v)})});
 if(team&&['enquiry','estimate','reviewing'].includes(j.stage))add('publishEstimate','Publish the estimate',[field('lowRateMinor','Low nightly rate, GBP','money'),field('mediumRateMinor','Expected nightly rate, GBP','money'),field('highRateMinor','High nightly rate, GBP','money'),field('comments','Estimate notes','textarea',false),...Array.from({length:3},(_,i)=>[field(`name${i}`,'Comparable '+(i+1)+' name','text',false),field(`url${i}`,'Comparable '+(i+1)+' HTTPS link','text',false),field(`adrMinor${i}`,'Comparable '+(i+1)+' nightly rate, GBP','money',false)]).flat()],v=>({lowRateMinor:v.lowRateMinor,mediumRateMinor:v.mediumRateMinor,highRateMinor:v.highRateMinor,comments:v.comments||'',comparables:[0,1,2].filter(i=>v[`name${i}`]||v[`url${i}`]).map(i=>({name:v[`name${i}`],url:v[`url${i}`],adrMinor:v[`adrMinor${i}`]}))}));
 if(owner&&['estimate','reviewing'].includes(j.stage))add('decideEstimate','Review your estimate',[select('decision','Your decision',['proceed','review','decline']),field('feedback','Questions or feedback','textarea',false),{...field('followUpOn','Follow-up date','date',false),help:'Required when you need more time.'}],v=>({...v,followUpOn:v.followUpOn||null}));
 if(team&&j.stage==='agreement')add('publishAgreement','Publish the management agreement',[{...field('agreement','Agreement supplied by Recharge','textarea'),help:'Use the actual approved contract. The app does not generate legal terms.'}]);
 if(owner&&j.stage==='agreement'&&j.agreementRevision>0)add('signAgreement','Accept the published agreement',[field('signedName','Your full name'),{...field('consent','I have read and agree to the management agreement shown above','checkbox'),help:'Your acceptance is saved with this exact agreement revision.'}],v=>({...v,agreementRevision:j.agreementRevision}));
 if(owner&&j.stage==='form')add('submitForm','Complete property setup',[
  field('businessName','Business or owner name'),field('bankAccountName','Bank account holder'),field('bankAccountNumber','UK account number, 8 digits'),field('bankSortCode','UK sort code'),field('accessDate','First access date','date'),field('accessInfo','Access instructions','textarea'),
  field('utilitiesConnected','Utilities are connected','checkbox',false),{...field('utilityInstallDate','Planned utility connection','date',false),help:'Required if utilities are not connected.'},field('prepaymentMeters','The property has prepayment meters','checkbox',false),field('creditSwitchDate','Planned switch to credit meter','date',false),
  field('broadbandConnected','Broadband is connected','checkbox',false),field('broadbandInstallDate','Planned broadband installation','date',false),field('hasGarden','The property has a garden','checkbox',false),select('mailPreference','Mailbox permission',['photograph','open_and_photograph','leave_safely']),field('warrantyDetails','Warranty details','textarea',false),field('preferredRepairContact','Preferred repair contact','textarea',false),field('repairLimitMinor','Automatic repair budget per request, GBP','money'),field('fullRepairPermission','Authorise repairs without a budget limit','checkbox',false),select('furnishingChoice','Furnishing',['self','recharge']),field('licensingRequired','Licensing support is required','checkbox',false)
 ],v=>({form:v}));
 if(admin(a)&&!j.invoiceId&&['form','invoice'].includes(j.stage)){
  forms.push({key:'createOnboardingInvoice',title:'Record the issued onboarding invoice',description:'This records the invoice. Sending it requires your email provider or manual delivery.',endpoint:'workspace',fields:[field('reference','Invoice reference'),field('amountMinor','Invoice amount, GBP','money')],build:(v,requestId)=>({action:'createInvoice',input:{...v,requestId,propertyId:j.propertyId,moduleId:'onboarding-invoices',recipientId:j.clientId,currency:'GBP'}})});
  add('linkInvoice','Link the onboarding invoice',[field('invoiceId','Issued onboarding invoice','select')]);
 }
 if((team||a.role==='ready')&&j.stage==='inspection_to_book')add('bookInspection','Book the property inspection',[field('inspectionOn','Inspection date','date')]);
 if((team||a.role==='ready')&&j.stage==='inspection_booked')add('completeInspection','Submit the inspection report',[field('report','Findings and required work','textarea')]);
 if(team&&j.stage==='inspection_complete')add('makeLive','Record the live listing',[select('platform','Platform',['Airbnb','Booking.com','Direct','Comfy Workers']),field('url','Live listing HTTPS address')],v=>({listingLinks:[v]}));
 return forms;
}
export function operationForms(a:WorkspaceAccount,w:OperationView):WorkflowForm[]{
 if(['completed','cancelled'].includes(w.status))return [];
 const forms:WorkflowForm[]=[],stays=admin(a)||a.role==='stays',ready=admin(a)||actorIs(a,'stays','ready');
 const add=(step:string,title:string,fields:WorkflowField[],transform=(v:Record<string,unknown>)=>v,unavailable?:string)=>forms.push({key:step,title,endpoint:'operations',fields,unavailable,build:v=>({action:'updateOperation',workId:w.workId,version:w.version,step,data:transform(v)})});
 if(w.kind==='daily_pricing'&&stays&&w.data.phase==='proposed')add('recordApplied','Record the applied pricing decision',[field('evidence','Where and when the price was held or changed','textarea')]);
 if(w.kind==='licensing'&&stays)add('recordGranted','Record an authority licence grant',[field('reference','Licence reference'),field('grantedOn','Grant date','date'),field('application','Application is complete','checkbox'),field('safetyChecks','Required safety checks are complete','checkbox'),field('authorityGrant','Authority has granted the licence','checkbox'),field('evidence','Actual grant evidence','textarea')],v=>({reference:v.reference,grantedOn:v.grantedOn,evidence:v.evidence,checklist:{application:v.application,safetyChecks:v.safetyChecks,authorityGrant:v.authorityGrant}}));
 if(['cleaning_setup','garden_setup','furnishing_quote','relisting'].includes(w.kind)&&!actorIs(a,'client','cleans'))add('completeHandover','Complete this handover',[field('evidence','What was completed and supporting evidence','textarea')]);
 if(w.kind==='direct_booking'&&stays){
  if(w.data.phase==='follow_up')add('prepareQuote','Prepare a direct-booking offer',[field('checkIn','Arrival','date'),field('checkOut','Departure','date'),field('baseAmountMinor','Original price, GBP','money')]);
  if(w.data.phase==='quoted')add('recordGuestAcceptance','Record guest acceptance',[field('guestEvidence','Guest agreement reference and notes','textarea')]);
  if(w.data.phase==='accepted')add('confirmBooking','Confirm the paid booking',[field('invoiceId','Matching paid invoice','select'),field('reference','Direct booking reference')]);
 }
 if(w.kind==='maintenance'){
  if(a.role==='client'&&w.data.phase==='owner_approval')add('approveBudget','Approve the quoted repair budget',[field('consent','I approve the estimated repair cost shown above','checkbox')]);
  if(stays&&w.data.phase==='triage')add('referReady','Refer the unresolved repair to Ready',[{...field('troubleshooting','Basic checks and outcome','textarea'),help:'Record safe user-facing checks only. For a suspected hazard, stop troubleshooting and escalate.'},field('warrantyContactEvidence','Warranty or preferred contact outcome','textarea',Boolean(w.data.warrantyRequired)),field('guestUpdate','Update for the guest','textarea')]);
  if(ready&&w.data.phase==='referred')add('bookRepair','Book the repair',[field('repairOn','Repair date','date'),field('contractor','Repair contractor'),field('guestUpdate','Guest booking update','textarea')]);
  if(ready&&w.data.phase==='booked')add('completeRepair','Record the completed repair',[field('report','Repair completion report','textarea'),field('actualCostMinor','Actual repair cost, GBP','money'),field('guestUpdate','Guest completion update','textarea')]);
 }
 if(w.kind==='cleaning'){
  if(a.role==='cleans'&&w.assigneeId===a.userId&&w.data.phase==='assigned')add('submitCleaning','Submit your clean',[field('report','Cleaning report','textarea')],v=>v,'Photo upload must be connected before a clean can be submitted.');
  if((admin(a)||actorIs(a,'stays','cleaning_manager'))&&w.data.phase==='review')add('reviewCleaning','Review the clean and guest feedback',[field('accepted','Accept the completed clean','checkbox',false),field('guestFeedback','Guest feedback','textarea'),field('reviewNote','Management review','textarea')]);
 }
 if(w.kind==='purchase'){
  if(admin(a)&&w.data.phase==='requested')add('approvePurchase','Approve the purchase budget',[field('approvedAmountMinor','Approved amount, GBP','money'),field('approvalNote','Budget decision and reason','textarea')]);
  if(admin(a)&&w.data.phase==='approved')add('recordOrder','Record the order',[field('orderReference','Order reference'),field('supplier','Supplier')]);
  if((admin(a)||a.role==='ready')&&w.data.phase==='ordered')add('recordDelivery','Record delivery',[field('receivedOn','Date received','date'),field('evidence','Delivery evidence','textarea')],v=>v,'Verified delivery photos require the media connection.');
  if(admin(a)&&w.data.phase==='delivered')add('reconcilePurchase','Reconcile the delivered purchase',[field('invoiceId','Paid purchase invoice','select'),field('reconciliation','Invoice and delivery checks','textarea')]);
 }
 return forms;
}
export function createOperationForms(a:WorkspaceAccount,propertyId:string):WorkflowForm[]{
 const forms:WorkflowForm[]=[],stays=admin(a)||a.role==='stays';
 const add=(kind:string,title:string,fields:WorkflowField[])=>forms.push({key:kind,title,endpoint:'operations',fields,build:v=>({action:'createOperation',propertyId,kind,data:v})});
 if(stays){
  add('listing_health','Record a listing health check',[field('checkedOn','Date checked','date'),select('platform','Listing platform',['Airbnb','Booking.com','Direct','Comfy Workers']),field('listingVisible','Listing is visible','checkbox',false),select('reviewSentiment','New review',['none','positive','negative']),field('reviewAcknowledged','The new review has been acknowledged','checkbox',false),field('suspended','Listing is suspended','checkbox',false),field('evidence','Check and review evidence','textarea')]);
  add('daily_pricing','Record a vacant-night pricing decision',[field('night','Vacant night in the next seven days','date'),field('currentRateMinor','Current nightly rate, GBP','money'),field('proposedRateMinor','Proposed nightly rate, GBP','money'),select('decision','Pricing decision',['hold','change']),field('reason','Reason for this decision','textarea')]);
 }
 if(stays||a.role==='client')add('maintenance','Request a property repair',[field('issue','What needs repairing?','textarea'),field('estimatedCostMinor','Estimated cost, GBP','money'),field('hazard','A hazard is suspected','checkbox',false)]);
 if(stays||actorIs(a,'client','ready'))add('purchase','Request a property purchase',[field('requirements','Items needed and why','textarea'),field('budgetMinor','Maximum budget, GBP','money')]);
 if(stays||a.role==='cleaning_manager')forms.push({key:'cleaning',title:'Create a cleaning job',endpoint:'operations',fields:[field('dueOn','Cleaning date','date'),{...field('checklist','Required checks, one per line','textarea'),help:'Include the checks needed for this property, such as broadband and room readiness.'}],build:v=>({action:'createOperation',propertyId,kind:'cleaning',data:{dueOn:v.dueOn,checklist:String(v.checklist).split('\n').map(s=>s.trim()).filter(Boolean)}})});
 const feature:Record<string,string>={listing_health:'listing-health',daily_pricing:'daily-pricing',maintenance:a.role==='client'?'client-property-maintenance':'stays-maintenance-reporting',purchase:a.role==='client'?'client-purchase-order-quotes':a.role==='ready'?'purchase-order':'purchase-order-requests',cleaning:'cleaning-schedule'};
 return forms.filter(f=>admin(a)||a.modules.some(m=>m===feature[f.key]));
}
