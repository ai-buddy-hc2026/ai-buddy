import type { Message } from './model'

/**
 * «Почему я так ответил» (идея 35): из данных ответа собираем, на что бот опирался.
 * Ничего не придумываем: в моке - из meta ответа, в реальном режиме - из sources и tool_call SSE.
 */
export type Confidence = 'high' | 'medium' | 'low'

/** Инструменты мок-движка; у реального API имя приходит строкой из tool_call. */
export type MockTool = 'plan' | 'kb' | 'mentorAnswers' | 'access' | 'absences' | 'escalation'

/**
 * Что с действиями во внешних сервисах:
 * none - их не было; confirm - есть черновик, уйдёт только по кнопке;
 * denied - отказ по правам; done - уже отправлено после подтверждения.
 */
export type ActionNote = 'none' | 'confirm' | 'denied' | 'done'

export type SourceRef = { title: string; detail: string | null; isStale: boolean }

export type Explanation = {
  sources: SourceRef[]
  tools: Array<{ kind: 'mock'; id: MockTool } | { kind: 'remote'; name: string }>
  confidence: Confidence | null
  action: ActionNote
}

const mock = (id: MockTool) => ({ kind: 'mock' as const, id })

/** Есть ли что объяснить: только у ответов бота с данными, кроме ошибок. */
export function explain(message: Message): Explanation | null {
  const meta = message.meta
  if (message.from !== 'bot' || !meta) return null
  switch (meta.kind) {
    case 'next':
      return { sources: [], tools: [mock('plan')], confidence: 'high', action: 'none' }
    case 'kb':
      return {
        sources: [
          { title: meta.source.title, detail: meta.source.ownerName, isStale: meta.source.isStale },
        ],
        tools: [mock('kb')],
        confidence: meta.source.isStale ? 'medium' : 'high',
        action: 'none',
      }
    case 'mentor':
      return {
        sources: [{ title: meta.question, detail: meta.mentorName, isStale: false }],
        tools: [mock('mentorAnswers')],
        confidence: 'high',
        action: 'none',
      }
    case 'absenceAsk':
      return {
        sources: meta.source
          ? [
              {
                title: meta.source.title,
                detail: meta.source.ownerName,
                isStale: meta.source.isStale,
              },
            ]
          : [],
        tools: [mock('kb')],
        confidence: 'high',
        action: 'confirm',
      }
    case 'absenceDraft':
      return {
        sources: [],
        tools: [mock('absences')],
        confidence: null,
        action: meta.status === 'sent' ? 'done' : 'confirm',
      }
    case 'denied':
      return { sources: [], tools: [mock('access')], confidence: null, action: 'denied' }
    case 'notFound':
      return {
        sources: [],
        tools:
          meta.status === 'sent'
            ? [mock('kb'), mock('mentorAnswers'), mock('escalation')]
            : [mock('kb'), mock('mentorAnswers')],
        confidence: 'low',
        action: meta.status === 'sent' ? 'done' : 'confirm',
      }
    case 'remote':
      return {
        sources: meta.sources.map((s) => ({
          title: s.title,
          detail: s.section || null,
          isStale: false,
        })),
        tools: (meta.tools ?? []).map((name) => ({ kind: 'remote' as const, name })),
        // Уверенность API пока не присылает: не выдумываем её
        confidence: null,
        action: remoteAction(meta.actions.map((a) => a.status)),
      }
    case 'error':
      return null
  }
}

function remoteAction(statuses: readonly string[]): ActionNote {
  if (statuses.length === 0) return 'none'
  return statuses.every((s) => s === 'sent' || s === 'approved') ? 'done' : 'confirm'
}
