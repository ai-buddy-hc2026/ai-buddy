import type { Slot } from '@/entities/calendar'
import type { Task } from '@/entities/plan'
import { ApiError } from '@/shared/api/http'
import type { Translate } from '@/shared/lib/i18n'
import { eventsApi, type Course, type EventItem } from './data'
import {
  buildDigest,
  buildEventDraft,
  courseReminders,
  eventHints,
  filterFeed,
  groupNotes,
  isWorkday,
  joinEvent,
  leaveEvent,
  myEvents,
  seatsLeft,
  type BuddyNote,
} from './logic'

const ru: Translate = (text) => text
const TODAY = '2026-11-12'
const WEEKDAYS = [1, 2, 3, 4, 5]

function event(patch: Partial<EventItem>): EventItem {
  return {
    id: 'ev',
    kind: 'training',
    title: 'Тренинг',
    description: '',
    start: '2026-11-13T12:00',
    minutes: 60,
    placeId: 'room-baikal',
    placeName: 'Переговорка Байкал',
    hostId: 'dasha',
    tags: [],
    capacity: 2,
    attendees: [],
    materials: [],
    ...patch,
  }
}

function course(patch: Partial<Course>): Course {
  return {
    id: 'c',
    title: 'Курс',
    modulesTotal: 5,
    modulesDone: 3,
    deadline: '2026-11-13',
    minutesLeft: 20,
    ...patch,
  }
}

function note(id: string): BuddyNote {
  return { id, kind: 'reminder', time: '10:00', title: id, lines: [], focus: null, links: [] }
}

describe('seats and sign-up', () => {
  test('counts seats left and treats null capacity as unlimited', () => {
    expect(seatsLeft(event({ capacity: 3, attendees: ['a'] }))).toBe(2)
    expect(seatsLeft(event({ capacity: null }))).toBeNull()
  })

  test('join adds the user without mutating the original list', () => {
    const events = [event({ attendees: ['a'] })]

    const next = joinEvent(events, 'ev', 'anya')

    expect(next[0].attendees).toEqual(['a', 'anya'])
    expect(events[0].attendees).toEqual(['a'])
  })

  test('join twice does not take a second seat', () => {
    const once = joinEvent([event({})], 'ev', 'anya')

    const twice = joinEvent(once, 'ev', 'anya')

    expect(twice[0].attendees).toEqual(['anya'])
  })

  test('join a full event fails with 409', () => {
    const full = [event({ capacity: 1, attendees: ['a'] })]

    expect(() => joinEvent(full, 'ev', 'anya')).toThrow(ApiError)
    expect(() => joinEvent(full, 'ev', 'anya')).toThrow(/Мест уже нет/)
  })

  test('join an unknown event fails with 404', () => {
    expect(() => joinEvent([], 'nope', 'anya')).toThrow('Такого события нет')
  })

  test('leave frees the seat', () => {
    const events = [event({ capacity: 1, attendees: ['anya'] })]

    const next = leaveEvent(events, 'ev', 'anya')

    expect(seatsLeft(next[0])).toBe(1)
  })

  test('draft for the action log is a sent booking with the given key', () => {
    const draft = buildEventDraft(event({ title: 'ИБ' }), 'join', 'key-1', 'пт, 13.11 в 12:00', ru)

    expect(draft).toMatchObject({
      kind: 'booking',
      status: 'sent',
      idempotencyKey: 'key-1',
      title: 'Запись: ИБ',
    })
    expect(draft.details).toContainEqual({ label: 'Где', value: 'Переговорка Байкал' })
  })
})

describe('feed', () => {
  const events = [
    event({ id: 'late', kind: 'user', start: '2026-11-14T10:00' }),
    event({ id: 'past', kind: 'avitotech', start: '2026-11-10T18:00' }),
    event({ id: 'soon', kind: 'training', start: '2026-11-12T09:00', attendees: ['anya'] }),
    event({ id: 'talk', kind: 'internal', start: '2026-11-13T17:00' }),
  ]

  test('hides past events and sorts by start', () => {
    expect(filterFeed(events, 'all', TODAY).map((e) => e.id)).toEqual(['soon', 'talk', 'late'])
  })

  test('talks filter keeps AvitoTech and internal talks only', () => {
    expect(filterFeed(events, 'talks', TODAY).map((e) => e.id)).toEqual(['talk'])
  })

  test('my events are upcoming events I signed up for', () => {
    expect(myEvents(events, 'anya', TODAY).map((e) => e.id)).toEqual(['soon'])
  })
})

