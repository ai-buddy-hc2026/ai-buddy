import { z } from 'zod'
import type { Escalation } from '@/entities/escalations'
import type { Task } from '@/entities/plan'
import { addDays, DEMO_TODAY, parseIso } from '@/shared/lib/date'
import { createCollection } from '@/shared/lib/storage'

/**
 * «Мягкий вопрос при застревании» (идея 25). Чистая логика + хранилище «Всё ок, просто долго».
 * Покрыто тестами в snooze.test.ts.
 */
export const STUCK_WORKDAYS = 3
export const SNOOZE_DAYS = 3
export const TRIED_MAX = 1000

/** taskId -> до какой даты (ISO) не спрашивать */
export const snoozesSchema = z.record(z.string(), z.string())
export type Snoozes = z.infer<typeof snoozesSchema>

const snoozeDb = createCollection<Snoozes>('plan.stuckSnooze', () => ({}))

export function readSnoozes(): Snoozes {
  const parsed = snoozesSchema.safeParse(snoozeDb.read())
  return parsed.success ? parsed.data : {}
}

export function writeSnoozes(next: Snoozes): Snoozes {
  return snoozeDb.write(next)
}

function isWorkday(iso: string): boolean {
  const day = parseIso(iso).getDay()
  return day !== 0 && day !== 6
}

/** Сколько рабочих дней прошло после `from` до `to` включительно. */
export function workdaysSince(from: string, to: string = DEMO_TODAY): number {
  let count = 0
  for (let day = addDays(from, 1); day <= to; day = addDays(day, 1)) {
    if (isWorkday(day)) count += 1
  }
  return count
}

/** Задача в работе и не менялась 3 рабочих дня и больше. */
export function isStuckWorkdays(task: Task, today: string = DEMO_TODAY): boolean {
  return task.status === 'in_progress' && workdaysSince(task.updatedAt, today) >= STUCK_WORKDAYS
}

export function isSnoozed(snoozes: Snoozes, taskId: string, today: string = DEMO_TODAY): boolean {
  const until = snoozes[taskId]
  return until !== undefined && until > today
}

/** «Всё ок, просто долго»: не спрашивать про задачу 3 дня. */
export function snoozeTask(snoozes: Snoozes, taskId: string, today: string = DEMO_TODAY): Snoozes {
  return { ...snoozes, [taskId]: addDays(today, SNOOZE_DAYS) }
}

export interface StuckPrompt {
  task: Task
  days: number
}

/** Про какие задачи мягко спросить: свои, зависшие, не отложенные. Самые старые первыми. */
export function stuckPrompts(
  tasks: readonly Task[],
  snoozes: Snoozes,
  today: string = DEMO_TODAY,
): StuckPrompt[] {
  return tasks
    .filter((task) => task.owner === 'intern' && isStuckWorkdays(task, today))
    .filter((task) => !isSnoozed(snoozes, task.id, today))
    .map((task) => ({ task, days: workdaysSince(task.updatedAt, today) }))
    .sort((a, b) => b.days - a.days)
}

/** Запрос боту: RAG-поиск по названию задачи. */
export function guideQuestion(task: Task): string {
  return `Подскажи по гайду: ${task.title}`
}

function escalationPrefix(task: Task): string {
  return `Застряла на задаче «${task.title}»`
}

/** Текст вопроса наставнику: задача и сколько висит. */
export function escalationQuestion(task: Task, days: number): string {
  return `${escalationPrefix(task)}. В работе без движения ${days} раб. дн. Нужна подсказка`
}

/** Вопрос по этой задаче уже передан наставнику и ещё без ответа. */
export function hasOpenEscalation(list: readonly Escalation[], task: Task): boolean {
  const prefix = escalationPrefix(task)
  return list.some((item) => item.status !== 'answered' && item.question.startsWith(prefix))
}

/** Идемпотентный ключ: одна эскалация на задачу и её текущее состояние. */
export function escalationKey(task: Task): string {
  return `stuck-${task.id}-${task.updatedAt}`
}
