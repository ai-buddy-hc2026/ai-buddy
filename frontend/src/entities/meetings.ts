import { useMutation, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { IS_MOCK, request } from '@/shared/api/http'
import { mockDelay } from '@/shared/lib/storage'

/**
 * AI-разбор через Go (backend/internal/httpapi/ai_proxy.go):
 *   POST /meetings/summary - итоги встречи из текста (идея 8);
 *   POST /questions/clusters - группы вопросов без ответа своей команды, только buddy и lead.
 * Go ходит в ai-service сервисным токеном, фронт видит только Go.
 */
export const MEETING_TEXT_MAX = 20_000
/** Разбор LLM дольше обычного запроса, Go ждёт ai-service до 30 секунд. */
const SUMMARY_TIMEOUT_MS = 40_000

export const actionItemSchema = z.object({
  title: z.string(),
  owner: z.string().nullable().optional(),
  due: z.string().nullable().optional(),
})
export type ActionItem = z.infer<typeof actionItemSchema>

export const meetingSummarySchema = z.object({
  agreements: z.array(z.string()),
  action_items: z.array(actionItemSchema),
})
export type MeetingSummary = z.infer<typeof meetingSummarySchema>

export const questionClusterSchema = z.object({
  label: z.string(),
  size: z.number().int().min(0),
  questions: z.array(z.object({ id: z.string().nullable().optional(), text: z.string() })),
})
export type QuestionCluster = z.infer<typeof questionClusterSchema>

export const clusterResponseSchema = z.object({ clusters: z.array(questionClusterSchema) })

const ACTION_RE =
  /(сдела|подготов|прочит|настро|напиш|добав|разбер|выда|пришл|отправ|провер|до\s)/iu

/** Мок без LLM: строки с глаголом действия - задачи, остальные - договорённости. */
export function mockSummarize(text: string): MeetingSummary {
  const lines = text
    .split(/[\n.;]+/u)
    .map((line) => line.replace(/^[\s\-*•\d.)]+/u, '').trim())
    .filter((line) => line.length >= 3)
    .map((line) => line.slice(0, 300))
  return {
    agreements: lines.filter((line) => !ACTION_RE.test(line)).slice(0, 20),
    action_items: lines
      .filter((line) => ACTION_RE.test(line))
      .slice(0, 20)
      .map((title) => ({ title, owner: null, due: null })),
  }
}

const MOCK_CLUSTERS: QuestionCluster[] = [
  {
    label: 'доступ к VPN и стендам',
    size: 3,
    questions: [
      { id: 'mq-1', text: 'Как получить доступ к VPN?' },
      { id: 'mq-2', text: 'Где взять доступ к тестовому стенду?' },
      { id: 'mq-3', text: 'VPN не пускает, к кому идти?' },
    ],
  },
  {
    label: 'тестовые данные',
    size: 2,
    questions: [
      { id: 'mq-4', text: 'Где взять тестовые данные для локального запуска?' },
      { id: 'mq-5', text: 'Есть ли дамп базы для разработки?' },
    ],
  },
]

export const meetingsApi = {
  async summarize(text: string): Promise<MeetingSummary> {
    if (!IS_MOCK) {
      return request('/meetings/summary', meetingSummarySchema, {
        method: 'POST',
        body: { text },
        isLongLived: true,
        signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
      })
    }
    await mockDelay(300)
    return mockSummarize(text)
  },
  async clusters(days = 30): Promise<QuestionCluster[]> {
    if (!IS_MOCK) {
      const result = await request('/questions/clusters', clusterResponseSchema, {
        method: 'POST',
        body: { days },
      })
      return result.clusters
    }
    await mockDelay(200)
    return MOCK_CLUSTERS
  },
}

export const CLUSTERS_KEY = ['questions', 'clusters'] as const

export function useSummarizeMeeting() {
  return useMutation({ mutationFn: (text: string) => meetingsApi.summarize(text) })
}

export function useQuestionClusters(isEnabled: boolean) {
  return useQuery({
    queryKey: CLUSTERS_KEY,
    queryFn: () => meetingsApi.clusters(),
    enabled: isEnabled,
  })
}
