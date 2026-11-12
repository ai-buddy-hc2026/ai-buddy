import { STAGES, countDone, isStuck, type Task, type TaskStatus } from '@/entities/plan'
import { DEMO_TODAY } from '@/shared/lib/date'
import type { Translate } from '@/shared/lib/i18n'
import type { BadgeTone } from '@/shared/ui'

/** Чистая логика вкладки «План» (S-1). Покрыта тестами в plan.test.ts. */
export const STATUS_ORDER: readonly TaskStatus[] = ['todo', 'in_progress', 'blocked', 'done']

export const STATUS_TONE: Record<TaskStatus, BadgeTone> = {
  todo: 'neutral',
  in_progress: 'accent',
  blocked: 'error',
  done: 'success',
}

export function statusLabel(status: TaskStatus, t: Translate): string {
  switch (status) {
    case 'todo':
      return t('Не начата', 'To do')
    case 'in_progress':
      return t('В работе', 'In progress')
    case 'blocked':
      return t('Заблокирована', 'Blocked')
    case 'done':
      return t('Готово', 'Done')
  }
}

export type StageColor = (typeof STAGES)[number]['color']

/** Цвет этапа: 1 зелёный, 2 синий, 3 фиолетовый. */
export function stageColorVar(color: StageColor): string {
  return `var(--brand-${color})`
}

export interface StageSummary {
  index: number
  color: StageColor
  done: number
  total: number
  tasks: Task[]
}

export function summarizeStages(tasks: readonly Task[]): StageSummary[] {
  return STAGES.map((stage) => {
    const own = tasks.filter((task) => task.stage === stage.index)
    return {
      index: stage.index,
      color: stage.color,
      done: countDone(own),
      total: own.length,
      tasks: own,
    }
  })
}

/** Текущий этап: первый, где есть незакрытые задачи. Всё закрыто - последний. */
export function currentStageIndex(stages: readonly StageSummary[]): number {
  const open = stages.find((stage) => stage.done < stage.total)
  return open?.index ?? stages[stages.length - 1]?.index ?? 0
}

/** Галочка: закрыть задачу или вернуть в «не начата». */
export function toggleDone(status: TaskStatus): TaskStatus {
  return status === 'done' ? 'todo' : 'done'
}

export type AttentionReason = 'stuck' | 'blocked'

export interface AttentionItem {
  task: Task
  reason: AttentionReason
}

/** Что требует внимания: заблокированные задачи и «зависшие» в работе 3+ дня (идея 25). */
export function attentionList(tasks: readonly Task[], today = DEMO_TODAY): AttentionItem[] {
  return tasks.flatMap((task): AttentionItem[] => {
    if (task.owner !== 'intern') return []
    if (task.status === 'blocked') return [{ task, reason: 'blocked' }]
    if (isStuck(task, today)) return [{ task, reason: 'stuck' }]
    return []
  })
}
