import { z } from 'zod';

// Owner email from an address Recharge does not know yet (Client relations: assign it to an owner, or dismiss it).
export const unknownSenderSchema = z.object({ id: z.string(), from: z.string(), name: z.string().nullable(), subject: z.string().nullable(), body: z.string(), receivedAt: z.string() });
export const unknownSendersSchema = z.object({ senders: z.array(unknownSenderSchema) });
