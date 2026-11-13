import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { getEmployee } from '@/entities/employees'
import { useSettings } from '@/entities/settings'
import { Avatar, BuddyAvatar, ErrorState, IconButton, Skeleton } from '@/shared/ui'
import { plural, useT } from '@/shared/lib/i18n'
import { Bubble, ChatHeader, Composer, useAutoScroll } from './ChatParts'
import { DEMO_NIGHT, planDelivery } from './delivery'
import { DeliveryStatus, OffHoursHint } from './DeliveryStatus'
import { newMessage, useThread, type Message } from './model'
import type { ThreadInfo } from './threads'
import s from './Chat.module.css'

type Props = {
  thread: Exclude<ThreadInfo, { kind: 'bot' }>
  initialDraft?: string
  onBack: () => void
}

const MOCK_REPLY_MS = 1400
const MOCK_REPLY = 'Принял, отвечу чуть позже'

/**
 * Личка с коллегой или группа стажёров. Свои сообщения сохраняются в localStorage.
 * В личке вне рабочих часов получателя сообщение ждёт начала его окна (идея 43).
 */
export function PeerChat({ thread, initialDraft, onBack }: Props) {
  const t = useT()
  const navigate = useNavigate()
  const chat = useThread(thread.id)
  const [draft, setDraft] = useState(initialDraft ?? '')
  const { listRef } = useAutoScroll(chat.messages.length)
  const isNight = useSettings((st) => st.simulateNight)
  const [openedAt] = useState(() => new Date())
  // «Сейчас» для подсказки: ночь из dev-панели или момент открытия чата
  const hintNow = isNight ? DEMO_NIGHT : openedAt
  const hintPlan =
    thread.kind === 'direct' ? planDelivery(hintNow, thread.employee.workHours) : null

  const isGroup = thread.kind === 'group'
  const title = isGroup ? t('Стажёры', 'Interns') : thread.employee.name
  const subtitle = isGroup
    ? t(
        `${thread.members.length} ${plural(thread.members.length, ['участник', 'участника', 'участников'])}, только стажёры`,
        `${thread.members.length} members, interns only`,
      )
    : `${thread.employee.role} · ${thread.employee.online ? t('в сети', 'online') : t('не в сети', 'offline')}`

  const replyLater = () => {
    if (thread.kind !== 'direct' || !thread.employee.online) return
    const authorId = thread.employee.id
    window.setTimeout(
      () => chat.append([newMessage({ from: 'peer', authorId, text: MOCK_REPLY })]),
      MOCK_REPLY_MS,
    )
  }

  const send = (text: string) => {
    const now = isNight ? DEMO_NIGHT : new Date()
    const plan = thread.kind === 'direct' ? planDelivery(now, thread.employee.workHours) : null
    if (plan?.kind === 'scheduled') {
      chat.append([
        newMessage({
          from: 'me',
          authorId: null,
          text,
          at: now.toISOString(),
          delivery: { status: 'scheduled', deliverAt: plan.deliverAt },
        }),
      ])
      return
    }
    chat.append([newMessage({ from: 'me', authorId: null, text })])
    replyLater()
  }

  const sendNow = (message: Message) => {
    if (!message.delivery) return
    chat.update(message.id, { delivery: { ...message.delivery, status: 'sent' } })
    replyLater()
  }

  const deskId = thread.kind === 'direct' ? thread.employee.deskId : null

  return (
    <div className={s.chat}>
      <ChatHeader
        avatar={
          isGroup ? (
            <Avatar name={title} color="green" isSquare size={40} />
          ) : (
            <Avatar
              name={thread.employee.name}
              color={thread.employee.color}
              isSquare
              isOnline={thread.employee.online}
              size={40}
            />
          )
        }
        title={title}
        subtitle={subtitle}
        onBack={onBack}
        actions={
          deskId && (
            <IconButton
              icon="route"
              label={t('Как дойти до места', 'Route to desk')}
              onClick={() => void navigate({ to: '/map', search: { to: deskId } })}
            />
          )
        }
      />

      {chat.isLoading ? (
        <div className={s.loading}>
          <Skeleton height={48} width="55%" />
          <Skeleton height={40} width="35%" />
        </div>
      ) : chat.isError ? (
        <ErrorState
          text={t('Не получилось загрузить чат', 'Could not load the chat')}
          onRetry={chat.refetch}
          retryLabel={t('Повторить', 'Retry')}
        />
      ) : (
        <ol
          ref={listRef}
          className={`${s.list} scroll-area`}
          role="log"
          aria-live="polite"
          aria-label={title}
        >
          {chat.messages.length === 0 && (
            <li className={s.hero} aria-live="off">
              <p className="t-muted">
                {t('Сообщений пока нет. Напиши первым', 'No messages yet. Say hi')}
              </p>
            </li>
          )}
          {chat.messages.map((m) => {
            const author = m.authorId ? getEmployee(m.authorId) : undefined
            const side = m.from === 'me' ? 'me' : m.from === 'bot' ? 'bot' : 'peer'
            return (
              <Bubble
                key={m.id}
                side={side}
                at={m.at}
                text={m.text}
                author={isGroup && author ? author.name : undefined}
                avatar={
                  m.from === 'bot' ? (
                    <BuddyAvatar size={32} />
                  ) : author ? (
                    <Avatar name={author.name} color={author.color} size={32} />
                  ) : null
                }
              >
                {m.delivery?.status === 'scheduled' && (
                  <DeliveryStatus
                    deliverAt={m.delivery.deliverAt}
                    sentAt={m.at}
                    onSendNow={() => sendNow(m)}
                  />
                )}
              </Bubble>
            )
          })}
        </ol>
      )}

      <div className={s.footer}>
        {hintPlan?.kind === 'scheduled' && thread.kind === 'direct' && (
          <OffHoursHint
            name={thread.employee.short}
            deliverAt={hintPlan.deliverAt}
            sentAt={hintNow.toISOString()}
          />
        )}
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={send}
          placeholder={t('Сообщение', 'Message')}
        />
      </div>
    </div>
  )
}
