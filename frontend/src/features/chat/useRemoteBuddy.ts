import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ACTIONS_KEY } from '@/entities/actions'
import { remoteChat } from '@/entities/remote'
import { errorMessage } from '@/shared/api/http'
import { newMessage, type BotMeta, type Message } from './model'
import { applyStreamEvent, EMPTY_REMOTE_META, historyToMessages, toErrorMessage } from './remote'
import type { BuddyApi } from './useBuddy'

const REMOTE_CHAT_KEY = ['chat', 'buddy', 'remote'] as const

/**
 * Чат с buddy через Go API: POST /chat/messages, затем токены по SSE /chat/stream/{id}.
 * Лента живёт в кэше Query; история не перезапрашивается, пока идёт ответ.
 */
export function useRemoteBuddy(): BuddyApi {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: REMOTE_CHAT_KEY,
    queryFn: async () => historyToMessages(await remoteChat.history()),
    staleTime: Infinity,
  })
  const [pendingId, setPendingId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const update = useCallback(
    (fn: (list: Message[]) => Message[]) =>
      client.setQueryData<Message[]>(REMOTE_CHAT_KEY, (prev) => fn(prev ?? [])),
    [client],
  )
  const updateMessage = useCallback(
    (id: string, fn: (message: Message) => Message) =>
      update((list) => list.map((m) => (m.id === id ? fn(m) : m))),
    [update],
  )

  const stream = useCallback(
    async (question: string, botId: string, controller: AbortController) => {
      try {
        const accepted = await remoteChat.send(question)
        for await (const event of remoteChat.events(accepted.request_id, controller.signal)) {
          updateMessage(botId, (m) => applyStreamEvent(m, event, question))
        }
      } catch (cause) {
        if (controller.signal.aborted) return
        updateMessage(botId, (m) => toErrorMessage(m, question, errorMessage(cause)))
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        setPendingId(null)
        // Предложения действий сохраняются в Go: обновляем историю действий
        void client.invalidateQueries({ queryKey: ACTIONS_KEY })
      }
    },
    [client, updateMessage],
  )

  const ask = useCallback(
    (text: string) => {
      const question = text.trim()
      if (!question || abortRef.current || query.isPending || query.isError) return
      const controller = new AbortController()
      abortRef.current = controller
      const userMessage = newMessage({ from: 'me', authorId: null, text: question })
      const botMessage = newMessage({
        from: 'bot',
        authorId: null,
        text: '',
        meta: EMPTY_REMOTE_META,
      })
      update((list) => [...list, userMessage, botMessage])
      setPendingId(botMessage.id)
      void stream(question, botMessage.id, controller)
    },
    [stream, update, query.isPending, query.isError],
  )

  /** Повтор после ошибки: убираем неудачную пару и задаём вопрос заново (новый request_id). */
  const retry = useCallback(
    (messageId: string, question: string) => {
      update((list) => {
        const index = list.findIndex((m) => m.id === messageId)
        const previous = index > 0 ? list[index - 1] : undefined
        const dropUser = previous?.from === 'me' && previous.text === question
        return list.filter((_, i) => i !== index && !(dropUser && i === index - 1))
      })
      ask(question)
    },
    [ask, update],
  )

  const patch = useCallback(
    (messageId: string, meta: BotMeta) => updateMessage(messageId, (m) => ({ ...m, meta })),
    [updateMessage],
  )

  return {
    messages: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
    streamingId: null,
    pendingId,
    finishStream: () => undefined,
    ask,
    retry,
    chooseAbsence: () => undefined,
    patch,
  }
}
