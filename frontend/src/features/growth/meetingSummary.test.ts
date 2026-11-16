import { describe, expect, it } from 'vitest'
import { mockSummarize } from '@/entities/meetings'
import { dueFromAi, summaryToDraft } from './meetingSummaryLogic'
import type { Person } from './meetingNotesLogic'

const PEOPLE: Person[] = [
  { short: 'Илья', role: 'mentor' },
  { short: 'Лена', role: 'other' },
]
const TODAY = '2026-11-16'

describe('summaryToDraft', () => {
  it('maps AI action items to agreements with owner and due', () => {
    const draft = summaryToDraft(
      {
        agreements: ['Релиз в пятницу.'],
        action_items: [
          { title: 'Выдать доступ к k8s', owner: 'Илья', due: '2026-11-18' },
          { title: 'Прочитать гайд по тестам', owner: null, due: 'до среды' },
          { title: 'Прислать макет', owner: 'Лена', due: 'когда-нибудь' },
        ],
      },
      PEOPLE,
      TODAY,
    )
    expect(draft?.summary).toBe('Релиз в пятницу')
    expect(draft?.agreements.map((a) => [a.owner, a.due_date])).toEqual([
      ['mentor', '2026-11-18'],
      ['intern', '2026-11-18'],
      ['other', null],
    ])
  })

  it('builds summary from action items when agreements are empty', () => {
    const draft = summaryToDraft(
      { agreements: [], action_items: [{ title: 'Настроить IDE' }] },
      PEOPLE,
      TODAY,
    )
    expect(draft?.summary).toBe('Договорились: Настроить IDE')
  })

  it('returns null when AI found nothing', () => {
    expect(summaryToDraft({ agreements: [], action_items: [] }, PEOPLE, TODAY)).toBeNull()
  })
})

describe('dueFromAi', () => {
  it('keeps ISO date and ignores empty or unknown text', () => {
    expect(dueFromAi('2026-12-01', TODAY)).toBe('2026-12-01')
    expect(dueFromAi(null, TODAY)).toBeNull()
    expect(dueFromAi('скоро', TODAY)).toBeNull()
  })
})

describe('mockSummarize', () => {
  it('splits notes into agreements and action items', () => {
    const result = mockSummarize('Обсудили релиз\n- Подготовить демо\n- Настроить CI')
    expect(result.agreements).toEqual(['Обсудили релиз'])
    expect(result.action_items.map((a) => a.title)).toEqual(['Подготовить демо', 'Настроить CI'])
  })
})
