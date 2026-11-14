import type { ActionDraft } from '@/entities/actions'
import type { Slot } from '@/entities/calendar'
import { getEmployee } from '@/entities/employees'
import { pickNextStep, type Task } from '@/entities/plan'
import { ApiError } from '@/shared/api/http'
import { daysUntil, formatDue, parseIso } from '@/shared/lib/date'
import type { Lang, Translate } from '@/shared/lib/i18n'
import type { Course, EventItem, EventKind } from './data'

/* ---------- Места и запись ---------- */

/** Сколько мест осталось. null - без ограничения. */
export function seatsLeft(event: EventItem): number | null {
  if (event.capacity === null) return null
  return Math.max(0, event.capacity - event.attendees.length)
}

export function isJoined(event: EventItem, userId: string): boolean {
  return event.attendees.includes(userId)
}

export function isFull(event: EventItem): boolean {
  return seatsLeft(event) === 0
}

function findEvent(events: readonly EventItem[], eventId: string): EventItem {
  const event = events.find((e) => e.id === eventId)
  if (!event) throw new ApiError(404, 'not_found', 'Такого события нет')
  return event
}

/** Проверка до отправки: событие есть, место есть. Уже записан - не ошибка. */
export function assertCanJoin(
  events: readonly EventItem[],
  eventId: string,
  userId: string,
): EventItem {
  const event = findEvent(events, eventId)
  if (!isJoined(event, userId) && isFull(event)) {
    throw new ApiError(409, 'conflict', 'Мест уже нет. Можно спросить организатора')
  }
  return event
}

/** Запись на событие. Повторная запись ничего не меняет, мест нет - 409. */
export function joinEvent(
  events: readonly EventItem[],
  eventId: string,
  userId: string,
): EventItem[] {
  const event = assertCanJoin(events, eventId, userId)
  if (isJoined(event, userId)) return [...events]
  return events.map((e) => (e.id === eventId ? { ...e, attendees: [...e.attendees, userId] } : e))
}

/** Отмена записи: место освобождается. */
export function leaveEvent(
  events: readonly EventItem[],
  eventId: string,
  userId: string,
): EventItem[] {
  findEvent(events, eventId)
  return events.map((e) =>
    e.id === eventId ? { ...e, attendees: e.attendees.filter((id) => id !== userId) } : e,
  )
}

/* ---------- Лента ---------- */

export type FeedFilter = 'all' | 'training' | 'talks' | 'user'

const FILTER_KINDS: Record<FeedFilter, readonly EventKind[]> = {
  all: ['training', 'avitotech', 'internal', 'user'],
  training: ['training'],
  talks: ['avitotech', 'internal'],
  user: ['user'],
}

export function eventDay(event: Pick<EventItem, 'start'>): string {
  return event.start.slice(0, 10)
}

export function eventTime(event: Pick<EventItem, 'start'>): string {
  return event.start.slice(11, 16)
}

/** Будущие события нужного вида, ближайшие сверху. */
export function filterFeed(
  events: readonly EventItem[],
  filter: FeedFilter,
  today: string,
): EventItem[] {
  return events
    .filter((e) => FILTER_KINDS[filter].includes(e.kind) && daysUntil(eventDay(e), today) >= 0)
    .sort((a, b) => a.start.localeCompare(b.start))
}

export function myEvents(events: readonly EventItem[], userId: string, today: string): EventItem[] {
  return filterFeed(events, 'all', today).filter((e) => isJoined(e, userId))
}

/** Вопрос для buddy о событии: уходит в /chats?c=buddy&q=... */
export function eventQuestion(event: Pick<EventItem, 'title'>, t: Translate): string {
  return t(
    `Расскажи про событие «${event.title}»: что взять и как подготовиться?`,
    `Tell me about «${event.title}»: how to prepare?`,
  )
}

/** Черновик для истории действий: запись или отмена записи. */
export function buildEventDraft(
  event: EventItem,
  mode: 'join' | 'leave',
  idempotencyKey: string,
  when: string,
  t: Translate,
): ActionDraft {
  return {
    kind: 'booking',
    title:
      mode === 'join'
        ? t(`Запись: ${event.title}`, `Sign-up: ${event.title}`)
        : t(`Отмена записи: ${event.title}`, `Cancelled: ${event.title}`),
    details: [
      { label: t('Когда', 'When'), value: when },
      { label: t('Где', 'Where'), value: event.placeName },
    ],
    status: 'sent',
    idempotencyKey,
  }
}

/* ---------- Проактивный buddy ---------- */

export interface NoteLink {
  label: string
  to: string
  search: Record<string, string>
}

export interface BuddyNote {
  id: string
  kind: 'digest' | 'reminder' | 'hint'
  /** Время доставки «HH:MM» */
  time: string
  title: string
  lines: string[]
  /** Главный шаг дня выделяется отдельно (идея 23) */
  focus: string | null
  links: NoteLink[]
}

/** 1 = пн ... 7 = вс, как в настройках рабочих часов. */
export function isWorkday(iso: string, workDays: readonly number[]): boolean {
  const day = parseIso(iso).getDay()
  return workDays.includes(day === 0 ? 7 : day)
}

const REMIND_DAYS = [3, 1]

