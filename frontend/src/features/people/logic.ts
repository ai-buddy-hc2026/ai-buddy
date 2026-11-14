import type { ActionDraft } from '@/entities/actions'
import type { Slot } from '@/entities/calendar'
import type { Employee } from '@/entities/employees'
import { addDays, daysUntil, nextWorkday, parseIso } from '@/shared/lib/date'
import { hashTo } from '@/shared/iso'

/* ---------- Вкладки ---------- */

export const TAB_IDS = ['team', 'hours', 'coffee', 'interests'] as const
export type PeopleTab = (typeof TAB_IDS)[number]

export function toTab(value: string | undefined): PeopleTab {
  return TAB_IDS.find((id) => id === value) ?? 'team'
}

/* ---------- Команда и «Кого спросить» (идея 19) ---------- */

const KIND_ORDER: Record<Employee['kind'], number> = {
  mentor: 0,
  lead: 1,
  colleague: 2,
  hr: 3,
  intern: 4,
}

/** Ключевые люди для стажёра: своя команда (без себя) и HR BP. Наставник и лид первыми. */
export function keyPeople(employees: readonly Employee[], self: Employee): Employee[] {
  return employees
    .filter((e) => e.id !== self.id && (e.teamId === self.teamId || e.kind === 'hr'))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
}

/** Тег зоны ответственности, который нашёлся в вопросе. null - совпадения нет. */
export function matchedTag(topic: string, employee: Employee): string | null {
  const query = topic.toLowerCase()
  return employee.tags.find((tag) => query.includes(tag)) ?? null
}

/** Черновик сообщения коллеге. Отправляет сам стажёр в чате. */
export function messageDraft(to: Employee, topic: string): string {
  const question = topic.trim()
  return question
    ? `Привет, ${to.short}! Подскажи, пожалуйста: ${question}`
    : `Привет, ${to.short}! Можно вопрос?`
}

/* ---------- Дни рождения (идея 15) ---------- */

export interface UpcomingBirthday {
  employee: Employee
  /** Дата ближайшего ДР, ISO */
  date: string
  inDays: number
}

/** Ближайшая дата «MM-DD» начиная с today (без года рождения). */
export function nextOccurrence(monthDay: string, today: string): string {
  const year = parseIso(today).getFullYear()
  const thisYear = `${year}-${monthDay}`
  return daysUntil(thisYear, today) >= 0 ? thisYear : `${year + 1}-${monthDay}`
}

/** ДР коллег своей команды в ближайшие windowDays дней. Скрытые в профиле не показываем. */
export function upcomingBirthdays(
  employees: readonly Employee[],
  self: Employee,
  today: string,
  windowDays = 30,
): UpcomingBirthday[] {
  return employees
    .filter((e) => e.id !== self.id && e.teamId === self.teamId && e.birthday !== null)
    .map((employee) => {
      const date = nextOccurrence(employee.birthday ?? '', today)
      return { employee, date, inDays: daysUntil(date, today) }
    })
    .filter((b) => b.inDays <= windowDays)
    .sort((a, b) => a.inDays - b.inDays)
}

/* ---------- Приёмные часы (идея 6) ---------- */

/** Запись в историю действий о брони. Ключ идемпотентности - слот и участник. */
export function bookingDraft(
  slot: Pick<Slot, 'id' | 'start'>,
  host: Employee,
  attendeeId: string,
  topic: string,
  when: string,
): ActionDraft {
  return {
    kind: 'booking',
    title: `Встреча с ${host.name}`,
    details: [
      { label: 'Когда', value: when },
      { label: 'Тема', value: topic },
    ],
    idempotencyKey: `booking-${slot.id}-${attendeeId}`,
    status: 'sent',
  }
}

/** Ближайшие слоты первыми. */
export function sortSlots<T extends Pick<Slot, 'start'>>(slots: readonly T[]): T[] {
  return [...slots].sort((a, b) => a.start.localeCompare(b.start))
}

/* ---------- Random coffee (идея 20) ---------- */

export const pairKey = (ids: readonly string[]): string => [...ids].sort().join('+')

/** Все пары внутри группы (для тройки - три пары). */
export function pairsOf(group: readonly string[]): string[] {
  return group.flatMap((a, i) => group.slice(i + 1).map((b) => pairKey([a, b])))
}

