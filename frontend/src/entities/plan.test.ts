import {
  addTasks,
  countDone,
  postponeToday,
  isStuck,
  pickNextStep,
  planApi,
  setTaskStatus,
  type Plan,
  type Task,
} from './plan'

function task(patch: Partial<Task>): Task {
  return {
    id: 'x',
    title: 'Задача',
    stage: 1,
    status: 'todo',
    due: null,
    note: '',
    owner: 'intern',
    source: 'checklist',
    updatedAt: '2026-11-09',
    ...patch,
  }
}

describe('plan', () => {
  test('seed matches the demo: week 2, 6 of 14 done', () => {
    const plan = planApi.peek()
    expect(plan.week).toBe(2)
    expect(plan.tasks).toHaveLength(14)
    expect(countDone(plan.tasks)).toBe(6)
  })

  test('next step is the open task with the nearest due date', () => {
    const next = pickNextStep(planApi.peek().tasks)
    expect(next?.title).toBe('Настроить локальное окружение')
  })

  test('next step skips blocked, done and mentor tasks', () => {
    const tasks = [
      task({ id: 'a', status: 'blocked', due: '2026-11-10' }),
      task({ id: 'b', status: 'done', due: '2026-11-10' }),
      task({ id: 'c', owner: 'mentor', due: '2026-11-10' }),
      task({ id: 'd', due: '2026-11-20' }),
    ]
    expect(pickNextStep(tasks)?.id).toBe('d')
  })

  test('returns null when everything is closed', () => {
    expect(pickNextStep([task({ status: 'done' })])).toBeNull()
  })

  test('setTaskStatus returns a new plan and does not mutate the old one', () => {
    const plan: Plan = { internId: 'anya', week: 2, tasks: [task({ id: 'a' })] }
    const next = setTaskStatus(plan, 'a', 'done', '2026-11-12')
    expect(next.tasks[0].status).toBe('done')
    expect(next.tasks[0].updatedAt).toBe('2026-11-12')
    expect(plan.tasks[0].status).toBe('todo')
  })

  test('status survives a reload (persisted in storage)', async () => {
    await planApi.setStatus('t7', 'done')
    expect(planApi.peek().tasks.find((t) => t.id === 't7')?.status).toBe('done')
  })

  test('task in progress for 3+ days is stuck', () => {
    expect(isStuck(task({ status: 'in_progress', updatedAt: '2026-11-09' }), '2026-11-12')).toBe(
      true,
    )
    expect(isStuck(task({ status: 'in_progress', updatedAt: '2026-11-11' }), '2026-11-12')).toBe(
      false,
    )
    expect(isStuck(task({ status: 'todo', updatedAt: '2026-11-01' }), '2026-11-12')).toBe(false)
  })

  test('addTasks appends meeting agreements with source and owner', () => {
    const plan: Plan = { internId: 'anya', week: 2, tasks: [] }
    const next = addTasks(plan, [
      { title: 'Выдать доступ к k8s', due: null, owner: 'mentor', source: 'meeting:1' },
    ])
    expect(next.tasks).toHaveLength(1)
    expect(next.tasks[0]).toMatchObject({
      owner: 'mentor',
      source: 'meeting:1',
      status: 'todo',
      stage: 1,
    })
  })

  test('not-my-day moves personal steps due today to the next workday, keeps required ones', () => {
    const plan: Plan = {
      internId: 'anya',
      week: 2,
      tasks: [
        task({ id: 'a', due: '2026-11-13' }),
        task({ id: 'b', due: '2026-11-13', source: 'required' }),
        task({ id: 'c', due: '2026-11-13', status: 'done' }),
      ],
    }
    const next = postponeToday(plan, '2026-11-13')
    expect(next.tasks.map((t) => t.due)).toEqual(['2026-11-16', '2026-11-13', '2026-11-13'])
  })
})
