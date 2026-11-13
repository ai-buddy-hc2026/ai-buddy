import { ApiError, request, tokenStore } from '@/shared/api/http'
import { openSse } from '@/shared/api/sse'
import {
  actionPageSchema,
  apiActionSchema,
  apiPlanSchema,
  apiTaskSchema,
  apiUserSchema,
  chatAcceptedSchema,
  chatHistorySchema,
  escalationAnswerSchema,
  escalationPageSchema,
  internPageSchema,
  knowledgeSearchSchema,
  loginResponseSchema,
  streamEventSchema,
  type ApiPlan,
  type ApiUser,
  type ChatHistory,
  type StreamEvent,
} from './contract'
import {
  findApiTask,
  toAction,
  toEscalation,
  toKnowledgeSource,
  toPlan,
  toRemoteUser,
  withApiTask,
  type RemoteUser,
} from './adapters'
import type { Action } from './actions'
import type { Escalation } from './escalations'
import type { KnowledgeHit } from './knowledge'
import type { Plan, TaskStatus } from './plan'

/**
 * Реальные вызовы Go API. Каждый ответ валидируется схемой из contract.ts и
 * переводится в модель фронта адаптером. Переключение mock/real - в entities/*.
 */
const PAGE_LIMIT = 100
const MAX_STREAM_RECONNECTS = 2

const path = (template: string, id: string) => template.replace('{id}', encodeURIComponent(id))

/* ---------- auth ---------- */

export const remoteAuth = {
  /** POST /auth/mock-login, затем GET /me: права и активность бэкенд читает заново. */
  async signIn(login: string): Promise<RemoteUser> {
    const session = await request('/auth/mock-login', loginResponseSchema, {
      method: 'POST',
      body: { login },
    })
    tokenStore.set(session.access_token)
    return toRemoteUser(await request('/me', apiUserSchema))
  },
}

/* ---------- buddy ---------- */

async function fetchInterns(): Promise<ApiUser[]> {
  const page = await request('/buddy/interns', internPageSchema, { query: { limit: PAGE_LIMIT } })
  return page.items
}

export const remoteBuddy = {
  interns: async (): Promise<RemoteUser[]> => (await fetchInterns()).map(toRemoteUser),
}

/* ---------- onboarding ---------- */

/** Стажёр читает свой план; наставнику нужен intern_id назначенного стажёра. */
async function planQuery(viewer: RemoteUser | null): Promise<{ intern_id?: string }> {
  if (!viewer || viewer.role === 'intern') return {}
  if (viewer.role === 'buddy') {
    const [first] = await fetchInterns()
    if (!first) throw new ApiError(404, 'NOT_FOUND', 'Нет назначенных стажёров')
    return { intern_id: first.id }
  }
  throw new ApiError(
    403,
    'NO_INTERN_LIST',
    'Список стажёров команды в API пока есть только у наставника',
  )
}

async function fetchPlan(viewer: RemoteUser | null): Promise<ApiPlan> {
  return request('/onboarding/plan', apiPlanSchema, { query: await planQuery(viewer) })
}

export const remotePlan = {
  get: async (viewer: RemoteUser | null): Promise<Plan> => toPlan(await fetchPlan(viewer)),

  /** PATCH требует актуальную version: читаем план, меняем задачу, план собираем из ответа. */
  async setStatus(viewer: RemoteUser | null, taskId: string, status: TaskStatus): Promise<Plan> {
    const plan = await fetchPlan(viewer)
    const task = findApiTask(plan, taskId)
    if (!task) throw new ApiError(404, 'NOT_FOUND', 'Задача не найдена или недоступна')
    if (task.status === status) return toPlan(plan)
    const updated = await request(path('/tasks/{id}', taskId), apiTaskSchema, {
      method: 'PATCH',
      body: { status, version: task.version },
    })
    return toPlan(withApiTask(plan, updated))
  },
}

/* ---------- actions ---------- */

