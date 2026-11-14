import { z } from 'zod'
import type { NewTask, Task } from '@/entities/plan'
import { addDays, DEMO_TODAY, parseIso, toIso } from '@/shared/lib/date'

/**
 * Итоги встречи (идея 8). В прототипе вместо LLM - детерминированный мок-экстрактор:
 * режем заметки на фразы, по правилам находим договорённости, ответственного и срок.
 * Ответ проверяем той же схемой, что потом будет у AI-сервиса. Покрыто тестами в meetingNotes.test.ts.
 */
export const NOTES_MAX = 5000
export const WHAT_MAX = 200
export const SUMMARY_MAX = 1000
const SUMMARY_SOFT = 300
const WHAT_MIN = 3

export const agreementSchema = z.object({
  id: z.string(),
  owner: z.enum(['intern', 'mentor', 'other']),
  what: z.string().trim().min(1).max(WHAT_MAX),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
})
export type Agreement = z.infer<typeof agreementSchema>
export type AgreementOwner = Agreement['owner']

export const meetingDraftSchema = z.object({
  summary: z.string().trim().min(1).max(SUMMARY_MAX),
  agreements: z.array(agreementSchema),
})
export type MeetingDraft = z.infer<typeof meetingDraftSchema>

export const meetingRecordSchema = meetingDraftSchema.extend({
  meetingId: z.string(),
  savedAt: z.string(),
  taskCount: z.number().int().min(0),
})
export type MeetingRecord = z.infer<typeof meetingRecordSchema>
export const meetingRecordsSchema = z.record(z.string(), meetingRecordSchema)
export type MeetingRecords = z.infer<typeof meetingRecordsSchema>

/** Кого узнаём в тексте: короткие имена коллег. */
export interface Person {
  short: string
  role: 'mentor' | 'other'
}

const L = '\\p{L}'
const word = (body: string, flags = 'iu') => new RegExp(`(?<!${L})(?:${body})(?!${L})`, flags)

const INTERN_RE = word('я|мне|меня|ты|тебе|тебя|сама|сам|стажёр\\p{L}*|стажер\\p{L}*')
const MENTOR_WORD_RE = word('наставник\\p{L}*')
const ACTION_RE =
  /(договорил|нужно|надо|должн|сдела|выда|пришл|отправ|подготов|прочит|чита|посмотр|настро|напиш|написа|добав|разбер|покаж|показа|созда|поправ|исправ|обнов|возьм|взять|скин|провер|закро|закры|todo)/iu
const SUMMARY_LEAD_RE =
  /^(обсудили|поговорили|рассказал\p{L}*|узнал\p{L}*|было|понравил\p{L}*|встреча)/iu
const LEAD_RE = /^(договорились|решили)\s*[,:-]?\s*(что\s+)?/iu
const BULLET_RE = /^[\s\-*•\d.)]+/u

/** Основа имени для склонений: Илья -> Иль (Ильи, Илье). С заглавной, чтобы «Лена» не ловила «лень». */
function nameRe(short: string): RegExp {
  const stem = short.slice(0, Math.max(3, short.length - 1))
  return word(`${stem}\\p{L}{0,3}`, 'u')
}

const WEEKDAYS: ReadonlyArray<[string, number]> = [
  ['понедельник\\p{L}?', 1],
  ['вторник\\p{L}?', 2],
  ['сред\\p{L}', 3],
  ['четверг\\p{L}?', 4],
  ['пятниц\\p{L}', 5],
  ['суббот\\p{L}', 6],
  ['воскресень\\p{L}', 0],
]
const PREP = '(?:(?:до|к|в|во|на|через)\\s+)?'

function nextWeekday(today: string, weekday: number): string {
  const current = parseIso(today).getDay()
  const diff = (weekday - current + 7) % 7 || 7
  return addDays(today, diff)
}

type DueMatch = { date: string; phrase: string }

