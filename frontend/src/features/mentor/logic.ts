import { getEmployee } from '@/entities/employees'
import type { Escalation } from '@/entities/escalations'
import { isStuck, type Task } from '@/entities/plan'
import { DEMO } from '@/entities/session'
import { DEMO_TODAY } from '@/shared/lib/date'

/** Чистая логика экрана наставника (S-5, S-6). Покрыта тестами в logic.test.ts. */
export const MIN_ANSWER_LENGTH = 3

/** ?id= из URL: известный сотрудник или Аня по умолчанию. */
export function resolveInternId(id: string | undefined): string {
  return id && getEmployee(id) ? id : DEMO.internId
}

const byCreated = (a: Escalation, b: Escalation) => a.createdAt.localeCompare(b.createdAt)

/** Вопросы, которые ждут ответа наставника: старые сверху. */
export function openQuestions(list: readonly Escalation[], internId: string): Escalation[] {
  return list.filter((e) => e.internId === internId && e.status !== 'answered').sort(byCreated)
}

/** Отвеченные: свежие сверху. */
export function answeredQuestions(list: readonly Escalation[], internId: string): Escalation[] {
  return list
    .filter((e) => e.internId === internId && e.status === 'answered')
    .sort((a, b) => byCreated(b, a))
}

export function isAnswerValid(text: string): boolean {
  return text.trim().length >= MIN_ANSWER_LENGTH
}

/** Задачи стажёра, где наставник может помочь: заблокированные и зависшие. */
export function tasksNeedingHelp(tasks: readonly Task[], today = DEMO_TODAY): Task[] {
  return tasks.filter((t) => t.owner === 'intern' && (t.status === 'blocked' || isStuck(t, today)))
}
