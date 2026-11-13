import { z } from 'zod'
import { DEMO_TODAY, daysUntil } from '@/shared/lib/date'
import type { Track, TrackModule } from './catalog'
import type { Quiz } from './quizzes'

/** Состояние «Моего онбординга»: выбранные треки по порядку и прогресс модулей. */
export const moduleStatusSchema = z.enum(['todo', 'done', 'skipped_by_test'])
export type ModuleStatus = z.infer<typeof moduleStatusSchema>

export const moduleProgressSchema = z.object({
  status: moduleStatusSchema,
  /** Последний результат теста, null - тест не проходили */
  lastScore: z.number().int().min(0).nullable(),
  /** Дата последней попытки теста */
  lastAttempt: z.string().nullable(),
})
export type ModuleProgress = z.infer<typeof moduleProgressSchema>

export const userTracksSchema = z.object({
  /** id треков в порядке прохождения */
  selected: z.array(z.string()),
  modules: z.record(z.string(), moduleProgressSchema),
})
export type UserTracks = z.infer<typeof userTracksSchema>

export const PASS_SCORE = 4
export const HOURS_PER_WEEK = 2
const STALE_DAYS = 183

const EMPTY_PROGRESS: ModuleProgress = { status: 'todo', lastScore: null, lastAttempt: null }

export function progressOf(state: UserTracks, moduleId: string): ModuleProgress {
  return state.modules[moduleId] ?? EMPTY_PROGRESS
}

export function isModuleClosed(state: UserTracks, moduleId: string): boolean {
  return progressOf(state, moduleId).status !== 'todo'
}

/* ---------- Выбор и порядок треков ---------- */

/** Обязательные треки роли всегда в списке: недостающие добавляются в начало. */
export function ensureRequired(state: UserTracks, requiredIds: readonly string[]): UserTracks {
  const missing = requiredIds.filter((id) => !state.selected.includes(id))
  return missing.length === 0 ? state : { ...state, selected: [...missing, ...state.selected] }
}

export function addTrack(state: UserTracks, trackId: string): UserTracks {
  if (state.selected.includes(trackId)) return state
  return { ...state, selected: [...state.selected, trackId] }
}

/** Обязательный трек удалить нельзя: состояние не меняется. */
export function removeTrack(
  state: UserTracks,
  trackId: string,
  requiredIds: readonly string[],
): UserTracks {
  if (requiredIds.includes(trackId)) return state
  return { ...state, selected: state.selected.filter((id) => id !== trackId) }
}

/** Переносит трек на позицию `to` (перетаскивание или кнопки вверх-вниз). */
export function moveTrack(state: UserTracks, trackId: string, to: number): UserTracks {
  const from = state.selected.indexOf(trackId)
  if (from === -1) return state
  const target = Math.max(0, Math.min(state.selected.length - 1, to))
  if (target === from) return state
  const rest = state.selected.filter((id) => id !== trackId)
  return { ...state, selected: [...rest.slice(0, target), trackId, ...rest.slice(target)] }
}

/* ---------- Модули и тест «Я это знаю» ---------- */

export function setModuleStatus(
  state: UserTracks,
  moduleId: string,
  status: ModuleStatus,
): UserTracks {
  return {
    ...state,
    modules: { ...state.modules, [moduleId]: { ...progressOf(state, moduleId), status } },
  }
}

export function scoreQuiz(quiz: Quiz, answers: readonly (number | null)[]): number {
  return quiz.questions.filter((question, i) => answers[i] === question.correct).length
}

export function isPassed(score: number): boolean {
  return score >= PASS_SCORE
}

/** 4 из 5 и выше - модуль закрыт тестом. Меньше - статус не меняется, пересдать можно завтра. */
export function applyQuizResult(
  state: UserTracks,
  moduleId: string,
  score: number,
  today = DEMO_TODAY,
): UserTracks {
  const prev = progressOf(state, moduleId)
  const status: ModuleStatus =
    isPassed(score) && prev.status === 'todo' ? 'skipped_by_test' : prev.status
  return {
    ...state,
    modules: { ...state.modules, [moduleId]: { status, lastScore: score, lastAttempt: today } },
  }
}

/** Пересдача после неудачи - не раньше следующего дня. */
export function canTakeQuiz(state: UserTracks, moduleId: string, today = DEMO_TODAY): boolean {
  const progress = progressOf(state, moduleId)
  if (progress.status !== 'todo') return false
  if (progress.lastAttempt === null) return true
  return daysUntil(progress.lastAttempt, today) < 0
}

/* ---------- Прогресс, маршрут и бейджи ---------- */

export interface TrackProgress {
  done: number
  total: number
  isComplete: boolean
}

export function trackProgress(track: Track, state: UserTracks): TrackProgress {
  const done = track.modules.filter((m) => isModuleClosed(state, m.id)).length
  return { done, total: track.modules.length, isComplete: done === track.modules.length }
}

export interface RouteStep {
  track: Track
  /** Неделя, к которой трек будет пройден при темпе HOURS_PER_WEEK */
  week: number
  minutesLeft: number
  progress: TrackProgress
}

/** План из выбранных треков: оставшиеся минуты копятся, по ним считается неделя окончания. */
export function buildRoute(
  selected: readonly Track[],
  state: UserTracks,
  startWeek: number,
  hoursPerWeek = HOURS_PER_WEEK,
): RouteStep[] {
  const budget = hoursPerWeek * 60
  let spent = 0
  return selected.map((track) => {
    const minutesLeft = track.modules
      .filter((m) => !isModuleClosed(state, m.id))
      .reduce((sum, m) => sum + m.minutes, 0)
    spent += minutesLeft
    const weeksAhead = Math.max(0, Math.ceil(spent / budget) - 1)
    return {
      track,
      week: startWeek + weeksAhead,
      minutesLeft,
      progress: trackProgress(track, state),
    }
  })
}

/** Следующий шаг: первый незакрытый модуль в порядке выбранных треков. */
export function nextModule(
  selected: readonly Track[],
  state: UserTracks,
): { track: Track; module: TrackModule } | null {
  for (const track of selected) {
    const module = track.modules.find((m) => !isModuleClosed(state, m.id))
    if (module) return { track, module }
  }
  return null
}

export interface BadgeInfo {
  id: string
  title: { ru: string; en: string }
  color: Track['color']
  isEarned: boolean
}

export function earnedBadges(selected: readonly Track[], state: UserTracks): BadgeInfo[] {
  const required = selected.filter((t) => t.required)
  const passedByTest = Object.values(state.modules).some((m) => m.status === 'skipped_by_test')
  const base: BadgeInfo[] = [
    {
      id: 'required',
      title: { ru: 'Обязательный минимум', en: 'Required basics' },
      color: 'green',
      isEarned: required.length > 0 && required.every((t) => trackProgress(t, state).isComplete),
    },
    {
      id: 'quiz',
      title: { ru: 'Я это знаю', en: 'I know this' },
      color: 'violet',
      isEarned: passedByTest,
    },
  ]
  const perTrack: BadgeInfo[] = selected
    .filter((t) => !t.required)
    .map((t) => ({
      id: `track-${t.id}`,
      title: { ru: t.title, en: t.title },
      color: t.color,
      isEarned: trackProgress(t, state).isComplete,
    }))
  return [...base, ...perTrack]
}

/** Документ проверяли больше 6 месяцев назад - «Может быть устаревшим» (идея 32). */
export function isStale(reviewedAt: string, today = DEMO_TODAY): boolean {
  return daysUntil(reviewedAt, today) < -STALE_DAYS
}