describe('proactive buddy', () => {
  test('workday follows the work hours days (1 = mon ... 7 = sun)', () => {
    expect(isWorkday('2026-11-12', WEEKDAYS)).toBe(true)
    expect(isWorkday('2026-11-15', WEEKDAYS)).toBe(false)
    expect(isWorkday('2026-11-15', [7])).toBe(true)
  })

  test('course reminders come 3 days and 1 day before the deadline only', () => {
    const courses = [
      course({ id: 'one', deadline: '2026-11-13' }),
      course({ id: 'three', deadline: '2026-11-15' }),
      course({ id: 'two', deadline: '2026-11-14' }),
      course({ id: 'done', deadline: '2026-11-13', modulesDone: 5 }),
    ]

    const ids = courseReminders(courses, TODAY, ru).map((n) => n.id)

    expect(ids).toEqual(['remind-one-1', 'remind-three-3'])
  })

  test('hint comes the day before a joined event with materials, once per event', () => {
    const events = [
      event({ id: 'mine', attendees: ['anya'], materials: ['Гайд'] }),
      event({ id: 'other', materials: ['Гайд'] }),
      event({ id: 'empty', attendees: ['anya'] }),
    ]

    const hints = eventHints(events, 'anya', TODAY, ru)

    expect(hints.map((n) => n.id)).toEqual(['hint-mine'])
    expect(hints[0].lines).toContain('Гайд')
  })

  test('digest takes facts from data and picks the main step by rule', () => {
    const slots: Slot[] = [
      {
        id: 's1',
        employeeId: 'ilya',
        start: '2026-11-12T14:00',
        minutes: 30,
        bookedBy: 'anya',
        topic: '1:1',
      },
      {
        id: 's2',
        employeeId: 'ilya',
        start: '2026-11-17T15:00',
        minutes: 30,
        bookedBy: 'anya',
        topic: '1:1',
      },
    ]
    const tasks: Task[] = [
      {
        id: 't1',
        title: 'Настроить окружение',
        stage: 1,
        status: 'in_progress',
        due: '2026-11-12',
        note: '',
        owner: 'intern',
        source: 'checklist',
        updatedAt: TODAY,
      },
    ]

    const digest = buildDigest(
      {
        today: TODAY,
        workDays: WEEKDAYS,
        userId: 'anya',
        slots,
        events: [],
        courses: [course({ title: 'ИБ' })],
        tasks,
      },
      ru,
      'ru',
    )

    expect(digest?.lines).toContain('1:1 - Илья Наставников, 14:00')
    expect(digest?.lines.some((line) => line.includes('17'))).toBe(false)
    expect(digest?.lines).toContain('Курс «ИБ» - завтра')
    expect(digest?.focus).toBe('Настроить окружение')
  })

  test('no digest on a day off', () => {
    const input = {
      today: '2026-11-14',
      workDays: WEEKDAYS,
      userId: 'anya',
      slots: [],
      events: [],
      courses: [],
      tasks: [],
    }

    expect(buildDigest(input, ru, 'ru')).toBeNull()
  })

  test('quiet mode keeps unread notes out of "new"', () => {
    const notes = [note('a'), note('b')]

    const groups = groupNotes(notes, ['b'], false)

    expect(groups.fresh).toEqual([])
    expect(groups.quiet.map((n) => n.id)).toEqual(['a'])
    expect(groups.read.map((n) => n.id)).toEqual(['b'])
  })

  test('when notifications are allowed unread notes are new', () => {
    expect(groupNotes([note('a')], [], true).fresh.map((n) => n.id)).toEqual(['a'])
  })
})

describe('events api', () => {
  test('seed has a full training and Anya signed up for tomorrow', () => {
    const events = eventsApi.peek()

    expect(events.some((e) => e.kind === 'training' && seatsLeft(e) === 0)).toBe(true)
    expect(eventHints(events, 'anya', TODAY, ru).map((n) => n.id)).toEqual(['hint-ev-data-safety'])
  })

  test('join writes an action and takes a seat; leave frees it', async () => {
    const draft = buildEventDraft(eventsApi.peek()[0], 'join', 'k-join', 'когда', ru)

    await eventsApi.join('ev-code-review', 'anya', draft)
    const joined = eventsApi.peek().find((e) => e.id === 'ev-code-review')
    await eventsApi.leave('ev-code-review', 'anya', { ...draft, idempotencyKey: 'k-leave' })
    const left = eventsApi.peek().find((e) => e.id === 'ev-code-review')

    expect(joined?.attendees).toContain('anya')
    expect(left?.attendees).not.toContain('anya')
  })

  test('join a full training is refused before anything is sent', async () => {
    const draft = buildEventDraft(eventsApi.peek()[0], 'join', 'k-full', 'когда', ru)

    await expect(eventsApi.join('ev-feedback', 'anya', draft)).rejects.toThrow(/Мест уже нет/)
  })

  test('seen notes are stored without duplicates', async () => {
    await eventsApi.markSeen(['a', 'b'])

    expect(await eventsApi.markSeen(['b', 'c'])).toEqual(['a', 'b', 'c'])
  })
})
