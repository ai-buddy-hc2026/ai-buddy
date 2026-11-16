import { describe, expect, it } from 'vitest'
import type { BragItem } from '@/entities/brag'
import type { Slot } from '@/entities/calendar'
import { EMPLOYEES } from '@/entities/employees'
import type { Task } from '@/entities/plan'
import {
  addPoint,
  agendaToText,
  mergeAgenda,
  removePoint,
  suggestAgenda,
  togglePoint,
  upcomingMeetings,
  visiblePoints,
} from './agendaLogic'
import {
  bragSuggestions,
  countByType,
  isCovered,
  normalizeBragInput,
  sortBragItems,
  updateBragItem,
  validateBragInput,
} from './bragLogic'
import {
  answerToBrag,
  buildFeedbackAction,
  canRequest,
  createRequest,
  effectiveStatus,
  markSaved,
  recipientsFor,
  validateFeedbackDraft,
  type FeedbackRequest,
} from './feedbackLogic'
import {
  averageLevel,
  BACKEND_COMPETENCIES,
  setLevel,
  skillHints,
  weakestSkill,
  type MergeRequest,
} from './skillsLogic'
import { toGrowthTab } from './tabs'

const brag = (
  id: string,
  title: string,
  date: string,
  extra: Partial<BragItem> = {},
): BragItem => ({
  id,
  type: 'task',
  title,
  link: null,
  date,
  ...extra,
})

const task = (id: string, title: string, extra: Partial<Task> = {}): Task => ({
  id,
  title,
  stage: 1,
  status: 'done',
  due: null,
  note: '',
  owner: 'intern',
  source: 'checklist',
  updatedAt: '2026-11-10',
  ...extra,
})

const mr = (number: number, extra: Partial<MergeRequest> = {}): MergeRequest => ({
  id: `mr-${number}`,
  number,
  title: `MR ${number}`,
  url: `https://gitlab.test/mr/${number}`,
  reviewerId: 'oleg',
  needsTests: true,
  hasTests: true,
  touchesSql: true,
  reviewRounds: 1,
  date: '2026-11-10',
  ...extra,
})

const request = (id: string, extra: Partial<FeedbackRequest> = {}): FeedbackRequest => ({
  id,
  toId: 'ilya',
  artifactUrl: 'https://gitlab.test/mr/1',
  artifactTitle: 'MR !1',
  question: 'Что улучшить?',
  status: 'sent',
  answer: null,
  sentAt: '2026-11-11',
  answeredAt: null,
  savedToBrag: false,
  externalId: null,
  ...extra,
})

describe('toGrowthTab', () => {
  it('returns brag for unknown or missing tab', () => {
    expect(toGrowthTab(undefined)).toBe('brag')
    expect(toGrowthTab('nope')).toBe('brag')
  })
  it('keeps a known tab', () => {
    expect(toGrowthTab('meetings')).toBe('meetings')
  })
})

describe('brag logic', () => {
  it('sorts items newest first without mutating input', () => {
    const items = [brag('a', 'A', '2026-11-01'), brag('b', 'B', '2026-11-05')]
    const sorted = sortBragItems(items)
    expect(sorted.map((i) => i.id)).toEqual(['b', 'a'])
    expect(items[0].id).toBe('a')
  })

  it('counts items by type', () => {
    const counts = countByType([
      brag('a', 'A', '2026-11-01'),
      brag('b', 'B', '2026-11-01', { type: 'pr' }),
    ])
    expect(counts).toEqual({ task: 1, pr: 1, review: 0, feedback: 0, manual: 0 })
  })

  it('updates one item and keeps its id', () => {
    const list = [brag('a', 'Старое', '2026-11-01'), brag('b', 'B', '2026-11-02')]
    const next = updateBragItem(list, 'a', {
      type: 'manual',
      title: 'Новое',
      link: null,
      date: '2026-11-03',
    })
    expect(next[0]).toEqual({
      id: 'a',
      type: 'manual',
      title: 'Новое',
      link: null,
      date: '2026-11-03',
    })
    expect(list[0].title).toBe('Старое')
  })

  it('validates title, date and link', () => {
    expect(
      validateBragInput({ type: 'manual', title: ' ', date: '12.11', link: 'ftp://x' }),
    ).toEqual({
      title: 'required',
      date: 'format',
      link: 'format',
    })
    expect(
      validateBragInput({ type: 'manual', title: 'Ок', date: '2026-11-12', link: null }),
    ).toEqual({})
  })

  it('normalizes empty link to null', () => {
    expect(
      normalizeBragInput({ type: 'manual', title: ' A ', date: '2026-11-12', link: '  ' }),
    ).toEqual({
      type: 'manual',
      title: 'A',
      date: '2026-11-12',
      link: null,
    })
  })

  it('treats a task as covered when word stems overlap', () => {
    const items = [brag('b1', 'Прошла вводный курс за 2 дня', '2026-11-04')]
    expect(isCovered('Пройти вводный курс', items)).toBe(true)
    expect(isCovered('Встреча 1:1 с наставником', items)).toBe(false)
  })

  it('suggests done tasks and MRs that are not in brag yet', () => {
    const items = [
      brag('b1', 'Прошла вводный курс', '2026-11-04'),
      brag('b2', 'MR', '2026-11-10', { link: 'https://gitlab.test/mr/1' }),
    ]
    const tasks = [
      task('t1', 'Пройти вводный курс'),
      task('t2', 'Встреча 1:1 с наставником'),
      task('t3', 'Первый PR', { status: 'todo' }),
    ]
    const result = bragSuggestions(tasks, [mr(1), mr(2)], items)
    expect(result.map((s) => s.id)).toEqual(['mr:mr-2', 'plan:t2'])
    expect(result[0].item).toMatchObject({ type: 'pr', link: 'https://gitlab.test/mr/2' })
  })
})

