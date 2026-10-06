import { z } from 'zod';
import { parseAnalyticsDate } from './analytics';
const id=z.string().uuid(), text=(n:number)=>z.string().trim().max(n), money=z.number().int().min(0).max(10000000);
const date=z.string().refine(v=>Boolean(parseAnalyticsDate(v)),'Choose a valid date');
const photos=z.array(id).min(1).max(30);
const base={action:z.literal('createOperation'),requestId:id,propertyId:id};
const update={action:z.literal('updateOperation'),requestId:id,workId:id,version:z.number().int().positive()};
const step=<T extends z.ZodRawShape>(name:string,shape:T)=>z.object({...update,step:z.literal(name),data:z.object(shape).strict()}).strict();
export const operationsActionSchema=z.union([
 z.object({action:z.literal('configureBookingPolicy'),requestId:id,version:z.number().int().positive(),minimumNights:z.number().int().min(1).max(365),discountBps:z.number().int().min(0).max(10000),discountCapMinor:money,confirmed:z.boolean()}).strict(),
 z.object({action:z.literal('recordReservation'),requestId:id,propertyId:id,reference:text(120).min(1),checkIn:date,checkOut:date,status:z.enum(['enquiry','confirmed','cancelled'])}).strict(),
 z.object({...base,kind:z.literal('listing_health'),data:z.object({checkedOn:date,platform:z.enum(['Airbnb','Booking.com','Direct','Comfy Workers']),listingVisible:z.boolean(),reviewSentiment:z.enum(['none','positive','negative']),reviewAcknowledged:z.boolean(),suspended:z.boolean(),evidence:text(2000).min(5)}).strict()}).strict(),
 z.object({...base,kind:z.literal('daily_pricing'),data:z.object({night:date,currentRateMinor:money,proposedRateMinor:money,decision:z.enum(['hold','change']),reason:text(2000).min(5)}).strict()}).strict(),
 z.object({...base,kind:z.literal('maintenance'),data:z.object({issue:text(3000).min(5),reservationId:id.optional(),estimatedCostMinor:money,hazard:z.boolean()}).strict()}).strict(),
 z.object({...base,kind:z.literal('cleaning'),data:z.object({dueOn:date,checklist:z.array(text(200).min(1)).min(1).max(30)}).strict()}).strict(),
 z.object({...base,kind:z.literal('purchase'),data:z.object({requirements:text(3000).min(5),budgetMinor:money}).strict()}).strict(),
 step('recordApplied',{evidence:text(2000).min(5)}),
 step('recordGranted',{reference:text(120).min(2),grantedOn:date,checklist:z.object({application:z.literal(true),safetyChecks:z.literal(true),authorityGrant:z.literal(true)}).strict(),evidence:text(3000).min(10)}),
 step('completeHandover',{evidence:text(3000).min(10)}),
 step('prepareQuote',{checkIn:date,checkOut:date,baseAmountMinor:money}),
 step('recordGuestAcceptance',{guestEvidence:text(2000).min(10)}),
 step('confirmBooking',{invoiceId:id,reference:text(120).min(1)}),
 step('approveBudget',{consent:z.literal(true)}),
 step('referReady',{troubleshooting:text(2000).min(5),warrantyContactEvidence:text(2000).optional(),guestUpdate:text(2000).min(5)}),
 step('bookRepair',{repairOn:date,contractor:text(200).min(2),guestUpdate:text(2000).min(5)}),
 step('completeRepair',{report:text(3000).min(10),actualCostMinor:money,guestUpdate:text(2000).min(5)}),
 step('submitCleaning',{checks:z.array(text(200).min(1)).min(1).max(30),report:text(3000).min(5),photoIds:photos,mailAction:z.enum(['none','photograph','open_and_photograph','leave_safely'])}),
 step('reviewCleaning',{accepted:z.boolean(),guestFeedback:text(2000).min(5),reviewNote:text(2000).min(5)}),
 step('approvePurchase',{approvedAmountMinor:money,approvalNote:text(2000).min(5)}),
 step('recordOrder',{orderReference:text(200).min(2),supplier:text(200).min(2)}),
 step('recordDelivery',{receivedOn:date,evidence:text(3000).min(10),photoIds:photos}),
 step('reconcilePurchase',{invoiceId:id,reconciliation:text(3000).min(10)}),
]);
export type OperationsAction=z.infer<typeof operationsActionSchema>;
