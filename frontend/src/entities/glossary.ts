import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { createCollection, mockDelay } from '@/shared/lib/storage'

/**
 * Мок словаря жаргона (идея 30): glossary(term, synonyms[], definition, source).
 * Общий модуль: раздел «Словарь» и подсветка терминов в ответах бота.
 * У каждого термина источник, дата проверки и владелец (идея 32).
 */
export const termCategorySchema = z.enum(['dev', 'process', 'company'])
export type TermCategory = z.infer<typeof termCategorySchema>

export const termSchema = z.object({
  id: z.string(),
  term: z.string(),
  synonyms: z.array(z.string()),
  category: termCategorySchema,
  definition: z.string(),
  example: z.string(),
  source: z.object({
    title: z.string(),
    /** YYYY-MM-DD */
    reviewedAt: z.string(),
    ownerId: z.string(),
  }),
})
export type Term = z.infer<typeof termSchema>

const src = (title: string, reviewedAt: string, ownerId: string): Term['source'] => ({
  title,
  reviewedAt,
  ownerId,
})

const SEED_TERMS: Term[] = [
  {
    id: 'mr',
    term: 'МР',
    synonyms: ['merge request', 'мерж-реквест', 'мерж'],
    category: 'dev',
    definition: 'Запрос на слияние твоего кода с основной веткой. Его смотрит ревьюер.',
    example: 'Скинь ссылку на МР, гляну после обеда',
    source: src('Гайд по code review', '2026-10-12', 'ilya'),
  },
  {
    id: 'review',
    term: 'Ревью',
    synonyms: ['code review', 'кодревью'],
    category: 'dev',
    definition: 'Коллега читает твой код и оставляет замечания. Без апрува МР не вливают.',
    example: 'Илья оставил три комментария на ревью',
    source: src('Гайд по code review', '2026-10-12', 'ilya'),
  },
  {
    id: 'approve',
    term: 'Апрув',
    synonyms: ['approve', 'апрувнуть'],
    category: 'dev',
    definition: 'Одобрение МР ревьюером. Свой МР апрувнуть нельзя.',
    example: 'Нужен ещё один апрув, и можно мёржить',
    source: src('Гайд по code review', '2026-10-12', 'ilya'),
  },
  {
    id: 'katnut',
    term: 'Катнуть',
    synonyms: ['выкатить', 'выкатка'],
    category: 'dev',
    definition: 'Выкатить изменения в прод, то есть показать их пользователям.',
    example: 'Катнём фикс после обеда, если тесты зелёные',
    source: src('Гайд по деплою', '2026-11-02', 'oleg'),
  },
  {
    id: 'prod',
    term: 'Прод',
    synonyms: ['продакшен', 'production'],
    category: 'dev',
    definition: 'Боевая среда, где работают настоящие пользователи. Тестировать там нельзя.',
    example: 'На проде ошибка, на стейдже всё норм',
    source: src('Гайд по деплою', '2026-11-02', 'oleg'),
  },
  {
    id: 'release-train',
    term: 'Релиз-трейн',
    synonyms: ['release train', 'поезд'],
    category: 'process',
    definition:
      'Выкатка по расписанию. Всё, что успело в поезд до отсечки, уходит в прод вместе. Не успел - едешь следующим.',
    example: 'Отсечка релиз-трейна в среду в 12:00',
    source: src('Гайд по деплою', '2026-11-02', 'oleg'),
  },
  {
    id: 'duty',
    term: 'Дежурство',
    synonyms: ['on-call', 'дежурный', 'онколл'],
    category: 'process',
    definition: 'Неделя, когда ты первым смотришь алерты и чинишь срочное. Стажёров ставят в пару.',
    example: 'На этой неделе дежурит Олег, пиши ему про алерты',
    source: src('Регламент дежурств', '2026-03-04', 'oleg'),
  },
  {
    id: 'alert',
    term: 'Алерт',
    synonyms: ['alert', 'алёрт'],
    category: 'process',
    definition: 'Автоматическое оповещение, что с сервисом что-то не так.',
    example: 'Прилетел алерт по задержкам в поиске',
    source: src('Регламент дежурств', '2026-03-04', 'oleg'),
  },
  {
    id: 'postmortem',
    term: 'Постмортем',
    synonyms: ['postmortem', 'разбор инцидента'],
    category: 'process',
    definition: 'Разбор после сбоя: что сломалось, почему и что поменять. Виноватых не ищем.',
    example: 'Постмортем по вчерашнему сбою лежит в вики',
    source: src('Регламент дежурств', '2026-03-04', 'oleg'),
  },
  {
    id: 'psi',
    term: 'ПСИ',
    synonyms: ['приёмо-сдаточные испытания'],
    category: 'process',
    definition:
      'Приёмо-сдаточные испытания. Заказчик проверяет, что фича работает как договорились.',
    example: 'ПСИ по новому фильтру в пятницу',
    source: src('Процесс разработки', '2026-09-15', 'maria'),
  },
  {
    id: 'feature-flag',
    term: 'Фича-флаг',
    synonyms: ['feature flag', 'флаг', 'тоггл'],
    category: 'dev',
    definition: 'Выключатель в коде. Фичу выкатили, но включают её только части пользователей.',
    example: 'Новый фильтр под флагом, включим на 5%',
    source: src('Процесс разработки', '2026-09-15', 'maria'),
  },
  {
    id: 'staff',
    term: 'Стафф',
    synonyms: ['staff', 'стафф-портал'],
    category: 'company',
    definition: 'Внутренний портал сотрудников: кто где сидит, кто руководитель, как связаться.',
    example: 'Найди Тимура на стаффе, там его телеграм',
    source: src('Первые дни в Авито', '2026-10-20', 'dasha'),
  },
  {
    id: 'okr',
    term: 'OKR',
    synonyms: ['окры', 'цели'],
    category: 'company',
    definition:
      'Цели команды на квартал и понятные результаты, по которым видно, что цель достигнута.',
    example: 'Эта задача из OKR команды на четвёртый квартал',
    source: src('Первые дни в Авито', '2026-10-20', 'dasha'),
  },
  {
    id: 'backlog',
    term: 'Бэклог',
    synonyms: ['backlog'],
    category: 'process',
    definition: 'Список задач, которые команда планирует сделать, но ещё не взяла в работу.',
    example: 'Закинь идею в бэклог, обсудим на планировании',
    source: src('Процесс разработки', '2026-09-15', 'maria'),
  },
]

const glossaryDb = createCollection<Term[]>('glossary', () => SEED_TERMS)

export const glossaryApi = {
  async list(): Promise<Term[]> {
    await mockDelay(200)
    return z.array(termSchema).parse(glossaryDb.read())
  },
}

export const GLOSSARY_KEY = ['glossary'] as const

export function useGlossary() {
  return useQuery({ queryKey: GLOSSARY_KEY, queryFn: glossaryApi.list })
}
