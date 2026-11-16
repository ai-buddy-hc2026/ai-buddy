import { describe, expect, it } from 'vitest'
import {
  DEMO_NIGHT,
  deliveryWhen,
  isoWeekday,
  planDelivery,
  wallClock,
  zonedToUtc,
} from './delivery'

const HOURS = { start: '10:00', end: '19:00' }
const msk = (local: string) => new Date(`${local}+03:00`)

describe('planDelivery', () => {
  it('delivers now inside working hours on a weekday', () => {
    // Arrange: чт 12.11, 15:00 по Москве
    const now = msk('2026-11-12T15:00:00')

    // Act
    const plan = planDelivery(now, HOURS)

    // Assert
    expect(plan).toEqual({ kind: 'now' })
  })

  it('schedules a late-night message for tomorrow 10:00 recipient time', () => {
    const plan = planDelivery(DEMO_NIGHT, HOURS)

    expect(plan).toEqual({
      kind: 'scheduled',
      deliverAt: '2026-11-13T07:00:00.000Z',
      localDate: '2026-11-13',
      localTime: '10:00',
      dayOffset: 1,
    })
  })

  it('schedules an early-morning message for today', () => {
    const plan = planDelivery(msk('2026-11-12T07:30:00'), HOURS)

    expect(plan.kind === 'scheduled' && plan.localDate).toBe('2026-11-12')
    expect(plan.kind === 'scheduled' && plan.dayOffset).toBe(0)
  })

  it('treats the end of the window as off hours', () => {
    const plan = planDelivery(msk('2026-11-12T19:00:00'), HOURS)

    expect(plan.kind).toBe('scheduled')
  })

  it('moves a Friday evening message to Monday', () => {
    const plan = planDelivery(msk('2026-11-13T21:00:00'), HOURS)

    expect(plan.kind === 'scheduled' && plan.localDate).toBe('2026-11-16')
    expect(plan.kind === 'scheduled' && plan.dayOffset).toBe(3)
  })

  it('moves a Saturday daytime message to Monday', () => {
    const plan = planDelivery(msk('2026-11-14T12:00:00'), HOURS)

    expect(plan.kind === 'scheduled' && plan.deliverAt).toBe('2026-11-16T07:00:00.000Z')
  })

  it('respects custom work days of the recipient', () => {
    // Работает только пн, ср
    const plan = planDelivery(msk('2026-11-16T20:00:00'), { ...HOURS, days: [1, 3] })

    expect(plan.kind === 'scheduled' && plan.localDate).toBe('2026-11-18')
  })

  it('uses the recipient time zone, not UTC', () => {
    // 16:30 UTC: в Москве 19:30 (уже вечер), в Лондоне 16:30 (рабочее время)
    const now = new Date('2026-11-12T16:30:00Z')

    expect(planDelivery(now, HOURS, 'Europe/Moscow').kind).toBe('scheduled')
    expect(planDelivery(now, HOURS, 'Europe/London').kind).toBe('now')
  })

  it('does not hold the message when the recipient has no work days', () => {
    expect(planDelivery(DEMO_NIGHT, { ...HOURS, days: [] })).toEqual({ kind: 'now' })
  })
})

describe('time zone helpers', () => {
  it('reads wall clock in Moscow', () => {
    expect(wallClock(DEMO_NIGHT, 'Europe/Moscow')).toEqual({ date: '2026-11-12', time: '23:40' })
  })

  it('converts Moscow wall clock to UTC', () => {
    expect(zonedToUtc('2026-11-13', '10:00', 'Europe/Moscow').toISOString()).toBe(
      '2026-11-13T07:00:00.000Z',
    )
  })

  it('numbers weekdays from Monday = 1 to Sunday = 7', () => {
    expect(isoWeekday('2026-11-16')).toBe(1)
    expect(isoWeekday('2026-11-15')).toBe(7)
  })
})

describe('deliveryWhen', () => {
  it('says tomorrow 10:00 for a message sent at 23:40', () => {
    const when = deliveryWhen('2026-11-13T07:00:00.000Z', DEMO_NIGHT.toISOString())

    expect(when).toEqual({ localDate: '2026-11-13', localTime: '10:00', dayOffset: 1 })
  })

  it('counts days by the recipient calendar, not UTC', () => {
    // 22:30 UTC четверга - это уже 01:30 пятницы в Москве
    const when = deliveryWhen('2026-11-13T07:00:00.000Z', '2026-11-12T22:30:00Z')

    expect(when.dayOffset).toBe(0)
  })
})