/** Понедельник недели, в которую входит дата. */
export function weekOf(iso: string): string {
  const day = parseIso(iso).getDay()
  return addDays(iso, -((day + 6) % 7))
}

/**
 * Пары из разных команд без повторов прошлых недель. Нечётное число - одна тройка.
 * Порядок детерминирован по seed (неделе), чтобы пары не менялись при перезагрузке.
 */
export function makePairs(
  participants: ReadonlyArray<Pick<Employee, 'id' | 'teamId'>>,
  history: readonly string[],
  seed: string,
): string[][] {
  const used = new Set(history)
  const order = [...participants].sort(
    (a, b) => hashTo(seed + a.id, 997) - hashTo(seed + b.id, 997),
  )
  let free = order
  let groups: string[][] = []

  while (free.length >= 2) {
    const [first, ...rest] = free
    // Другая команда важнее, чем отсутствие повтора
    const score = (p: Pick<Employee, 'id' | 'teamId'>) =>
      (p.teamId !== first.teamId ? 2 : 0) + (used.has(pairKey([first.id, p.id])) ? 0 : 1)
    const partner = rest.reduce((best, p) => (score(p) > score(best) ? p : best), rest[0])
    groups = [...groups, [first.id, partner.id]]
    free = rest.filter((p) => p.id !== partner.id)
  }

  if (free.length === 1 && groups.length > 0) {
    const lastIndex = groups.length - 1
    groups = groups.map((group, i) => (i === lastIndex ? [...group, free[0].id] : group))
  }
  return groups
}

const PREFERRED_TIMES = ['15:00', '12:30', '16:30', '11:00'] as const
const COFFEE_MINUTES = 20

const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** Общие варианты времени на ближайшие рабочие дни: внутри рабочих часов обоих. */
export function proposeTimes(
  today: string,
  hours: ReadonlyArray<{ start: string; end: string }>,
  count = 3,
): string[] {
  const start = Math.max(...hours.map((h) => toMinutes(h.start)))
  const end = Math.min(...hours.map((h) => toMinutes(h.end)))
  const result: string[] = []
  let day = today
  for (let step = 0; step < count && start < end; step += 1) {
    day = nextWorkday(day)
    const time = PREFERRED_TIMES[step % PREFERRED_TIMES.length]
    const fits = toMinutes(time) >= start && toMinutes(time) + COFFEE_MINUTES <= end
    result.push(`${day}T${fits ? time : minutesToTime(start)}`)
  }
  return result
}

function minutesToTime(total: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

/* ---------- Увлечения (идея 22) ---------- */

const ALIASES: Record<string, string> = {
  футбик: 'футбол',
  football: 'футбол',
  'настольные игры': 'настолки',
  настолки: 'настолки',
  'board games': 'настолки',
  пробежки: 'бег',
  running: 'бег',
  вело: 'велосипед',
  велик: 'велосипед',
  рисую: 'рисование',
}

/** Свободный ввод -> существующий тег. Не нашли - чистим и оставляем как есть. */
export function normalizeInterest(input: string, known: readonly string[]): string {
  const clean = input.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!clean) return ''
  if (ALIASES[clean]) return ALIASES[clean]
  if (known.includes(clean)) return clean
  const byPrefix = clean.length >= 3 ? known.find((tag) => tag.startsWith(clean)) : undefined
  return byPrefix ?? clean
}

export function addInterest(list: readonly string[], tag: string): string[] {
  return tag && !list.includes(tag) ? [...list, tag] : [...list]
}

export function removeInterest(list: readonly string[], tag: string): string[] {
  return list.filter((t) => t !== tag)
}

export interface InterestMatch {
  employee: Employee
  shared: string[]
}

/** Люди с теми же увлечениями: больше общих - выше. Себя не показываем. */
export function interestMatches(
  mine: readonly string[],
  employees: readonly Employee[],
  selfId: string,
): InterestMatch[] {
  return employees
    .filter((e) => e.id !== selfId)
    .map((employee) => ({
      employee,
      shared: employee.interests.filter((tag) => mine.includes(tag)),
    }))
    .filter((m) => m.shared.length > 0)
    .sort(
      (a, b) => b.shared.length - a.shared.length || a.employee.name.localeCompare(b.employee.name),
    )
}

export function allInterestTags(
  employees: readonly Employee[],
  extra: readonly string[],
): string[] {
  return [...new Set([...employees.flatMap((e) => e.interests), ...extra])].sort()
}
