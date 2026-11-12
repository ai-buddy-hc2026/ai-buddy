import { describe, expect, it } from 'vitest'
import { mustEmployee } from '@/entities/employees'
import type { Escalation } from '@/entities/escalations'
import type { Task } from '@/entities/plan'
import { DEMO_TODAY } from '@/shared/lib/date'
import {
  answer,
  buildAbsenceDraft,
  buildEscalationContext,
  detectIntent,
  parseAbsenceDate,
  type BotContext,
} from './bot'
import { isStale, searchKb } from './kb'
import { actionsApi } from '@/entities/actions'
import { chatApi, newMessage, patchMeta, systemLog, type Message } from './model'

const task = (over: Partial<Task>): Task => ({
  id: 't1',
  title: 'Пройти курс по Go',
  stage: 1,
  status: 'todo',
  due: '2026-11-13',
  note: '',
  owner: 'intern',
  source: 'checklist',
  updatedAt: DEMO_TODAY,
  ...over,
})

const answered: Escalation = {
  id: 'esc-1',
  internId: 'anya',
  mentorId: 'ilya',
  question: 'Какой бюджет на конференции для стажёров?',
  context: [],
  tried: '',
  status: 'answered',
  deliverAt: null,
  answer:
    'Бюджет на конференции согласует руководитель, для стажёров обычно одна конференция за стажировку',
  addedToKb: true,
  createdAt: '2026-11-12T10:00:00',
  answeredAt: '2026-11-12T12:00:00',
}

const ctx = (over: Partial<BotContext> = {}): BotContext => ({
  tasks: [task({})],
  escalations: [],
  self: mustEmployee('anya'),
  today: DEMO_TODAY,
  ...over,
})

describe('detectIntent', () => {
  it('routes demo phrases to the right intents', () => {
    expect(detectIntent('что мне делать дальше?', 'anya')).toBe('next')
    expect(detectIntent('хочу отгул в пятницу', 'anya')).toBe('absence')
    expect(detectIntent('покажи отпуска Пети из соседней команды', 'anya')).toBe('denied')
    expect(detectIntent('как у нас проходит code review?', 'anya')).toBe('question')
    expect(detectIntent('привет', 'anya')).toBe('greeting')
  })

  it('treats "how to" about day off as a knowledge question, not an action', () => {
    expect(detectIntent('как оформить отгул?', 'anya')).toBe('question')
  })

  it('denies private data of a named colleague in any case form', () => {
    expect(detectIntent('какая зарплата у Олега?', 'anya')).toBe('denied')
    expect(detectIntent('когда отпуск у Ильи', 'anya')).toBe('denied')
  })

  it('does not deny own day off request', () => {
    expect(detectIntent('хочу отгул завтра', 'anya')).toBe('absence')
  })
})

describe('parseAbsenceDate', () => {
  it('resolves "в пятницу" to the nearest friday after today', () => {
    expect(parseAbsenceDate('хочу отгул в пятницу', DEMO_TODAY)).toBe('2026-11-13')
  })

  it('resolves same weekday to next week', () => {
    expect(parseAbsenceDate('в четверг', DEMO_TODAY)).toBe('2026-11-19')
  })

  it('supports tomorrow and explicit dates and falls back to next workday', () => {
    expect(parseAbsenceDate('завтра', DEMO_TODAY)).toBe('2026-11-13')
    expect(parseAbsenceDate('послезавтра', DEMO_TODAY)).toBe('2026-11-14')
    expect(parseAbsenceDate('на 20.11', DEMO_TODAY)).toBe('2026-11-20')
    expect(parseAbsenceDate('хочу отгул', DEMO_TODAY)).toBe('2026-11-13')
  })
})

