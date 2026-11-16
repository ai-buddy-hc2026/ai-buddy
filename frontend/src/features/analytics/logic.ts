import type { Action } from '@/entities/actions'
import type { Escalation } from '@/entities/escalations'
import { DEMO_TODAY } from '@/shared/lib/date'

/**
 * Метрики пилота (демо шаг 10). Чистые функции, покрыты тестами в logic.test.ts.
 *
 * Контракт с чатом (данные пишутся через useConfirmAction в entities/actions):
 * - отказ политики доступа: действие с деталью value === 'policy_denied' или idempotencyKey с префиксом 'policy_denied';
 * - вопрос, закрытый ботом без наставника: действие kind 'message' с деталью value === 'resolved_by_bot'.
 */
export const POLICY_DENIED = 'policy_denied'
export const BOT_RESOLVED = 'resolved_by_bot'

const DONE_STATUSES: ReadonlySet<Action['status']> = new Set(['sent', 'approved', 'scheduled'])

export interface DayStat {
  /** ISO YYYY-MM-DD */
  date: string
  asked: number
  selfServed: number
}

/** Синтетика пилота за неделю 2 до демо: сколько вопросов задали и сколько бот закрыл сам. */
export const PILOT_BASELINE: readonly DayStat[] = [
  { date: '2026-11-09', asked: 9, selfServed: 7 },
  { date: '2026-11-10', asked: 12, selfServed: 10 },
  { date: '2026-11-11', asked: 10, selfServed: 9 },
  { date: '2026-11-12', asked: 4, selfServed: 4 },
]

export interface Metrics {
  questionsTotal: number
  closedWithoutMentor: number
  /** Доля закрытых без наставника, 0-100 */
  selfServeShare: number
  actionsDone: number
  escalations: number
  policyDenied: number
}

export function isPolicyDenied(action: Action): boolean {
  return (
    action.idempotencyKey.startsWith(POLICY_DENIED) ||
    action.details.some((d) => d.value === POLICY_DENIED)
  )
}

export function isBotResolved(action: Action): boolean {
  return action.kind === 'message' && action.details.some((d) => d.value === BOT_RESOLVED)
}

export function isCompletedAction(action: Action): boolean {
  return !isPolicyDenied(action) && !isBotResolved(action) && DONE_STATUSES.has(action.status)
}

const sum = (items: readonly DayStat[], key: 'asked' | 'selfServed') =>
  items.reduce((acc, d) => acc + d[key], 0)

export function computeMetrics(
  actions: readonly Action[],
  escalations: readonly Escalation[],
  baseline: readonly DayStat[] = PILOT_BASELINE,
): Metrics {
  const liveBot = actions.filter(isBotResolved).length
  const closedWithoutMentor = sum(baseline, 'selfServed') + liveBot
  const questionsTotal = sum(baseline, 'asked') + liveBot + escalations.length
  return {
    questionsTotal,
    closedWithoutMentor,
    selfServeShare:
      questionsTotal > 0 ? Math.round((closedWithoutMentor / questionsTotal) * 100) : 0,
    actionsDone: actions.filter(isCompletedAction).length,
    escalations: escalations.length,
    policyDenied: actions.filter(isPolicyDenied).length,
  }
}

/** Ряд по дням: к сегодняшнему дню добавляются живые данные демо. */
export function dailySeries(
  baseline: readonly DayStat[],
  live: { selfServed: number; escalated: number },
  today = DEMO_TODAY,
): DayStat[] {
  const add = (day: DayStat): DayStat => ({
    ...day,
    asked: day.asked + live.selfServed + live.escalated,
    selfServed: day.selfServed + live.selfServed,
  })
  const hasToday = baseline.some((d) => d.date === today)
  const series = baseline.map((d) => (d.date === today ? add(d) : d))
  return hasToday ? series : [...series, add({ date: today, asked: 0, selfServed: 0 })]
}

/** Верх шкалы графика: ближайшее «круглое» число сверху. */
export function niceMax(value: number, step = 5): number {
  return Math.max(step, Math.ceil(value / step) * step)
}
