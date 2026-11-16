import type { WorkHours } from '@/entities/settings'

/** Чистая логика настроек. Покрыта тестами в logic.test.ts. */
export const WEEKDAYS: ReadonlyArray<{ day: number; ru: string; en: string }> = [
  { day: 1, ru: 'пн', en: 'Mon' },
  { day: 2, ru: 'вт', en: 'Tue' },
  { day: 3, ru: 'ср', en: 'Wed' },
  { day: 4, ru: 'чт', en: 'Thu' },
  { day: 5, ru: 'пт', en: 'Fri' },
  { day: 6, ru: 'сб', en: 'Sat' },
  { day: 7, ru: 'вс', en: 'Sun' },
]

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** Включить или выключить день. Последний рабочий день выключить нельзя. */
export function toggleDay(days: readonly number[], day: number): number[] {
  if (days.includes(day)) {
    return days.length > 1 ? days.filter((d) => d !== day) : [...days]
  }
  return [...days, day].sort((a, b) => a - b)
}

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value)
}

/** Начало раньше конца, оба значения в формате HH:MM. */
export function isValidHours(hours: Pick<WorkHours, 'start' | 'end'>): boolean {
  return isValidTime(hours.start) && isValidTime(hours.end) && hours.start < hours.end
}
