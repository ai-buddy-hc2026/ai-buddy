import type { ActionDraft } from '@/entities/actions'
import { EMPLOYEES, mustEmployee, type Employee } from '@/entities/employees'
import { findKbAnswer, type Escalation } from '@/entities/escalations'
import { pickNextStep, type Task } from '@/entities/plan'
import { DEMO } from '@/entities/session'
import { addDays, formatDue, formatShort, nextWorkday, parseIso } from '@/shared/lib/date'
import { findKbDoc, isStale, searchKb, type KbDoc } from './kb'
import type { AbsenceType, BotMeta, Message, Source } from './model'

/**
 * Мок-движок бота buddy: intent-роутинг по ключевым словам, без LLM.
 * Факты берём только из данных (план, база знаний, ответы наставника).
 * Когда появится AI-сервис, этот файл заменится вызовом API с тем же форматом ответа.
 */
export type Intent = 'denied' | 'absence' | 'next' | 'greeting' | 'question'

export type BotContext = {
  tasks: readonly Task[]
  escalations: readonly Escalation[]
  self: Employee
  today: string
}

export type BotReply = {
  intent: Intent
  text: string
  meta?: BotMeta
}

/* ---------- Распознавание намерения ---------- */

const PRIVATE_WORDS = [
  'отпуск',
  'отгул',
  'зарплат',
  'больничн',
  'оценк',
  'отзыв',
  'календар',
  'расписани',
  'преми',
  'перфоманс',
]
const OTHER_TEAM = /(соседн|чуж|друг)\S*\s+команд/
const SELF_REQUEST = /(хочу|мне нуж|оформи мне|возьму|мой |мои |моя |у меня)/
const ABSENCE_WORDS = /(отгул|выходн)/
const ABSENCE_VERBS = /(хочу|оформ|возьм|взять|нуж|запиши|можно)/
const QUESTION_START = /^(как|где|какой|какая|какие|сколько|почему|зачем|кто)(\s|$|[?,.!])/
const NEXT_STEP = /(что|чем)\s.*(дальше|делать|заняться)|следующ\S*\s+шаг/
const GREETING = /^(привет|здравствуй|добрый|hi|hello|хай)/

function nameStem(short: string): string {
  const lower = short.toLowerCase()
  return /[аяйь]$/.test(lower) ? lower.slice(0, -1) : lower
}

const MAX_ENDING = 3

/** Упоминает ли текст другого сотрудника (в любом падеже: «Пети», «Олега»). */
export function mentionsOtherEmployee(text: string, selfId: string): boolean {
  const words = text.toLowerCase().split(/[^a-zа-яё]+/i)
  return EMPLOYEES.filter((e) => e.id !== selfId).some((e) => {
    const stem = nameStem(e.short)
    return words.some((w) => w.startsWith(stem) && w.length <= stem.length + MAX_ENDING)
  })
}

/** S-SEC: запрос личных данных другого человека или чужой команды. */
export function isForeignDataRequest(text: string, selfId: string): boolean {
  const lower = text.toLowerCase()
  const isPrivate = PRIVATE_WORDS.some((w) => lower.includes(w))
  if (!isPrivate) return false
  if (OTHER_TEAM.test(lower)) return true
  return mentionsOtherEmployee(lower, selfId) && !SELF_REQUEST.test(lower)
}

export function detectIntent(text: string, selfId: string): Intent {
  const lower = text.trim().toLowerCase()
  if (isForeignDataRequest(lower, selfId)) return 'denied'
  if (ABSENCE_WORDS.test(lower) && ABSENCE_VERBS.test(lower) && !QUESTION_START.test(lower))
    return 'absence'
  if (NEXT_STEP.test(lower)) return 'next'
  if (GREETING.test(lower) && lower.length < 25) return 'greeting'
  return 'question'
}

/* ---------- Отгул ---------- */

const WEEKDAYS: ReadonlyArray<[string, number]> = [
  ['воскрес', 0],
  ['понедельн', 1],
  ['вторник', 2],
  ['сред', 3],
  ['четверг', 4],
  ['пятниц', 5],
  ['суббот', 6],
]

const DAYS_IN_WEEK = 7

/** «в пятницу» -> ближайшая пятница после сегодня, «завтра», «13.11». По умолчанию - следующий рабочий день. */
export function parseAbsenceDate(text: string, today: string): string {
  const lower = text.toLowerCase()
  if (lower.includes('послезавтра')) return addDays(today, 2)
  if (lower.includes('завтра')) return addDays(today, 1)
  const exact = lower.match(/(?:^|\D)(\d{1,2})\.(\d{1,2})(?!\d)/)
  if (exact) {
    const pad = (n: string) => n.padStart(2, '0')
    return `${today.slice(0, 4)}-${pad(exact[2])}-${pad(exact[1])}`
  }
  const weekday = WEEKDAYS.find(([root]) => lower.includes(root))
  if (weekday) {
    const diff =
      (weekday[1] - parseIso(today).getDay() + DAYS_IN_WEEK) % DAYS_IN_WEEK || DAYS_IN_WEEK
    return addDays(today, diff)
  }
  return nextWorkday(today)
}

