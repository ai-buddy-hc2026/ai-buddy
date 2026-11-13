import { useState, type ReactNode } from 'react'
import { Avatar, BuddyAvatar, Icon } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatTime } from '@/shared/lib/date'
import { useT } from '@/shared/lib/i18n'
import { chatApi } from './model'
import { BUDDY_ID, type ThreadInfo } from './threads'
import s from './Chat.module.css'

type Props = {
  threads: readonly ThreadInfo[]
  activeId: string | null
  onSelect: (id: string) => void
}

function threadName(thread: ThreadInfo, groupName: string): string {
  if (thread.kind === 'bot') return 'buddy'
  if (thread.kind === 'group') return groupName
  return thread.employee.name
}

export function ChatList({ threads, activeId, onSelect }: Props) {
  const t = useT()
  const [query, setQuery] = useState('')
  const groupName = t('Стажёры', 'Interns')
  const needle = query.trim().toLowerCase()
  const visible = threads.filter(
    (th) => th.kind !== 'bot' && threadName(th, groupName).toLowerCase().includes(needle),
  )
  const bot = threads.find((th) => th.kind === 'bot')

  return (
    <nav className={s.listNav} aria-label={t('Чаты', 'Chats')}>
      <h1 className={s.listTitle}>{t('Чаты', 'Chats')}</h1>
      <label className={s.search}>
        <Icon name="search" size={18} />
        <span className="visually-hidden">{t('Поиск по чатам', 'Search chats')}</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Поиск', 'Search')}
          type="search"
        />
      </label>

      <ul className={`${s.threads} scroll-area`}>
        {bot && !needle && (
          <li>
            <ThreadButton
              isPinned
              isActive={activeId === BUDDY_ID}
              onClick={() => onSelect(BUDDY_ID)}
              avatar={<BuddyAvatar size={48} />}
              name="buddy"
              preview={
                lastPreview(BUDDY_ID) ??
                t('Спроси что угодно про онбординг', 'Ask anything about onboarding')
              }
              at={lastAt(BUDDY_ID)}
              badge={<Icon name="pinned" size={16} />}
            />
          </li>
        )}
        {visible.map((th) => (
          <li key={th.id}>
            <ThreadButton
              isActive={activeId === th.id}
              onClick={() => onSelect(th.id)}
              avatar={
                th.kind === 'group' ? (
                  <Avatar name={groupName} color="green" isSquare size={48} />
                ) : th.kind === 'direct' ? (
                  <Avatar
                    name={th.employee.name}
                    color={th.employee.color}
                    isSquare
                    isOnline={th.employee.online}
                    size={48}
                  />
                ) : null
              }
              name={threadName(th, groupName)}
              preview={
                lastPreview(th.id) ??
                (th.kind === 'direct' ? th.employee.role : t('Только стажёры', 'Interns only'))
              }
              at={lastAt(th.id)}
            />
          </li>
        ))}
        {visible.length === 0 && needle && (
          <li className={s.noResults}>{t('Никого не нашли', 'Nobody found')}</li>
        )}
      </ul>
    </nav>
  )
}

function lastPreview(threadId: string): string | null {
  const list = chatApi.peek(threadId)
  const last = list[list.length - 1]
  if (!last) return null
  return last.from === 'me' ? `Ты: ${last.text}` : last.text
}

function lastAt(threadId: string): string | null {
  const list = chatApi.peek(threadId)
  return list[list.length - 1]?.at ?? null
}

type ThreadButtonProps = {
  isActive: boolean
  isPinned?: boolean
  onClick: () => void
  avatar: ReactNode
  name: string
  preview: string
  at: string | null
  badge?: ReactNode
}

function ThreadButton({
  isActive,
  isPinned = false,
  onClick,
  avatar,
  name,
  preview,
  at,
  badge,
}: ThreadButtonProps) {
  return (
    <button
      type="button"
      className={cn(s.thread, isPinned && s.pinned, isActive && s.active)}
      aria-current={isActive ? 'page' : undefined}
      onClick={onClick}
    >
      {avatar}
      <span className={s.threadBody}>
        <span className={s.threadTop}>
          <b>{name}</b>
          {at && <time dateTime={at}>{formatTime(at)}</time>}
          {badge}
        </span>
        <span className={s.preview}>{preview}</span>
      </span>
    </button>
  )
}