describe('skills logic', () => {
  it('clamps level into 1..4', () => {
    expect(setLevel({}, 'go', 9)).toEqual({ go: 4 })
    expect(setLevel({ go: 3 }, 'go', 0)).toEqual({ go: 1 })
  })

  it('builds hints only from facts', () => {
    const hints = skillHints(
      [mr(1, { hasTests: false }), mr(2), mr(3, { needsTests: false, hasTests: false })].map(
        (m) => ({ ...m, touchesSql: false }),
      ),
    )
    expect(hints).toContainEqual({ skillId: 'tests', kind: 'missingTests', missing: 1, total: 2 })
    expect(hints).toContainEqual({ skillId: 'sql', kind: 'noSql', total: 3 })
    expect(skillHints([])).toEqual([])
  })

  it('picks the weakest skill, preferring one with a hint on ties', () => {
    const levels = { go: 1, tests: 1, review: 3, sql: 3, infra: 3, comms: 3 }
    const weakest = weakestSkill(BACKEND_COMPETENCIES, levels, [
      { skillId: 'tests', kind: 'missingTests', missing: 2, total: 3 },
    ])
    expect(weakest?.id).toBe('tests')
  })

  it('averages levels with default for unknown skills', () => {
    expect(averageLevel(BACKEND_COMPETENCIES, { go: 4 })).toBe(2.3)
    expect(averageLevel([], {})).toBe(0)
  })
})

