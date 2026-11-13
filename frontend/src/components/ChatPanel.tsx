import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import {
  ChatRequestError,
  confirmChatProposal,
  sendChatMessage,
  type ChatProposal,
} from '../api/chat'
import { chatErrorMessage } from '../api/chat-errors'
import { chatHistoryQuery } from '../api/queries'
import type { ChatMessage } from '../api/schemas'

export function ChatPanel() {
  const { data: history = [] } = useQuery(chatHistoryQuery)
  const [draft, setDraft] = useState('')
  const [sent, setSent] = useState<ChatMessage[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [pendingProposal, setPendingProposal] = useState<ChatProposal | null>(null)
  const [confirming, setConfirming] = useState(false)

  const messages = [...history, ...sent]

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    setSent((prev) => [...prev, { id: `local-user-${crypto.randomUUID()}`, author: 'user', text }])
    setDraft('')
    setErrorMessage(null)
    setSending(true)
    try {
      const answer = await sendChatMessage(text)
      if (answer.proposal) setPendingProposal(answer.proposal)
      setSent((prev) => [
        ...prev,
        {
          id: `local-assistant-${crypto.randomUUID()}`,
          author: 'assistant',
          text: answer.text,
          source: answer.source,
        },
      ])
    } catch (error) {
      setErrorMessage(
        error instanceof ChatRequestError ? error.message : chatErrorMessage(undefined),
      )
    } finally {
      setSending(false)
    }
  }

  async function handleConfirmProposal() {
    if (!pendingProposal || confirming) return
    setErrorMessage(null)
    setConfirming(true)
    try {
      await confirmChatProposal(pendingProposal.actionId)
      setPendingProposal(null)
      setSent((prev) => [
        ...prev,
        {
          id: `local-confirmation-${crypto.randomUUID()}`,
          author: 'assistant',
          text: 'Подтверждение отправлено. Дождитесь результата выполнения.',
        },
      ])
    } catch (error) {
      setErrorMessage(
        error instanceof ChatRequestError ? error.message : chatErrorMessage(undefined),
      )
    } finally {
      setConfirming(false)
    }
  }

  return (
    <section className="panel chat" aria-labelledby="chat-title">
      <h2 id="chat-title" className="panel__title">
        Чат с AI-buddy
      </h2>
      <ol className="messages">
        {messages.map((message) => (
          <li key={message.id} className={`message message--${message.author}`}>
            <div className="message__text">{message.text}</div>
            {message.source && <div className="message__source">Источник: {message.source}</div>}
          </li>
        ))}
      </ol>
      {errorMessage && (
        <p className="error" role="alert" aria-live="assertive">
          {errorMessage}
        </p>
      )}
      {pendingProposal && (
        <div className="action-proposal" role="group" aria-label="Подтверждение действия">
          <p>Подготовлено действие: {pendingProposal.actionType}</p>
          <button
            type="button"
            className="composer__button"
            onClick={handleConfirmProposal}
            disabled={confirming}
          >
            {confirming ? 'Отправляю...' : 'Подтвердить действие'}
          </button>
        </div>
      )}
      <form className="composer" onSubmit={handleSubmit}>
        <label htmlFor="chat-input" className="visually-hidden">
          Сообщение
        </label>
        <input
          id="chat-input"
          className="composer__input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Спроси про онбординг"
          autoComplete="off"
        />
        <button type="submit" className="composer__button" disabled={!draft.trim() || sending}>
          {sending ? 'Жду ответ...' : 'Отправить'}
        </button>
      </form>
    </section>
  )
}
