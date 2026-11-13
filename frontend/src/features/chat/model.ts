import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { createCollection, mockDelay, newId } from '@/shared/lib/storage'
import { actionSchema, confirmAction, type Action, type ActionDraft } from '@/entities/actions'
import { knowledgeSourceSchema } from '@/entities/knowledge'
import { SEED_THREADS } from './threads'

/* ---------- Схемы сообщений ---------- */

export const sourceSchema = z.object({
  docId: z.string(),
  title: z.string(),
  reviewedAt: z.string(),
  ownerName: z.string(),
  isStale: z.boolean(),
})
export type Source = z.infer<typeof sourceSchema>

export const absenceTypeSchema = z.enum(['unpaid', 'vacation', 'workoff'])
export type AbsenceType = z.infer<typeof absenceTypeSchema>

/** Что бот прикладывает к ответу: источник, карточку, кнопку. */
export const botMetaSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('next'), taskId: z.string().nullable() }),
  z.object({ kind: z.literal('kb'), source: sourceSchema }),
  z.object({
    kind: z.literal('mentor'),
    mentorName: z.string(),
    question: z.string(),
    answeredAt: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('absenceAsk'),
    date: z.string(),
    options: z.array(z.string()),
    isAnswered: z.boolean(),
    source: sourceSchema.nullable(),
  }),
  z.object({
    kind: z.literal('absenceDraft'),
    date: z.string(),
    type: absenceTypeSchema,
    idempotencyKey: z.string(),
    status: z.enum(['draft', 'sent', 'cancelled']),
    externalId: z.string().nullable(),
    actionStatus: z.string().nullable(),
  }),
  z.object({ kind: z.literal('denied') }),
  /** Ответ Go API: источники с revision и предложенные действия (черновики до подтверждения) */
  z.object({
    kind: z.literal('remote'),
    sources: z.array(knowledgeSourceSchema),
    actions: z.array(actionSchema),
    /** Инструменты из событий tool_call SSE (идея 35); в истории их нет */
    tools: z.array(z.string()).optional(),
  }),
  /** Генерация завершилась ошибкой: показываем «Повторить», вопрос задаётся заново */
  z.object({ kind: z.literal('error'), question: z.string(), message: z.string() }),
  z.object({
    kind: z.literal('notFound'),
    question: z.string(),
    status: z.enum(['idle', 'sent']),
    deliverAt: z.string().nullable(),
  }),
])
export type BotMeta = z.infer<typeof botMetaSchema>

export const messageSchema = z.object({
  id: z.string(),
  from: z.enum(['me', 'bot', 'peer']),
  /** Автор в группе или личке; для бота и своих сообщений null */
  authorId: z.string().nullable(),
  text: z.string(),
  at: z.string(),
  meta: botMetaSchema.optional(),
  /** Отложенная доставка коллеге вне его рабочих часов (идея 43) */
  delivery: z.object({ status: z.enum(['scheduled', 'sent']), deliverAt: z.string() }).optional(),
})
export type Message = z.infer<typeof messageSchema>

const threadsSchema = z.record(z.string(), z.array(messageSchema))
type Threads = z.infer<typeof threadsSchema>

const threadsDb = createCollection<Threads>('chat.threads', () => SEED_THREADS)

function readThreads(): Threads {
  const parsed = threadsSchema.safeParse(threadsDb.read())
  return parsed.success ? parsed.data : SEED_THREADS
}

export function newMessage(input: Omit<Message, 'id' | 'at'> & { at?: string }): Message {
  return { ...input, id: newId('msg'), at: input.at ?? new Date().toISOString() }
}

/** Чистая логика: заменить meta у сообщения, не мутируя ленту. */
export function patchMeta(list: readonly Message[], messageId: string, meta: BotMeta): Message[] {
  return patchMessage(list, messageId, { meta })
}

export type MessageChanges = Partial<Pick<Message, 'meta' | 'delivery'>>

/** Чистая логика: обновить поля сообщения, не мутируя ленту. */
export function patchMessage(
  list: readonly Message[],
  messageId: string,
  changes: MessageChanges,
): Message[] {
  return list.map((m) => (m.id === messageId ? { ...m, ...changes } : m))
}

