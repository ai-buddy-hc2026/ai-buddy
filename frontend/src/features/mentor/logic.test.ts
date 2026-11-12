import type { Escalation } from '@/entities/escalations'
import type { Task } from '@/entities/plan'
import {
  answeredQuestions,
  isAnswerValid,
  openQuestions,
  resolveInternId,
  tasksNeedingHelp,
} from './logic'

const esc = (patch: Partial<Escalation>): Escalation => ({
  id: 'e1',
  internId: 'anya',
  mentorId: 'ilya',
  question: 'Вопрос',
  context: [],
  tried: '',
  status: 'open',
  deliverAt: null,
  answer: null,
  addedToKb: false,
  createdAt: '2026-11-11T10:00:00',
  answeredAt: null,
  ...patch,
})

const task = (patch: Partial<Task>): Task => ({
  id: 't1',
  title: 'Задача',
  stage: 1,
  status: 'todo',
  due: null,
  note: '',
  owner: 'intern',
  source: 'checklist',
  updatedAt: '2026-11-12',
  ...patch,
})

describe('resolveInternId', () => {
  it('берёт известного сотрудника из URL', () => {
    expect(resolveInternId('anya')).toBe('anya')
  })

  it('возвращает Аню для пустого или неизвестного id', () => {
    expect(resolveInternId(undefined)).toBe('anya')
    expect(resolveInternId('nobody')).toBe('anya')
  })
})

describe('openQuestions и answeredQuestions', () => {
  it('делит вопросы стажёра на открытые и отвеченные', () => {
    // Arrange
    const list = [
      esc({ id: 'late', createdAt: '2026-11-12T10:00:00' }),
      esc({ id: 'early', createdAt: '2026-11-10T10:00:00', status: 'scheduled' }),
      esc({ id: 'done', status: 'answered', answer: 'Ответ' }),
      esc({ id: 'other', internId: 'petya' }),
    ]
    // Act
    const open = openQuestions(list, 'anya')
    const answered = answeredQuestions(list, 'anya')
    // Assert
    expect(open.map((e) => e.id)).toEqual(['early', 'late'])
    expect(answered.map((e) => e.id)).toEqual(['done'])
  })
})

describe('isAnswerValid', () => {
  it('не пускает пустой ответ из пробелов', () => {
    expect(isAnswerValid('   ')).toBe(false)
    expect(isAnswerValid('Скину дамп')).toBe(true)
  })
})

describe('tasksNeedingHelp', () => {
  it('находит заблокированные и зависшие задачи', () => {
    const tasks = [
      task({ id: 'b', status: 'blocked' }),
      task({ id: 's', status: 'in_progress', updatedAt: '2026-11-08' }),
      task({ id: 'ok', status: 'in_progress' }),
    ]
    expect(tasksNeedingHelp(tasks, '2026-11-12').map((t) => t.id)).toEqual(['b', 's'])
  })
})
