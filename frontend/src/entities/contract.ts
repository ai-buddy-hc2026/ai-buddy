import { z } from 'zod'

/**
 * Zod-схемы ответов Go API в snake_case, как в docs/openapi.yaml.
 * Компоненты их не видят: адаптеры (entities/adapters.ts) переводят их в модели фронта.
 * Go кодирует пустой срез как null, поэтому массивы принимают null и превращают его в [].
 */
const list = <T extends z.ZodType>(item: T) =>
  z
    .array(item)
    .nullable()
    .transform((value) => value ?? [])

const id = z.string().min(1)
const looseObject = z
  .record(z.string(), z.unknown())
  .nullable()
  .transform((value) => value ?? {})

export const errorDetailSchema = z.object({ code: z.string(), message: z.string() })

/* ---------- auth ---------- */

export const apiRoleSchema = z.enum(['intern', 'buddy', 'lead'])

export const apiUserSchema = z.object({
  id,
  login: z.string().min(1),
  name: z.string().min(1),
  role: apiRoleSchema,
  team: z.object({ id, code: z.string(), name: z.string(), timezone: z.string() }),
  timezone: z.string(),
  buddy_id: id.nullable(),
  manager_id: id.nullable(),
})
export type ApiUser = z.infer<typeof apiUserSchema>

export const loginResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().min(1),
  user: apiUserSchema,
})

export const internPageSchema = z.object({
  items: list(apiUserSchema),
  next_cursor: z.string().nullable(),
})

/* ---------- onboarding ---------- */

export const stageCodeSchema = z.enum(['week_1', 'week_2', 'weeks_3_4'])
export type StageCode = z.infer<typeof stageCodeSchema>
export const apiTaskStatusSchema = z.enum(['todo', 'in_progress', 'blocked', 'done'])

export const apiTaskSchema = z.object({
  id,
  plan_id: id,
  assignee_id: id,
  stage: stageCodeSchema,
  title: z.string().min(1),
  description: z.string(),
  position: z.number().int().min(0),
  due_date: z.string().nullable(),
  status: apiTaskStatusSchema,
  version: z.number().int().min(1),
  updated_at: z.string(),
  materials: list(
    z.object({
      document_id: id,
      title: z.string(),
      url: z.string(),
      is_test_instruction: z.boolean(),
    }),
  ),
})
export type ApiTask = z.infer<typeof apiTaskSchema>

export const apiPlanSchema = z.object({
  id,
  intern_id: id,
  title: z.string(),
  start_date: z.string(),
  current_stage: stageCodeSchema,
  status: z.enum(['active', 'completed', 'archived']),
  stages: list(z.object({ code: stageCodeSchema, title: z.string(), tasks: list(apiTaskSchema) })),
  progress: z.object({ done: z.number(), total: z.number(), percent: z.number() }),
  next_task_id: id.nullable(),
})
export type ApiPlan = z.infer<typeof apiPlanSchema>

/* ---------- sources и knowledge ---------- */

export const apiSourceSchema = z.object({
  document_id: id,
  revision: z.number().int().min(1),
  title: z.string(),
  section: z.string(),
  url: z.string(),
})
export type ApiSource = z.infer<typeof apiSourceSchema>

export const knowledgeSearchSchema = z.object({
  items: list(z.object({ source: apiSourceSchema, content: z.string() })),
})

/* ---------- actions ---------- */

export const actionTypeSchema = z.enum([
  'absences.create_request',
  'escalation.create',
  'checklist.update_status',
])
export type ActionType = z.infer<typeof actionTypeSchema>

export const apiActionStatusSchema = z.enum([
  'proposed',
  'confirmed',
  'executing',
  'succeeded',
  'failed',
  'cancelled',
])
export type ApiActionStatus = z.infer<typeof apiActionStatusSchema>

