import { describe, expect, it } from 'vitest'

import {
  ChatMessageSchema,
  OnboardingPlanSchema,
  RoleSchema,
  StageSchema,
  TaskSchema,
  TaskStatusSchema,
  UserSchema,
} from './schemas'

describe('API schemas', () => {
  it('validates roles and rejects unknown values', () => {
    expect(RoleSchema.parse('intern')).toBe('intern')
    expect(RoleSchema.safeParse('admin').success).toBe(false)
  })

  it('validates users and task statuses', () => {
    expect(
      UserSchema.parse({
        id: 'u1',
        login: 'intern',
        name: '???',
        role: 'intern',
        team: 'demo',
      }).role,
    ).toBe('intern')
    expect(TaskStatusSchema.parse('in_progress')).toBe('in_progress')
    expect(TaskStatusSchema.safeParse('blocked').success).toBe(false)
  })

  it('validates tasks, stages, and onboarding plans', () => {
    const task = { id: 't1', title: 'Setup', status: 'todo', deadline: '2026-11-12' }
    expect(TaskSchema.parse(task).id).toBe('t1')
    expect(StageSchema.parse({ id: 's1', title: 'Start', tasks: [task] }).tasks).toHaveLength(1)
    expect(
      OnboardingPlanSchema.parse({
        stages: [{ id: 's1', title: 'Start', tasks: [task] }],
        nextStep: 'Setup',
      }).nextStep,
    ).toBe('Setup')
  })

  it('validates chat messages with optional source', () => {
    expect(
      ChatMessageSchema.parse({ id: 'm1', author: 'assistant', text: 'Ready' }).source,
    ).toBeUndefined()
    expect(
      ChatMessageSchema.parse({ id: 'm2', author: 'assistant', text: 'Ready', source: 'Guide' })
        .source,
    ).toBe('Guide')
    expect(ChatMessageSchema.safeParse({ id: 'm3', author: 'system', text: 'No' }).success).toBe(
      false,
    )
  })
})