/** Напоминания об обязательных курсах: за 3 дня и за 1 день до дедлайна (идея 10). */
export function courseReminders(
  courses: readonly Course[],
  today: string,
  t: Translate,
): BuddyNote[] {
  return courses
    .filter(
      (c) => c.modulesDone < c.modulesTotal && REMIND_DAYS.includes(daysUntil(c.deadline, today)),
    )
    .map((c): BuddyNote => ({
      id: `remind-${c.id}-${daysUntil(c.deadline, today)}`,
      kind: 'reminder',
      time: '10:00',
      title: t(
        `Курс «${c.title}»: дедлайн ${formatDue(c.deadline, 'ru', today)}`,
        `«${c.title}» is due ${formatDue(c.deadline, 'en', today)}`,
      ),
      lines: [
        t(
          `${c.modulesDone} из ${c.modulesTotal} модулей, осталось около ${c.minutesLeft} минут`,
          `${c.modulesDone} of ${c.modulesTotal} modules, about ${c.minutesLeft} min left`,
        ),
      ],
      focus: null,
      links: [
        { label: t('Продолжить курс', 'Continue'), to: '/onboarding', search: { tab: 'courses' } },
      ],
    }))
}

/** Подсказка за день до тренинга, на который записан стажёр (идея 24). Одна на событие. */
export function eventHints(
  events: readonly EventItem[],
  userId: string,
  today: string,
  t: Translate,
): BuddyNote[] {
  return events
    .filter(
      (e) => isJoined(e, userId) && daysUntil(eventDay(e), today) === 1 && e.materials.length > 0,
    )
    .map((e): BuddyNote => ({
      id: `hint-${e.id}`,
      kind: 'hint',
      time: '10:00',
      title: t(
        `Завтра «${e.title}» в ${eventTime(e)}`,
        `Tomorrow: «${e.title}» at ${eventTime(e)}`,
      ),
      lines: [t('Перед ним стоит глянуть:', 'Worth a look before it:'), ...e.materials],
      focus: null,
      links: [
        { label: t('Открыть событие', 'Open event'), to: '/events', search: { id: e.id } },
        {
          label: t('Спросить buddy', 'Ask buddy'),
          to: '/chats',
          search: { c: 'buddy', q: eventQuestion(e, t) },
        },
      ],
    }))
}

export interface DigestInput {
  today: string
  workDays: readonly number[]
  userId: string
  slots: readonly Slot[]
  events: readonly EventItem[]
  courses: readonly Course[]
  tasks: readonly Task[]
}

const DIGEST_HORIZON_DAYS = 3

function digestDeadlines(input: DigestInput, t: Translate, lang: Lang): string[] {
  const near = (iso: string) => {
    const diff = daysUntil(iso, input.today)
    return diff >= 0 && diff <= DIGEST_HORIZON_DAYS
  }
  const courses = input.courses
    .filter((c) => c.modulesDone < c.modulesTotal && near(c.deadline))
    .map((c) => `${t('Курс', 'Course')} «${c.title}» - ${formatDue(c.deadline, lang, input.today)}`)
  const tasks = input.tasks
    .filter(
      (task) =>
        task.owner === 'intern' && task.status !== 'done' && task.due !== null && near(task.due),
    )
    .map((task) => `${task.title} - ${formatDue(task.due ?? input.today, lang, input.today)}`)
  return [...courses, ...tasks]
}

/** Утренний брифинг (идея 23): только факты из данных. В выходной не собирается. */
export function buildDigest(input: DigestInput, t: Translate, lang: Lang): BuddyNote | null {
  if (!isWorkday(input.today, input.workDays)) return null

  const meetings = input.slots
    .filter((slot) => slot.bookedBy === input.userId && slot.start.startsWith(input.today))
    .map(
      (slot) =>
        `${slot.topic || t('Встреча', 'Meeting')} - ${getEmployee(slot.employeeId)?.name ?? slot.employeeId}, ${slot.start.slice(11, 16)}`,
    )
  const events = myEvents(input.events, input.userId, input.today)
    .filter((e) => eventDay(e) === input.today)
    .map((e) => `${e.title}, ${eventTime(e)}`)
  const deadlines = digestDeadlines(input, t, lang)
  const today = [...meetings, ...events]

  return {
    id: `digest-${input.today}`,
    kind: 'digest',
    time: '10:00',
    title: t('Доброе утро! Вот твой день', 'Good morning! Here is your day'),
    lines: [
      ...(today.length > 0
        ? [t('Сегодня:', 'Today:'), ...today]
        : [t('Встреч сегодня нет', 'No meetings today')]),
      ...(deadlines.length > 0 ? [t('Скоро дедлайн:', 'Due soon:'), ...deadlines] : []),
    ],
    focus: pickNextStep(input.tasks)?.title ?? null,
    links: [{ label: t('Открыть план', 'Open plan'), to: '/onboarding', search: { tab: 'plan' } }],
  }
}

export interface NoteGroups {
  /** Новые: показываем с меткой и объявляем диктору */
  fresh: BuddyNote[]
  /** Тихие: пришли, пока нельзя беспокоить. Видны, но не как новые */
  quiet: BuddyNote[]
  read: BuddyNote[]
}

/** Разбор сообщений buddy. Если сейчас нельзя беспокоить, непрочитанное молчит в очереди. */
export function groupNotes(
  notes: readonly BuddyNote[],
  seenIds: readonly string[],
  canNotify: boolean,
): NoteGroups {
  const unseen = notes.filter((n) => !seenIds.includes(n.id))
  return {
    fresh: canNotify ? unseen : [],
    quiet: canNotify ? [] : unseen,
    read: notes.filter((n) => seenIds.includes(n.id)),
  }
}
