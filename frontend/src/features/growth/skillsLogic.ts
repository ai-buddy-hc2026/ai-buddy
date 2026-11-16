import { z } from 'zod'

/** MR из мока GitLab (идеи 29, 48). */
export const mergeRequestSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  reviewerId: z.string(),
  /** Изменения в коде, где тесты нужны (README и конфиги - нет) */
  needsTests: z.boolean(),
  hasTests: z.boolean(),
  touchesSql: z.boolean(),
  reviewRounds: z.number().int().min(0),
  date: z.string(),
})
export type MergeRequest = z.infer<typeof mergeRequestSchema>

export const MIN_LEVEL = 1
export const MAX_LEVEL = 4

export const skillLevelsSchema = z.record(
  z.string(),
  z.number().int().min(MIN_LEVEL).max(MAX_LEVEL),
)
export type SkillLevels = z.infer<typeof skillLevelsSchema>

export interface Competency {
  id: string
  name: { ru: string; en: string }
}

/** Карта компетенций роли Backend: `competencies (role, name, levels)`. */
export const BACKEND_COMPETENCIES: readonly Competency[] = [
  { id: 'go', name: { ru: 'Go и стандартная библиотека', en: 'Go and the standard library' } },
  { id: 'tests', name: { ru: 'Тесты', en: 'Testing' } },
  { id: 'review', name: { ru: 'Code review', en: 'Code review' } },
  { id: 'sql', name: { ru: 'SQL и базы данных', en: 'SQL and databases' } },
  { id: 'infra', name: { ru: 'CI, деплой, k8s', en: 'CI, deploy, k8s' } },
  { id: 'comms', name: { ru: 'Коммуникация в команде', en: 'Team communication' } },
]

export const DEFAULT_LEVEL = 2

export function levelOf(levels: SkillLevels, id: string): number {
  return levels[id] ?? DEFAULT_LEVEL
}

export function setLevel(levels: SkillLevels, id: string, level: number): SkillLevels {
  const clamped = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level)))
  return { ...levels, [id]: clamped }
}

export type SkillHint =
  | { skillId: 'tests'; kind: 'missingTests'; missing: number; total: number }
  | { skillId: 'sql'; kind: 'noSql'; total: number }
  | { skillId: 'review'; kind: 'manyRounds'; rounds: number; total: number }

const ROUNDS_THRESHOLD = 2

/** Подсказки бота только по фактам из мока GitLab, без догадок. */
export function skillHints(mrs: readonly MergeRequest[]): SkillHint[] {
  if (mrs.length === 0) return []
  const hints: SkillHint[] = []
  const codeMrs = mrs.filter((mr) => mr.needsTests)
  const missing = codeMrs.filter((mr) => !mr.hasTests).length
  if (missing > 0)
    hints.push({ skillId: 'tests', kind: 'missingTests', missing, total: codeMrs.length })
  const heavy = mrs.filter((mr) => mr.reviewRounds > ROUNDS_THRESHOLD).length
  if (heavy > 0)
    hints.push({ skillId: 'review', kind: 'manyRounds', rounds: heavy, total: mrs.length })
  if (!mrs.some((mr) => mr.touchesSql))
    hints.push({ skillId: 'sql', kind: 'noSql', total: mrs.length })
  return hints
}

/** Что подтянуть: минимальная самооценка, при равенстве - навык с подсказкой по фактам. */
export function weakestSkill(
  competencies: readonly Competency[],
  levels: SkillLevels,
  hints: readonly SkillHint[],
): Competency | null {
  if (competencies.length === 0) return null
  const hinted = new Set(hints.map((hint) => hint.skillId as string))
  const score = (c: Competency) => levelOf(levels, c.id) * 2 - (hinted.has(c.id) ? 1 : 0)
  return [...competencies].sort((a, b) => score(a) - score(b))[0]
}

export function averageLevel(competencies: readonly Competency[], levels: SkillLevels): number {
  if (competencies.length === 0) return 0
  const sum = competencies.reduce((acc, c) => acc + levelOf(levels, c.id), 0)
  return Math.round((sum / competencies.length) * 10) / 10
}