function matchRelative(text: string, today: string): DueMatch | null {
  const rules: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
    [word(`${PREP}послезавтра`), () => addDays(today, 2)],
    [word(`${PREP}завтра`), () => addDays(today, 1)],
    [word(`${PREP}сегодня`), () => today],
    [word('(?:до\\s+)?конца\\s+недели'), () => nextWeekday(addDays(today, -1), 5)],
    [word('через\\s+неделю'), () => addDays(today, 7)],
    [word('через\\s+(\\d{1,2})\\s+(?:дн\\p{L}*|день)'), (m) => addDays(today, Number(m[1]))],
  ]
  for (const [re, toDate] of rules) {
    const m = text.match(re)
    if (m) return { date: toDate(m), phrase: m[0] }
  }
  return null
}

/** Срок из фразы: «до среды», «завтра», «18.11», «через 3 дня». Нет срока - null. */
export function parseDue(text: string, today: string = DEMO_TODAY): DueMatch | null {
  const numeric = text.match(word(`${PREP}(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{4}))?`))
  if (numeric) {
    const year = numeric[3] ? Number(numeric[3]) : parseIso(today).getFullYear()
    const date = new Date(year, Number(numeric[2]) - 1, Number(numeric[1]))
    if (date.getDate() === Number(numeric[1])) return { date: toIso(date), phrase: numeric[0] }
  }
  for (const [body, weekday] of WEEKDAYS) {
    const m = text.match(word(`${PREP}${body}`))
    if (m) return { date: nextWeekday(today, weekday), phrase: m[0] }
  }
  return matchRelative(text, today)
}

function detectOwner(clause: string, people: readonly Person[]): AgreementOwner {
  const hits: Array<{ index: number; owner: AgreementOwner }> = []
  const push = (re: RegExp, owner: AgreementOwner) => {
    const m = clause.match(re)
    if (m?.index !== undefined) hits.push({ index: m.index, owner })
  }
  push(INTERN_RE, 'intern')
  push(MENTOR_WORD_RE, 'mentor')
  people.forEach((person) => push(nameRe(person.short), person.role))
  if (hits.length === 0) return 'intern'
  return [...hits].sort((a, b) => a.index - b.index)[0].owner
}

function startsWithOwner(text: string, people: readonly Person[]): boolean {
  const head = text.replace(/^(а|и)\s+/iu, '')
  const res = [INTERN_RE, MENTOR_WORD_RE, ...people.map((p) => nameRe(p.short))]
  return res.some((re) => re.exec(head)?.index === 0)
}

/** Фразы: строки, предложения, а внутри - части через запятую с новым ответственным. */
export function splitClauses(text: string, people: readonly Person[]): string[] {
  const sentences = text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?;])\s+/))
    .map((line) => line.replace(BULLET_RE, '').trim())
    .filter(Boolean)
  return sentences.flatMap((sentence) =>
    sentence.split(/,\s*/).reduce<string[]>((acc, part) => {
      if (acc.length === 0 || startsWithOwner(part, people)) return [...acc, part]
      return [...acc.slice(0, -1), `${acc[acc.length - 1]}, ${part}`]
    }, []),
  )
}

