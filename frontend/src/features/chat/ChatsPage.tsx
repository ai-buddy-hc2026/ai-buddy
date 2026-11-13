import { useNavigate, useSearch } from '@tanstack/react-router'
import { useUser } from '@/entities/session'
import { IsoArt } from '@/shared/iso'
import { EmptyState } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { useT } from '@/shared/lib/i18n'
import { BuddyChat } from './BuddyChat'
import { ChatList } from './ChatList'
import { PeerChat } from './PeerChat'
import { findThread, listThreads } from './threads'
import s from './Chat.module.css'

/**
 * Мессенджер: слева список (бот закреплён), справа переписка.
 * На телефоне список и переписка - отдельные экраны. Контракт: ?c=<chatId>&q=<текст>.
 */
export function ChatsPage() {
  const t = useT()
  const user = useUser()
  const navigate = useNavigate()
  const { c, q } = useSearch({ strict: false })
  const threads = listThreads(user.employee)
  const active = findThread(c, user.employee)

  const open = (id: string) => void navigate({ to: '/chats', search: { c: id } })
  const back = () => void navigate({ to: '/chats', search: {} })

  return (
    <div className={cn(s.layout, active && s.hasActive)}>
      <aside className={s.listPane}>
        <ChatList threads={threads} activeId={active?.id ?? null} onSelect={open} />
      </aside>
      <section className={s.convPane} aria-label={t('Переписка', 'Conversation')}>
        {!active ? (
          <div className={s.emptyPane}>
            <EmptyState
              art={<IsoArt name="chat" isFloating />}
              title={c ? t('Такого чата нет', 'No such chat') : t('Выбери чат', 'Pick a chat')}
              text={t(
                'Начни с buddy: он подскажет следующий шаг и найдёт ответ',
                'Start with buddy: next step and answers',
              )}
            />
          </div>
        ) : active.kind === 'bot' ? (
          <BuddyChat initialQuestion={q} onBack={back} />
        ) : (
          <PeerChat key={active.id} thread={active} initialDraft={q} onBack={back} />
        )}
      </section>
    </div>
  )
}
