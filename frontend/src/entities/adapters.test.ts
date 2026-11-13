import { apiActionSchema, apiEscalationSchema, apiPlanSchema, streamEventSchema } from './contract'
import { toAction, toActionStatus, toEscalation, toPlan, withApiTask } from './adapters'
import { employeeIdForUser } from './directory'
import {
  ACTION_ID,
  ANYA_ID,
  ILYA_ID,
  REQUEST_ID,
  TASK_ID,
  apiAction,
  apiPlan,
  apiTask,
} from './fixtures.test-data'

describe('plan adapter', () => {
  test('переводит план Go в модель фронта: этап, срок, владелец, null вместо []', () => {
    const raw = apiPlanSchema.parse(
      apiPlan([apiTask(), apiTask({ id: 'mentor-task', assignee_id: ILYA_ID, status: 'done' })]),
    )
    const plan = toPlan(raw)

    expect(plan.internId).toBe('anya')
    expect(plan.week).toBe(2)
    expect(plan.tasks).toHaveLength(2)
    expect(plan.tasks[0]).toEqual({
      id: TASK_ID,
      title: 'Изучить порядок оформления отгула',
      stage: 1,
      status: 'todo',
      due: '2026-11-13',
      note: 'Виды отсутствия и порядок подачи заявки',
      owner: 'intern',
      source: 'checklist',
      updatedAt: '2026-11-10',
    })
    expect(plan.tasks[1].owner).toBe('mentor')
  })

  test('ответ PATCH заменяет задачу без мутации исходного плана', () => {
    const raw = apiPlanSchema.parse(apiPlan())
    const patched = withApiTask(raw, { ...raw.stages[1].tasks[0], status: 'done', version: 2 })
    expect(patched.stages[1].tasks[0].version).toBe(2)
    expect(raw.stages[1].tasks[0].version).toBe(1)
  })

  test('отклоняет план с неизвестным этапом', () => {
    expect(apiPlanSchema.safeParse({ ...apiPlan(), current_stage: 'week_9' }).success).toBe(false)
  })
})

describe('action adapter', () => {
  test('предложение отгула: черновик с понятными полями карточки', () => {
    const action = toAction(apiActionSchema.parse(apiAction()))
    expect(action).toMatchObject({
      id: ACTION_ID,
      kind: 'absence',
      title: 'Отгул',
      status: 'draft',
      externalId: null,
      serverId: ACTION_ID,
    })
    expect(action.details).toEqual([
      { label: 'Дата', value: 'пт, 20.11' },
      { label: 'Тип', value: 'Отгул' },
      { label: 'Согласует', value: 'Мария Руководова' },
    ])
  })

  test('succeeded с корпоративным статусом pending_approval и external_id', () => {
    const action = toAction(
      apiActionSchema.parse(
        apiAction({
          status: 'succeeded',
          result: { external_id: 'ABS-1042', status: 'pending_approval' },
        }),
      ),
    )
    expect(action.status).toBe('pending_approval')
    expect(action.externalId).toBe('ABS-1042')
  })

  test.each([
    ['confirmed', 'scheduled'],
    ['executing', 'scheduled'],
    ['failed', 'failed'],
    ['cancelled', 'cancelled'],
  ] as const)('статус %s -> %s', (status, expected) => {
    expect(toActionStatus({ status, result: {} })).toBe(expected)
  })

  test('неизвестный action_type не проходит валидацию', () => {
    expect(apiActionSchema.safeParse(apiAction({ action_type: 'salary.read' })).success).toBe(false)
  })
})

describe('escalation adapter', () => {
  test('контекст, ответ и публикация в KB', () => {
    const raw = apiEscalationSchema.parse({
      id: 'e1',
      action_id: ACTION_ID,
      intern_id: ANYA_ID,
      buddy_id: ILYA_ID,
      question: 'Где взять тестовые данные?',
      context_snapshot: [
        { message_id: 'm1', role: 'user', content: 'где данные?', sources: null },
        { message_id: 'm2', role: 'assistant', content: 'Не нашёл', sources: [] },
      ],
      status: 'answered',
      answer_text: 'В песочнице',
      answered_by: ILYA_ID,
      answered_at: '2026-11-12T12:00:00Z',
      publication: {
        document_id: 'd1',
        revision: 1,
        status: 'published',
        index_status: 'ready',
        indexed_revision: 1,
        index_error: null,
      },
      version: 'v1',
      created_at: '2026-11-12T10:00:00Z',
      updated_at: '2026-11-12T12:00:00Z',
    })
    const item = toEscalation(raw)
    expect(item).toMatchObject({
      internId: 'anya',
      mentorId: 'ilya',
      status: 'answered',
      answer: 'В песочнице',
      addedToKb: true,
    })
    expect(item.context).toEqual([
      { from: 'intern', text: 'где данные?' },
      { from: 'bot', text: 'Не нашёл' },
    ])
  })

  test('незнакомый пользователь остаётся со своим UUID, известный по списку стажёров маппится', () => {
    expect(employeeIdForUser('unknown-uuid')).toBe('unknown-uuid')
    expect(employeeIdForUser('x', { x: 'intern_anya' })).toBe('anya')
  })
})

describe('stream event schema', () => {
  test('принимает конверт done и отклоняет неизвестное событие', () => {
    const done = streamEventSchema.parse({
      event: 'done',
      request_id: REQUEST_ID,
      seq: 2,
      data: { full_text: 'Привет!', sources: [] },
    })
    expect(done.event).toBe('done')
    expect(
      streamEventSchema.safeParse({ event: 'weird', request_id: REQUEST_ID, seq: 1, data: {} })
        .success,
    ).toBe(false)
  })
})
