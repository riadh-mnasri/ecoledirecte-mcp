import { z } from "zod";

export const StudentSchema = z.object({
  id: z.number(),
  firstName: z.string(),
  lastName: z.string(),
  className: z.string().optional(),
});
export type Student = z.infer<typeof StudentSchema>;

export const GradeSchema = z.object({
  id: z.string(),
  subject: z.string(),
  value: z.string(),
  scale: z.string(),
  coefficient: z.string().optional(),
  date: z.string(),
  comment: z.string().optional(),
});
export type Grade = z.infer<typeof GradeSchema>;

export const HomeworkItemSchema = z.object({
  subject: z.string(),
  dueDate: z.string(),
  description: z.string(),
  done: z.boolean().default(false),
});
export type HomeworkItem = z.infer<typeof HomeworkItemSchema>;

export const AbsenceItemSchema = z.object({
  id: z.string(),
  type: z.enum(["absence", "retard", "sanction", "observation"]),
  date: z.string(),
  reason: z.string().optional(),
  justified: z.boolean().optional(),
});
export type AbsenceItem = z.infer<typeof AbsenceItemSchema>;

export const MessageItemSchema = z.object({
  id: z.string(),
  from: z.string(),
  subject: z.string(),
  date: z.string(),
  read: z.boolean(),
});
export type MessageItem = z.infer<typeof MessageItemSchema>;

export class SecurityChallengeError extends Error {
  constructor(public readonly question: string, public readonly challengeToken: string) {
    super(`EcoleDirecte demande une question de sécurité : ${question}`);
    this.name = "SecurityChallengeError";
  }
}

export class EcoleDirecteApiShapeError extends Error {
  constructor(endpoint: string, cause: unknown) {
    super(`Réponse inattendue de l'API EcoleDirecte sur ${endpoint} (le format a probablement changé)`);
    this.name = "EcoleDirecteApiShapeError";
    this.cause = cause;
  }
}
