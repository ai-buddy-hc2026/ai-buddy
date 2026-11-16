import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { ApiError, IS_MOCK } from '@/shared/api/http'
import { createCollection, mockDelay, newId } from '@/shared/lib/storage'
import { remoteEscalations } from './remote'
import { currentRemoteUser } from './session'

/**
 * Эскалации наставнику (S-5) и ответы в базу знаний (S-6).
 * Стажёр создаёт вопрос по кнопке, наставник видит его с контекстом диалога и отвечает.
 * Если наставник поставил «Добавить в базу знаний», бот дальше отвечает на этот вопрос сам.
 */
export const escalationSchema = z.object({
  id: z.string(),
  internId: z.string(),
  mentorId: z.string(),
  question: z.string(),
  /** Переписка перед вопросом */
  context: z.array(z.object({ from: z.enum(['intern', 'bot']), text: z.string() })),
  /** Что стажёр уже пробовал (идея 25) */
  tried: z.string(),
  status: z.enum(['scheduled', 'open', 'answered']),
  /** Когда доставить: не раньше рабочих часов наставника (идея 43). null - сразу */
  deliverAt: z.string().nullable(),
  answer: z.string().nullable(),
  addedToKb: z.boolean(),
  createdAt: z.string(),
  answeredAt: z.string().nullable(),
})
export type Escalation = z.infer<typeof escalationSchema>

export type NewEscalation = Pick<
  Escalation,
  'internId' | 'mentorId' | 'question' | 'context' | 'tried' | 'deliverAt'
>

const SEED: Escalation[] = [
  {
    id: 'esc-seed-1',
    internId: 'anya',
    mentorId: 'ilya',
    question: 'Где взять тестовые данные для локального запуска сервиса объявлений?',
    context: [
      { from: 'intern', text: 'где взять тестовые данные для локального запуска?' },
      { from: 'bot', text: 'В базе знаний этого нет. Лучше спросить наставника' },
    ],
    tried: 'Смотрела гайд по окружению, там про данные ничего нет',
    status: 'open',
    deliverAt: null,
    answer: null,
    addedToKb: false,
    createdAt: '2026-11-11T16:20:00',
    answeredAt: null,
  },
]

const escalationsDb = createCollection<Escalation[]>('escalations', () => SEED)

export function createEscalation(
  list: readonly Escalation[],
  input: NewEscalation,
  now: string,
): Escalation[] {
  const created: Escalation = {
    ...input,
    id: newId('esc'),
    status: input.deliverAt ? 'scheduled' : 'open',
    answer: null,
    addedToKb: false,
    createdAt: now,
    answeredAt: null,
  }
  return [created, ...list]
}

export function answerEscalation(
  list: readonly Escalation[],
  id: string,
  answer: string,
  addToKb: boolean,
  now: string,
): Escalation[] {
  return list.map((e) =>
    e.id === id ? { ...e, status: 'answered', answer, addedToKb: addToKb, answeredAt: now } : e,
  )
}

/** Грубая нормализация вопроса для поиска ответа наставника в «базе знаний». */
function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 3)
}

const KB_MATCH_THRESHOLD = 0.5

/** S-6: ищем ответ наставника, добавленный в базу знаний, по пересечению слов. */
export function findKbAnswer(list: readonly Escalation[], question: string): Escalation | null {
  const words = new Set(normalize(question))
  if (words.size === 0) return null
  let best: { item: Escalation; score: number } | null = null
  for (const item of list) {
    if (!item.addedToKb || !item.answer) continue
    const own = normalize(item.question)
    const overlap = own.filter((word) => words.has(word)).length
    const score = overlap / Math.max(1, Math.min(own.length, words.size))
    if (score >= KB_MATCH_THRESHOLD && (!best || score > best.score)) best = { item, score }
  }
  return best?.item ?? null
}

export const escalationsApi = {
  /** GET /buddy/escalations доступен только наставнику; остальным ролям список пуст. */
  async list(): Promise<Escalation[]> {
    if (!IS_MOCK) return currentRemoteUser()?.role === 'buddy' ? remoteEscalations.list() : []
    await mockDelay(150)
    return z.array(escalationSchema).parse(escalationsDb.read())
  },
  /** В Go эскалация создаётся подтверждением предложения из чата, отдельного POST нет. */
  async create(input: NewEscalation): Promise<Escalation> {
    if (!IS_MOCK) throw new ApiError(0, 'NOT_SUPPORTED', 'Вопрос наставнику создаётся из чата')
    await mockDelay(400)
    const next = escalationsDb.update((list) =>
      createEscalation(list, input, new Date().toISOString()),
    )
    return next[0]
  },
  async answer(id: string, answer: string, addToKb: boolean): Promise<void> {
    if (!IS_MOCK) return remoteEscalations.answer(id, answer, addToKb)
    await mockDelay(300)
    escalationsDb.update((list) =>
      answerEscalation(list, id, answer, addToKb, new Date().toISOString()),
    )
  },
  peek: (): Escalation[] => escalationsDb.read(),
}

export const ESCALATIONS_KEY = ['escalations'] as const

export function useEscalations() {
  return useQuery({ queryKey: ESCALATIONS_KEY, queryFn: escalationsApi.list })
}

export function useCreateEscalation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: NewEscalation) => escalationsApi.create(input),
    onSuccess: () => client.invalidateQueries({ queryKey: ESCALATIONS_KEY }),
  })
}

export function useAnswerEscalation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, answer, addToKb }: { id: string; answer: string; addToKb: boolean }) =>
      escalationsApi.answer(id, answer, addToKb),
    onSuccess: () => client.invalidateQueries({ queryKey: ESCALATIONS_KEY }),
  })
}
