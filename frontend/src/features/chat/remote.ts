import { toAction, toKnowledgeSource, toProposedAction } from '@/entities/adapters'
import type { ApiChatTurn, ChatHistory, StreamEvent } from '@/entities/contract'
import type { BotMeta, Message } from './model'

/**
 * Адаптер чата Go API -> лента фронта. Чистые функции, покрыты remote.test.ts.
 * История (GET /chat/messages) и события SSE превращаются в те же Message, что и у мок-бота.
 */
type RemoteMeta = Extract<BotMeta, { kind: 'remote' }>

export const EMPTY_REMOTE_META: RemoteMeta = { kind: 'remote', sources: [], actions: [] }

function remoteMeta(message: Message): RemoteMeta {
  return message.meta?.kind === 'remote' ? message.meta : EMPTY_REMOTE_META
}

export function turnToMessages(turn: ApiChatTurn): Message[] {
  const user = turn.messages.find((m) => m.role === 'user')
  const assistant = turn.messages.find((m) => m.role === 'assistant')
  const actions = turn.actions.map(toAction)
  const botId = `${turn.request.request_id}:bot`
  const result: Message[] = user
    ? [{ id: user.id, from: 'me', authorId: null, text: user.content, at: user.created_at }]
    : []

  if (assistant || actions.length > 0) {
    return [
      ...result,
      {
        id: assistant?.id ?? botId,
        from: 'bot',
        authorId: null,
        text: assistant?.content ?? '',
        at: assistant?.created_at ?? turn.request.created_at,
        meta: {
          kind: 'remote',
          sources: (assistant?.sources ?? []).map(toKnowledgeSource),
          actions,
        },
      },
    ]
  }
  if (turn.request.status === 'error') {
    return [
      ...result,
      {
        id: botId,
        from: 'bot',
        authorId: null,
        text: '',
        at: turn.request.finished_at ?? turn.request.created_at,
        meta: {
          kind: 'error',
          question: user?.content ?? '',
          message: turn.request.error?.message ?? '',
        },
      },
    ]
  }
  return result
}

export function historyToMessages(history: ChatHistory): Message[] {
  return history.items.flatMap(turnToMessages)
}

export function toErrorMessage(message: Message, question: string, text: string): Message {
  // Частичный ответ при ошибке не сохраняется сервером, поэтому и в ленте его не оставляем
  return { ...message, text: '', meta: { kind: 'error', question, message: text } }
}

/** Применяет одно событие SSE к ответу ассистента, не мутируя сообщение. */
export function applyStreamEvent(message: Message, event: StreamEvent, question: string): Message {
  const meta = remoteMeta(message)
  switch (event.event) {
    case 'token':
      return { ...message, text: message.text + event.data.text, meta }
    case 'tool_call': {
      const tools = meta.tools ?? []
      if (tools.includes(event.data.tool_name)) return message
      return { ...message, meta: { ...meta, tools: [...tools, event.data.tool_name] } }
    }
    case 'action_proposal': {
      if (meta.actions.some((a) => a.id === event.data.action_id)) return message
      const action = toProposedAction(
        event.data.action_id,
        event.data.action_type,
        event.data.details,
        message.at,
      )
      return { ...message, meta: { ...meta, actions: [...meta.actions, action] } }
    }
    case 'done':
      // full_text заменяет частичный текст из token
      return {
        ...message,
        text: event.data.full_text,
        meta: { ...meta, sources: event.data.sources.map(toKnowledgeSource) },
      }
    case 'error':
      return toErrorMessage(message, question, event.data.message)
  }
}
