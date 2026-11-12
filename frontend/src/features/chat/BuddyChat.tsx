import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useSettings } from '@/entities/settings'
import { IsoArt } from '@/shared/iso'
import { BuddyAvatar, Chip, ChipRow, ErrorState, IconButton, Skeleton, Switch } from '@/shared/ui'
import { useT } from '@/shared/lib/i18n'
import { BotExtras } from './BotExtras'
import { Bubble, ChatHeader, Composer, StreamText, useAutoScroll } from './ChatParts'
import { useBuddy } from './useBuddy'
import s from './Chat.module.css'

/** Подсказки-чипы: шаги демо из MVP. */
const SUGGESTIONS = [
  'Что мне делать дальше?',
  'Как у нас проходит code review?',
  'Хочу отгул в пятницу',
  'Покажи отпуска Пети из соседней команды',
  'Какой бюджет на конференции?',
]

type Props = {
  initialQuestion?: string
  onBack: () => void
}

export function BuddyChat({ initialQuestion, onBack }: Props) {
  const t = useT()
  const navigate = useNavigate()
  const buddy = useBuddy()
  const [draft, setDraft] = useState('')
  const handledRef = useRef<string | null>(null)
  const { listRef, scrollDown } = useAutoScroll(`${buddy.messages.length}:${buddy.streamingId}`)
  const { ask } = buddy

  // ?q=текст: сразу задаём вопрос один раз и убираем q из адреса
  useEffect(() => {
    if (!initialQuestion || handledRef.current === initialQuestion) return
    handledRef.current = initialQuestion
    ask(initialQuestion)
    void navigate({ to: '/chats', search: { c: 'buddy' }, replace: true })
  }, [initialQuestion, ask, navigate])

  return (
    <div className={s.chat}>
      <ChatHeader
        avatar={<BuddyAvatar size={40} />}
        title="buddy"
        subtitle={t('Отвечает по тестовой базе знаний', 'Answers from the test knowledge base')}
        onBack={onBack}
        actions={<BuddyMenu />}
      />

      {buddy.isLoading ? (
        <div className={s.loading}>
          <Skeleton height={56} width="60%" />
          <Skeleton height={40} width="40%" />
        </div>
      ) : buddy.isError ? (
        <ErrorState
          text={t('Не получилось загрузить чат', 'Could not load the chat')}
          onRetry={buddy.refetch}
          retryLabel={t('Повторить', 'Retry')}
        />
      ) : (
        <ol
          ref={listRef}
          className={`${s.list} scroll-area`}
          role="log"
          aria-live="polite"
          aria-label={t('Переписка с buddy', 'Chat with buddy')}
        >
          {buddy.messages.length === 0 && (
            <li className={s.hero} aria-live="off">
              <IsoArt name="chat" isFloating className={s.heroArt} />
              <h3>{t('Спроси buddy', 'Ask buddy')}</h3>
              <p className="t-muted">
                {t(
                  'Подскажу следующий шаг, найду ответ в базе знаний и помогу оформить отгул. Ничего не отправляю без твоего «Отправить»',
                  'I suggest the next step, search the knowledge base and help with a day off. Nothing is sent without your confirmation',
                )}
              </p>
            </li>
          )}
          {buddy.messages.map((m) => {
            const isStreaming = m.id === buddy.streamingId
            return (
              <Bubble
                key={m.id}
                side={m.from === 'me' ? 'me' : 'bot'}
                avatar={<BuddyAvatar size={32} />}
                at={m.at}
                text={
                  <StreamText
                    text={m.text}
                    isActive={isStreaming}
                    onDone={buddy.finishStream}
                    onProgress={scrollDown}
                  />
                }
              >
                {m.from === 'bot' && !isStreaming && (
                  <BotExtras
                    message={m}
                    messages={buddy.messages}
                    onPatch={(meta) => buddy.patch(m.id, meta)}
                    onChooseAbsence={(date, type) => buddy.chooseAbsence(m, date, type)}
                  />
                )}
              </Bubble>
            )
          })}
        </ol>
      )}

      <div className={s.footer}>
        <ChipRow className={s.suggest} aria-label={t('Примеры вопросов', 'Sample questions')}>
          {SUGGESTIONS.map((q) => (
            <Chip key={q} onClick={() => ask(q)} disabled={buddy.streamingId !== null}>
              {q}
            </Chip>
          ))}
        </ChipRow>
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={ask}
          placeholder={t('Спроси что угодно про онбординг', 'Ask anything about onboarding')}
          isDisabled={buddy.streamingId !== null}
        />
      </div>
    </div>
  )
}

/** Меню «...»: имитация сбоя сервиса (в AppShell такого переключателя нет) и история действий. */
function BuddyMenu() {
  const t = useT()
  const [isOpen, setOpen] = useState(false)
  const simulateFailure = useSettings((st) => st.simulateFailure)
  const setSimulateFailure = useSettings((st) => st.setSimulateFailure)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event instanceof MouseEvent && boxRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [isOpen])

  return (
    <div className={s.menuBox} ref={boxRef}>
      <IconButton
        icon="more"
        label={t('Ещё', 'More')}
        aria-expanded={isOpen}
        onClick={() => setOpen((v) => !v)}
      />
      {isOpen && (
        <div className={s.menu} role="group" aria-label={t('Настройки чата', 'Chat settings')}>
          <div className={s.menuRow}>
            <span>
              <b>{t('Имитировать сбой сервиса', 'Simulate service failure')}</b>
              <span className={s.disclaimer}>
                {t('Следующая отправка вернёт ошибку', 'Next send will fail')}
              </span>
            </span>
            <Switch
              isChecked={simulateFailure}
              onChange={setSimulateFailure}
              label={t('Имитировать сбой сервиса', 'Simulate service failure')}
            />
          </div>
          <Link to="/actions" className={s.menuLink}>
            {t('История действий', 'Action history')}
          </Link>
        </div>
      )}
    </div>
  )
}
