/** Ответы Go API по docs/openapi.yaml для тестов адаптеров. UUID из seed docs/users.md. */
export const ANYA_ID = 'a24a3478-cf42-51b1-b05b-9833260247a5'
export const ILYA_ID = '4a59a828-3b1a-55e4-bf9b-81db5ad6183a'
export const MARIA_ID = '10000000-0000-0000-0000-000000000003'
export const PLAN_ID = '30000000-0000-0000-0000-000000000001'
export const TASK_ID = '40000000-0000-0000-0000-000000000001'
export const ACTION_ID = '50000000-0000-0000-0000-000000000001'
export const REQUEST_ID = '20000000-0000-0000-0000-000000000001'

export function apiTask(patch: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    plan_id: PLAN_ID,
    assignee_id: ANYA_ID,
    stage: 'week_2',
    title: 'Изучить порядок оформления отгула',
    description: 'Виды отсутствия и порядок подачи заявки',
    position: 0,
    due_date: '2026-11-13',
    status: 'todo',
    version: 1,
    updated_at: '2026-11-10T09:00:00Z',
    materials: null,
    ...patch,
  }
}

export function apiPlan(tasks: unknown[] = [apiTask()]) {
  return {
    id: PLAN_ID,
    intern_id: ANYA_ID,
    title: 'План адаптации',
    start_date: '2026-11-02',
    current_stage: 'week_2',
    status: 'active',
    stages: [
      { code: 'week_1', title: 'Неделя 1', tasks: null },
      { code: 'week_2', title: 'Неделя 2', tasks },
    ],
    progress: { done: 0, total: tasks.length, percent: 0 },
    next_task_id: TASK_ID,
  }
}

export function apiAction(patch: Record<string, unknown> = {}) {
  return {
    id: ACTION_ID,
    request_id: REQUEST_ID,
    proposal_seq: 2,
    action_type: 'absences.create_request',
    details: { date: '2026-11-20', type: 'day_off', approver: MARIA_ID },
    status: 'proposed',
    result: {},
    last_error: null,
    attempt_count: 0,
    created_at: '2026-11-12T10:00:00Z',
    updated_at: '2026-11-12T10:00:00Z',
    ...patch,
  }
}

export function apiUser(patch: Record<string, unknown> = {}) {
  return {
    id: ANYA_ID,
    login: 'intern_anya',
    name: 'Anya',
    role: 'intern',
    team: { id: 't1', code: 'team_avito_ai', name: 'Team 1', timezone: 'Europe/Moscow' },
    timezone: 'Europe/Moscow',
    buddy_id: ILYA_ID,
    manager_id: MARIA_ID,
    ...patch,
  }
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
