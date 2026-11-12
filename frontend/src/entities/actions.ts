import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { ApiError, IS_MOCK, request } from '@/shared/api/http'
import { createCollection, mockDelay, newId } from '@/shared/lib/storage'
import { useSettings } from './settings'

/**
 * История действий (K-11, таблица actions_log). Любое действие во внешнем сервисе:
 * черновик -> подтверждение стажёра -> результат сервиса -> запись здесь.
 */
export const actionKindSchema = z.enum([
  'absence',
  'escalation',
  'booking',
  'access',
  'feedback',
  'message',
])
export type ActionKind = z.infer<typeof actionKindSchema>

export const actionSchema = z.object({
  id: z.string(),
  kind: actionKindSchema,
  title: z.string(),
  /** Поля карточки: «Дата» -> «пт, 13.11» */
  details: z.array(z.object({ label: z.string(), value: z.string() })),
  status: z.enum(['pending_approval', 'approved', 'sent', 'scheduled', 'failed']),
  /** Номер во внешнем сервисе, например ABS-1042 */
  externalId: z.string().nullable(),
  idempotencyKey: z.string(),
  createdAt: z.string(),
})
export type Action = z.infer<typeof actionSchema>

export type ActionDraft = Pick<Action, 'kind' | 'title' | 'details' | 'idempotencyKey'> & {
  status?: Action['status']
}

const EXTERNAL_PREFIX: Record<ActionKind, string> = {
  absence: 'ABS',
  escalation: 'ESC',
  booking: 'CAL',
  access: 'ACC',
  feedback: 'FB',
  message: 'MSG',
}
const FIRST_EXTERNAL_NUMBER = 1042

const actionsDb = createCollection<Action[]>('actions', () => [])

/** Чистая логика подтверждения: повтор с тем же ключом не создаёт дубль (V-8). */
export function confirmAction(
  log: readonly Action[],
  draft: ActionDraft,
  now: string,
): { log: Action[]; action: Action } {
  const existing = log.find((a) => a.idempotencyKey === draft.idempotencyKey)
  if (existing) return { log: [...log], action: existing }

  const sameKind = log.filter((a) => a.kind === draft.kind).length
  const action: Action = {
    id: newId('act'),
    kind: draft.kind,
    title: draft.title,
    details: draft.details,
    status: draft.status ?? 'pending_approval',
    externalId: `${EXTERNAL_PREFIX[draft.kind]}-${FIRST_EXTERNAL_NUMBER + sameKind}`,
    idempotencyKey: draft.idempotencyKey,
    createdAt: now,
  }
  return { log: [action, ...log], action }
}

export const actionsApi = {
  async list(): Promise<Action[]> {
    if (!IS_MOCK) return request('/actions', z.array(actionSchema))
    await mockDelay(150)
    return z.array(actionSchema).parse(actionsDb.read())
  },
  /** POST /actions/{id}/confirm. Вызывается только по кнопке «Отправить». */
  async confirm(draft: ActionDraft): Promise<Action> {
    if (!IS_MOCK) {
      return request(`/actions/${draft.idempotencyKey}/confirm`, actionSchema, {
        method: 'POST',
        body: draft,
        idempotencyKey: draft.idempotencyKey,
      })
    }
    await mockDelay(700)
    if (useSettings.getState().simulateFailure) {
      // Сбой демонстрируется один раз: следующий «Повторить» проходит
      useSettings.getState().setSimulateFailure(false)
      throw new ApiError(
        504,
        'timeout',
        'Сервис не ответил вовремя. Заявка не отправлена, можно повторить',
      )
    }
    const result = confirmAction(actionsDb.read(), draft, new Date().toISOString())
    actionsDb.write(result.log)
    return result.action
  },
}

export const ACTIONS_KEY = ['actions'] as const

export function useActions() {
  return useQuery({ queryKey: ACTIONS_KEY, queryFn: actionsApi.list })
}

export function useConfirmAction() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (draft: ActionDraft) => actionsApi.confirm(draft),
    onSuccess: () => client.invalidateQueries({ queryKey: ACTIONS_KEY }),
  })
}
