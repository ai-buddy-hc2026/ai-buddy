import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { remoteNotifications, useNotifications, type Notification } from '@/entities/notifications'
import { formatCalendarTime } from '@/entities/remote-calendar'
import { useSession } from '@/entities/session'
import { useSettings } from '@/entities/settings'
import { errorMessage } from '@/shared/api/http'
import { useT } from '@/shared/lib/i18n'
import { Badge, Button, Dialog, EmptyState, ErrorState, Skeleton } from '@/shared/ui'
import s from './notifications.module.css'

function NotificationResource({ id, userId }: { id: string; userId: string }) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const client = useQueryClient()
  const resource = useQuery({
    queryKey: ['notification-resource', userId, id],
    queryFn: ({ signal }) => remoteNotifications.resource(id, signal),
    retry: false,
  })
  const {
    mutate,
    error: readError,
    isPending,
  } = useMutation({
    mutationFn: () => remoteNotifications.read(userId, id),
    onSuccess: () => {
      if (useSession.getState().remote?.id === userId)
        void client.invalidateQueries({ queryKey: ['notifications', userId] })
    },
  })
  useEffect(() => {
    if (resource.data) mutate()
  }, [resource.data, mutate])
  if (resource.isPending) return <Skeleton height={180} />
  if (resource.isError)
    return (
      <ErrorState text={errorMessage(resource.error)} onRetry={() => void resource.refetch()} />
    )
  const value = resource.data
  return (
    <div className={s.detail}>
      {value.type === 'booking' ? (
        <>
          <h3>
            {t('Встреча', 'Meeting')}: {value.booking.topic}
          </h3>
          <p>
            {value.booking.host_name} · {value.booking.attendee_name}
          </p>
          <p>
            {formatCalendarTime(value.booking.starts_at, value.booking.timezone, lang)} ·{' '}
            {value.booking.timezone}
          </p>
          <Badge>{t('Подтверждено', 'Confirmed')}</Badge>
          <p className={s.identifier}>ID: {value.booking.id}</p>
        </>
      ) : (
        <>
          <h3>{t('Ответ наставника', 'Mentor answer')}</h3>
          <p className="t-muted">{value.answer.question}</p>
          <p className={s.answer}>{value.answer.answer_text}</p>
        </>
      )}
      {readError && (
        <div role="alert">
          <p>
            {t('Не удалось отметить прочитанным', 'Could not mark as read')}:{' '}
            {errorMessage(readError)}
          </p>
          <Button disabled={isPending} onClick={() => mutate()}>
            {t('Повторить', 'Retry')}
          </Button>
        </div>
      )}
    </div>
  )
}

export function NotificationsBell() {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const userId = useSession((state) => state.remote?.id)
  const feed = useNotifications()
  const [opened, setOpened] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const close = useCallback(() => {
    setOpened(null)
    setSelected(null)
  }, [])
  const unread = feed.data?.pages[0]?.unread_count ?? 0
  const title = (item: Notification) =>
    item.kind === 'booking_confirmed'
      ? t('Бронь подтверждена', 'Booking confirmed')
      : item.kind === 'meeting_reminder'
        ? t('Скоро встреча', 'Meeting soon')
        : t('Наставник ответил', 'Mentor replied')
  return (
    <>
      <Button
        icon="bell"
        variant="ghost"
        aria-label={
          unread
            ? t(`Уведомления: ${unread} непрочитанных`, `Notifications: ${unread} unread`)
            : t('Уведомления', 'Notifications')
        }
        onClick={() => {
          if (userId) {
            setSelected(null)
            setOpened(userId)
            void feed.refetch()
          }
        }}
      >
        {unread > 0 && <span className={s.count}>{unread > 99 ? '99+' : unread}</span>}
      </Button>
      {userId && opened === userId && (
        <Dialog
          isOpen
          onClose={close}
          title={t('Уведомления', 'Notifications')}
          footer={
            selected ? (
              <Button icon="arrowLeft" onClick={() => setSelected(null)}>
                {t('К списку', 'Back to list')}
              </Button>
            ) : undefined
          }
        >
          {selected ? (
            <NotificationResource key={`${userId}:${selected}`} id={selected} userId={userId} />
          ) : feed.isPending ? (
            <Skeleton height={160} />
          ) : feed.isError ? (
            <ErrorState text={errorMessage(feed.error)} onRetry={() => void feed.refetch()} />
          ) : (
            <>
              {feed.data.pages.every((page) => page.items.length === 0) && (
                <EmptyState title={t('Уведомлений пока нет', 'No notifications yet')} />
              )}
              <ul className={s.list}>
                {feed.data.pages
                  .flatMap((page) => page.items)
                  .map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={s.item}
                        onClick={() => setSelected(item.id)}
                        data-testid={`notification-${item.id}`}
                      >
                        <span className={s.itemTitle}>
                          {title(item)}
                          {!item.read_at && <Badge>{t('Новое', 'New')}</Badge>}
                        </span>
                        <span className="t-s t-muted">
                          {item.starts_at && item.timezone
                            ? `${item.person_name ?? ''} · ${formatCalendarTime(item.starts_at, item.timezone, lang)}`
                            : item.question_preview}
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
              {feed.hasNextPage && (
                <Button
                  isLoading={feed.isFetchingNextPage}
                  onClick={() => void feed.fetchNextPage()}
                >
                  {t('Показать ещё', 'Show more')}
                </Button>
              )}
            </>
          )}
        </Dialog>
      )}
    </>
  )
}
