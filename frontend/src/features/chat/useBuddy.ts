import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ACTIONS_KEY } from '@/entities/actions'
import { escalationsApi } from '@/entities/escalations'
import { planApi } from '@/entities/plan'
import { useUser } from '@/entities/session'
import { DEMO_TODAY, formatShort } from '@/shared/lib/date'
import { newId } from '@/shared/lib/storage'
import { absenceTypeLabel, answer } from './bot'
import {
  newMessage,
  systemLog,
  useThread,
  type AbsenceType,
  type BotMeta,
  type Message,
} from './model'
import { BUDDY_ID } from './threads'

export type BuddyApi = {
  messages: Message[]
  isLoading: boolean
  isError: boolean
  refetch: () => void
  /** id ответа, который сейчас «печатается» */
  streamingId: string | null
  finishStream: () => void
  ask: (text: string) => void
  chooseAbsence: (ask: Message, date: string, type: AbsenceType) => void
  patch: (messageId: string, meta: BotMeta) => void
}

/** Чат с ботом: вопрос -> ответ мок-движка -> запись в ленту, отказы -> журнал policy_denied. */
export function useBuddy(): BuddyApi {
  const thread = useThread(BUDDY_ID)
  const user = useUser()
  const client = useQueryClient()
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const { append, patch } = thread

  const ask = useCallback(
    (text: string) => {
      const question = text.trim()
      if (!question) return
      const reply = answer(question, {
        tasks: planApi.peek().tasks,
        escalations: escalationsApi.peek(),
        self: user.employee,
        today: DEMO_TODAY,
      })
      const meta = reply.meta
      if (meta?.kind === 'denied') systemLog.policyDenied(question)
      if (meta?.kind === 'kb') systemLog.resolvedByBot(question, meta.source.title)
      if (meta?.kind === 'mentor')
        systemLog.resolvedByBot(question, `Ответ наставника: ${meta.mentorName}`)
      if (meta?.kind === 'denied' || meta?.kind === 'kb' || meta?.kind === 'mentor') {
        void client.invalidateQueries({ queryKey: ACTIONS_KEY })
      }
      const botMessage = newMessage({
        from: 'bot',
        authorId: null,
        text: reply.text,
        meta: reply.meta,
      })
      append([newMessage({ from: 'me', authorId: null, text: question }), botMessage])
      setStreamingId(botMessage.id)
    },
    [append, client, user.employee],
  )

  const chooseAbsence = useCallback(
    (askMessage: Message, date: string, type: AbsenceType) => {
      if (askMessage.meta?.kind !== 'absenceAsk') return
      patch(askMessage.id, { ...askMessage.meta, isAnswered: true })
      const draft = newMessage({
        from: 'bot',
        authorId: null,
        text: 'Вот черновик заявки. Проверь и нажми «Отправить» - без этого заявка никуда не уйдёт',
        meta: {
          kind: 'absenceDraft',
          date,
          type,
          idempotencyKey: newId('abs'),
          status: 'draft',
          externalId: null,
          actionStatus: null,
        },
      })
      append([
        newMessage({
          from: 'me',
          authorId: null,
          text: `${absenceTypeLabel(type)}, ${formatShort(date)}`,
        }),
        draft,
      ])
      setStreamingId(draft.id)
    },
    [append, patch],
  )

  return {
    messages: thread.messages,
    isLoading: thread.isLoading,
    isError: thread.isError,
    refetch: thread.refetch,
    streamingId,
    finishStream: () => setStreamingId(null),
    ask,
    chooseAbsence,
    patch,
  }
}
