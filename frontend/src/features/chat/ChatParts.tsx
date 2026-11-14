import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { IconButton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatTime } from '@/shared/lib/date'
import { useT } from '@/shared/lib/i18n'
import s from './Chat.module.css'

/* ---------- Шапка диалога ---------- */

type HeaderProps = {
  avatar: ReactNode
  title: string
  subtitle: ReactNode
  onBack: () => void
  actions?: ReactNode
}

export function ChatHeader({ avatar, title, subtitle, onBack, actions }: HeaderProps) {
  const t = useT()
  return (
    <header className={s.header}>
      <IconButton
        icon="arrowLeft"
        label={t('К списку чатов', 'Back to chats')}
        className={s.back}
        onClick={onBack}
      />
      {avatar}
      <div className={s.headerText}>
        <h2 className={s.headerTitle}>{title}</h2>
        <p className={s.headerSub}>{subtitle}</p>
      </div>
      {actions && <div className={s.headerActions}>{actions}</div>}
    </header>
  )
}

/* ---------- Поле ввода ---------- */

type ComposerProps = {
  value: string
  onChange: (value: string) => void
  onSend: (text: string) => void
  placeholder: string
  isDisabled?: boolean
}

export function Composer({
  value,
  onChange,
  onSend,
  placeholder,
  isDisabled = false,
}: ComposerProps) {
  const t = useT()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const canSend = value.trim().length > 0 && !isDisabled

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (!canSend) return
    onSend(value.trim())
    onChange('')
    inputRef.current?.focus()
  }

  const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form className={s.composer} onSubmit={submit}>
      <label className="visually-hidden" htmlFor="chat-input">
        {t('Сообщение', 'Message')}
      </label>
      <textarea
        id="chat-input"
        ref={inputRef}
        rows={1}
        className={s.input}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKey}
        maxLength={1000}
      />
      <IconButton
        type="submit"
        icon="send"
        variant="accent"
        isRound
        label={t('Отправить', 'Send')}
        disabled={!canSend}
        className={s.send}
      />
    </form>
  )
}

/* ---------- Пузыри ---------- */

type BubbleProps = {
  side: 'me' | 'bot' | 'peer'
  text: ReactNode
  at: string
  avatar?: ReactNode
  author?: string
  children?: ReactNode
}

export function Bubble({ side, text, at, avatar, author, children }: BubbleProps) {
  return (
    <li className={cn(s.msg, s[`msg-${side}`])}>
      {side !== 'me' && <span className={s.msgAvatar}>{avatar}</span>}
      <div className={s.msgBody}>
        {author && <span className={s.author}>{author}</span>}
        <div className={cn(s.bubble, s[`bubble-${side}`])}>{text}</div>
        {children}
        <time className={s.time} dateTime={at}>
          {formatTime(at)}
        </time>
      </div>
    </li>
  )
}

export function TypingDots() {
  const t = useT()
  return (
    <span className={s.dots} role="status" aria-label={t('buddy печатает', 'buddy is typing')}>
      <i />
      <i />
      <i />
    </span>
  )
}

/** Прокрутка ленты вниз при новых сообщениях и по ходу «стрима». */
export function useAutoScroll(trigger: string | number) {
  const listRef = useRef<HTMLOListElement>(null)
  const scrollDown = useCallback(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])
  useEffect(scrollDown, [trigger, scrollDown])
  return { listRef, scrollDown }
}

/* ---------- Имитация стрима ---------- */

const THINK_MS = 550
const STEP_MS = 45
const WORDS_PER_STEP = 2

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  )
}

type StreamProps = {
  text: string
  isActive: boolean
  onDone: () => void
  onProgress: () => void
}

/**
 * Ответ печатается по словам. Пока идёт «стрим», частичный текст скрыт от экранного диктора,
 * целиком он появляется в aria-live ленте один раз, когда допечатан.
 */
export function StreamText({ text, isActive, onDone, onProgress }: StreamProps) {
  const tokens = useMemo(() => text.split(/(\s+)/), [text])
  const [isInstant] = useState(prefersReducedMotion)
  const [shown, setShown] = useState(isActive && !isInstant ? -1 : tokens.length)
  const handleDone = useEffectEvent(() => onDone())
  const handleProgress = useEffectEvent(() => onProgress())

  useEffect(() => {
    if (!isActive) return
    if (isInstant) {
      handleDone()
      return
    }
    let count = 0
    let interval: number | undefined
    const start = window.setTimeout(() => {
      interval = window.setInterval(() => {
        count += WORDS_PER_STEP * 2
        setShown(count)
        handleProgress()
        if (count >= tokens.length) {
          window.clearInterval(interval)
          handleDone()
        }
      }, STEP_MS)
    }, THINK_MS)
    return () => {
      window.clearTimeout(start)
      window.clearInterval(interval)
    }
  }, [isActive, isInstant, tokens.length])

  if (!isActive || shown >= tokens.length) return <>{text}</>
  if (shown < 0) return <TypingDots />
  return <span aria-hidden>{tokens.slice(0, shown).join('')}</span>
}
