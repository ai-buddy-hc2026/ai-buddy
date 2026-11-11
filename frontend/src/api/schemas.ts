import { z } from 'zod'

// Черновые схемы. Сверим с docs/openapi.yaml, когда он появится в репо.

export const RoleSchema = z.enum(['intern', 'buddy', 'lead'])

export const UserSchema = z.object({
  id: z.string(),
  login: z.string(),
  name: z.string(),
  role: RoleSchema,
  team: z.string(),
})

export const TaskStatusSchema = z.enum(['todo', 'in_progress', 'done'])

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: TaskStatusSchema,
  deadline: z.string(),
})

export const StageSchema = z.object({
  id: z.string(),
  title: z.string(),
  tasks: z.array(TaskSchema),
})

export const OnboardingPlanSchema = z.object({
  stages: z.array(StageSchema),
  nextStep: z.string(),
})

export const ChatMessageSchema = z.object({
  id: z.string(),
  author: z.enum(['user', 'assistant']),
  text: z.string(),
  source: z.string().optional(),
})

export type Role = z.infer<typeof RoleSchema>
export type User = z.infer<typeof UserSchema>
export type TaskStatus = z.infer<typeof TaskStatusSchema>
export type Task = z.infer<typeof TaskSchema>
export type Stage = z.infer<typeof StageSchema>
export type OnboardingPlan = z.infer<typeof OnboardingPlanSchema>
export type ChatMessage = z.infer<typeof ChatMessageSchema>
