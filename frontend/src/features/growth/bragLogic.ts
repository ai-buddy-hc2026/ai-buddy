import type { BragItem } from '@/entities/brag'
import type { Task } from '@/entities/plan'
import type { MergeRequest } from './skillsLogic'

export type BragType = BragItem['type']
export type BragInput = Omit<BragItem, 'id'>

export const BRAG_TYPES: readonly BragType[] = ['task', 'pr', 'review', 'feedback', 'manual']
export const TITLE_MAX = 200

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const STEM_LENGTH = 5
const MIN_WORD = 4

export function sortBragItems(items: readonly BragItem[]): BragItem[] {
  return [...items].sort((a, b) => b.date.localeCompare(a.date))
}

export function countByType(items: readonly BragItem[]): Record<BragType, number> {
  const empty: Record<BragType, number> = { task: 0, pr: 0, review: 0, feedback: 0, manual: 0 }
  return items.reduce((acc, item) => ({ ...acc, [item.type]: acc[item.type] + 1 }), empty)
}

export function updateBragItem(
  list: readonly BragItem[],
  id: string,
  patch: BragInput,
): BragItem[] {
  return list.map((item) => (item.id === id ? { ...item, ...patch, id } : item))
}

export type BragErrors = Partial<
  Record<'title' | 'date' | 'link', 'required' | 'tooLong' | 'format'>
>

export function validateBragInput(input: BragInput): BragErrors {
  const errors: BragErrors = {}
  const title = input.title.trim()
  if (!title) errors.title = 'required'
  else if (title.length > TITLE_MAX) errors.title = 'tooLong'
  if (!ISO_DATE.test(input.date)) errors.date = 'format'
  if (input.link !== null && !isHttpUrl(input.link)) errors.link = 'format'
  return errors
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Нормализует ввод формы: пустая ссылка -> null, пробелы по краям убраны. */
export function normalizeBragInput(input: {
  type: BragType
  title: string
  date: string
  link: string
}): BragInput {
  const link = input.link.trim()
  return {
    type: input.type,
    title: input.title.trim(),
    date: input.date,
    link: link === '' ? null : link,
  }
}

function stems(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-zа-яё0-9]+/i)
      .filter((word) => word.length >= MIN_WORD)
      .map((word) => word.slice(0, STEM_LENGTH)),
  )
}

/** Задача уже есть в достижениях, если совпадают хотя бы 2 основы слов (или все, если слов меньше). */
export function isCovered(title: string, items: readonly BragItem[]): boolean {
  const target = stems(title)
  if (target.size === 0) return true
  const need = Math.min(2, target.size)
  return items.some((item) => {
    const other = stems(item.title)
    return [...target].filter((stem) => other.has(stem)).length >= need
  })
}

/** Закрытые задачи чек-листа, которых ещё нет в brag document. Достижения собираются сами. */
export function suggestFromPlan(tasks: readonly Task[], items: readonly BragItem[]): Task[] {
  return tasks.filter(
    (task) => task.status === 'done' && task.owner === 'intern' && !isCovered(task.title, items),
  )
}

export function taskToBrag(task: Task): BragInput {
  return { type: 'task', title: task.title, link: null, date: task.updatedAt }
}

/** MR из мока GitLab, которых ещё нет в достижениях (сверяем по ссылке). */
export function suggestFromMrs(
  mrs: readonly MergeRequest[],
  items: readonly BragItem[],
): MergeRequest[] {
  const links = new Set(items.map((item) => item.link).filter(Boolean))
  return mrs.filter((mr) => !links.has(mr.url))
}

export function mrToBrag(mr: MergeRequest): BragInput {
  return { type: 'pr', title: `MR !${mr.number}: ${mr.title}`, link: mr.url, date: mr.date }
}

export type BragSuggestion = {
  id: string
  title: string
  source: 'plan' | 'gitlab'
  item: BragInput
}

export function bragSuggestions(
  tasks: readonly Task[],
  mrs: readonly MergeRequest[],
  items: readonly BragItem[],
): BragSuggestion[] {
  const fromPlan = suggestFromPlan(tasks, items).map((task) => ({
    id: `plan:${task.id}`,
    title: task.title,
    source: 'plan' as const,
    item: taskToBrag(task),
  }))
  const fromMrs = suggestFromMrs(mrs, items).map((mr) => ({
    id: `mr:${mr.id}`,
    title: `MR !${mr.number}: ${mr.title}`,
    source: 'gitlab' as const,
    item: mrToBrag(mr),
  }))
  return [...fromMrs, ...fromPlan]
}
