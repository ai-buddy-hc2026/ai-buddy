import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { ACTIONS_KEY, actionsApi, type ActionDraft } from '@/entities/actions'
import { createCollection, mockDelay } from '@/shared/lib/storage'
import { assertCanJoin, joinEvent, leaveEvent } from './logic'

/**
 * Мок сервиса событий и обучения (идеи 10, 22, 24):
 * лента событий с местами и записью, обязательные курсы с дедлайнами,
 * прочитанные сообщения buddy в ленте.
 */
export const eventKindSchema = z.enum(['training', 'avitotech', 'internal', 'user'])
export type EventKind = z.infer<typeof eventKindSchema>

export const eventSchema = z.object({
  id: z.string(),
  kind: eventKindSchema,
  title: z.string(),
  description: z.string(),
  /** ISO без таймзоны: 2026-11-13T12:00 */
  start: z.string(),
  minutes: z.number().int().positive(),
  /** Точка на карте офиса. null - вне офиса или онлайн */
  placeId: z.string().nullable(),
  placeName: z.string(),
  hostId: z.string(),
  tags: z.array(z.string()),
  /** Лимит мест. null - без ограничения */
  capacity: z.number().int().positive().nullable(),
  attendees: z.array(z.string()),
  /** Материалы для подсказки накануне (идея 24) */
  materials: z.array(z.string()),
})
export type EventItem = z.infer<typeof eventSchema>

export const courseSchema = z.object({
  id: z.string(),
  title: z.string(),
  modulesTotal: z.number().int().positive(),
  modulesDone: z.number().int().min(0),
  /** YYYY-MM-DD */
  deadline: z.string(),
  minutesLeft: z.number().int().min(0),
})
export type Course = z.infer<typeof courseSchema>

const others = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `guest-${i + 1}`)

const SEED_EVENTS: EventItem[] = [
  {
    id: 'ev-data-safety',
    kind: 'training',
    title: 'Тренинг: безопасная работа с данными',
    description:
      'Разбираем, какие данные можно выгружать, как хранить доступы и что делать, если что-то утекло. Практика на тестовых кейсах.',
    start: '2026-11-13T12:00',
    minutes: 60,
    placeId: 'room-altai',
    placeName: 'Переговорка Алтай',
    hostId: 'dasha',
    tags: ['обязательное', 'ИБ'],
    capacity: 12,
    attendees: ['anya', ...others(8)],
    materials: ['Памятка по ИБ для новичков (5 минут)', 'Курс по ИБ: модули 4 и 5'],
  },
  {
    id: 'ev-avitotech-pg',
    kind: 'avitotech',
    title: 'AvitoTech: как мы шардировали PostgreSQL',
    description:
      'Доклад команды платформы данных: почему понадобилось шардирование, какие грабли собрали и что получилось.',
    start: '2026-11-12T18:30',
    minutes: 90,
    placeId: 'room-baikal',
    placeName: 'Переговорка Байкал',
    hostId: 'timur',
    tags: ['backend', 'PostgreSQL'],
    capacity: null,
    attendees: ['anya', 'ilya', 'oleg'],
    materials: [],
  },
  {
    id: 'ev-board-games',
    kind: 'user',
    title: 'Настолки в пятницу',
    description: 'Играем в «Кодовые имена» и «Каркассон». Новичкам объясним правила за пять минут.',
    start: '2026-11-13T19:00',
    minutes: 120,
    placeId: 'kitchen',
    placeName: 'Кухня',
    hostId: 'oleg',
    tags: ['настолки'],
    capacity: 8,
    attendees: ['oleg', 'sveta', 'lena', 'petya', 'dima'],
    materials: [],
  },
  {
    id: 'ev-run',
    kind: 'user',
    title: 'Забег в субботу',
    description: 'Лёгкие 5 км в своём темпе, потом кофе. Встречаемся у главного входа в парк.',
    start: '2026-11-14T10:00',
    minutes: 90,
    placeId: null,
    placeName: 'Парк Горького, главный вход',
    hostId: 'sveta',
    tags: ['спорт', 'бег'],
    capacity: 20,
    attendees: ['sveta', 'timur'],
    materials: [],
  },
  {
    id: 'ev-code-review',
    kind: 'training',
    title: 'Тренинг: как проходить code review',
    description:
      'Как читать замечания, отвечать на них и не принимать на свой счёт. Разбор реальных ревью из команды.',
    start: '2026-11-16T15:00',
    minutes: 60,
    placeId: 'room-baikal',
    placeName: 'Переговорка Байкал',
    hostId: 'ilya',
    tags: ['soft skills', 'ревью'],
    capacity: 10,
    attendees: others(7),
    materials: ['Гайд команды по ревью (5 минут)', '3 частые ошибки новичков на ревью'],
  },
  {
    id: 'ev-search-talk',
    kind: 'internal',
    title: 'Внутренний доклад: как устроен поиск объявлений',
    description:
      'Путь запроса от строки поиска до выдачи. Без слайдов на 80 страниц, с живой схемой.',
    start: '2026-11-17T17:00',
    minutes: 45,
    placeId: 'room-altai',
    placeName: 'Переговорка Алтай',
    hostId: 'maria',
    tags: ['поиск', 'архитектура'],
    capacity: 30,
    attendees: ['ilya', 'oleg', ...others(14)],
    materials: [],
  },
  {
    id: 'ev-feedback',
    kind: 'training',
    title: 'Soft skills: как давать и принимать обратную связь',
    description: 'Короткий тренинг в парах. Учимся просить фидбек и формулировать его без оценок.',
    start: '2026-11-18T11:00',
    minutes: 90,
    placeId: 'room-altai',
    placeName: 'Переговорка Алтай',
    hostId: 'dasha',
    tags: ['soft skills'],
    capacity: 14,
    attendees: others(14),
    materials: ['Модель SBI за 3 минуты'],
  },
]

