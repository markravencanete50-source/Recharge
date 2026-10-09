import { z } from 'zod';
import { parseAnalyticsDate } from './analytics';
const id=z.string().uuid(), text=(max:number)=>z.string().trim().max(max), money=z.number().int().min(0).max(10000000);
const date=z.string().refine(v=>Boolean(parseAnalyticsDate(v)),'Choose a valid date');
const https=z.string().url().max(1000).refine(v=>new URL(v).protocol==='https:','Use HTTPS');
const base={requestId:id,propertyId:id,version:z.number().int().positive()};
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
 z.object({action:z.literal('createEnquiry'),requestId:id,clientId:id.optional(),name:text(200).min(2),address:text(1000).min(5),region:text(200).default(''),propertyType:text(120).min(2),bedrooms:z.number().int().min(0).max(40),bathrooms:z.number().int().min(0).max(40),enquiry:enquiryDetailsSchema.optional()}).strict(),
 z.object({action:z.literal('publishEstimate'),...base,lowRateMinor:money.min(100),mediumRateMinor:money.min(100),highRateMinor:money.min(100),comparables:z.array(z.object({name:text(160).min(1),url:https,adrMinor:money}).strict()).max(3),comments:text(5000).default(''),occupancyBps:z.number().int().min(0).max(10000).optional(),directBookingBps:z.number().int().min(0).max(10000).optional(),otaFeeBps:z.number().int().min(0).max(10000).optional(),managementFeeBps:z.number().int().min(0).max(10000).optional()}).strict(),
 z.object({action:z.literal('decideEstimate'),...base,decision:z.enum(['proceed','review','decline']),feedback:text(5000).default(''),followUpOn:date.nullable().optional()}).strict(),
 z.object({action:z.literal('publishAgreement'),...base,agreement:text(10000).min(20)}).strict(),
 z.object({action:z.literal('signAgreement'),...base,agreementRevision:z.number().int().positive(),signedName:text(200).min(2),consent:z.literal(true)}).strict(),
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
