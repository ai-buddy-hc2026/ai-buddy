import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { IS_MOCK, request } from '@/shared/api/http'
import { DEMO_TODAY, daysUntil, nextWorkday } from '@/shared/lib/date'
import { createCollection, mockDelay, newId } from '@/shared/lib/storage'

/** План онбординга (S-1): этапы, задачи, статусы, следующий шаг. */
export const taskStatusSchema = z.enum(['todo', 'in_progress', 'blocked', 'done'])
export type TaskStatus = z.infer<typeof taskStatusSchema>

export const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Этап: 0 - неделя 1, 1 - неделя 2, 2 - недели 3-4 */
  stage: z.number().int().min(0).max(2),
  status: taskStatusSchema,
  /** Срок ISO YYYY-MM-DD или null */
  due: z.string().nullable(),
  note: z.string(),
  /** Чья задача: стажёра или обязательство наставника (идея 8) */
  owner: z.enum(['intern', 'mentor']),
  /** Откуда задача: базовый чек-лист, встреча, трек */
  source: z.string(),
  /** Когда статус менялся в последний раз (для «мягкого вопроса при застревании», идея 25) */
  updatedAt: z.string(),
})
export type Task = z.infer<typeof taskSchema>

export const planSchema = z.object({
  internId: z.string(),
  week: z.number().int(),
  tasks: z.array(taskSchema),
})
export type Plan = z.infer<typeof planSchema>

export const STAGES = [
  { index: 0, color: 'green', title: { ru: 'Неделя 1: старт', en: 'Week 1: start' } },
  { index: 1, color: 'blue', title: { ru: 'Неделя 2: погружение', en: 'Week 2: deep dive' } },
  {
    index: 2,
    color: 'violet',
    title: { ru: 'Недели 3-4: первая задача', en: 'Weeks 3-4: first task' },
  },
] as const

type Seed = [
  title: string,
  stage: number,
  status: TaskStatus,
  due: string | null,
  note: string,
  updated: string,
]

const SEED: Seed[] = [
  ['Получить пропуск и ноутбук', 0, 'done', '2026-11-02', '', '2026-11-02'],
  ['Познакомиться с наставником', 0, 'done', '2026-11-02', '', '2026-11-02'],
  ['Пройти вводный курс', 0, 'done', '2026-11-04', '', '2026-11-04'],
  ['Получить доступ к GitLab', 0, 'done', '2026-11-05', '', '2026-11-05'],
  ['Встреча 1:1 с наставником', 0, 'done', '2026-11-06', '', '2026-11-06'],
  ['Прочитать гайд по code review', 1, 'done', '2026-11-10', '5 минут', '2026-11-10'],
  [
    'Настроить локальное окружение',
    1,
    'in_progress',
    '2026-11-12',
    'Гайд на 20 минут',
    '2026-11-09',
  ],
  ['Курс по ИБ', 1, 'in_progress', '2026-11-13', '3 из 5 модулей', '2026-11-11'],
  [
    'Получить доступ к k8s-dev',
    1,
    'blocked',
    '2026-11-13',
    'Заявка на согласовании 2 дня',
    '2026-11-10',
  ],
  ['Взять первую задачу', 1, 'todo', '2026-11-16', '', '2026-11-09'],
  ['Первый PR', 2, 'todo', '2026-11-20', '', '2026-11-09'],
  ['Пройти первое ревью', 2, 'todo', '2026-11-23', '', '2026-11-09'],
  ['Демо для команды', 2, 'todo', '2026-11-27', '', '2026-11-09'],
  ['Ретро с наставником', 2, 'todo', '2026-11-30', '', '2026-11-09'],
]

function seedPlan(): Plan {
  return {
    internId: 'anya',
    week: 2,
    tasks: SEED.map(([title, stage, status, due, note, updatedAt], i) => ({
      id: `t${i + 1}`,
      title,
      stage,
      status,
      due,
      note,
      owner: 'intern',
      source: 'checklist',
      updatedAt,
    })),
  }
}

const planDb = createCollection<Plan>('plan', seedPlan)

/* Чистые функции - покрыты тестами в plan.test.ts */

export function countDone(tasks: readonly Task[]): number {
  return tasks.filter((t) => t.status === 'done').length
}

/**
 * Следующий шаг выбирается правилом, без LLM (идея 23):
 * первая незакрытая и незаблокированная задача стажёра с ближайшим сроком.
 */
