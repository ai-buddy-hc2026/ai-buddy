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

export interface Localized {
  ru: string
  en: string
}

/** Строка матрицы: описания уровней 1-4 по порядку (`competency_levels`). */
export interface Competency {
  id: string
  name: Localized
  levels: readonly Localized[]
}

/** Матрица трека и своя самооценка. Самооценку видит только сам стажёр. */
export interface CompetencyMatrix {
  track: string
  competencies: readonly Competency[]
  levels: SkillLevels
}

const competency = (id: string, name: Localized, ru: string[], en: string[]): Competency => ({
  id,
  name,
  levels: ru.map((text, i) => ({ ru: text, en: en[i] ?? text })),
})

/** Мок матрицы трека Backend, повторяет seeds/competencies.sql. */
export const BACKEND_COMPETENCIES: readonly Competency[] = [
  competency(
    'go',
    { ru: 'Go и стандартная библиотека', en: 'Go and the standard library' },
    [
      'Читаю код сервиса и запускаю его локально',
      'Пишу ручку по образцу, ошибки обрабатываю с подсказкой',
      'Сама пишу пакет с контекстом, ошибками и горутинами',
      'Объясняю идиомы Go и ревьюю чужой код',
    ],
    [
      'I read the service code and run it locally',
      'I write a handler from an example, handle errors with help',
      'I write a package with context, errors and goroutines on my own',
      "I explain Go idioms and review others' code",
    ],
  ),
  competency(
    'tests',
    { ru: 'Тесты', en: 'Testing' },
    [
      'Запускаю существующие тесты',
      'Дописываю табличный тест по образцу',
      'Покрываю свой код тестами, включая ошибки и границы',
      'Строю тестовую инфраструктуру и учу других',
    ],
    [
      'I run existing tests',
      'I add a table test from an example',
      'I cover my code with tests, including errors and edge cases',
      'I build test infrastructure and teach others',
    ],
  ),
  competency(
    'review',
    { ru: 'Code review', en: 'Code review' },
    [
      'Читаю комментарии к своему MR и исправляю',
      'Готовлю MR с понятным описанием, проходит за 2-3 круга',
      'Мои MR проходят за 1-2 круга, оставляю полезные комментарии',
      'Ревьюю MR команды и помогаю договориться',
    ],
    [
      'I read comments on my MR and fix them',
      'I prepare an MR with a clear description, it passes in 2-3 rounds',
      'My MRs pass in 1-2 rounds, I leave useful comments',
      'I review team MRs and help reach agreement',
    ],
  ),
  competency(
    'sql',
    { ru: 'SQL и базы данных', en: 'SQL and databases' },
    [
      'Пишу простой SELECT по готовой схеме',
      'Пишу JOIN и миграцию по образцу',
      'Сама проектирую таблицу, индексы и транзакцию',
      'Разбираю планы запросов и учу других',
    ],
    [
      'I write a simple SELECT against an existing schema',
      'I write a JOIN and a migration from an example',
      'I design a table, indexes and a transaction on my own',
      'I analyze query plans and teach others',
    ],
  ),
  competency(
    'api',
    { ru: 'Проектирование API', en: 'API design' },
    [
      'Вызываю готовые ручки по документации',
      'Добавляю поле в контракт с подсказкой',
      'Сама проектирую ручку: коды ответов, ошибки, совместимость',
      'Веду контракт между сервисами и объясняю решения',
    ],
    [
      'I call existing endpoints from the docs',
      'I add a field to the contract with help',
      'I design an endpoint on my own: status codes, errors, compatibility',
      'I own the contract between services and explain decisions',
    ],
  ),
  competency(
    'infra',
    { ru: 'CI, деплой, k8s', en: 'CI, deploy, k8s' },
    [
      'Смотрю статус пайплайна и логи',
      'Чиню упавший шаг CI с подсказкой',
      'Сама выкатываю сервис и откатываю при ошибке',
      'Настраиваю пайплайн и алерты для команды',
    ],
    [
      'I check pipeline status and logs',
      'I fix a failed CI step with help',
      'I deploy the service and roll it back on my own',
      'I set up the pipeline and alerts for the team',
    ],
  ),
  competency(
    'comms',
    { ru: 'Коммуникация в команде', en: 'Team communication' },
    [
      'Задаю вопросы в чате команды',
      'Пишу понятный статус: что сделала, что дальше, где застряла',
      'Сама договариваюсь о решении с другими командами',
      'Помогаю новичкам и веду обсуждения',
    ],
    [
      'I ask questions in the team chat',
      'I write a clear status: done, next, blocked',
      'I agree on decisions with other teams on my own',
      'I help newcomers and lead discussions',
    ],
  ),
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
