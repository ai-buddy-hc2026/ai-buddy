import type { Escalation } from '@/entities/escalations'
import type { Task } from '@/entities/plan'
import {
  escalationQuestion,
  guideQuestion,
  hasOpenEscalation,
  isSnoozed,
  isStuckWorkdays,
  readSnoozes,
  snoozeTask,
  stuckPrompts,
  workdaysSince,
  writeSnoozes,
} from './snooze'

const base: Task = {
  id: 't7',
  title: 'Настроить локальное окружение',
  stage: 1,
  status: 'in_progress',
  due: null,
  note: '',
  owner: 'intern',
  source: 'checklist',
  updatedAt: '2026-11-09',
}
const task = (patch: Partial<Task>): Task => ({ ...base, ...patch })
const TODAY = '2026-11-12'

describe('workdaysSince', () => {
  it('считает рабочие дни после даты, без выходных', () => {
    expect(workdaysSince('2026-11-09', TODAY)).toBe(3)
    // пт -> чт: пн, вт, ср, чт
    expect(workdaysSince('2026-11-06', TODAY)).toBe(4)
    expect(workdaysSince(TODAY, TODAY)).toBe(0)
  })
})

describe('isStuckWorkdays', () => {
  it('зависшая - только в работе и 3+ рабочих дня', () => {
    expect(isStuckWorkdays(task({}), TODAY)).toBe(true)
    expect(isStuckWorkdays(task({ updatedAt: '2026-11-10' }), TODAY)).toBe(false)
    expect(isStuckWorkdays(task({ status: 'todo' }), TODAY)).toBe(false)
  })

  it('выходные не считаются: пт -> пн это один день', () => {
    expect(isStuckWorkdays(task({ updatedAt: '2026-11-13' }), '2026-11-16')).toBe(false)
  })
})

describe('snoozeTask', () => {
  it('откладывает вопрос на 3 дня и не мутирует исходное', () => {
    // Arrange
    const before = {}
    // Act
    const after = snoozeTask(before, 't7', TODAY)
    // Assert
    expect(after).toEqual({ t7: '2026-11-15' })
    expect(before).toEqual({})
    expect(isSnoozed(after, 't7', TODAY)).toBe(true)
    expect(isSnoozed(after, 't7', '2026-11-15')).toBe(false)
  })

  it('сохраняется в localStorage и переживает битые данные', () => {
    writeSnoozes({ t7: '2026-11-15' })
    expect(readSnoozes()).toEqual({ t7: '2026-11-15' })
    localStorage.setItem('buddy.plan.stuckSnooze', '[1,2]')
    expect(readSnoozes()).toEqual({})
  })
})

describe('stuckPrompts', () => {
  it('берёт свои зависшие задачи без отложенных, самые старые первыми', () => {
    // Arrange
    const tasks = [
      task({ id: 'a', updatedAt: '2026-11-09' }),
      task({ id: 'b', updatedAt: '2026-11-05' }),
      task({ id: 'mentor', owner: 'mentor' }),
      task({ id: 'snoozed' }),
      task({ id: 'fresh', updatedAt: '2026-11-11' }),
    ]
    // Act
    const prompts = stuckPrompts(tasks, { snoozed: '2026-11-15' }, TODAY)
    // Assert
    expect(prompts.map((p) => [p.task.id, p.days])).toEqual([
      ['b', 5],
      ['a', 3],
    ])
  })
})

describe('тексты', () => {
  it('собирает запрос к гайду и вопрос наставнику', () => {
    expect(guideQuestion(base)).toBe('Подскажи по гайду: Настроить локальное окружение')
    expect(escalationQuestion(base, 3)).toContain('«Настроить локальное окружение»')
    expect(escalationQuestion(base, 3)).toContain('3 раб. дн.')
  })

  it('видит уже переданный и неотвеченный вопрос по задаче', () => {
    const open = { question: escalationQuestion(base, 3), status: 'open' } as Escalation
    const answered = { ...open, status: 'answered' } as Escalation
    expect(hasOpenEscalation([open], base)).toBe(true)
    expect(hasOpenEscalation([answered], base)).toBe(false)
  })
})
