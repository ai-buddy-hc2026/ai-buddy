import type { Action } from '@/entities/actions'
import type { Escalation } from '@/entities/escalations'
import {
  BOT_RESOLVED,
  POLICY_DENIED,
  computeMetrics,
  dailySeries,
  isCompletedAction,
  isPolicyDenied,
  niceMax,
} from './logic'

const action = (patch: Partial<Action>): Action => ({
  id: 'a1',
  kind: 'absence',
  title: 'Отсутствие',
  details: [],
  status: 'sent',
  externalId: 'ABS-1042',
  idempotencyKey: 'k1',
  createdAt: '2026-11-12T10:00:00',
  ...patch,
})

const escalation = { id: 'e1' } as Escalation

describe('isPolicyDenied', () => {
  it('узнаёт отказ по детали или по ключу', () => {
    expect(isPolicyDenied(action({ details: [{ label: 'Причина', value: POLICY_DENIED }] }))).toBe(
      true,
    )
    expect(isPolicyDenied(action({ idempotencyKey: `${POLICY_DENIED}-1` }))).toBe(true)
    expect(isPolicyDenied(action({}))).toBe(false)
  })
})

describe('isCompletedAction', () => {
  it('не считает упавшие и отказы выполненными', () => {
    expect(isCompletedAction(action({ status: 'failed' }))).toBe(false)
    expect(isCompletedAction(action({ idempotencyKey: POLICY_DENIED }))).toBe(false)
    expect(isCompletedAction(action({ status: 'scheduled' }))).toBe(true)
  })
})

describe('computeMetrics', () => {
  it('складывает синтетику пилота и живые данные демо', () => {
    // Arrange
    const actions = [
      action({ id: '1' }),
      action({ id: '2', status: 'failed' }),
      action({ id: '3', idempotencyKey: `${POLICY_DENIED}-x`, status: 'failed' }),
      action({ id: '4', kind: 'message', details: [{ label: 'Итог', value: BOT_RESOLVED }] }),
    ]
    const baseline = [{ date: '2026-11-11', asked: 10, selfServed: 8 }]
    // Act
    const metrics = computeMetrics(actions, [escalation], baseline)
    // Assert
    expect(metrics).toEqual({
      questionsTotal: 12,
      closedWithoutMentor: 9,
      selfServeShare: 75,
      actionsDone: 1,
      escalations: 1,
      policyDenied: 1,
    })
  })

  it('даёт нулевую долю без вопросов', () => {
    expect(computeMetrics([], [], []).selfServeShare).toBe(0)
  })
})

describe('dailySeries', () => {
  it('добавляет живые данные к сегодняшнему дню', () => {
    const series = dailySeries(
      [{ date: '2026-11-12', asked: 4, selfServed: 4 }],
      { selfServed: 1, escalated: 2 },
      '2026-11-12',
    )
    expect(series).toEqual([{ date: '2026-11-12', asked: 7, selfServed: 5 }])
  })

  it('создаёт сегодняшний день, если его нет в синтетике', () => {
    const series = dailySeries(
      [{ date: '2026-11-11', asked: 3, selfServed: 2 }],
      { selfServed: 0, escalated: 1 },
      '2026-11-12',
    )
    expect(series.at(-1)).toEqual({ date: '2026-11-12', asked: 1, selfServed: 0 })
  })
})

describe('niceMax', () => {
  it('округляет верх шкалы вверх до шага', () => {
    expect(niceMax(12)).toBe(15)
    expect(niceMax(0)).toBe(5)
  })
})