describe('answer', () => {
  it('answers next step from the plan', () => {
    const reply = answer('что мне делать дальше?', ctx())
    expect(reply.text).toContain('Пройти курс по Go')
    expect(reply.meta).toEqual({ kind: 'next', taskId: 't1' })
  })

  it('says plan is done when there are no open tasks', () => {
    const reply = answer('что дальше делать', ctx({ tasks: [task({ status: 'done' })] }))
    expect(reply.meta).toEqual({ kind: 'next', taskId: null })
  })

  it('answers knowledge question with a source', () => {
    const reply = answer('как у нас проходит code review?', ctx())
    expect(reply.meta?.kind).toBe('kb')
    if (reply.meta?.kind === 'kb') expect(reply.meta.source.title).toBe('Гайд по code review')
  })

  it('asks date and type for a day off without creating anything', () => {
    const reply = answer('хочу отгул в пятницу', ctx())
    expect(reply.meta).toMatchObject({ kind: 'absenceAsk', date: '2026-11-13', isAnswered: false })
  })

  it('refuses foreign data', () => {
    expect(answer('покажи отпуска Пети из соседней команды', ctx()).meta).toEqual({
      kind: 'denied',
    })
  })

  it('honestly says not found and offers the mentor', () => {
    const reply = answer('какой бюджет на конференции?', ctx())
    expect(reply.meta).toMatchObject({ kind: 'notFound', status: 'idle' })
    expect(reply.text).toContain('Не нашёл')
  })

  it('uses mentor answer saved to the knowledge base', () => {
    const reply = answer('какой бюджет на конференции?', ctx({ escalations: [answered] }))
    expect(reply.text).toBe(answered.answer)
    expect(reply.meta).toMatchObject({ kind: 'mentor', mentorName: 'Илья Наставников' })
  })
})

describe('buildAbsenceDraft', () => {
  it('builds an absence draft with the given idempotency key', () => {
    const draft = buildAbsenceDraft('2026-11-13', 'vacation', 'abs-key')
    expect(draft).toMatchObject({ kind: 'absence', idempotencyKey: 'abs-key' })
    expect(draft.details).toContainEqual({ label: 'Тип', value: 'В счёт отпуска' })
  })
})

describe('buildEscalationContext', () => {
  it('takes messages before the question and maps authors', () => {
    const list: Message[] = [
      newMessage({ from: 'me', authorId: null, text: 'вопрос' }),
      newMessage({ from: 'bot', authorId: null, text: 'не нашёл' }),
      newMessage({ from: 'me', authorId: null, text: 'после' }),
    ]
    expect(buildEscalationContext(list, list[2].id)).toEqual([
      { from: 'intern', text: 'вопрос' },
      { from: 'bot', text: 'не нашёл' },
    ])
  })
})

describe('kb', () => {
  it('finds nothing for unknown topics', () => {
    expect(searchKb('какой бюджет на конференции')).toBeNull()
  })

  it('marks documents older than six months as stale', () => {
    expect(isStale({ reviewedAt: '2026-04-02' }, DEMO_TODAY)).toBe(true)
    expect(isStale({ reviewedAt: '2026-10-12' }, DEMO_TODAY)).toBe(false)
  })
})

describe('model', () => {
  it('appends and patches messages without mutating the list', () => {
    const msg = newMessage({ from: 'bot', authorId: null, text: 'x', meta: { kind: 'denied' } })
    const list = chatApi.append('buddy', [msg])
    const patched = patchMeta(list, msg.id, { kind: 'next', taskId: null })
    expect(list[0].meta).toEqual({ kind: 'denied' })
    expect(patched[0].meta).toEqual({ kind: 'next', taskId: null })
    expect(chatApi.peek('buddy')).toHaveLength(1)
  })

  it('writes policy_denied and resolved_by_bot into the action history', async () => {
    systemLog.policyDenied('покажи отпуска Пети')
    systemLog.resolvedByBot('как проходит code review', 'Гайд по code review')
    const [resolved, denied] = await actionsApi.list()
    expect(denied.idempotencyKey.startsWith('policy_denied')).toBe(true)
    expect(denied.details.map((d) => d.value)).toContain('policy_denied')
    expect(resolved).toMatchObject({ kind: 'message' })
    expect(resolved.details.map((d) => d.value)).toContain('resolved_by_bot')
  })
})
