import { describe, expect, it } from 'vitest'
import { formatDuration, formatHours, toDayStats } from './serverMetrics'

describe('serverMetrics', () => {
  it('maps server days to chart rows without negative self-served values', () => {
    const rows = toDayStats([
      { date: '2026-11-15', questions: 3, unknown: 1 },
      { date: '2026-11-16', questions: 0, unknown: 2 },
    ])
    expect(rows).toEqual([
      { date: '2026-11-15', asked: 3, selfServed: 2 },
      { date: '2026-11-16', asked: 0, selfServed: 0 },
    ])
  })

  it('formats saved minutes as hours', () => {
    expect(formatHours(25)).toBe('0,4 ч')
    expect(formatHours(90, 'en')).toBe('1.5 h')
  })

  it('formats action duration', () => {
    expect(formatDuration(0)).toBe('-')
    expect(formatDuration(42.4)).toBe('42 с')
    expect(formatDuration(180)).toBe('3 мин')
  })
})
