import { z } from 'zod'
import { request } from '@/shared/api/http'

/**
 * Реальные вызовы Go API для роста и сообщества (backend/internal/growth, маршруты /growth/*).
 * Ответ валидируется схемой и переводится в модель фронта. Переключение mock/real - в местах вызова.
 */
const path = (template: string, id: string) => template.replace('{id}', encodeURIComponent(id))
const page = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) })
const noContent = z.undefined()

const pad = (n: number) => String(n).padStart(2, '0')

/** RFC3339 с сервера -> локальное время без зоны, как в моках: 2026-11-13T12:00. */
export function toLocalMinute(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const toLocalDate = (iso: string): string => toLocalMinute(iso).slice(0, 10)

/* ---------- brag ---------- */

export const apiBragSchema = z.object({
  id: z.string(),
  type: z.enum(['task', 'pr', 'review', 'feedback', 'manual']),
  title: z.string(),
  link: z.string().nullable(),
  date: z.string(),
})
export type ApiBrag = z.infer<typeof apiBragSchema>

export const remoteBrag = {
  list: async (): Promise<ApiBrag[]> => (await request('/growth/brag', page(apiBragSchema))).items,
  add: (item: Omit<ApiBrag, 'id'>): Promise<ApiBrag> =>
    request('/growth/brag', apiBragSchema, { method: 'POST', body: item }),
  remove: (id: string): Promise<void> =>
    request(path('/growth/brag/{id}', id), noContent, { method: 'DELETE' }),
}

/* ---------- feedback ---------- */

export const apiFeedbackSchema = z.object({
  id: z.string(),
  fromId: z.string(),
  toId: z.string(),
  artifactUrl: z.string(),
  artifactTitle: z.string(),
  question: z.string(),
  status: z.enum(['sent', 'answered', 'expired']),
  answer: z.string().nullable(),
  sentAt: z.string(),
  expiresAt: z.string(),
  answeredAt: z.string().nullable(),
  savedToBrag: z.boolean(),
  externalId: z.string().nullable(),
})
export type ApiFeedback = z.infer<typeof apiFeedbackSchema>

/** Модель фронта хранит даты днями и только исходящие запросы. */
export function toFeedbackRequest(item: ApiFeedback) {
  return {
    id: item.id,
    toId: item.toId,
    artifactUrl: item.artifactUrl,
    artifactTitle: item.artifactTitle,
    question: item.question,
    status: item.status,
    answer: item.answer,
    sentAt: toLocalDate(item.sentAt),
    answeredAt: item.answeredAt ? toLocalDate(item.answeredAt) : null,
    savedToBrag: item.savedToBrag,
    externalId: item.externalId,
  }
}

export interface FeedbackCreate {
  toId: string
  artifactUrl: string
  artifactTitle: string
  question: string
  externalId: string | null
}

export const remoteFeedback = {
  async listSent(myId: string) {
    const { items } = await request('/growth/feedback', page(apiFeedbackSchema))
    return items.filter((item) => item.fromId === myId).map(toFeedbackRequest)
  },
  create: (body: FeedbackCreate) =>
    request('/growth/feedback', apiFeedbackSchema, { method: 'POST', body }),
  markSaved: (id: string) =>
    request(path('/growth/feedback/{id}/saved', id), apiFeedbackSchema, { method: 'POST' }),
}

/* ---------- events ---------- */

export const apiEventSchema = z.object({
  id: z.string(),
  kind: z.enum(['training', 'avitotech', 'internal', 'user']),
  title: z.string(),
  description: z.string(),
  start: z.string(),
  minutes: z.number().int().positive(),
  placeId: z.string().nullable(),
  placeName: z.string(),
  hostId: z.string(),
  tags: z.array(z.string()),
  capacity: z.number().int().positive().nullable(),
  attendees: z.array(z.string()),
  materials: z.array(z.string()),
})
export type ApiEvent = z.infer<typeof apiEventSchema>

export const remoteEvents = {
  async list(): Promise<ApiEvent[]> {
    const { items } = await request('/growth/events', page(apiEventSchema))
    return items.map((item) => ({ ...item, start: toLocalMinute(item.start) }))
  },
  join: (id: string): Promise<void> =>
    request(path('/growth/events/{id}/attendees', id), noContent, { method: 'POST' }),
  leave: (id: string): Promise<void> =>
    request(path('/growth/events/{id}/attendees', id), noContent, { method: 'DELETE' }),
}

/* ---------- interests ---------- */

export const apiInterestsSchema = z.object({
  tags: z.array(z.string()),
  groups: z.array(z.object({ tag: z.string(), members: z.array(z.string()) })),
})

export const remoteInterests = {
  get: async (): Promise<string[]> => (await request('/growth/interests', apiInterestsSchema)).tags,
  save: async (tags: readonly string[]): Promise<string[]> =>
    (await request('/growth/interests', apiInterestsSchema, { method: 'PUT', body: { tags } }))
      .tags,
}

/* ---------- tracks ---------- */

export const remoteTracks = {
  get: <T>(schema: z.ZodType<T>): Promise<T> => request('/growth/tracks', schema),
  save: <T>(schema: z.ZodType<T>, state: T): Promise<T> =>
    request('/growth/tracks', schema, { method: 'PUT', body: state }),
}

/* ---------- meetings ---------- */

export const remoteMeetings = {
  list: <T>(schema: z.ZodType<T>): Promise<T> => request('/growth/meetings', schema),
  /** Сервер сам добавляет договорённости в план; повтор не дублирует задачи. */
  save: <T>(schema: z.ZodType<T>, meetingId: string, draft: unknown): Promise<T> =>
    request(path('/growth/meetings/{id}', meetingId), schema, { method: 'PUT', body: draft }),
}

/* ---------- coffee ---------- */

export const apiCoffeePairSchema = z.object({
  id: z.string(),
  weekStart: z.string(),
  partnerId: z.string(),
  status: z.enum(['proposed', 'met', 'skipped']),
})

export const remoteCoffee = {
  pairs: async () => (await request('/growth/coffee', page(apiCoffeePairSchema))).items,
}

/* ---------- competencies ---------- */

const localizedSchema = z.object({ ru: z.string(), en: z.string() })

/** GET /growth/competencies: матрица трека и только своя самооценка (myLevel). */
export const apiCompetencyMatrixSchema = z.object({
  track: z.string(),
  items: z.array(
    z.object({
      code: z.string(),
      name: localizedSchema,
      levels: z.array(z.object({ level: z.number().int(), description: localizedSchema })),
      myLevel: z.number().int().min(1).max(4).nullable(),
    }),
  ),
})
export type ApiCompetencyMatrix = z.infer<typeof apiCompetencyMatrixSchema>

/** Ответ API -> модель фронта: описания по порядку уровней, оценки только проставленные. */
export function toCompetencyMatrix(matrix: ApiCompetencyMatrix) {
  const levels: Record<string, number> = {}
  for (const item of matrix.items) {
    if (item.myLevel !== null) levels[item.code] = item.myLevel
  }
  return {
    track: matrix.track,
    competencies: matrix.items.map((item) => ({
      id: item.code,
      name: item.name,
      levels: [...item.levels].sort((a, b) => a.level - b.level).map((level) => level.description),
    })),
    levels,
  }
}

export const remoteCompetencies = {
  matrix: async () =>
    toCompetencyMatrix(await request('/growth/competencies', apiCompetencyMatrixSchema)),
  setLevel: async (code: string, level: number) =>
    toCompetencyMatrix(
      await request(`/growth/competencies/${encodeURIComponent(code)}`, apiCompetencyMatrixSchema, {
        method: 'PUT',
        body: { level },
      }),
    ),
}