export function pickNextStep(tasks: readonly Task[]): Task | null {
  const open = tasks.filter(
    (t) => t.owner === 'intern' && (t.status === 'todo' || t.status === 'in_progress'),
  )
  if (open.length === 0) return null
  const far = '9999-12-31'
  return [...open].sort(
    (a, b) => (a.due ?? far).localeCompare(b.due ?? far) || a.stage - b.stage,
  )[0]
}

export function setTaskStatus(
  plan: Plan,
  taskId: string,
  status: TaskStatus,
  today = DEMO_TODAY,
): Plan {
  return {
    ...plan,
    tasks: plan.tasks.map((t) => (t.id === taskId ? { ...t, status, updatedAt: today } : t)),
  }
}

/** Задача «зависла»: в работе и не двигалась 3 дня и больше (идея 25). */
export function isStuck(task: Task, today = DEMO_TODAY): boolean {
  return task.status === 'in_progress' && daysUntil(task.updatedAt, today) <= -3
}

export interface NewTask {
  title: string
  due: string | null
  owner: Task['owner']
  source: string
  stage?: number
  note?: string
}

export function addTasks(plan: Plan, items: readonly NewTask[], today = DEMO_TODAY): Plan {
  const created: Task[] = items.map((item) => ({
    id: newId('t'),
    title: item.title,
    stage: item.stage ?? Math.min(plan.week - 1, 2),
    status: 'todo',
    due: item.due,
    note: item.note ?? '',
    owner: item.owner,
    source: item.source,
    updatedAt: today,
  }))
  return { ...plan, tasks: [...plan.tasks, ...created] }
}

/**
 * «Не мой день» (идея 44): личные шаги со сроком «сегодня» переносятся на следующий рабочий день.
 * Жёсткие дедлайны (обязательные курсы, source = required) не двигаем.
 */
export function postponeToday(plan: Plan, today = DEMO_TODAY): Plan {
  const next = nextWorkday(today)
  return {
    ...plan,
    tasks: plan.tasks.map((t) =>
      t.due === today && t.status !== 'done' && t.owner === 'intern' && t.source !== 'required'
        ? { ...t, due: next }
        : t,
    ),
  }
}

/* API: мок или Go (`GET /onboarding/plan`, `PATCH /tasks/{id}`) */

export const planApi = {
  async get(): Promise<Plan> {
    if (!IS_MOCK) return request('/onboarding/plan', planSchema)
    await mockDelay(200)
    return planSchema.parse(planDb.read())
  },
  async setStatus(taskId: string, status: TaskStatus): Promise<Plan> {
    if (!IS_MOCK) {
      await request(`/tasks/${taskId}`, taskSchema, { method: 'PATCH', body: { status } })
      return request('/onboarding/plan', planSchema)
    }
    await mockDelay(150)
    return planDb.update((plan) => setTaskStatus(plan, taskId, status))
  },
  async add(items: readonly NewTask[]): Promise<Plan> {
    await mockDelay(150)
    return planDb.update((plan) => addTasks(plan, items))
  },
  async postponeToday(): Promise<Plan> {
    await mockDelay(150)
    return planDb.update((plan) => postponeToday(plan))
  },
  /** Синхронное чтение для мок-движка чата (ответ «что дальше?» строится по данным, а не выдумывается). */
  peek: (): Plan => planDb.read(),
}

export const PLAN_KEY = ['plan'] as const

export function usePlan() {
  return useQuery({ queryKey: PLAN_KEY, queryFn: planApi.get })
}

/** Оптимистичная смена статуса (K-8): UI меняется сразу, при ошибке откат. */
export function useSetTaskStatus() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) =>
      planApi.setStatus(taskId, status),
    onMutate: async ({ taskId, status }) => {
      await client.cancelQueries({ queryKey: PLAN_KEY })
      const previous = client.getQueryData<Plan>(PLAN_KEY)
      if (previous) client.setQueryData(PLAN_KEY, setTaskStatus(previous, taskId, status))
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) client.setQueryData(PLAN_KEY, context.previous)
    },
    onSettled: () => client.invalidateQueries({ queryKey: PLAN_KEY }),
  })
}

export function useAddTasks() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (items: readonly NewTask[]) => planApi.add(items),
    onSuccess: (plan) => client.setQueryData(PLAN_KEY, plan),
  })
}

export function usePostponeToday() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => planApi.postponeToday(),
    onSuccess: (plan) => client.setQueryData(PLAN_KEY, plan),
  })
}
