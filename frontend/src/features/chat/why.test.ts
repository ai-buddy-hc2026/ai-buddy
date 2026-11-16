import { describe, expect, it } from 'vitest'
import type { Action } from '@/entities/actions'
import type { BotMeta, Message } from './model'
import { explain } from './why'

function bot(meta?: BotMeta): Message {
  return { id: 'b1', from: 'bot', authorId: null, text: 'Ответ', at: '2026-11-12T10:00:00', meta }
}

const SOURCE = {
  docId: 'kb-code-review',
  title: 'Гайд по code review',
  reviewedAt: '2026-10-12',
  ownerName: 'Илья Наставников',
  isStale: false,
}

describe('explain', () => {
  it('returns nothing for messages without data and for errors', () => {
    expect(explain(bot())).toBeNull()
    expect(explain(bot({ kind: 'error', question: 'q', message: 'm' }))).toBeNull()
    expect(explain({ ...bot({ kind: 'denied' }), from: 'me' })).toBeNull()
  })

  it('shows the knowledge base source with high confidence', () => {
    // Act
    const why = explain(bot({ kind: 'kb', source: SOURCE }))

    // Assert
    expect(why).toEqual({
      sources: [{ title: 'Гайд по code review', detail: 'Илья Наставников', isStale: false }],
      tools: [{ kind: 'mock', id: 'kb' }],
      confidence: 'high',
      action: 'none',
    })
  })

  it('lowers confidence for a stale document', () => {
    const why = explain(bot({ kind: 'kb', source: { ...SOURCE, isStale: true } }))

    expect(why?.confidence).toBe('medium')
  })

  it('gives low confidence and a confirm note when nothing was found', () => {
    const why = explain(
      bot({ kind: 'notFound', question: 'Бюджет?', status: 'idle', deliverAt: null }),
    )

    expect(why?.confidence).toBe('low')
    expect(why?.action).toBe('confirm')
    expect(why?.sources).toEqual([])
  })

  it('marks an absence draft as waiting for confirmation until it is sent', () => {
    const draft: BotMeta = {
      kind: 'absenceDraft',
      date: '2026-11-13',
      type: 'unpaid',
      idempotencyKey: 'k',
      status: 'draft',
      externalId: null,
      actionStatus: null,
    }

    expect(explain(bot(draft))?.action).toBe('confirm')
    expect(explain(bot({ ...draft, status: 'sent' }))?.action).toBe('done')
  })

  it('uses sources and tool_call names from the real API without inventing confidence', () => {
    const action = { id: 'a1', status: 'draft' } as Action
    const why = explain(
      bot({
        kind: 'remote',
        sources: [{ docId: 'd1', revision: 2, title: 'Отгулы', section: 'Порядок', url: '/kb/1' }],
        actions: [action],
        tools: ['absences.create_request'],
      }),
    )

    expect(why).toEqual({
      sources: [{ title: 'Отгулы', detail: 'Порядок', isStale: false }],
      tools: [{ kind: 'remote', name: 'absences.create_request' }],
      confidence: null,
      action: 'confirm',
    })
  })

  it('handles remote answers without tools and actions', () => {
    const why = explain(bot({ kind: 'remote', sources: [], actions: [] }))

    expect(why?.tools).toEqual([])
    expect(why?.action).toBe('none')
  })
})
