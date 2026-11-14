/**
 * Демо живёт в фиксированном «сегодня», чтобы тестовые данные не устаревали.
 * Чт, 12 ноября 2026, неделя 2 стажировки Ани.
 */
export const DEMO_TODAY = '2026-11-12'

const WEEKDAYS_RU = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MS_DAY = 86_400_000

export function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function addDays(iso: string, days: number): string {
  const date = parseIso(iso)
  date.setDate(date.getDate() + days)
  return toIso(date)
}

/** Сколько дней от «сегодня» до даты. Отрицательное - просрочено. */
export function daysUntil(iso: string, today: string = DEMO_TODAY): number {
  return Math.round((parseIso(iso).getTime() - parseIso(today).getTime()) / MS_DAY)
}

/** «пт, 13.11» */
export function formatShort(iso: string, lang: 'ru' | 'en' = 'ru'): string {
  const date = parseIso(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  const weekday = (lang === 'en' ? WEEKDAYS_EN : WEEKDAYS_RU)[date.getDay()]
  return `${weekday}, ${pad(date.getDate())}.${pad(date.getMonth() + 1)}`
}

/** «сегодня», «завтра», «через 3 дня», «просрочено на 2 дня» или короткая дата. */
export function formatDue(
  iso: string,
  lang: 'ru' | 'en' = 'ru',
  today: string = DEMO_TODAY,
): string {
  const diff = daysUntil(iso, today)
  if (lang === 'en') {
    if (diff === 0) return 'today'
    if (diff === 1) return 'tomorrow'
    if (diff < 0) return `${-diff} d overdue`
    return diff <= 6 ? `in ${diff} d` : formatShort(iso, 'en')
  }
  if (diff === 0) return 'сегодня'
  if (diff === 1) return 'завтра'
  if (diff < 0) return `просрочено на ${-diff} дн.`
  return diff <= 6 ? `до ${formatShort(iso)}` : formatShort(iso)
}

/** Следующий рабочий день (пн-пт) после даты. */
export function nextWorkday(iso: string): string {
  let next = addDays(iso, 1)
  while ([0, 6].includes(parseIso(next).getDay())) next = addDays(next, 1)
  return next
}

/** «10:42» из Date или ISO-строки со временем. */
export function formatTime(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/** Попадает ли время «HH:MM» в окно [start, end). */
export function isWithinHours(time: string, start: string, end: string): boolean {
  return time >= start && time < end
}
