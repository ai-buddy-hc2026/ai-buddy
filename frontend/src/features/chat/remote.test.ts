import { chatHistorySchema, streamEventSchema } from '@/entities/contract'
import { ACTION_ID, REQUEST_ID, apiAction } from '@/entities/fixtures.test-data'
import type { Message } from './model'
import { applyStreamEvent, EMPTY_REMOTE_META, historyToMessages } from './remote'

const source = { document_id: 'd1', revision: 2, title: 'Отгулы', section: 'Порядок', url: '/kb/1' }

function event(seq: number, name: string, data: unknown) {
  return streamEventSchema.parse({ event: name, request_id: REQUEST_ID, seq, data })
}

const empty: Message = {
  id: 'bot',
  from: 'bot',
  authorId: null,
  text: '',
  at: '2026-11-12T10:00:00Z',
  meta: EMPTY_REMOTE_META,
}

describe('chat history adapter', () => {
  test('ход с ответом, источником и действием; ошибочный ход с кнопкой повтора', () => {
    const history = chatHistorySchema.parse({
      conversation_id: 'c1',
      next_cursor: null,
      active_request: null,
      items: [
        {
          request: {
            request_id: REQUEST_ID,
            status: 'done',
            created_at: '2026-11-12T10:00:00Z',
            finished_at: '2026-11-12T10:00:05Z',
            error: null,
            stream_url: `/chat/stream/${REQUEST_ID}`,
          },
          messages: [
            { id: 'u1', role: 'user', content: 'Хочу отгул', sources: null, created_at: 'x' },
            {
              id: 'a1',
              role: 'assistant',
              content: 'Черновик',
              sources: [source],
              created_at: 'y',
            },
          ],
          actions: [apiAction()],
        },
        {
          request: {
            request_id: 'r2',
            status: 'error',
            created_at: '2026-11-12T11:00:00Z',
            finished_at: null,
            error: { code: 'LLM_UNAVAILABLE', message: 'Ассистент временно недоступен' },
            stream_url: '/chat/stream/r2',
          },
          messages: [{ id: 'u2', role: 'user', content: 'Привет', sources: [], created_at: 'z' }],
          actions: null,
        },
      ],
    })

    const messages = historyToMessages(history)

    expect(messages.map((m) => `${m.from}:${m.text}`)).toEqual([
      'me:Хочу отгул',
      'bot:Черновик',
      'me:Привет',
      'bot:',
    ])
    const reply = messages[1].meta
    expect(reply?.kind).toBe('remote')
    if (reply?.kind !== 'remote') return
    expect(reply.sources).toEqual([
      { docId: 'd1', revision: 2, title: 'Отгулы', section: 'Порядок', url: '/kb/1' },
    ])
    expect(reply.actions[0]).toMatchObject({ id: ACTION_ID, status: 'draft', kind: 'absence' })
    expect(messages[3].meta).toEqual({
      kind: 'error',
      question: 'Привет',
      message: 'Ассистент временно недоступен',
    })
  })
})

describe('stream reducer', () => {
  test('токены копятся, done заменяет текст и добавляет источники', () => {
    const steps = [
      event(1, 'token', { text: 'При' }),
      event(2, 'token', { text: 'вет' }),
      event(3, 'done', { full_text: 'Привет!', sources: [source] }),
    ]
    const partial = applyStreamEvent(applyStreamEvent(empty, steps[0], 'q'), steps[1], 'q')
    expect(partial.text).toBe('Привет')
    const done = applyStreamEvent(partial, steps[2], 'q')
    expect(done.text).toBe('Привет!')
    expect(done.meta?.kind === 'remote' && done.meta.sources).toHaveLength(1)
    expect(empty.text).toBe('')
  })

  test('action_proposal добавляет черновик один раз', () => {
    const proposal = event(2, 'action_proposal', {
      action_id: ACTION_ID,
      action_type: 'absences.create_request',
      status: 'proposed',
      details: { date: '2026-11-20', type: 'day_off' },
    })
    const once = applyStreamEvent(empty, proposal, 'q')
    const twice = applyStreamEvent(once, proposal, 'q')
    expect(twice.meta?.kind === 'remote' && twice.meta.actions).toHaveLength(1)
  })

  test('error убирает частичный текст и сохраняет вопрос для повтора', () => {
    const partial = applyStreamEvent(empty, event(1, 'token', { text: 'Част' }), 'Вопрос')
    const failed = applyStreamEvent(
      partial,
      event(2, 'error', { code: 'LLM_UNAVAILABLE', message: 'Ассистент временно недоступен' }),
      'Вопрос',
    )
    expect(failed.text).toBe('')
    expect(failed.meta).toEqual({
      kind: 'error',
      question: 'Вопрос',
      message: 'Ассистент временно недоступен',
    })
  })
})