export const apiActionSchema = z.object({
  id,
  request_id: id,
  proposal_seq: z.number().int(),
  action_type: actionTypeSchema,
  details: looseObject,
  status: apiActionStatusSchema,
  result: looseObject,
  last_error: errorDetailSchema.nullable(),
  attempt_count: z.number().int().min(0),
  created_at: z.string(),
  updated_at: z.string(),
})
export type ApiAction = z.infer<typeof apiActionSchema>

export const actionPageSchema = z.object({
  items: list(apiActionSchema),
  next_cursor: z.string().nullable(),
})

/* ---------- escalations ---------- */

export const apiEscalationSchema = z.object({
  id,
  action_id: id,
  intern_id: id,
  buddy_id: id,
  question: z.string(),
  context_snapshot: list(
    z.object({
      message_id: id,
      role: z.enum(['user', 'assistant']),
      content: z.string(),
      sources: list(apiSourceSchema),
    }),
  ),
  status: z.enum(['open', 'answered', 'closed']),
  answer_text: z.string().nullable(),
  answered_by: id.nullable(),
  answered_at: z.string().nullable(),
  publication: z
    .object({
      document_id: id,
      revision: z.number().int(),
      status: z.enum(['draft', 'published', 'archived']),
      index_status: z.enum(['pending', 'ready', 'failed']),
      indexed_revision: z.number().int().nullable(),
      index_error: z.string().nullable(),
    })
    .nullable(),
  version: z.string().min(1),
  created_at: z.string(),
  updated_at: z.string(),
})
export type ApiEscalation = z.infer<typeof apiEscalationSchema>

export const escalationPageSchema = z.object({
  items: list(apiEscalationSchema),
  next_cursor: z.string().nullable(),
})

export const escalationAnswerSchema = z.object({
  id,
  status: z.literal('answered'),
  answer_text: z.string(),
  answered_by: id,
  answered_at: z.string(),
  add_to_kb: z.boolean(),
  kb_document_id: id.nullable(),
  kb_status: z.enum(['not_added', 'ready']),
  version: z.string().min(1),
})

/* ---------- chat ---------- */

export const chatAcceptedSchema = z.object({
  request_id: id,
  conversation_id: id,
  status: z.enum(['running', 'done', 'error']),
  stream_url: z.string().min(1),
})

const chatRequestSchema = z.object({
  request_id: id,
  status: z.enum(['running', 'done', 'error']),
  created_at: z.string(),
  finished_at: z.string().nullable(),
  error: errorDetailSchema.nullable(),
  stream_url: z.string(),
})

export const apiChatMessageSchema = z.object({
  id,
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  sources: list(apiSourceSchema),
  created_at: z.string(),
})

export const apiChatTurnSchema = z.object({
  request: chatRequestSchema,
  messages: list(apiChatMessageSchema),
  actions: list(apiActionSchema),
})
export type ApiChatTurn = z.infer<typeof apiChatTurnSchema>

export const chatHistorySchema = z.object({
  conversation_id: id.nullable(),
  items: list(apiChatTurnSchema),
  active_request: chatRequestSchema.nullable(),
  next_cursor: z.string().nullable(),
})
export type ChatHistory = z.infer<typeof chatHistorySchema>

/* ---------- SSE: конверт {event, request_id, seq, data} ---------- */

const envelope = { request_id: id, seq: z.number().int().min(1) }

export const streamEventSchema = z.discriminatedUnion('event', [
  z.object({ ...envelope, event: z.literal('token'), data: z.object({ text: z.string() }) }),
  z.object({
    ...envelope,
    event: z.literal('tool_call'),
    data: z.object({ tool_name: z.string(), arguments: looseObject }),
  }),
  z.object({
    ...envelope,
    event: z.literal('action_proposal'),
    data: z.object({
      action_id: id,
      action_type: actionTypeSchema,
      status: z.literal('proposed'),
      details: looseObject,
    }),
  }),
  z.object({
    ...envelope,
    event: z.literal('done'),
    data: z.object({ full_text: z.string(), sources: list(apiSourceSchema) }),
  }),
  z.object({ ...envelope, event: z.literal('error'), data: errorDetailSchema }),
])
export type StreamEvent = z.infer<typeof streamEventSchema>