const SEED_COURSES: Course[] = [
  {
    id: 'c-security',
    title: 'Информационная безопасность',
    modulesTotal: 5,
    modulesDone: 3,
    deadline: '2026-11-13',
    minutesLeft: 20,
  },
  {
    id: 'c-ethics',
    title: 'Этика и антикоррупция',
    modulesTotal: 4,
    modulesDone: 2,
    deadline: '2026-11-15',
    minutesLeft: 25,
  },
  {
    id: 'c-data',
    title: 'Работа с персональными данными',
    modulesTotal: 3,
    modulesDone: 0,
    deadline: '2026-11-20',
    minutesLeft: 30,
  },
  {
    id: 'c-safety',
    title: 'Охрана труда',
    modulesTotal: 3,
    modulesDone: 3,
    deadline: '2026-11-06',
    minutesLeft: 0,
  },
]

const eventsDb = createCollection<EventItem[]>('events.list', () => SEED_EVENTS)
const coursesDb = createCollection<Course[]>('events.courses', () => SEED_COURSES)
const seenDb = createCollection<string[]>('events.seen', () => [])

export const eventsApi = {
  /** GET /events */
  async list(): Promise<EventItem[]> {
    await mockDelay(200)
    return z.array(eventSchema).parse(eventsDb.read())
  },
  /** GET /learning/{user_id}/required */
  async requiredCourses(): Promise<Course[]> {
    await mockDelay(150)
    return z.array(courseSchema).parse(coursesDb.read())
  },
  async seenNotes(): Promise<string[]> {
    await mockDelay(50)
    return z.array(z.string()).parse(seenDb.read())
  },
  /**
   * POST /events/{id}/attendees. Только по кнопке подтверждения:
   * сначала проверка мест, потом отправка во внешний календарь и запись в историю действий.
   */
  async join(eventId: string, userId: string, draft: ActionDraft): Promise<void> {
    assertCanJoin(z.array(eventSchema).parse(eventsDb.read()), eventId, userId)
    await actionsApi.confirm(draft)
    eventsDb.update((events) => joinEvent(events, eventId, userId))
  },
  /** DELETE /events/{id}/attendees/{user_id} */
  async leave(eventId: string, userId: string, draft: ActionDraft): Promise<void> {
    await actionsApi.confirm(draft)
    eventsDb.update((events) => leaveEvent(events, eventId, userId))
  },
  async markSeen(ids: readonly string[]): Promise<string[]> {
    await mockDelay(50)
    return seenDb.update((prev) => [...new Set([...prev, ...ids])])
  },
  peek: (): EventItem[] => z.array(eventSchema).parse(eventsDb.read()),
}

export const EVENTS_KEY = ['events'] as const
const COURSES_KEY = ['events', 'courses'] as const
const SEEN_KEY = ['events', 'seen'] as const
const LIST_KEY = ['events', 'list'] as const

export function useEvents() {
  return useQuery({ queryKey: LIST_KEY, queryFn: eventsApi.list })
}

export function useRequiredCourses() {
  return useQuery({ queryKey: COURSES_KEY, queryFn: eventsApi.requiredCourses })
}

export function useSeenNotes() {
  return useQuery({ queryKey: SEEN_KEY, queryFn: eventsApi.seenNotes })
}

type AttendanceVars = { eventId: string; userId: string; draft: ActionDraft }

function useAttendance(run: (vars: AttendanceVars) => Promise<void>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: run,
    // И при успехе, и при 409 список мест устарел
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: LIST_KEY }),
        client.invalidateQueries({ queryKey: ACTIONS_KEY }),
      ])
    },
  })
}

export function useJoinEvent() {
  return useAttendance(({ eventId, userId, draft }) => eventsApi.join(eventId, userId, draft))
}

export function useLeaveEvent() {
  return useAttendance(({ eventId, userId, draft }) => eventsApi.leave(eventId, userId, draft))
}

export function useMarkSeen() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (ids: readonly string[]) => eventsApi.markSeen(ids),
    onSuccess: (seen) => client.setQueryData(SEEN_KEY, seen),
  })
}
