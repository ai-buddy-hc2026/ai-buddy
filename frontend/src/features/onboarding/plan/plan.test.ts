import type { Task } from '@/entities/plan'
import {
  attentionList,
  currentStageIndex,
  stageColorVar,
  statusLabel,
  summarizeStages,
  toggleDone,
} from './status'

const base: Task = {
  id: 't1',
  title: 'Задача',
  stage: 0,
  status: 'todo',
  due: null,
  note: '',
  owner: 'intern',
  source: 'checklist',
  updatedAt: '2026-11-12',
}
const task = (patch: Partial<Task>): Task => ({ ...base, ...patch })
const ru = (text: string) => text

describe('summarizeStages', () => {
  it('считает закрытые и все задачи по каждому этапу', () => {
    // Arrange
    const tasks = [
      task({ id: 'a', status: 'done' }),
      task({ id: 'b' }),
      task({ id: 'c', stage: 2, status: 'done' }),
    ]
    // Act
    const stages = summarizeStages(tasks)
    // Assert
    expect(stages.map((s) => [s.done, s.total])).toEqual([
      [1, 2],
      [0, 0],
      [1, 1],
    ])
    expect(stages[1].color).toBe('blue')
  })
})

describe('currentStageIndex', () => {
  it('возвращает первый этап с открытыми задачами', () => {
    const stages = summarizeStages([task({ status: 'done' }), task({ id: 'b', stage: 1 })])
    expect(currentStageIndex(stages)).toBe(1)
  })

  it('возвращает последний этап, когда всё закрыто', () => {
    const stages = summarizeStages([task({ status: 'done' })])
    expect(currentStageIndex(stages)).toBe(2)
  })
})

describe('toggleDone', () => {
  it('закрывает открытую задачу и возвращает закрытую', () => {
    expect(toggleDone('in_progress')).toBe('done')
    expect(toggleDone('done')).toBe('todo')
  })
})

describe('attentionList', () => {
  it('находит заблокированные и зависшие задачи стажёра', () => {
    // Arrange
    const tasks = [
      task({ id: 'blocked', status: 'blocked' }),
      task({ id: 'stuck', status: 'in_progress', updatedAt: '2026-11-09' }),
      task({ id: 'fresh', status: 'in_progress', updatedAt: '2026-11-11' }),
      task({ id: 'mentor', status: 'blocked', owner: 'mentor' }),
    ]
    // Act
    const items = attentionList(tasks, '2026-11-12')
    // Assert
    expect(items.map((i) => [i.task.id, i.reason])).toEqual([
      ['blocked', 'blocked'],
      ['stuck', 'stuck'],
    ])
  })
})

describe('подписи и цвета', () => {
  it('даёт подпись статуса и CSS-переменную этапа', () => {
    expect(statusLabel('blocked', ru)).toBe('Заблокирована')
    expect(stageColorVar('violet')).toBe('var(--brand-violet)')
  })
})
