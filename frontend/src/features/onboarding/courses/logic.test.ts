import { COURSES, coursesApi } from './data'
import {
  completeModule,
  courseStatus,
  minutesLeft,
  mostUrgent,
  nextCourseModule,
  reminderDay,
  sortCourses,
  type Course,
} from './logic'

const course: Course = {
  id: 'ib',
  title: 'Курс по ИБ',
  kind: 'required',
  modules: ['a', 'b', 'c', 'd', 'e'],
  minutesPerModule: 10,
  deadline: '2026-11-13',
  source: { title: 'Памятка', reviewedAt: '2026-08-01', ownerId: 'dasha' },
}
const optional: Course = { ...course, id: 'soft', kind: 'optional', deadline: null }

describe('курсы', () => {
  it('считает оставшиеся минуты: 3 из 5 модулей - около 20 минут', () => {
    expect(minutesLeft(course, { ib: 3 })).toBe(20)
  })

  it('определяет статус по дедлайну', () => {
    expect(courseStatus(course, { ib: 5 }, '2026-11-12')).toBe('done')
    expect(courseStatus(course, { ib: 3 }, '2026-11-12')).toBe('soon')
    expect(courseStatus(course, { ib: 3 }, '2026-11-01')).toBe('ok')
    expect(courseStatus(course, { ib: 3 }, '2026-11-14')).toBe('overdue')
    expect(courseStatus(optional, {}, '2026-11-12')).toBe('optional')
  })

  it('закрывает следующий модуль и не уходит за край', () => {
    expect(nextCourseModule(course, { ib: 3 })).toBe('d')
    expect(completeModule({ ib: 3 }, course)).toEqual({ ib: 4 })
    expect(completeModule({ ib: 5 }, course)).toEqual({ ib: 5 })
    expect(nextCourseModule(course, { ib: 5 })).toBeNull()
  })

  it('сортирует: просроченные и горящие раньше, пройденные в конце', () => {
    const late: Course = { ...course, id: 'late', deadline: '2026-11-10' }
    const done: Course = { ...course, id: 'done' }
    const sorted = sortCourses([done, course, late], { done: 5 }, '2026-11-12')
    expect(sorted.map((c) => c.id)).toEqual(['late', 'ib', 'done'])
  })

  it('главный курс - самый срочный незакрытый обязательный', () => {
    expect(mostUrgent([optional, course], {}, '2026-11-12')?.id).toBe('ib')
    expect(mostUrgent([optional], {}, '2026-11-12')).toBeNull()
  })

  it('напоминает за 3 дня и за 1 день до дедлайна', () => {
    expect(reminderDay(course, {}, '2026-11-12')).toBe(1)
    expect(reminderDay(course, {}, '2026-11-10')).toBe(3)
    expect(reminderDay(course, {}, '2026-11-11')).toBeNull()
    expect(reminderDay(course, { ib: 5 }, '2026-11-12')).toBeNull()
  })

  it('мок обучения сохраняет пройденный модуль', async () => {
    const before = await coursesApi.progress()
    const after = await coursesApi.completeModule('ib')
    expect(after.ib).toBe((before.ib ?? 0) + 1)
    expect(COURSES.find((c) => c.id === 'ib')?.modules).toHaveLength(5)
  })
})
