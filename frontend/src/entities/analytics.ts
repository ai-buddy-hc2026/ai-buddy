import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { IS_MOCK, request } from '@/shared/api/http'

/** Ответ GET /analytics/summary (SA-6). Метрики считает Go по таблицам БД. */
export const analyticsSummarySchema = z.object({
  scope: z.enum(['team', 'assigned']),
  interns: z.number().int().nonnegative(),
  questions: z.number().int().nonnegative(),
  answered: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  with_sources: z.number().int().nonnegative(),
  escalations: z.number().int().nonnegative(),
  deflection_rate: z.number().min(0).max(100),
  actions_proposed: z.number().int().nonnegative(),
  actions_succeeded: z.number().int().nonnegative(),
  avg_action_seconds: z.number().nonnegative(),
  policy_denied: z.number().int().nonnegative(),
  tasks_total: z.number().int().nonnegative(),
  tasks_done: z.number().int().nonnegative(),
  checklist_rate: z.number().min(0).max(100),
  mentor_minutes_saved: z.number().int().nonnegative(),
  minutes_per_question: z.number().int().nonnegative(),
  days: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      questions: z.number().int().nonnegative(),
      unknown: z.number().int().nonnegative(),
    }),
  ),
})
export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>

export const ANALYTICS_KEY = ['analytics', 'summary'] as const

/** Серверная сводка доступна только в режиме реального API. */
export function useAnalyticsSummary() {
  return useQuery({
    queryKey: ANALYTICS_KEY,
    queryFn: () => request('/analytics/summary', analyticsSummarySchema),
    enabled: !IS_MOCK,
  })
}
