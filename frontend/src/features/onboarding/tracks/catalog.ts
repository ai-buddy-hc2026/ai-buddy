import { z } from 'zod'

/**
 * Каталог треков онбординга (идея 45): обязательный минимум роли и треки на выбор.
 * У каждого модуля есть источник с датой проверки и владельцем (идея 32). Данные тестовые.
 */
export const sourceSchema = z.object({
  title: z.string(),
  /** Когда документ проверяли, ISO YYYY-MM-DD */
  reviewedAt: z.string(),
  /** id сотрудника-владельца из мока сотрудников */
  ownerId: z.string(),
})
export type Source = z.infer<typeof sourceSchema>

export const trackModuleSchema = z.object({
  id: z.string(),
  title: z.string(),
  minutes: z.number().int().positive(),
  source: sourceSchema,
  /** Тест «Я это знаю». null - модуль закрывается только прохождением */
  quizId: z.string().nullable(),
})
export type TrackModule = z.infer<typeof trackModuleSchema>

export const trackColorSchema = z.enum(['green', 'blue', 'violet', 'red', 'yellow'])
export type TrackColor = z.infer<typeof trackColorSchema>

export const trackSchema = z.object({
  id: z.string(),
  title: z.string(),
  about: z.string(),
  role: z.string(),
  required: z.boolean(),
  color: trackColorSchema,
  modules: z.array(trackModuleSchema).min(1),
})
export type Track = z.infer<typeof trackSchema>

const src = (title: string, reviewedAt: string, ownerId: string): Source => ({
  title,
  reviewedAt,
  ownerId,
})

const RAW_TRACKS: Track[] = [
  {
    id: 'access',
    title: 'Доступы и инструменты',
    about: 'GitLab, VPN, Jira и рабочее окружение',
    role: 'backend',
    required: true,
    color: 'green',
    modules: [
      {
        id: 'access-1',
        title: 'Какие доступы нужны Backend-стажёру',
        minutes: 10,
        source: src('Гайд по доступам', '2026-10-20', 'oleg'),
        quizId: null,
      },
      {
        id: 'access-2',
        title: 'Локальное окружение за 20 минут',
        minutes: 20,
        source: src('Гайд по локальному окружению', '2026-09-14', 'ilya'),
        quizId: null,
      },
    ],
  },
  {
    id: 'security',
    title: 'ИБ и работа с данными',
    about: 'Пароли, фишинг, персональные данные',
    role: 'backend',
    required: true,
    color: 'red',
    modules: [
      {
        id: 'security-1',
        title: 'Пароли и двухфакторка',
        minutes: 15,
        source: src('Памятка по ИБ', '2026-08-01', 'dasha'),
        quizId: null,
      },
      {
        id: 'security-2',
        title: 'Что считается персональными данными',
        minutes: 15,
        source: src('Правила работы с данными', '2025-12-03', 'dasha'),
        quizId: null,
      },
    ],
  },
  {
    id: 'first-task',
    title: 'Первая задача',
    about: 'От задачи в Jira до мёрджа',
    role: 'backend',
    required: true,
    color: 'blue',
    modules: [
      {
        id: 'first-task-1',
        title: 'Как взять задачу и оценить её',
        minutes: 10,
        source: src('Гайд по задачам команды', '2026-10-05', 'ilya'),
        quizId: null,
      },
      {
        id: 'first-task-2',
        title: 'Как проходит code review',
        minutes: 15,
        source: src('Гайд по code review', '2026-10-12', 'ilya'),
        quizId: null,
      },
    ],
  },
  {
    id: 'git-flow',
    title: 'Git-флоу команды',
    about: 'Ветки, коммиты, мёрдж-реквесты',
    role: 'backend',
    required: false,
    color: 'violet',
    modules: [
      {
        id: 'git-flow-1',
        title: 'Ветки и мёрдж-реквесты',
        minutes: 20,
        source: src('Git-флоу команды', '2026-09-30', 'ilya'),
        quizId: 'quiz-git',
      },
    ],
  },
  {
    id: 'go',
    title: 'Go в Авито',
    about: 'Как пишем сервисы на Go',
    role: 'backend',
    required: false,
    color: 'blue',
    modules: [
      {
        id: 'go-1',
        title: 'Ошибки и context',
        minutes: 25,
        source: src('Go-гайд команды', '2026-07-18', 'ilya'),
        quizId: 'quiz-go',
      },
      {
        id: 'go-2',
        title: 'Структура сервиса',
        minutes: 20,
        source: src('Шаблон Go-сервиса', '2026-07-18', 'ilya'),
        quizId: null,
      },
    ],
  },
  {
    id: 'deploy',
    title: 'Как устроен деплой',
    about: 'CI, окружения, откат релиза',
    role: 'backend',
    required: false,
    color: 'green',
    modules: [
      {
        id: 'deploy-1',
        title: 'Пайплайн CI',
        minutes: 15,
        source: src('Гайд по CI', '2026-10-01', 'oleg'),
        quizId: 'quiz-ci',
      },
      {
        id: 'deploy-2',
        title: 'Окружения и откат',
        minutes: 15,
        source: src('Гайд по релизам', '2026-03-10', 'oleg'),
        quizId: null,
      },
    ],
  },
  {
    id: 'kafka',
    title: 'Kafka с нуля',
    about: 'Топики, партиции, консьюмеры',
    role: 'backend',
    required: false,
    color: 'yellow',
    modules: [
      {
        id: 'kafka-1',
        title: 'Топики и партиции',
        minutes: 20,
        source: src('Kafka для новичков', '2026-06-22', 'oleg'),
        quizId: 'quiz-kafka',
      },
      {
        id: 'kafka-2',
        title: 'Консьюмер-группы',
        minutes: 20,
        source: src('Kafka для новичков', '2026-06-22', 'oleg'),
        quizId: null,
      },
    ],
  },
  {
    id: 'analysts',
    title: 'Как работать с аналитиками',
    about: 'Метрики, события, A/B-тесты',
    role: 'backend',
    required: false,
    color: 'violet',
    modules: [
      {
        id: 'analysts-1',
        title: 'Как заводить события',
        minutes: 15,
        source: src('Гайд по аналитике', '2026-05-15', 'sveta'),
        quizId: null,
      },
    ],
  },
]

/** Каталог проходит схему при загрузке модуля: битые данные видны сразу. */
export const TRACKS: readonly Track[] = z.array(trackSchema).parse(RAW_TRACKS)

export const REQUIRED_TRACK_IDS: readonly string[] = TRACKS.filter((t) => t.required).map(
  (t) => t.id,
)

export function getTrack(id: string): Track | undefined {
  return TRACKS.find((t) => t.id === id)
}

export function findModule(moduleId: string): { track: Track; module: TrackModule } | undefined {
  for (const track of TRACKS) {
    const module = track.modules.find((m) => m.id === moduleId)
    if (module) return { track, module }
  }
  return undefined
}

export function trackColorVar(color: TrackColor): string {
  return `var(--brand-${color})`
}
