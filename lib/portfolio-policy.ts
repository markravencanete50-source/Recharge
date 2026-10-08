import { z } from 'zod';
import { parseAnalyticsDate } from './analytics';
const id=z.string().uuid(),text=(n:number)=>z.string().trim().max(n),date=z.string().refine(v=>Boolean(parseAnalyticsDate(v)));
export const portfolioReadSchema=z.object({section:z.enum(['portfolio','bookingPolicy','reservations','vacancies','weekly','notifications','onboardingPayout','insights']).default('portfolio'),propertyId:id.optional(),from:date.optional(),to:date.optional(),download:z.literal('csv').optional()}).strict().superRefine((v,c)=>{
 if(!['portfolio','bookingPolicy','notifications','insights'].includes(v.section)&&!v.propertyId)c.addIssue({code:'custom',message:'Choose a property'});
 if(v.section==='weekly'&&(!v.from||!v.to||v.from>v.to||Date.parse(v.to)-Date.parse(v.from)>30*86400000))c.addIssue({code:'custom',message:'Choose up to 31 report days'});
 if(v.download&&v.section!=='weekly')c.addIssue({code:'custom',message:'Choose a weekly property report'});
 if(v.section!=='weekly'&&(v.from||v.to))c.addIssue({code:'custom',message:'Dates apply to weekly reports only'});
});
const base={requestId:id,propertyId:id};
export const LISTING_PLATFORMS=['Airbnb','Booking.com','Vrbo','Direct','Channel manager','Comfy Workers'] as const;
export const portfolioActionSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('saveLocation'),...base,version:z.number().int().positive(),latitude:z.number().min(-90).max(90).nullable(),longitude:z.number().min(-180).max(180).nullable(),hostawayListingId:text(100).default('')}).strict(),
 z.object({action:z.literal('saveListingLinks'),...base,links:z.array(z.object({platform:z.enum(LISTING_PLATFORMS),url:z.string().max(1000).refine(v=>v===''||/^https:\/\/[^/@\s]+([/:?#]|$)/.test(v),'Listing links must start with https://').default(''),listingId:z.string().max(100).regex(/^[A-Za-z0-9._:-]*$/,'Listing IDs use letters, numbers, dots, dashes or colons').default('')}).strict().refine(l=>l.url!==''||l.listingId!=='','Give each listing a link or an ID')).max(12)}).strict(),
 z.object({action:z.literal('recordLocalEvent'),...base,name:text(200).min(2),eventOn:date,sourceUrl:z.string().url().max(1000).refine(v=>new URL(v).protocol==='https:'),opportunity:text(2000).min(5)}).strict(),
]);
export type PortfolioAction=z.infer<typeof portfolioActionSchema>;
