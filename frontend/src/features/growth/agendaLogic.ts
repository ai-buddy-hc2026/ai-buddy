import { z } from 'zod'
import type { Slot } from '@/entities/calendar'
import { isStuck, type Task } from '@/entities/plan'
import { daysUntil, DEMO_TODAY } from '@/shared/lib/date'
import { effectiveStatus, type FeedbackRequest } from './feedbackLogic'

export const agendaPointSchema = z.object({
  id: z.string(),
  text: z.string(),
  source: z.enum(['blocked', 'stuck', 'due', 'feedback', 'manual']),
  isOn: z.boolean(),
})
export type AgendaPoint = z.infer<typeof agendaPointSchema>
export type AgendaSource = AgendaPoint['source']

/** Повестка по id слота */
export const agendasSchema = z.record(z.string(), z.array(agendaPointSchema))
export type Agendas = z.infer<typeof agendasSchema>

export const DUE_SOON_DAYS = 3
export const POINT_MAX = 200

export function upcomingMeetings(slots: readonly Slot[], today: string = DEMO_TODAY): Slot[] {
  return slots
    .filter((s) => s.start.slice(0, 10) >= today)
    .sort((a, b) => a.start.localeCompare(b.start))
}

export function pastMeetings(slots: readonly Slot[], today: string = DEMO_TODAY): Slot[] {
  return slots
    .filter((s) => s.start.slice(0, 10) < today)
    .sort((a, b) => b.start.localeCompare(a.start))
}

function taskPoint(task: Task, today: string): AgendaPoint | null {
  if (task.owner !== 'intern') return null
  if (task.status === 'blocked') {
    const note = task.note ? ` (${task.note})` : ''
    return {
      id: `blocked:${task.id}`,
      text: `Блокер: ${task.title}${note}`,
      source: 'blocked',
      isOn: true,
    }
  }
  if (isStuck(task, today)) {
    return { id: `stuck:${task.id}`, text: `Застряла: ${task.title}`, source: 'stuck', isOn: true }
  }
  if (task.status !== 'done' && task.due && daysUntil(task.due, today) <= DUE_SOON_DAYS) {
    return { id: `due:${task.id}`, text: `Скоро срок: ${task.title}`, source: 'due', isOn: false }
  }
  return null
}

/** Подсказки для повестки 1:1 из фактов: блокеры, зависшие задачи, близкие сроки, ответы на запросы отзыва. */
export function suggestAgenda(
  tasks: readonly Task[],
  requests: readonly FeedbackRequest[],
  today: string = DEMO_TODAY,
): AgendaPoint[] {
  const fromTasks = tasks
    .map((task) => taskPoint(task, today))
    .filter((p): p is AgendaPoint => p !== null)
  const fromFeedback: AgendaPoint[] = requests
    .filter((r) => effectiveStatus(r, today) === 'answered' && r.answer)
    .map((r) => ({
      id: `feedback:${r.id}`,
      text: `Обсудить отзыв: ${r.answer}`,
      source: 'feedback',
      isOn: false,
    }))
  return [...fromTasks, ...fromFeedback]
}

/** Сохранённые пункты главнее: новые подсказки добавляются в конец, удалённые стажёром не возвращаются. */
export function mergeAgenda(
  saved: readonly AgendaPoint[] | undefined,
  suggested: readonly AgendaPoint[],
): AgendaPoint[] {
  if (!saved) return [...suggested]
  const known = new Set(saved.map((p) => p.id))
  return [...saved, ...suggested.filter((p) => !known.has(p.id))]
}

export function togglePoint(points: readonly AgendaPoint[], id: string): AgendaPoint[] {
  return points.map((p) => (p.id === id ? { ...p, isOn: !p.isOn } : p))
}

export function removePoint(points: readonly AgendaPoint[], id: string): AgendaPoint[] {
  return points.map((p) => (p.id === id ? { ...p, isOn: false, text: '' } : p))
}

export function addPoint(points: readonly AgendaPoint[], text: string, id: string): AgendaPoint[] {
  const clean = text.trim().slice(0, POINT_MAX)
  if (!clean) return [...points]
  return [...points, { id, text: clean, source: 'manual', isOn: true }]
}

export function visiblePoints(points: readonly AgendaPoint[]): AgendaPoint[] {
  return points.filter((p) => p.text !== '')
}

/** Текст повестки для черновика в чате с наставником. */
export function agendaToText(points: readonly AgendaPoint[], meetingLabel: string): string {
  const chosen = visiblePoints(points).filter((p) => p.isOn)
  if (chosen.length === 0) return ''
  return [
    `Повестка на 1:1 (${meetingLabel}):`,
    ...chosen.map((p, i) => `${i + 1}. ${p.text}`),
  ].join('\n')
}
