import { formatShort } from '@/shared/lib/date'
import type {
  ActionType,
  ApiAction,
  ApiEscalation,
  ApiPlan,
  ApiSource,
  ApiTask,
  ApiUser,
  StageCode,
} from './contract'
import { displayNameForUser, employeeIdForUser } from './directory'
import type { Action, ActionKind } from './actions'
import type { Escalation } from './escalations'
import type { KnowledgeSource } from './knowledge'
import type { Plan, Task } from './plan'

/**
 * Адаптеры snake_case -> модели фронта. Чистые функции без запросов, покрыты adapters.test.ts.
 * Компоненты работают только с моделями фронта и не знают формат Go API.
 */

/* ---------- Пользователь ---------- */

export interface RemoteUser {
  id: string
  login: string
  name: string
  role: ApiUser['role']
  teamName: string
}

export function toRemoteUser(user: ApiUser): RemoteUser {
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    role: user.role,
    teamName: user.team.name,
  }
}

/* ---------- План ---------- */

const STAGE_INDEX: Record<StageCode, number> = { week_1: 0, week_2: 1, weeks_3_4: 2 }
const STAGE_WEEK: Record<StageCode, number> = { week_1: 1, week_2: 2, weeks_3_4: 3 }
const ISO_DATE_LENGTH = 10

export function toTask(task: ApiTask, internUserId: string): Task {
  return {
    id: task.id,
    title: task.title,
    stage: STAGE_INDEX[task.stage],
    status: task.status,
    due: task.due_date,
    note: task.description,
    // Задачи наставника в том же плане - его обязательства перед стажёром
    owner: task.assignee_id === internUserId ? 'intern' : 'mentor',
    source: 'checklist',
    updatedAt: task.updated_at.slice(0, ISO_DATE_LENGTH),
  }
}

export function toPlan(plan: ApiPlan): Plan {
  return {
    internId: employeeIdForUser(plan.intern_id),
    week: STAGE_WEEK[plan.current_stage],
    tasks: plan.stages.flatMap((stage) => stage.tasks.map((t) => toTask(t, plan.intern_id))),
  }
}

/** Задача с актуальной version из ответа PATCH, без мутации исходного плана. */
export function withApiTask(plan: ApiPlan, task: ApiTask): ApiPlan {
  return {
    ...plan,
    stages: plan.stages.map((stage) => ({
      ...stage,
      tasks: stage.tasks.map((t) => (t.id === task.id ? task : t)),
    })),
  }
}

export function findApiTask(plan: ApiPlan, taskId: string): ApiTask | undefined {
  return plan.stages.flatMap((stage) => stage.tasks).find((t) => t.id === taskId)
}

/* ---------- Действия ---------- */

export const ACTION_KIND: Record<ActionType, ActionKind> = {
  'absences.create_request': 'absence',
  'escalation.create': 'escalation',
  'checklist.update_status': 'task',
}

const ACTION_TITLE: Record<ActionType, string> = {
  'absences.create_request': 'Отгул',
  'escalation.create': 'Вопрос наставнику',
  'checklist.update_status': 'Статус задачи',
}

const ABSENCE_TYPE_LABEL: Readonly<Record<string, string>> = { day_off: 'Отгул' }
const TASK_STATUS_LABEL: Readonly<Record<string, string>> = {
  todo: 'Не начата',
  in_progress: 'В работе',
  blocked: 'Заблокирована',
  done: 'Готово',
}

type DetailField = { label: string; format: (value: string) => string }

/** Поля карточки по ключам details из Go; служебные (version, context_snapshot) не показываем. */
const DETAIL_FIELDS: Readonly<Record<string, DetailField>> = {
  date: { label: 'Дата', format: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? formatShort(v) : v) },
  type: { label: 'Тип', format: (v) => ABSENCE_TYPE_LABEL[v] ?? v },
  approver: { label: 'Согласует', format: displayNameForUser },
  status: { label: 'Статус', format: (v) => TASK_STATUS_LABEL[v] ?? v },
  question: { label: 'Вопрос', format: (v) => v },
  buddy_id: { label: 'Кому', format: displayNameForUser },
}

export function toActionDetails(details: Readonly<Record<string, unknown>>): Action['details'] {
  return Object.entries(DETAIL_FIELDS).flatMap(([key, field]) => {
    const value = details[key]
    if (typeof value !== 'string' && typeof value !== 'number') return []
    return [{ label: field.label, value: field.format(String(value)) }]
  })
}

export function toActionStatus(action: Pick<ApiAction, 'status' | 'result'>): Action['status'] {
  switch (action.status) {
    case 'proposed':
      return 'draft'
    case 'confirmed':
    case 'executing':
      return 'scheduled'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    case 'succeeded': {
      // succeeded - инструмент выполнен; корпоративный статус заявки лежит в result.status
      const corporate = action.result.status
      if (corporate === 'pending_approval') return 'pending_approval'
      if (corporate === 'approved') return 'approved'
      return 'sent'
    }
  }
}

function readString(record: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function toAction(action: ApiAction): Action {
  return {
    id: action.id,
    kind: ACTION_KIND[action.action_type],
    title: ACTION_TITLE[action.action_type],
    details: toActionDetails(action.details),
    status: toActionStatus(action),
    externalId: readString(action.result, 'external_id') ?? readString(action.result, 'id'),
    idempotencyKey: action.id,
    createdAt: action.created_at,
    serverId: action.id,
  }
}

/** Карточка предложения из SSE action_proposal: ещё не подтверждена. */
export function toProposedAction(
  actionId: string,
  actionType: ActionType,
  details: Readonly<Record<string, unknown>>,
  createdAt: string,
): Action {
  return toAction({
    id: actionId,
    request_id: actionId,
    proposal_seq: 1,
    action_type: actionType,
    details,
    status: 'proposed',
    result: {},
    last_error: null,
    attempt_count: 0,
    created_at: createdAt,
    updated_at: createdAt,
  })
}

/* ---------- Эскалации ---------- */

export function toEscalation(
  item: ApiEscalation,
  known: Readonly<Record<string, string>> = {},
): Escalation {
  return {
    id: item.id,
    internId: employeeIdForUser(item.intern_id, known),
    mentorId: employeeIdForUser(item.buddy_id, known),
    question: item.question,
    context: item.context_snapshot.map((m) => ({
      from: m.role === 'user' ? 'intern' : 'bot',
      text: m.content,
    })),
    tried: '',
    status: item.status === 'open' ? 'open' : 'answered',
    deliverAt: null,
    answer: item.answer_text,
    addedToKb: item.publication?.status === 'published',
    createdAt: item.created_at,
    answeredAt: item.answered_at,
  }
}

/* ---------- Источники ---------- */

export function toKnowledgeSource(source: ApiSource): KnowledgeSource {
  return {
    docId: source.document_id,
    revision: source.revision,
    title: source.title,
    section: source.section,
    url: source.url,
  }
}
