import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { createCollection, mockDelay } from '@/shared/lib/storage'
import {
  completeModule,
  courseProgressSchema,
  courseSchema,
  type Course,
  type CourseProgress,
} from './logic'

/** Каталог курсов мока обучения. Данные тестовые, не регламент Авито. */
const RAW_COURSES: Course[] = [
  {
    id: 'ib',
    title: 'Курс по ИБ',
    kind: 'required',
    modules: [
      'Пароли и 2FA',
      'Фишинг',
      'Работа с ноутбуком вне офиса',
      'Секреты в коде',
      'Итоговый тест',
    ],
    minutesPerModule: 10,
    deadline: '2026-11-13',
    source: { title: 'Памятка по ИБ', reviewedAt: '2026-08-01', ownerId: 'dasha' },
  },
  {
    id: 'data',
    title: 'Работа с персональными данными',
    kind: 'required',
    modules: ['Что такое ПДн', 'Где их нельзя хранить', 'Логи и маскирование', 'Итоговый тест'],
    minutesPerModule: 8,
    deadline: '2026-11-18',
    source: { title: 'Правила работы с данными', reviewedAt: '2025-12-03', ownerId: 'dasha' },
  },
  {
    id: 'safety',
    title: 'Охрана труда',
    kind: 'required',
    modules: ['Рабочее место', 'Пожарная безопасность', 'Итоговый тест'],
    minutesPerModule: 7,
    deadline: '2026-11-20',
    source: { title: 'Инструкция по охране труда', reviewedAt: '2026-09-01', ownerId: 'dasha' },
  },
  {
    id: 'ethics',
    title: 'Этика и антикоррупция',
    kind: 'required',
    modules: ['Конфликт интересов', 'Подарки и встречи'],
    minutesPerModule: 10,
    deadline: '2026-11-09',
    source: { title: 'Кодекс этики', reviewedAt: '2026-04-20', ownerId: 'maria' },
  },
  {
    id: 'review-feedback',
    title: 'Как принимать замечания на ревью',
    kind: 'optional',
    modules: ['Замечание - не про тебя', 'Как отвечать на комментарии'],
    minutesPerModule: 5,
    deadline: null,
    source: { title: 'Гайд по code review', reviewedAt: '2026-10-12', ownerId: 'ilya' },
  },
  {
    id: 'ask-questions',
    title: 'Как задавать вопросы',
    kind: 'optional',
    modules: ['Контекст, попытки, вопрос', 'Когда идти к наставнику'],
    minutesPerModule: 5,
    deadline: null,
    source: { title: 'Гайд для стажёров', reviewedAt: '2026-09-25', ownerId: 'ilya' },
  },
  {
    id: 'time',
    title: 'Тайм-менеджмент для стажёра',
    kind: 'optional',
    modules: ['Оценка задач', 'Фокус и перерывы', 'Как говорить «не успеваю»'],
    minutesPerModule: 6,
    deadline: null,
    source: { title: 'Гайд для стажёров', reviewedAt: '2026-09-25', ownerId: 'maria' },
  },
]

export const COURSES: readonly Course[] = z.array(courseSchema).parse(RAW_COURSES)

const seedProgress = (): CourseProgress => ({ ib: 3, data: 1, safety: 0, ethics: 2 })

const progressDb = createCollection<CourseProgress>('courses', seedProgress)

export const coursesApi = {
  async progress(): Promise<CourseProgress> {
    await mockDelay(200)
    const parsed = courseProgressSchema.safeParse(progressDb.read())
    return parsed.success ? parsed.data : seedProgress()
  },
  /** POST /learning/{course_id}/progress: модуль пройден */
  async completeModule(courseId: string): Promise<CourseProgress> {
    await mockDelay(200)
    const course = COURSES.find((c) => c.id === courseId)
    if (!course) throw new Error('Курс не найден')
    const parsed = courseProgressSchema.safeParse(progressDb.read())
    return progressDb.write(completeModule(parsed.success ? parsed.data : seedProgress(), course))
  },
}

export const COURSES_KEY = ['onboarding', 'courses'] as const

export function useCourseProgress() {
  return useQuery({ queryKey: COURSES_KEY, queryFn: coursesApi.progress })
}

export function useCompleteModule() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (courseId: string) => coursesApi.completeModule(courseId),
    onSuccess: (progress) => client.setQueryData(COURSES_KEY, progress),
  })
}
