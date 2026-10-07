import { z } from "zod";

// Response shapes the live Cleans screens rely on, shared with the tests that
// check them against the real database functions.
export const scheduleSchema = z.object({
  work: z.array(z.object({ workId: z.string().uuid(), propertyId: z.string().uuid(), propertyName: z.string(), title: z.string(), status: z.string(), dueOn: z.string().nullable(), assigneeId: z.string().nullable(), assigneeName: z.string().nullable(), kind: z.string().nullable(), version: z.number() })),
  stays: z.array(z.object({ reservationId: z.string(), propertyId: z.string(), propertyName: z.string(), checkIn: z.string(), checkOut: z.string(), guests: z.number().nullable() })),
});
export const performanceSchema = z.array(z.object({
  cleanerId: z.string().uuid(), fullName: z.string(), accepted: z.number(), rejected: z.number(), overturned: z.number(), warning: z.boolean(),
  openComplaints: z.array(z.object({ workId: z.string().uuid(), propertyId: z.string(), cleanerStatement: z.string().nullable(), createdAt: z.string() })),
}));
export const candidatesSchema = z.array(z.object({ userId: z.string().uuid(), fullName: z.string(), role: z.string() }));