export const ABSENCE_TYPES: ReadonlyArray<{ id: AbsenceType; ru: string; en: string }> = [
  { id: 'unpaid', ru: 'За свой счёт', en: 'Unpaid' },
  { id: 'vacation', ru: 'В счёт отпуска', en: 'From vacation days' },
  { id: 'workoff', ru: 'С отработкой', en: 'Make up the hours' },
]

export function absenceTypeLabel(type: AbsenceType): string {
  return ABSENCE_TYPES.find((t) => t.id === type)?.ru ?? type
}

/** Черновик для useConfirmAction: ключ идемпотентности живёт в карточке, повтор не создаёт дубль. */
export function buildAbsenceDraft(
  date: string,
  type: AbsenceType,
  idempotencyKey: string,
): ActionDraft {
  return {
    kind: 'absence',
    title: 'Отгул',
    details: [
      { label: 'Дата', value: formatShort(date) },
      { label: 'Тип', value: absenceTypeLabel(type) },
      { label: 'Согласует', value: mustEmployee(DEMO.leadId).name },
    ],
    idempotencyKey,
  }
}

/* ---------- Ответы ---------- */

export function toSource(doc: KbDoc, today: string): Source {
  return {
    docId: doc.id,
    title: doc.title,
    reviewedAt: doc.reviewedAt,
    ownerName: doc.ownerName,
    isStale: isStale(doc, today),
  }
}

function replyNext(tasks: readonly Task[]): BotReply {
  const task = pickNextStep(tasks)
  if (!task) {
    return {
      intent: 'next',
      text: 'Все задачи плана закрыты. Спроси наставника, что взять дальше',
      meta: { kind: 'next', taskId: null },
    }
  }
  const due = task.due ? `, срок ${formatDue(task.due)}` : ''
  return {
    intent: 'next',
    text: `Следующий шаг по плану: «${task.title}»${due}. Когда сделаешь, отметь задачу в онбординге`,
    meta: { kind: 'next', taskId: task.id },
  }
}

function replyAbsence(text: string, today: string): BotReply {
  const date = parseAbsenceDate(text, today)
  const options = [...new Set([date, nextWorkday(date)])]
  const doc = findKbDoc('kb-absence')
  const lead = mustEmployee(DEMO.leadId)
  return {
    intent: 'absence',
    text:
      `Порядок такой: заявка уходит в сервис «Отсутствия», её согласует руководитель - ${lead.name}. ` +
      'Подавать лучше за 1-2 рабочих дня. Уточни дату и тип отгула',
    meta: {
      kind: 'absenceAsk',
      date,
      options,
      isAnswered: false,
      source: doc ? toSource(doc, today) : null,
    },
  }
}

function replyQuestion(text: string, ctx: BotContext): BotReply {
  const mentorAnswer = findKbAnswer(ctx.escalations, text)
  if (mentorAnswer?.answer) {
    return {
      intent: 'question',
      text: mentorAnswer.answer,
      meta: {
        kind: 'mentor',
        mentorName: mustEmployee(mentorAnswer.mentorId).name,
        question: mentorAnswer.question,
        answeredAt: mentorAnswer.answeredAt,
      },
    }
  }
  const doc = searchKb(text)
  if (doc)
    return {
      intent: 'question',
      text: doc.answer,
      meta: { kind: 'kb', source: toSource(doc, ctx.today) },
    }
  const mentor = mustEmployee(DEMO.mentorId)
  return {
    intent: 'question',
    text: `Не нашёл ответ в базе знаний, а выдумывать не буду. Могу передать вопрос наставнику - ${mentor.name} - вместе с нашей перепиской`,
    meta: { kind: 'notFound', question: text.trim(), status: 'idle', deliverAt: null },
  }
}

export function answer(text: string, ctx: BotContext): BotReply {
  const intent = detectIntent(text, ctx.self.id)
  switch (intent) {
    case 'denied':
      return {
        intent,
        text:
          'Не могу показать: отпуска, оценки и другие личные данные коллег видят только они сами и их руководитель. ' +
          'Запрос записан в историю действий как отказ',
        meta: { kind: 'denied' },
      }
    case 'absence':
      return replyAbsence(text, ctx.today)
    case 'next':
      return replyNext(ctx.tasks)
    case 'greeting':
      return {
        intent,
        text: `Привет, ${ctx.self.short}! Я buddy. Подскажу следующий шаг, найду ответ в базе знаний и помогу оформить отгул`,
      }
    case 'question':
      return replyQuestion(text, ctx)
  }
}

const CONTEXT_LIMIT = 6

/** S-5: переписка перед вопросом для наставника (без самого вопроса и без лишнего). */
export function buildEscalationContext(
  messages: readonly Message[],
  beforeId: string,
): Array<{ from: 'intern' | 'bot'; text: string }> {
  const index = messages.findIndex((m) => m.id === beforeId)
  const before = index === -1 ? messages : messages.slice(0, index)
  return before
    .filter((m) => m.from === 'me' || m.from === 'bot')
    .slice(-CONTEXT_LIMIT)
    .map((m) => ({ from: m.from === 'me' ? 'intern' : 'bot', text: m.text }))
}
