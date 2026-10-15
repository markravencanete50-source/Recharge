import { z } from 'zod';
import { parseAnalyticsDate } from './analytics';
import { cleanConditionSchema } from './clean-report';
const id=z.string().uuid(), text=(n:number)=>z.string().trim().max(n), money=z.number().int().min(0).max(10000000);
const date=z.string().refine(v=>Boolean(parseAnalyticsDate(v)),'Choose a valid date');
const photos=z.array(id).min(1).max(30);
// Repairs with contractors (migration 20261021200000): a visit window as 'HH:MM' (UK time), and the contractor's
// quote or invoice (photos, or PDFs where the media store takes them), up to 10 files.
const clock=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/,'Use a time like 09:30');
const files=z.array(id).min(1).max(10);
export const REPAIR_TYPES=['heating','hot_water','leak','toilet_drain','electrics','appliance','wifi','locks_access','pests','damage','other'] as const;
// Where a repair quote came from: the Ready team, or an outside contractor's estimate (management always approve those).
export const QUOTE_SOURCES=['team','contractor'] as const;
const base={action:z.literal('createOperation'),requestId:id,propertyId:id};
const update={action:z.literal('updateOperation'),requestId:id,workId:id,version:z.number().int().positive()};
const step=<T extends z.ZodRawShape>(name:string,shape:T)=>z.object({...update,step:z.literal(name),data:z.object(shape).strict()}).strict();
export const operationsActionSchema=z.union([
 z.object({action:z.literal('configureBookingPolicy'),requestId:id,version:z.number().int().positive(),minimumNights:z.number().int().min(1).max(365),discountBps:z.number().int().min(0).max(10000),discountCapMinor:money,confirmed:z.boolean()}).strict(),
 z.object({action:z.literal('recordReservation'),requestId:id,propertyId:id,reference:text(120).min(1),checkIn:date,checkOut:date,status:z.enum(['enquiry','confirmed','cancelled'])}).strict(),
 z.object({...base,kind:z.literal('listing_health'),data:z.object({checkedOn:date,platform:z.enum(['Airbnb','Booking.com','Direct','Comfy Workers']),listingVisible:z.boolean(),reviewSentiment:z.enum(['none','positive','negative']),reviewAcknowledged:z.boolean(),suspended:z.boolean(),evidence:text(2000).min(5),relist:z.boolean().optional()}).strict()}).strict(),
 z.object({...base,kind:z.literal('guest_review'),data:z.object({platform:z.enum(['Airbnb','Booking.com','Direct','Comfy Workers']),reviewedOn:date,rating:z.number().int().min(1).max(10),outOf:z.union([z.literal(5),z.literal(10)]),sentiment:z.enum(['positive','neutral','negative']),summary:text(2000).min(5),relist:z.boolean(),response:text(2000).optional()}).strict().refine(v=>v.rating<=v.outOf,'Rating is above the scale').refine(v=>!v.relist||v.sentiment==='negative','Only a bad review is sent for re-listing')}).strict(),
 z.object({...base,kind:z.literal('daily_pricing'),data:z.object({night:date,currentRateMinor:money,proposedRateMinor:money,decision:z.enum(['hold','change']),reason:text(2000).min(5)}).strict()}).strict(),
 z.object({...base,kind:z.literal('maintenance'),data:z.object({issue:text(3000).min(5),reservationId:id.optional(),estimatedCostMinor:money,hazard:z.boolean(),repairType:z.enum(REPAIR_TYPES).optional(),urgent:z.boolean().optional(),quoteSource:z.enum(QUOTE_SOURCES).optional(),guestConversationId:id.optional()}).strict()}).strict(),
 z.object({...base,kind:z.literal('cleaning'),data:z.object({dueOn:date,checklist:z.array(text(200).min(1)).min(1).max(30)}).strict()}).strict(),
 z.object({...base,kind:z.literal('purchase'),data:z.object({requirements:text(3000).min(5),budgetMinor:money}).strict()}).strict(),
 step('recordApplied',{evidence:text(2000).min(5)}),
 step('recordGranted',{reference:text(120).min(2),grantedOn:date,checklist:z.object({application:z.literal(true),safetyChecks:z.literal(true),authorityGrant:z.literal(true)}).strict(),evidence:text(3000).min(10)}),
 step('completeHandover',{evidence:text(3000).min(10)}),
 step('submitApplication',{authority:text(200).min(2),applicationReference:text(120).min(2),submittedOn:date}),
 step('recordSafetyChecks',{checks:z.object({gasSafety:z.literal(true),electrical:z.literal(true),alarms:z.literal(true),legionella:z.literal(true),epc:z.literal(true),insurance:z.literal(true)}).strict(),evidence:text(3000).min(10)}),
 step('startRelisting',{note:text(2000).min(5)}),
 step('recordGuestDecline',{reason:text(2000).min(5)}),
 step('prepareQuote',{checkIn:date,checkOut:date,baseAmountMinor:money}),
 step('recordGuestAcceptance',{guestEvidence:text(2000).min(10)}),
 step('confirmBooking',{invoiceId:id,reference:text(120).min(1)}),
 // The owner's approval; in the team beta the team records it with how the owner agreed.
 step('approveBudget',{consent:z.literal(true),ownerAgreement:text(500).min(5).optional()}),
 // readyUserId: the one contractor (a Ready user with access to the property) who gets the job.
 step('referReady',{troubleshooting:text(2000).min(5),warrantyContactEvidence:text(2000).optional(),guestUpdate:text(2000).min(5),urgent:z.boolean().optional(),readyUserId:id}),
 step('reassignReady',{readyUserId:id,reason:text(2000).min(5)}),
 // A repair still in triage closed without a visit: what fixed it (Stays or management; resolveRepair in the database).
 step('resolveRepair',{resolution:text(2000).min(5)}),
 z.object({...update,step:z.literal('bookRepair'),data:z.object({repairOn:date,contractor:text(200).min(2),guestUpdate:text(2000).min(5),visitFrom:clock,visitTo:clock}).strict()
  .refine(v=>v.visitFrom<v.visitTo,{message:'The visit must end after it starts',path:['visitTo']})}).strict(),
 step('completeRepair',{report:text(3000).min(10),actualCostMinor:money,guestUpdate:text(2000).min(5),photoIds:z.array(id).max(30).optional(),invoiceFileIds:files.optional()}),
 // quoteSource: a Ready team quote (the default) or a contractor's estimate, which management always approve.
 step('reviseQuote',{quoteMinor:money,reason:text(2000).min(5),quoteSource:z.enum(QUOTE_SOURCES).optional(),quoteFileIds:files.optional()}),
 // Saying no to a repair's cost: the owner, or management above the company-wide limit. Stays then
 // re-quote it or close it.
 step('declineBudget',{reason:text(2000).min(5)}),
 step('approveManagement',{note:text(2000).optional()}),
 step('declineManagement',{reason:text(2000).min(5)}),
 step('closeRepair',{note:text(2000).min(5)}),
 step('submitCleaning',{checks:z.array(text(200).min(1)).min(1).max(30),report:text(3000).min(5),photoIds:photos,mailAction:z.enum(['none','photograph','open_and_photograph','leave_safely']),mailNote:text(500).optional(),mailPhotoIds:z.array(id).min(1).max(20).optional(),condition:cleanConditionSchema.optional()}),
 step('reviewCleaning',{accepted:z.boolean(),guestFeedback:text(2000).min(5),reviewNote:text(2000).min(5)}),
 // The assigned cleaner reports a problem found on the clean; it becomes a repair for the Stays team.
 step('reportCleanProblem',{issue:text(3000).min(5),urgent:z.boolean(),repairType:z.enum(REPAIR_TYPES).optional(),photoIds:z.array(id).min(1).max(10).optional()}),
 step('approvePurchase',{approvedAmountMinor:money,approvalNote:text(2000).min(5),budgetItemId:id.optional(),quantity:z.number().int().min(1).max(100).optional()}),
 step('recordOrder',{orderReference:text(200).min(2),supplier:text(200).min(2)}),
 step('recordDelivery',{receivedOn:date,evidence:text(3000).min(10),photoIds:photos}),
 step('reconcilePurchase',{invoiceId:id,reconciliation:text(3000).min(10)}),
]);
export type OperationsAction=z.infer<typeof operationsActionSchema>;

// Both schemas are unions, which report only "Invalid input". Give the reason from the variant
// that matches the request's action (and step), naming the field.
export function validationReason(error:z.ZodError):string{
 let issue:z.ZodIssue|undefined=error.issues[0];
 if(issue?.code==='invalid_union')issue=issue.unionErrors.find(e=>!e.issues.some(i=>i.code==='invalid_literal'&&['action','step','kind'].includes(String(i.path[0]))))?.issues[0]??issue;
 if(!issue)return 'Check the details and try again';
 const field=[...issue.path].reverse().find(part=>typeof part==='string');
 return (field&&issue.code!=='invalid_union'?readableField(String(field))+': ':'')+issue.message;
}
const readableField=(name:string)=>name.replace(/Minor$/,'').replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().replace(/^./,c=>c.toUpperCase());