function cleanWhat(clause: string, duePhrase: string | null): string {
  const noDue = duePhrase ? clause.replace(duePhrase, ' ') : clause
  const text = noDue
    .replace(LEAD_RE, '')
    .replace(/^(а|и)\s+/iu, '')
    .replace(/[\s,.;:!-]+$/u, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return (text.charAt(0).toUpperCase() + text.slice(1)).slice(0, WHAT_MAX)
}

function isAgreement(clause: string, hasDue: boolean): boolean {
  if (SUMMARY_LEAD_RE.test(clause)) return false
  return hasDue || ACTION_RE.test(clause)
}

function buildSummary(rest: readonly string[], agreements: readonly Agreement[]): string {
  const base =
    rest.length > 0
      ? rest.map((line) => line.replace(/[.;]+$/u, '')).join('. ')
      : `Договорились: ${agreements.map((a) => a.what).join('; ')}`
  return base.length > SUMMARY_SOFT ? `${base.slice(0, SUMMARY_SOFT - 3).trimEnd()}...` : base
}

/** Мок-экстрактор: заметки -> черновик {summary, agreements}. Без LLM, только правила. */
export function extractMeeting(
  text: string,
  people: readonly Person[],
  today: string = DEMO_TODAY,
): MeetingDraft {
  const clauses = splitClauses(text.slice(0, NOTES_MAX), people)
  const agreements: Agreement[] = []
  const rest: string[] = []
  clauses.forEach((clause) => {
    const due = parseDue(clause, today)
    const what = cleanWhat(clause, due?.phrase ?? null)
    if (!isAgreement(clause, due !== null) || what.length < WHAT_MIN) {
      rest.push(clause)
      return
    }
    agreements.push({
      id: `ag-${agreements.length + 1}`,
      owner: detectOwner(clause, people),
      what,
      due_date: due?.date ?? null,
    })
  })
  if (agreements.length === 0 && rest.length === 0) return { summary: '', agreements: [] }
  return { summary: buildSummary(rest, agreements), agreements }
}

export type ExtractResult = { ok: true; draft: MeetingDraft } | { ok: false }

/** Как с AI-сервисом: ответ не прошёл схему - один повтор, потом ошибка. */
export function extractWithRetry(run: () => unknown, attempts = 2): ExtractResult {
  for (let i = 0; i < attempts; i += 1) {
    const parsed = meetingDraftSchema.safeParse(run())
    if (parsed.success) return { ok: true, draft: parsed.data }
  }
  return { ok: false }
}

/* ---------- Правка черновика ---------- */

export function updateAgreement(
  list: readonly Agreement[],
  id: string,
  patch: Partial<Omit<Agreement, 'id'>>,
): Agreement[] {
  return list.map((item) => (item.id === id ? { ...item, ...patch } : item))
}

export function removeAgreement(list: readonly Agreement[], id: string): Agreement[] {
  return list.filter((item) => item.id !== id)
}

export function addAgreement(list: readonly Agreement[], id: string): Agreement[] {
  return [...list, { id, owner: 'intern', what: '', due_date: null }]
}

/** Пустые пункты при сохранении отбрасываем, остальное проверяем схемой. */
export function finalizeDraft(draft: MeetingDraft): MeetingDraft | null {
  const cleaned = {
    summary: draft.summary.trim(),
    agreements: draft.agreements
      .map((a) => ({ ...a, what: a.what.trim() }))
      .filter((a) => a.what.length > 0),
  }
  const parsed = meetingDraftSchema.safeParse(cleaned)
  return parsed.success ? parsed.data : null
}

export function meetingSource(meetingId: string): string {
  return `meeting:${meetingId}`
}

const OWNER_NOTE: Record<AgreementOwner, string> = {
  intern: 'Договорённость со встречи',
  mentor: 'Обязательство наставника',
  other: 'Делает коллега, проследи',
}

/** Договорённости -> задачи чек-листа. Уже добавленные с этой встречи не дублируем. */
export function agreementsToTasks(
  agreements: readonly Agreement[],
  meetingId: string,
  existing: readonly Task[],
): NewTask[] {
  const source = meetingSource(meetingId)
  const known = new Set(existing.filter((t) => t.source === source).map((t) => t.title))
  return agreements
    .filter((a) => !known.has(a.what))
    .map((a) => ({
      title: a.what,
      due: a.due_date,
      // В чек-листе два владельца: «другой человек» становится задачей стажёра «проследить»
      owner: a.owner === 'mentor' ? 'mentor' : 'intern',
      source,
      note: OWNER_NOTE[a.owner],
    }))
}
