import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { chatHistoryQuery } from '../api/queries'
import type { ChatMessage } from '../api/schemas'

export function ChatPanel() {
  const { data: history = [] } = useQuery(chatHistoryQuery)
  const [draft, setDraft] = useState('')
  const [sent, setSent] = useState<ChatMessage[]>([])

  const messages = [...history, ...sent]

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    // Заглушка: сообщение пока только показываем, отправку в API подключим вместе со стримингом.
    setSent((prev) => [...prev, { id: `local-${prev.length}`, author: 'user', text }])
    setDraft('')
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
        <button type="submit" className="composer__button" disabled={!draft.trim()}>
          Отправить
        </button>
      </form>
    </section>
  )
}
