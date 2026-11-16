import { z } from 'zod'
import type { ActionDraft } from '@/entities/actions'
import type { Employee } from '@/entities/employees'
import { daysUntil, DEMO_TODAY } from '@/shared/lib/date'
import { isHttpUrl, type BragInput } from './bragLogic'
import type { MergeRequest } from './skillsLogic'

/** `feedback_requests` (идея 48). */
export const feedbackRequestSchema = z.object({
  id: z.string(),
  toId: z.string(),
  artifactUrl: z.string(),
  artifactTitle: z.string(),
  question: z.string(),
  status: z.enum(['sent', 'answered', 'expired']),
  answer: z.string().nullable(),
  sentAt: z.string(),
  answeredAt: z.string().nullable(),
  savedToBrag: z.boolean(),
  externalId: z.string().nullable(),
})
export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>
export type FeedbackStatus = FeedbackRequest['status']

export const MAX_OPEN_PER_PERSON = 3
export const EXPIRE_DAYS = 7
export const QUESTION_MAX = 300

/** Без ответа 7 дней - expired. Статус считаем на лету, хранить не нужно. */
export function effectiveStatus(
  request: FeedbackRequest,
  today: string = DEMO_TODAY,
): FeedbackStatus {
  if (request.status !== 'sent') return request.status
  return daysUntil(request.sentAt, today) <= -EXPIRE_DAYS ? 'expired' : 'sent'
}

export function openCountTo(
  list: readonly FeedbackRequest[],
  toId: string,
  today: string = DEMO_TODAY,
): number {
  return list.filter((r) => r.toId === toId && effectiveStatus(r, today) === 'sent').length
}

/** Не больше 3 открытых запросов к одному человеку. */
export function canRequest(
  list: readonly FeedbackRequest[],
  toId: string,
  today: string = DEMO_TODAY,
): boolean {
  return openCountTo(list, toId, today) < MAX_OPEN_PER_PERSON
}

/** Кому можно отправить: ревьюер MR и наставник, только из своей команды. */
export function recipientsFor(
  mr: MergeRequest | null,
  team: readonly Employee[],
  mentorId: string,
  selfId: string,
): Employee[] {
  const ids = [mr?.reviewerId, mentorId].filter((id): id is string => Boolean(id) && id !== selfId)
  const unique = [...new Set(ids)]
  return unique
    .map((id) => team.find((e) => e.id === id))
    .filter((e): e is Employee => e !== undefined)
}

export interface FeedbackDraft {
  toId: string
  artifactUrl: string
  artifactTitle: string
  question: string
}

export type FeedbackErrors = Partial<
  Record<'toId' | 'artifactUrl' | 'question', 'required' | 'format' | 'tooLong' | 'limit'>
>

export function validateFeedbackDraft(
  draft: FeedbackDraft,
  list: readonly FeedbackRequest[],
  today: string = DEMO_TODAY,
): FeedbackErrors {
  const errors: FeedbackErrors = {}
  if (!draft.toId) errors.toId = 'required'
  else if (!canRequest(list, draft.toId, today)) errors.toId = 'limit'
  if (!draft.artifactUrl.trim()) errors.artifactUrl = 'required'
  else if (!isHttpUrl(draft.artifactUrl.trim())) errors.artifactUrl = 'format'
  const question = draft.question.trim()
  if (!question) errors.question = 'required'
  else if (question.length > QUESTION_MAX) errors.question = 'tooLong'
  return errors
}

/** Черновик для useConfirmAction: уходит только по кнопке «Отправить». */
export function buildFeedbackAction(
  draft: FeedbackDraft,
  recipientName: string,
  idempotencyKey: string,
): ActionDraft {
  return {
    kind: 'feedback',
    title: `Запрос обратной связи: ${recipientName}`,
    details: [
      { label: 'Кому', value: recipientName },
      { label: 'Что оценить', value: draft.artifactTitle || draft.artifactUrl },
      { label: 'Вопрос', value: draft.question.trim() },
    ],
    status: 'sent',
    idempotencyKey,
  }
}

export function createRequest(
  list: readonly FeedbackRequest[],
  draft: FeedbackDraft,
  ids: { id: string; externalId: string | null },
  today: string = DEMO_TODAY,
): FeedbackRequest[] {
  const created: FeedbackRequest = {
    id: ids.id,
    toId: draft.toId,
    artifactUrl: draft.artifactUrl.trim(),
    artifactTitle: draft.artifactTitle.trim() || draft.artifactUrl.trim(),
    question: draft.question.trim(),
    status: 'sent',
    answer: null,
    sentAt: today,
    answeredAt: null,
    savedToBrag: false,
    externalId: ids.externalId,
  }
  return [created, ...list]
}

export function markSaved(list: readonly FeedbackRequest[], id: string): FeedbackRequest[] {
  return list.map((r) => (r.id === id ? { ...r, savedToBrag: true } : r))
}

/** Запись для brag document из ответа (кнопка «Сохранить в мои достижения»). */
export function answerToBrag(request: FeedbackRequest, authorShort: string): BragInput | null {
  if (request.status !== 'answered' || !request.answer) return null
  return {
    type: 'feedback',
    title: `${authorShort}: «${request.answer}»`,
    link: isHttpUrl(request.artifactUrl) ? request.artifactUrl : null,
    date: request.answeredAt ?? request.sentAt,
  }
}

export function sortRequests(list: readonly FeedbackRequest[]): FeedbackRequest[] {
  return [...list].sort((a, b) =>
    (b.answeredAt ?? b.sentAt).localeCompare(a.answeredAt ?? a.sentAt),
  )
}