export const remoteActions = {
  async list(): Promise<Action[]> {
    const page = await request('/actions', actionPageSchema, { query: { limit: PAGE_LIMIT } })
    return page.items.map(toAction)
  },

  /** POST /actions/{id}/confirm без тела. failed - понятная ошибка, «Повторить» шлёт тот же id. */
  async confirm(actionId: string): Promise<Action> {
    const action = await request(path('/actions/{id}/confirm', actionId), apiActionSchema, {
      method: 'POST',
    })
    if (action.status === 'failed') {
      throw new ApiError(
        502,
        action.last_error?.code ?? 'TOOL_FAILED',
        action.last_error?.message ?? 'Сервис не выполнил действие. Можно повторить',
      )
    }
    return toAction(action)
  },
}

/* ---------- escalations ---------- */

async function fetchEscalations() {
  return request('/buddy/escalations', escalationPageSchema, { query: { limit: PAGE_LIMIT } })
}

export const remoteEscalations = {
  async list(): Promise<Escalation[]> {
    const [page, interns] = await Promise.all([fetchEscalations(), fetchInterns()])
    const known = Object.fromEntries(interns.map((user) => [user.id, user.login]))
    return page.items.map((item) => toEscalation(item, known))
  },

  /** version берём из свежего списка: она защищает от параллельного изменения. */
  async answer(id: string, answer: string, addToKb: boolean): Promise<void> {
    const page = await fetchEscalations()
    const item = page.items.find((e) => e.id === id)
    if (!item) throw new ApiError(404, 'NOT_FOUND', 'Вопрос не найден или недоступен')
    await request(path('/buddy/escalations/{id}/answer', id), escalationAnswerSchema, {
      method: 'POST',
      body: { answer_text: answer, add_to_kb: addToKb, version: item.version },
    })
  },
}

/* ---------- knowledge ---------- */

export const remoteKnowledge = {
  async search(q: string): Promise<KnowledgeHit[]> {
    const result = await request('/knowledge/search', knowledgeSearchSchema, { query: { q } })
    return result.items.map((item) => ({
      source: toKnowledgeSource(item.source),
      content: item.content,
    }))
  },
}

/* ---------- chat ---------- */

function parseEvent(data: string): StreamEvent {
  let json: unknown
  try {
    json = JSON.parse(data)
  } catch {
    throw new ApiError(0, 'INVALID_AI_EVENT', 'Ассистент прислал неожиданный ответ')
  }
  const parsed = streamEventSchema.safeParse(json)
  if (!parsed.success)
    throw new ApiError(0, 'INVALID_AI_EVENT', 'Ассистент прислал неожиданный ответ')
  return parsed.data
}

const isTerminal = (event: StreamEvent) => event.event === 'done' || event.event === 'error'

export const remoteChat = {
  history: (): Promise<ChatHistory> =>
    request('/chat/messages', chatHistorySchema, { query: { limit: PAGE_LIMIT } }),

  /** 202 означает, что вопрос сохранён; ответ придёт по SSE. Автоповтора POST нет. */
  send: (message: string) =>
    request('/chat/messages', chatAcceptedSchema, { method: 'POST', body: { message } }),

  /**
   * События одной генерации по порядку seq. Дубли seq пропускаются. При обрыве сети
   * переподключаемся с Last-Event-ID, генерация на сервере при этом не перезапускается.
   */
  async *events(requestId: string, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    let lastSeq = 0
    for (let attempt = 0; attempt <= MAX_STREAM_RECONNECTS; attempt += 1) {
      try {
        const lastEventId = lastSeq > 0 ? `${requestId}:${lastSeq}` : undefined
        const frames = await openSse(path('/chat/stream/{id}', requestId), { lastEventId, signal })
        for await (const frame of frames) {
          const event = parseEvent(frame.data)
          if (event.seq <= lastSeq) continue
          lastSeq = event.seq
          yield event
          if (isTerminal(event)) return
        }
      } catch (cause) {
        // HTTP-ошибки и отмена не лечатся переподключением
        if (signal?.aborted || (cause instanceof ApiError && cause.status !== 0)) throw cause
        if (cause instanceof ApiError && cause.code === 'INVALID_AI_EVENT') throw cause
      }
    }
    throw new ApiError(0, 'STREAM_INTERRUPTED', 'Ответ прервался. Можно повторить')
  },
}