describe('feedback logic', () => {
  it('expires a request after 7 days without answer', () => {
    expect(effectiveStatus(request('a', { sentAt: '2026-11-05' }), '2026-11-12')).toBe('expired')
    expect(effectiveStatus(request('a', { sentAt: '2026-11-06' }), '2026-11-12')).toBe('sent')
    expect(
      effectiveStatus(request('a', { status: 'answered', sentAt: '2026-10-01' }), '2026-11-12'),
    ).toBe('answered')
  })

  it('allows at most 3 open requests to one person', () => {
    const list = [request('a'), request('b'), request('c', { sentAt: '2026-11-01' }), request('d')]
    expect(canRequest(list, 'ilya', '2026-11-12')).toBe(false)
    expect(canRequest(list.slice(0, 2), 'ilya', '2026-11-12')).toBe(true)
  })

  it('offers reviewer and mentor from own team, without self and duplicates', () => {
    const recipients = recipientsFor(mr(1, { reviewerId: 'ilya' }), EMPLOYEES, 'ilya', 'anya')
    expect(recipients.map((e) => e.id)).toEqual(['ilya'])
    expect(
      recipientsFor(mr(1, { reviewerId: 'nobody' }), EMPLOYEES, 'ilya', 'anya').map((e) => e.id),
    ).toEqual(['ilya'])
  })

  it('validates the draft including the limit', () => {
    const full = [request('a'), request('b'), request('c')]
    const errors = validateFeedbackDraft(
      { toId: 'ilya', artifactUrl: 'нет', artifactTitle: '', question: '' },
      full,
      '2026-11-12',
    )
    expect(errors).toEqual({ toId: 'limit', artifactUrl: 'format', question: 'required' })
  })

  it('builds an action draft with kind feedback', () => {
    const draft = buildFeedbackAction(
      {
        toId: 'oleg',
        artifactUrl: 'https://x.test',
        artifactTitle: 'MR !1',
        question: ' Что улучшить? ',
      },
      'Олег Деплоев',
      'fb-key',
    )
    expect(draft).toMatchObject({ kind: 'feedback', idempotencyKey: 'fb-key', status: 'sent' })
    expect(draft.details[2]).toEqual({ label: 'Вопрос', value: 'Что улучшить?' })
  })

  it('creates a request on top and marks it saved immutably', () => {
    const list = createRequest(
      [],
      { toId: 'oleg', artifactUrl: ' https://x.test ', artifactTitle: '', question: 'Q' },
      { id: 'n', externalId: 'FB-1' },
      '2026-11-12',
    )
    expect(list[0]).toMatchObject({
      id: 'n',
      status: 'sent',
      artifactTitle: 'https://x.test',
      sentAt: '2026-11-12',
    })
    const saved = markSaved(list, 'n')
    expect(saved[0].savedToBrag).toBe(true)
    expect(list[0].savedToBrag).toBe(false)
  })

  it('turns only answered requests into brag items', () => {
    const answered = request('a', { status: 'answered', answer: 'норм', answeredAt: '2026-11-12' })
    expect(answerToBrag(answered, 'Олег')).toEqual({
      type: 'feedback',
      title: 'Олег: «норм»',
      link: 'https://gitlab.test/mr/1',
      date: '2026-11-12',
    })
    expect(answerToBrag(request('b'), 'Олег')).toBeNull()
  })
})

describe('agenda logic', () => {
  const slot = (id: string, start: string): Slot => ({
    id,
    employeeId: 'ilya',
    start,
    minutes: 30,
    bookedBy: 'anya',
    topic: '1:1',
  })

  it('keeps meetings from today on, sorted', () => {
    const slots = [
      slot('b', '2026-11-19T11:00'),
      slot('a', '2026-11-12T14:00'),
      slot('old', '2026-11-06T10:00'),
    ]
    expect(upcomingMeetings(slots, '2026-11-12').map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('suggests blockers, stuck tasks, close deadlines and answered feedback', () => {
    const tasks = [
      task('t1', 'Доступ к k8s', { status: 'blocked', note: '2 дня' }),
      task('t2', 'Окружение', { status: 'in_progress', updatedAt: '2026-11-08' }),
      task('t3', 'Курс по ИБ', {
        status: 'in_progress',
        updatedAt: '2026-11-11',
        due: '2026-11-13',
      }),
      task('t4', 'Готово', { status: 'done', due: '2026-11-12' }),
    ]
    const points = suggestAgenda(
      tasks,
      [request('f', { status: 'answered', answer: 'добавь кейсы' })],
      '2026-11-12',
    )
    expect(points.map((p) => p.id)).toEqual(['blocked:t1', 'stuck:t2', 'due:t3', 'feedback:f'])
    expect(points[0].text).toBe('Блокер: Доступ к k8s (2 дня)')
  })

  it('merges saved points first and does not bring back removed ones', () => {
    const suggested = [
      { id: 'x', text: 'X', source: 'blocked', isOn: true } as const,
      { id: 'y', text: 'Y', source: 'due', isOn: false } as const,
    ]
    const saved = removePoint(mergeAgenda(undefined, suggested), 'x')
    const merged = mergeAgenda(saved, [
      ...suggested,
      { id: 'z', text: 'Z', source: 'stuck', isOn: true },
    ])
    expect(visiblePoints(merged).map((p) => p.id)).toEqual(['y', 'z'])
  })

  it('adds, toggles and renders chosen points as text', () => {
    const base = addPoint([], '  Как подготовиться к экватору ', 'm1')
    const points = togglePoint(addPoint(base, 'Лишнее', 'm2'), 'm2')
    expect(addPoint(points, '   ', 'm3')).toHaveLength(2)
    expect(agendaToText(points, 'чт, 12.11 в 14:00')).toBe(
      'Повестка на 1:1 (чт, 12.11 в 14:00):\n1. Как подготовиться к экватору',
    )
    expect(agendaToText([], 'x')).toBe('')
  })
})
