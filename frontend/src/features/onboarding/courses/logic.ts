import { z } from 'zod'
import { sourceSchema } from '../tracks/catalog'
import { DEMO_TODAY, daysUntil } from '@/shared/lib/date'

/**
 * Курсы (идея 10 и необязательные soft skills из идеи 24).
 * Мок обучения: `GET /learning/{user_id}/required` -> modules_total, modules_done, deadline, minutes_left.
 */
export const courseSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(['required', 'optional']),
  modules: z.array(z.string()).min(1),
  minutesPerModule: z.number().int().positive(),
  /** Жёсткий дедлайн ISO YYYY-MM-DD, у необязательных null */
  deadline: z.string().nullable(),
  source: sourceSchema,
})
export type Course = z.infer<typeof courseSchema>

/** Сколько модулей пройдено по каждому курсу */
export const courseProgressSchema = z.record(z.string(), z.number().int().min(0))
export type CourseProgress = z.infer<typeof courseProgressSchema>

export type CourseStatus = 'done' | 'overdue' | 'soon' | 'ok' | 'optional'

const SOON_DAYS = 3
/** Крон напоминает за 3 дня и за 1 день до дедлайна */
export const REMIND_DAYS: readonly number[] = [3, 1]

export function doneOf(course: Course, progress: CourseProgress): number {
  return Math.min(progress[course.id] ?? 0, course.modules.length)
}

export function minutesLeft(course: Course, progress: CourseProgress): number {
  return (course.modules.length - doneOf(course, progress)) * course.minutesPerModule
}

export function courseStatus(
  course: Course,
  progress: CourseProgress,
  today = DEMO_TODAY,
): CourseStatus {
  if (doneOf(course, progress) === course.modules.length) return 'done'
  if (course.deadline === null) return 'optional'
  const left = daysUntil(course.deadline, today)
  if (left < 0) return 'overdue'
  return left <= SOON_DAYS ? 'soon' : 'ok'
}

/** Название следующего модуля или null, если курс пройден. */
export function nextCourseModule(course: Course, progress: CourseProgress): string | null {
  return course.modules[doneOf(course, progress)] ?? null
}

export function completeModule(progress: CourseProgress, course: Course): CourseProgress {
  return { ...progress, [course.id]: Math.min(doneOf(course, progress) + 1, course.modules.length) }
}

const STATUS_ORDER: Record<CourseStatus, number> = {
  overdue: 0,
  soon: 1,
  ok: 2,
  optional: 3,
  done: 4,
}

/** Сначала просроченные и горящие, внутри - по дедлайну. Пройденные в конце. */
export function sortCourses(
  courses: readonly Course[],
  progress: CourseProgress,
  today = DEMO_TODAY,
): Course[] {
  const far = '9999-12-31'
  return [...courses].sort(
    (a, b) =>
      STATUS_ORDER[courseStatus(a, progress, today)] -
        STATUS_ORDER[courseStatus(b, progress, today)] ||
      (a.deadline ?? far).localeCompare(b.deadline ?? far),
  )
}

/** Самый срочный незакрытый обязательный курс: его показываем главным. */
export function mostUrgent(
  courses: readonly Course[],
  progress: CourseProgress,
  today = DEMO_TODAY,
): Course | null {
  const open = courses.filter(
    (c) => c.kind === 'required' && courseStatus(c, progress, today) !== 'done',
  )
  return sortCourses(open, progress, today)[0] ?? null
}

/** Сегодня день напоминания по крону: вернёт число дней до дедлайна или null. */
export function reminderDay(
  course: Course,
  progress: CourseProgress,
  today = DEMO_TODAY,
): number | null {
  if (course.deadline === null || courseStatus(course, progress, today) === 'done') return null
  const left = daysUntil(course.deadline, today)
  return REMIND_DAYS.includes(left) ? left : null
}
