import type { AnalyticsSummary } from '@/entities/analytics'
import type { DayStat } from './logic'

/** Ряд для BarChart: «закрыто ботом» = вопросы без ответа «не знаю». */
export function toDayStats(days: AnalyticsSummary['days']): DayStat[] {
  return days.map((day) => ({
    date: day.date,
    asked: day.questions,
    selfServed: Math.max(day.questions - day.unknown, 0),
  }))
}

/** Минуты в часы с одной цифрой после запятой: 25 -> «0,4 ч». */
export function formatHours(minutes: number, locale: 'ru' | 'en' = 'ru'): string {
  const hours = Math.round((minutes / 60) * 10) / 10
  return locale === 'ru' ? `${String(hours).replace('.', ',')} ч` : `${hours} h`
}

/** Секунды до подтверждённого действия в короткий текст. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '-'
  if (seconds < 60) return `${Math.round(seconds)} с`
  return `${Math.round(seconds / 60)} мин`
}
