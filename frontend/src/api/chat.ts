import { useSession } from '../store/session'
import { API_BASE_URL } from '../config'
import { mockUser } from './mocks'
import { chatErrorMessage } from './chat-errors'

type ChatSource = { title: string; url: string }
type ChatEvent = { event: string; data: Record<string, unknown> }
export type ChatProposal = {
  actionId: string
  actionType: string
  details: Record<string, unknown>
}

export type ChatAnswer = { text: string; source?: string; proposal?: ChatProposal }

export class ChatRequestError extends Error {
  readonly code: string

  constructor(code: string) {
    super(chatErrorMessage(code))
    this.name = 'ChatRequestError'
    this.code = code
  }
}

async function responseError(response: Response): Promise<ChatRequestError> {
  let code = response.status === 401 ? 'UNAUTHORIZED' : 'SERVICE_UNAVAILABLE'
  try {
    const body = (await response.json()) as { error?: { code?: string } }
    if (body.error?.code) code = body.error.code
  } catch {
    // Use a safe fallback when a proxy returns a non-JSON response.
  }
  return new ChatRequestError(code)
}

async function getAccessToken(): Promise<string> {
  const session = useSession.getState()
  if (session.token) return session.token

  const response = await fetch(`${API_BASE_URL}/auth/mock-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: mockUser.login }),
  })
  if (!response.ok) throw await responseError(response)

  const result = (await response.json()) as { access_token?: string }
  if (!result.access_token) throw new ChatRequestError('SERVICE_UNAVAILABLE')
  useSession.getState().setToken(result.access_token)
  return result.access_token
}

function parseEvents(body: string): ChatEvent[] {
  return body.split(/\r?\n\r?\n/).flatMap((block) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .join('\n')
    if (!data || data === '[DONE]') return []
    try {
      return [JSON.parse(data) as ChatEvent]
    } catch {
      return []
    }
  })
}

export async function sendChatMessage(message: string): Promise<ChatAnswer> {
  try {
    const token = await getAccessToken()
    const headers = { Authorization: `Bearer ${token}` }
    const acceptedResponse = await fetch(`${API_BASE_URL}/chat/messages`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })
    if (!acceptedResponse.ok) throw await responseError(acceptedResponse)

    const accepted = (await acceptedResponse.json()) as { stream_url?: string }
    if (!accepted.stream_url) throw new ChatRequestError('SERVICE_UNAVAILABLE')
    const streamResponse = await fetch(new URL(accepted.stream_url, API_BASE_URL), { headers })
    if (!streamResponse.ok) throw await responseError(streamResponse)

    let answer = ''
    let sources: ChatSource[] = []
    let proposal: ChatProposal | undefined
    for (const event of parseEvents(await streamResponse.text())) {
      if (event.event === 'token' && typeof event.data.text === 'string') {
        answer += event.data.text
      } else if (event.event === 'done') {
        if (typeof event.data.full_text === 'string') answer = event.data.full_text
        if (Array.isArray(event.data.sources)) {
          sources = event.data.sources.filter(
            (source): source is ChatSource =>
              typeof source === 'object' &&
              source !== null &&
              typeof (source as ChatSource).title === 'string' &&
              typeof (source as ChatSource).url === 'string',
          )
        }
      } else if (event.event === 'action_proposal') {
        const actionId = event.data.action_id
        const actionType = event.data.action_type
        const details = event.data.details
        if (
          typeof actionId === 'string' &&
          typeof actionType === 'string' &&
          typeof details === 'object' &&
          details !== null &&
          !Array.isArray(details)
        ) {
          proposal = { actionId, actionType, details: details as Record<string, unknown> }
        }
      } else if (event.event === 'error') {
        throw new ChatRequestError(
          typeof event.data.code === 'string' ? event.data.code : 'INTERNAL_ERROR',
        )
      }
    }
    if (!answer) throw new ChatRequestError('INTERNAL_ERROR')
    return {
      text: answer,
      source: sources.map((source) => source.title).join(', ') || undefined,
      proposal,
    }
  } catch (error) {
    if (error instanceof ChatRequestError) throw error
    throw new ChatRequestError('SERVICE_UNAVAILABLE')
  }
}

export async function confirmChatProposal(actionId: string): Promise<void> {
  try {
    const token = await getAccessToken()
    const response = await fetch(
      `${API_BASE_URL}/actions/${encodeURIComponent(actionId)}/confirm`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      },
    )
    if (!response.ok) throw await responseError(response)
  } catch (error) {
    if (error instanceof ChatRequestError) throw error
    throw new ChatRequestError('SERVICE_UNAVAILABLE')
  }
}
