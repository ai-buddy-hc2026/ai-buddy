import { describe, expect, it } from 'vitest'
import { ALL_FEATURES_ON, featuresSchema } from './features'

describe('featuresSchema', () => {
  it('принимает ответ GET /features', () => {
    const body = { chat: false, absences: true, escalations: true, kb_publish: false }
    expect(featuresSchema.parse(body)).toEqual(body)
  })

  it('отклоняет ответ без флага', () => {
    expect(featuresSchema.safeParse({ chat: true }).success).toBe(false)
  })

  it('по умолчанию все сценарии включены', () => {
    expect(Object.values(ALL_FEATURES_ON).every(Boolean)).toBe(true)
  })
})
