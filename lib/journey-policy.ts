import { z } from 'zod';
import { parseAnalyticsDate } from './analytics';
import { validationReason } from './operations-policy';
import { ownCostsSchema } from './estimate-projection';
import { MAX_SIGNATURE_LENGTH, SIGNATURE_PATTERN } from './signature-png';
const id=z.string().uuid(), text=(max:number)=>z.string().trim().max(max), money=z.number().int().min(0).max(10000000);
const date=z.string().refine(v=>Boolean(parseAnalyticsDate(v)),'Choose a valid date');
// A link that does not parse ("Test") must fail validation, never throw: new URL throws, which used to surface as a 503.
export const HTTPS_LINK_MESSAGE='The link must start with https://';
export const isHttpsLink=(v:string)=>{try{return new URL(v).protocol==='https:';}catch{return false;}};
const https=z.string({required_error:HTTPS_LINK_MESSAGE,invalid_type_error:HTTPS_LINK_MESSAGE}).max(1000).refine(isHttpsLink,HTTPS_LINK_MESSAGE);
// A comparable on the estimate: the name, an https link and the nightly rate, each with a plain message.
// Up to 3 on a new estimate (Alex's Estimate Delivery: the consultant hand-picks up to 3 in External Analysis); the database
// checks the same number (migration 20261025300000). Estimates saved before, with up to 20 (Lee, 14 October), still read:
// MAX_SAVED_COMPARABLES is what a saved estimate may hold.
export const MAX_COMPARABLES=3;
export const MAX_SAVED_COMPARABLES=20;
const comparable=z.object({name:text(160).min(1,'Add the name').refine(v=>!/^(https?:|www\.)/i.test(v),'Put the link in the link field'),url:https,adrMinor:z.number({required_error:'Add the nightly rate',invalid_type_error:'Add the nightly rate'}).int().min(0).max(10000000)}).strict();
const base={requestId:id,propertyId:id,version:z.number().int().positive()};
// Item 7 (Lee, 16 October): at Proceed the owner says which repairs Recharge may approve without asking them. Saved as the
// property's limit in Limit Changer (migration 20261022300000), so the same bounds: whole pounds, 0 to 100,000.
export const REPAIR_LIMIT_QUESTION='Repairs we can approve without asking you';
export const REPAIR_LIMIT_HELP='Up to this amount per repair, we go ahead and tell you after. Above it, we ask you first.';
export const REPAIR_LIMIT_MESSAGE='Choose the repair limit in whole pounds, from 0 to 100,000';
export const REPAIR_LIMIT_OTHER_MESSAGE='Enter the amount in whole pounds, like 300';
export const MAX_REPAIR_LIMIT_MINOR=10000000;
export const REPAIR_LIMIT_DEFAULT='10000';
export const REPAIR_LIMIT_CHOICES=[{value:'0',label:'Always ask me (£0)'},{value:'10000',label:'Up to £100'},{value:'25000',label:'Up to £250'},{value:'50000',label:'Up to £500'},{value:'other',label:'Another amount'}] as const;
const repairLimit=z.number({invalid_type_error:REPAIR_LIMIT_MESSAGE}).int(REPAIR_LIMIT_MESSAGE).min(0,REPAIR_LIMIT_MESSAGE).max(MAX_REPAIR_LIMIT_MINOR,REPAIR_LIMIT_MESSAGE).multipleOf(100,REPAIR_LIMIT_MESSAGE);
export const repairLimitMinorSchema=repairLimit;
// The choice in words: "Always ask (£0)", "Up to £250".
export const repairLimitText=(minor:number)=>minor===0?'Always ask (£0)':`Up to £${(minor/100).toLocaleString('en-GB')}`;
// The amount from the choice, or from "Another amount" ("300", "£1,000"), in pence; or which field to fix.
export function repairLimitFrom(choice:string,other:string):{minor:number}|{field:'repairLimitMinor'|'repairLimitOther';error:string}{
 if(choice!=='other'){const minor=Number(choice);return REPAIR_LIMIT_CHOICES.some(c=>c.value===choice)?{minor}:{field:'repairLimitMinor',error:'Choose an option for the repair limit'};}
 const text=other.trim().replace(/^£\s*/,'');
 if(!/^\d{1,3}(,\d{3})*$|^\d+$/.test(text))return {field:'repairLimitOther',error:text?REPAIR_LIMIT_OTHER_MESSAGE:'Enter the amount, in whole pounds'};
 const minor=Number(text.replace(/,/g,''))*100;
 return repairLimit.safeParse(minor).success?{minor}:{field:'repairLimitOther',error:REPAIR_LIMIT_MESSAGE};
}
export const onboardingFormSchema=z.object({
 businessName:text(200).min(2),bankAccountName:text(200).min(2),bankAccountNumber:z.string().regex(/^\d{8}$/),bankSortCode:z.string().regex(/^\d{2}-?\d{2}-?\d{2}$/),
 accessDate:date,accessInfo:text(10000).min(2),utilitiesConnected:z.boolean(),utilityInstallDate:date.nullable().optional(),prepaymentMeters:z.boolean(),creditSwitchDate:date.nullable().optional(),
 broadbandConnected:z.boolean(),broadbandInstallDate:date.nullable().optional(),hasGarden:z.boolean(),mailPreference:z.enum(['photograph','open_and_photograph','leave_safely']),
 warrantyDetails:text(5000).default(''),preferredRepairContact:text(2000).default(''),repairLimitMinor:money,fullRepairPermission:z.boolean(),furnishingChoice:z.enum(['self','recharge']),licensingRequired:z.boolean(),
 gasElectricMeters:text(2000).optional(),operatingStatus:text(2000).optional(),
}).strict().superRefine((v,c)=>{
 for(const [needed,key] of [[!v.utilitiesConnected,'utilityInstallDate'],[v.prepaymentMeters,'creditSwitchDate'],[!v.broadbandConnected,'broadbandInstallDate']] as const)
  if(needed&&!v[key])c.addIssue({code:'custom',path:[key],message:'Provide the planned date'});
});
// The enquiry form's contact and property details. Blank answers are left out; the database
// requires a contact name and an email or phone number when there is no owner account.
const optionalText=(max:number)=>text(max).optional();
export const enquiryDetailsSchema=z.object({
 contactName:optionalText(300),companyName:optionalText(300),email:z.union([z.literal(''),z.string().trim().email().max(300)]).optional(),phone:z.union([z.literal(''),z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/,'Enter a valid phone number')]).optional(),
 existingClient:z.boolean().optional(),wcs:z.number().int().min(0).max(40).optional(),parking:optionalText(300),garden:optionalText(300),photoLink:z.union([z.literal(''),https]).optional(),notes:optionalText(3000),
}).strict();
export const journeyActionSchema=z.discriminatedUnion('action',[
 // startWhen: "When would you like to get started?" on an owner's own enquiry (migration 20261022300000 checks the choice),
 // and on one the team adds (20261022400000).
 z.object({action:z.literal('createEnquiry'),requestId:id,clientId:id.optional(),name:text(200).min(2),address:text(1000).min(5),region:text(200).default(''),propertyType:text(120).min(2),bedrooms:z.number().int().min(0).max(40),bathrooms:z.number().int().min(0).max(40),enquiry:enquiryDetailsSchema.optional(),startWhen:text(200).optional()}).strict(),
 z.object({action:z.literal('publishEstimate'),...base,lowRateMinor:money.min(100),mediumRateMinor:money.min(100),highRateMinor:money.min(100),comparables:z.array(comparable).max(MAX_COMPARABLES,`Up to ${MAX_COMPARABLES} comparables`),comments:text(5000).default(''),occupancyBps:z.number().int().min(0).max(10000).optional(),directBookingBps:z.number().int().min(0).max(10000).optional(),otaFeeBps:z.number().int().min(0).max(10000).optional(),managementFeeBps:z.number().int().min(0).max(10000).optional(),ownCosts:ownCostsSchema.optional()}).strict(),
 z.object({action:z.literal('decideEstimate'),...base,decision:z.enum(['proceed','review','decline']),feedback:text(5000).default(''),followUpOn:date.nullable().optional(),repairLimitMinor:repairLimit.optional()}).strict(),
 // The agreement typed in, or made from the contract in use (templateId, migration 20261020870000; the database fills it in).
 z.object({action:z.literal('publishAgreement'),...base,agreement:text(200000).min(20).optional(),templateId:id.optional(),format:z.enum(['text','outline']).optional()}).strict(),
 z.object({action:z.literal('signAgreement'),...base,agreementRevision:z.number().int().positive(),signedName:text(200).min(2),signatureImage:z.string().max(MAX_SIGNATURE_LENGTH).regex(SIGNATURE_PATTERN,'Draw your signature again').optional(),consent:z.literal(true)}).strict(),
 z.object({action:z.literal('submitForm'),...base,form:onboardingFormSchema}).strict(),
 z.object({action:z.literal('linkInvoice'),...base,invoiceId:id}).strict(),
 z.object({action:z.literal('recordInvoiceOutside'),...base,note:text(500).min(3)}).strict(),
 z.object({action:z.literal('bookInspection'),...base,inspectionOn:date}).strict(),
 z.object({action:z.literal('completeInspection'),...base,report:text(5000).min(10),checks:z.record(z.enum(['keysAccess','alarms','heatingHotWater','appliances','wifi','damage','furnishing','safetyItems','guestReady']),z.boolean()).optional(),issues:text(3000).optional()}).strict(),
 z.object({action:z.literal('askQuestion'),...base,question:text(2000).min(5)}).strict(),
 z.object({action:z.literal('answerQuestion'),...base,questionId:id,answer:text(2000).min(2)}).strict(),
 z.object({action:z.literal('makeLive'),...base,listingLinks:z.array(z.object({platform:z.enum(['Airbnb','Booking.com','Direct','Comfy Workers']),url:https}).strict()).min(1).max(10)}).strict(),
]);
export type JourneyAction=z.infer<typeof journeyActionSchema>;
export const journeyReadSchema=z.object({propertyId:id.optional()}).strict();
// The work list, or one work item by its id (opened from an update, migration 20261017300000).
export const operationsReadSchema=z.union([
 // The contractors (Ready users) who can take a repair at a property, for "Send to contractor" (lib/repair-contractors.ts).
 z.object({section:z.literal('repairContractors'),propertyId:id}).strict(),
 // Every owner's properties and their repair limits, for Limit Changer (admins read, super admins change).
 z.object({section:z.literal('repairLimits')}).strict(),
 // The repairs a cleaner reported and where each is up to (lib/cleaner-repairs.ts; cleaners only, the database checks).
 z.object({section:z.literal('cleanerRepairs')}).strict(),
 z.object({propertyId:id.optional(),workId:id.optional()}).strict().refine(v=>!(v.propertyId&&v.workId),{message:'Choose a property or a work item'}),
]);
// The journey route's 400 message. A comparable or a listing link is named in plain words ("Comparable 1 link: The link
// must start with https://"); everything else reads as validationReason has it.
const ITEM_LABELS:Record<string,[string,Record<string,string>]>={comparables:['Comparable',{name:'name',url:'link',adrMinor:'nightly rate'}],listingLinks:['Listing link',{platform:'platform',url:''}]};
// Which form field a refusal is about, so the app can show the message next to it: a top-level key ("mediumRateMinor"),
// or a comparable's field as the form names it ("url0" for the first comparable's link). Null when it is not one field.
export function journeyValidationField(error:z.ZodError):string|null{
 const [first,index,key]=error.issues[0]?.path??[];
 if(first==='comparables'&&typeof index==='number'&&typeof key==='string')return key+index;
 return typeof first==='string'&&index===undefined?first:null;
}
// The nightly rates go up: low, then expected, then high. The database refuses them out of order with the same words
// (migration 20261022300000); the form and the server check first and say which rate.
export type FieldIssue={field:string;message:string};
export const RATE_ORDER_MESSAGES={mediumRateMinor:'The expected nightly rate must be at least the low nightly rate',highRateMinor:'The high nightly rate must be at least the expected nightly rate'} as const;
export function estimateRateIssues(v:{lowRateMinor?:unknown;mediumRateMinor?:unknown;highRateMinor?:unknown}):FieldIssue[]{
 const n=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)?x:null,[low,mid,high]=[n(v.lowRateMinor),n(v.mediumRateMinor),n(v.highRateMinor)];
 const issues:FieldIssue[]=[];
 if(low!==null&&mid!==null&&mid<low)issues.push({field:'mediumRateMinor',message:RATE_ORDER_MESSAGES.mediumRateMinor});
 if(mid!==null&&high!==null&&high<mid)issues.push({field:'highRateMinor',message:RATE_ORDER_MESSAGES.highRateMinor});
 return issues;
}
export function journeyValidationReason(error:z.ZodError):string{
 const issue=error.issues[0],[list,index,key]=issue?.path??[],item=typeof list==='string'?ITEM_LABELS[list]:undefined;
 if(!issue||!item||typeof index!=='number')return validationReason(error);
 const part=typeof key==='string'?item[1][key]??key:'';
 return `${item[0]} ${index+1}${part?' '+part:''}: ${issue.message}`;
}
