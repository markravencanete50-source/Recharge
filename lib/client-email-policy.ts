import { z } from 'zod';

// Client email conversations: email to ownerrelations@ from someone who is not an owner yet (round 7, Session F). Read and answered by
// admins, super admins and the client relations rota; replies go out from ownerrelations@ (lib/client-email-server.ts).
const uuid = z.string().uuid();
export const clientEmailReadSchema = z.discriminatedUnion('section', [
  z.object({ section: z.literal('list') }).strict(),
  z.object({ section: z.literal('thread'), threadId: uuid }).strict(),
]);
export const clientEmailActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reply'), requestId: uuid, threadId: uuid, body: z.string().trim().min(1, 'Write the reply').max(5000, 'Replies can be up to 5,000 characters') }).strict(),
  z.object({ action: z.literal('close'), threadId: uuid }).strict(),
  z.object({ action: z.literal('reopen'), threadId: uuid }).strict(),
  z.object({ action: z.literal('assign'), threadId: uuid, ownerId: uuid }).strict(),
]);
export type ClientEmailAction = z.infer<typeof clientEmailActionSchema>;
export const clientEmailThreadSchema = z.object({
  id: uuid, address: z.string(), name: z.string().nullable(), subject: z.string().nullable(), status: z.enum(['open', 'closed']),
  lastMessageAt: z.string().nullable(), preview: z.string().nullable(), lastFrom: z.enum(['in', 'out']).nullable(), waitingSince: z.string().nullable(), messages: z.number(),
});
export type ClientEmailThread = z.infer<typeof clientEmailThreadSchema>;
const fileSchema = z.object({ id: uuid, filename: z.string(), mime: z.string(), bytes: z.number() });
export const clientEmailListSchema = z.object({ threads: z.array(clientEmailThreadSchema), canSend: z.boolean().default(false) });
export const clientEmailDetailSchema = z.object({
  thread: clientEmailThreadSchema, canSend: z.boolean().default(false),
  messages: z.array(z.object({ id: uuid, direction: z.enum(['in', 'out']), body: z.string(), sentAt: z.string(), author: z.string().nullable(), files: z.array(fileSchema).default([]) })),
});
// The status filter Clients uses for every conversation: the other side spoke last and it is open (Needs a reply), we did (Engaged), or closed.
export const clientEmailStatus = (t: Pick<ClientEmailThread, 'status' | 'waitingSince'>) => t.status === 'closed' ? 'closed' as const : t.waitingSince ? 'reply' as const : 'waiting' as const;
