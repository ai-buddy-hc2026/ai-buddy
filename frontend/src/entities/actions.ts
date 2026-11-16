import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { ApiError, IS_MOCK } from '@/shared/api/http'
import { createCollection, mockDelay, newId } from '@/shared/lib/storage'
import { remoteActions } from './remote'
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
  /** checklist.update_status из чата */
  'task',
])
export type ActionKind = z.infer<typeof actionKindSchema>

export const actionSchema = z.object({
  id: z.string(),
  kind: actionKindSchema,
  title: z.string(),
  /** Поля карточки: «Дата» -> «пт, 13.11» */
  details: z.array(z.object({ label: z.string(), value: z.string() })),
  /** draft и cancelled приходят только из Go API: предложение без подтверждения и отмена */
  status: z.enum([
    'pending_approval',
    'approved',
    'sent',
    'scheduled',
    'failed',
    'draft',
    'cancelled',
  ]),
  /** Номер во внешнем сервисе, например ABS-1042 */
  externalId: z.string().nullable(),
  idempotencyKey: z.string(),
  createdAt: z.string(),
  /** UUID действия в Go API. Есть - подтверждение идёт в POST /actions/{id}/confirm */
  serverId: z.string().optional(),
})
export type Action = z.infer<typeof actionSchema>

export type ActionDraft = Pick<Action, 'kind' | 'title' | 'details' | 'idempotencyKey'> & {
  status?: Action['status']
  serverId?: string
}

const EXTERNAL_PREFIX: Record<ActionKind, string> = {
  absence: 'ABS',
  escalation: 'ESC',
  booking: 'CAL',
  access: 'ACC',
  feedback: 'FB',
  message: 'MSG',
  task: 'TSK',
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

/** Свежие сверху: так история читается и в демо, и в реальном режиме. */
export function mergeActions(remote: readonly Action[], local: readonly Action[]): Action[] {
  return [...remote, ...local].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function readLocalActions(): Action[] {
  const parsed = z.array(actionSchema).safeParse(actionsDb.read())
  return parsed.success ? parsed.data : []
}

export const actionsApi = {
  /**
   * В реальном режиме история - GET /actions плюс локальные записи разделов без эндпоинтов
   * (бронирования, доступы, отзывы): они остаются на моках.
   */
  async list(): Promise<Action[]> {
    if (!IS_MOCK) return mergeActions(await remoteActions.list(), readLocalActions())
    await mockDelay(150)
    return z.array(actionSchema).parse(actionsDb.read())
  },
  /** Вызывается только по кнопке «Отправить». */
  async confirm(draft: ActionDraft): Promise<Action> {
    // Предложение из Go API: POST /actions/{id}/confirm, ключ идемпотентности хранит Go
    if (!IS_MOCK && draft.serverId) return remoteActions.confirm(draft.serverId)
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
