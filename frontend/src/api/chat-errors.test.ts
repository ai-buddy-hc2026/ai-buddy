import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendChatMessage } from './chat'
import { chatErrorMessage } from './chat-errors'
import { useSession } from '../store/session'

afterEach(() => {
  vi.unstubAllGlobals()
  useSession.getState().setToken(null)
})

describe('chatErrorMessage', () => {
  it.each([
    ['LLM_TIMEOUT', 'Ответ задерживается. Попробуйте отправить вопрос ещё раз.'],
    ['LLM_UNAVAILABLE', 'Ассистент сейчас недоступен. Попробуйте позже.'],
    ['TOOL_FAILED', 'Не удалось получить данные для ответа. Попробуйте позже.'],
  ])('maps %s to a clear message', (code, message) => {
    expect(chatErrorMessage(code)).toBe(message)
  })

  it('does not expose unknown backend details', () => {
    expect(chatErrorMessage('PRIVATE_PROVIDER_ERROR')).toBe(
      'Не удалось получить ответ. Попробуйте ещё раз.',
    )
  })

  it('turns an LLM stream error into a safe UI message', async () => {
    useSession.getState().setToken('synthetic-token')
    const fetchMock = vi.fn()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ stream_url: '/chat/stream/synthetic-id' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          'data: {"event":"error","data":{"code":"LLM_TIMEOUT","message":"private detail"}}\n\n',
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendChatMessage('Synthetic question')).rejects.toMatchObject({
      code: 'LLM_TIMEOUT',
      message: 'Ответ задерживается. Попробуйте отправить вопрос ещё раз.',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns an action proposal without confirming it automatically', async () => {
    useSession.getState().setToken('synthetic-token')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ stream_url: '/chat/stream/synthetic-id' }), {
          status: 202,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          [
            'data: {"event":"action_proposal","data":{"action_id":"synthetic-action","action_type":"absences.create_request","details":{"date":"2030-01-01"}}}',
            '',
            'data: {"event":"done","data":{"full_text":"Предложение подготовлено","sources":[]}}',
            '',
          ].join('\n'),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    const answer = await sendChatMessage('Prepare a leave request')
    expect(answer.proposal).toEqual({
      actionId: 'synthetic-action',
      actionType: 'absences.create_request',
      details: { date: '2030-01-01' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const { confirmChatProposal } = await import('./chat')
    await confirmChatProposal('synthetic-action')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'POST' })
  })
})