export const chatApi = {
  async list(threadId: string): Promise<Message[]> {
    await mockDelay(120)
    return readThreads()[threadId] ?? []
  },
  peek: (threadId: string): Message[] => readThreads()[threadId] ?? [],
  append(threadId: string, messages: readonly Message[]): Message[] {
    const threads = readThreads()
    const next = [...(threads[threadId] ?? []), ...messages]
    threadsDb.write({ ...threads, [threadId]: next })
    return next
  },
  patch(threadId: string, messageId: string, meta: BotMeta): Message[] {
    return chatApi.update(threadId, messageId, { meta })
  },
  update(threadId: string, messageId: string, changes: MessageChanges): Message[] {
    const threads = readThreads()
    const next = patchMessage(threads[threadId] ?? [], messageId, changes)
    threadsDb.write({ ...threads, [threadId]: next })
    return next
  },
}

export const chatKey = (threadId: string) => ['chat', threadId] as const

export type ThreadApi = {
  messages: Message[]
  isLoading: boolean
  isError: boolean
  refetch: () => void
  append: (messages: readonly Message[]) => void
  patch: (messageId: string, meta: BotMeta) => void
  update: (messageId: string, changes: MessageChanges) => void
}

/** Лента чата: чтение через Query, запись синхронно в localStorage + сразу в кэш. */
export function useThread(threadId: string): ThreadApi {
  const client = useQueryClient()
  const query = useQuery({ queryKey: chatKey(threadId), queryFn: () => chatApi.list(threadId) })
  const append = useCallback(
    (messages: readonly Message[]) =>
      client.setQueryData(chatKey(threadId), chatApi.append(threadId, messages)),
    [client, threadId],
  )
  const patch = useCallback(
    (messageId: string, meta: BotMeta) =>
      client.setQueryData(chatKey(threadId), chatApi.patch(threadId, messageId, meta)),
    [client, threadId],
  )
  const update = useCallback(
    (messageId: string, changes: MessageChanges) =>
      client.setQueryData(chatKey(threadId), chatApi.update(threadId, messageId, changes)),
    [client, threadId],
  )
  return {
    messages: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
    append,
    patch,
    update,
  }
}

/* ---------- Служебные записи в историю действий ---------- */

/**
 * Отказы по правам и вопросы, закрытые ботом, - не внешние действия, поэтому пишем их
 * в ту же коллекцию `actions` напрямую через чистый confirmAction (без мок-сбоя сервиса).
 * Формат по контракту аналитики: 'policy_denied' и 'resolved_by_bot' в details.
 */
const actionsLog = createCollection<Action[]>('actions', () => [])

function recordSystemAction(draft: ActionDraft): Action {
  const parsed = z.array(actionSchema).safeParse(actionsLog.read())
  const result = confirmAction(parsed.success ? parsed.data : [], draft, new Date().toISOString())
  actionsLog.write(result.log)
  return result.action
}

export const POLICY_DENIED = 'policy_denied'
export const RESOLVED_BY_BOT = 'resolved_by_bot'

export const systemLog = {
  /** S-SEC: запрос чужих данных отклонён. */
  policyDenied(request: string): Action {
    return recordSystemAction({
      kind: 'message',
      title: 'Отказ: запрос чужих данных',
      details: [
        { label: 'Запрос', value: request },
        { label: 'Решение', value: POLICY_DENIED },
      ],
      idempotencyKey: newId(POLICY_DENIED),
      status: 'failed',
    })
  },
  /** S-2/S-6: вопрос закрыт ботом без наставника. */
  resolvedByBot(question: string, sourceTitle: string): Action {
    return recordSystemAction({
      kind: 'message',
      title: 'Ответ без наставника',
      details: [
        { label: 'Вопрос', value: question },
        { label: 'Источник', value: sourceTitle },
        { label: 'Итог', value: RESOLVED_BY_BOT },
      ],
      idempotencyKey: newId('resolved'),
      status: 'sent',
    })
  },
}
