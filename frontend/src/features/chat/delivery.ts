import type { Employee } from '@/entities/employees'
import { DEMO_TODAY, addDays, daysUntil, isWithinHours, parseIso } from '@/shared/lib/date'

/**
 * Отложенная доставка коллеге (идея 43, «Мои границы»).
 * Вне рабочих часов получателя сообщение получает deliver_at = начало его следующего окна.
 * Чистые функции: время считаем в часовом поясе получателя, а не браузера.
 */
export const DEMO_TIMEZONE = 'Europe/Moscow'
/** Пн-пт, как в настройках: 1 = пн ... 7 = вс */
export const DEFAULT_WORK_DAYS: readonly number[] = [1, 2, 3, 4, 5]
/** «Ночь» для демо: сегодня в 23:40 по Москве (UTC+3) */
export const DEMO_NIGHT = new Date(`${DEMO_TODAY}T20:40:00Z`)

export type RecipientHours = Pick<Employee['workHours'], 'start' | 'end' | 'days'>

export type DeliveryPlan =
  | { kind: 'now' }
  | {
      kind: 'scheduled'
      /** Момент доставки, ISO в UTC */
      deliverAt: string
      /** Дата и время по часам получателя */
      localDate: string
      localTime: string
      /** 0 - сегодня, 1 - завтра, ... по часам получателя */
      dayOffset: number
    }

type WallClock = { date: string; time: string }

const DAYS_AHEAD = 7
const ISO_WEEK_SUNDAY = 7

/** Дата и время «на стене» в часовом поясе. */
export function wallClock(instant: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00'
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  }
}

/** 1 = пн ... 7 = вс */
export function isoWeekday(date: string): number {
  return parseIso(date).getDay() || ISO_WEEK_SUNDAY
}

function asUtcMs({ date, time }: WallClock): number {
  const [y, m, d] = date.split('-').map(Number)
  const [h, min] = time.split(':').map(Number)
  return Date.UTC(y, m - 1, d, h, min)
}

/** Момент, когда в часовом поясе на часах date + time. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const guess = asUtcMs({ date, time })
  const offset = asUtcMs(wallClock(new Date(guess), timeZone)) - guess
  return new Date(guess - offset)
}

/** Доставить сейчас или отложить до начала следующего рабочего окна получателя. */
export function planDelivery(
  now: Date,
  hours: RecipientHours,
  timeZone: string = DEMO_TIMEZONE,
): DeliveryPlan {
  const days = hours.days ?? DEFAULT_WORK_DAYS
  const local = wallClock(now, timeZone)
  const isWorkday = days.includes(isoWeekday(local.date))
  if (isWorkday && isWithinHours(local.time, hours.start, hours.end)) return { kind: 'now' }

  for (let offset = 0; offset <= DAYS_AHEAD; offset += 1) {
    const date = addDays(local.date, offset)
    const isAhead = offset > 0 || local.time < hours.start
    if (isAhead && days.includes(isoWeekday(date))) {
      return {
        kind: 'scheduled',
        deliverAt: zonedToUtc(date, hours.start, timeZone).toISOString(),
        localDate: date,
        localTime: hours.start,
        dayOffset: offset,
      }
    }
  }
  // Рабочих дней нет вовсе: не задерживаем сообщение
  return { kind: 'now' }
}

export type DeliveryWhen = { localDate: string; localTime: string; dayOffset: number }

/** Когда получатель увидит сообщение: дата и время по его часам и сдвиг от дня отправки. */
export function deliveryWhen(
  deliverAt: string,
  sentAt: string,
  timeZone: string = DEMO_TIMEZONE,
): DeliveryWhen {
  const target = wallClock(new Date(deliverAt), timeZone)
  const sent = wallClock(new Date(sentAt), timeZone)
  return {
    localDate: target.date,
    localTime: target.time,
    dayOffset: daysUntil(target.date, sent.date),
  }
}
