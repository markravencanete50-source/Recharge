import { z } from "zod";
import { emailSchema, newPasswordSchema, phoneSchema } from "./auth-security-policy";

export { phoneSchema };
export const avatarIds = [
  "forest",
  "sage",
  "ocean",
  "plum",
  "clay",
  "slate",
] as const;
export const appearanceSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(2)
      .max(60)
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
    avatar: z.enum(avatarIds),
  })
  .strict();
const contact = z.discriminatedUnion("method", [
  z.object({ method: z.literal("email"), address: emailSchema }),
  z.object({ method: z.literal("phone"), address: phoneSchema }),
]);
export const registrationSchema = z
  .object({
    action: z.literal("register"),
    method: z.enum(["email", "phone"]),
    address: z.string().max(254),
    password: newPasswordSchema.shape.password,
  })
  .strict()
  .superRefine((value, context) => {
    if (!contact.safeParse(value).success)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Check your email address or international phone number.",
        path: ["address"],
      });
  });
export const verificationSchema = z
  .object({
    action: z.literal("verify"),
    method: z.enum(["email", "phone"]),
    address: z.string().max(254),
    code: z.string().regex(/^\d{6,8}$/),
  })
  .strict()
  .superRefine((value, context) => {
    if (!contact.safeParse(value).success)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Check your contact details.",
        path: ["address"],
      });
  });
export function normalizeContact(method: "email" | "phone", address: string) {
  return method === "email"
    ? emailSchema.parse(address)
    : phoneSchema.parse(address);
}
export function confirmedContact(
  user: {
    email?: string;
    phone?: string;
    email_confirmed_at?: string;
    phone_confirmed_at?: string;
  },
  method?: "email" | "phone",
  address?: string,
) {
  const email = Boolean(user.email && user.email_confirmed_at);
  const phone = Boolean(user.phone && /^\+?[1-9]\d{7,14}$/.test(user.phone) && user.phone_confirmed_at);
  if (!method) return email || phone;
  return method === "email"
    ? email && user.email?.toLowerCase() === address
    // Supabase Auth stores the canonical number without its leading +.
    : phone && user.phone?.replace(/^\+/, '') === address?.replace(/^\+/, '');
}
