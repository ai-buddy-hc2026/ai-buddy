import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useColleagues } from '@/entities/colleagues'
import {
  clearCalendarDraft,
  formatCalendarTime,
  prepareCalendarDraft,
  readCalendarDraft,
  remoteCalendar,
  useCalendarBookings,
  useCalendarSlots,
  type CalendarBooking,
  type CalendarDraft,
  type CalendarSlot,
} from '@/entities/remote-calendar'
import { useSession } from '@/entities/session'
import { useSettings } from '@/entities/settings'
import { ApiError, errorMessage } from '@/shared/api/http'
import { IsoArt } from '@/shared/iso'
import { useT } from '@/shared/lib/i18n'
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  Dialog,
  EmptyState,
  ErrorState,
  Icon,
  Input,
  Note,
  Row,
  Skeleton,
} from '@/shared/ui'
import s from './people.module.css'

export function CalendarBookings({ className }: { className?: string }) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const userId = useSession((state) => state.remote?.id)
  const bookings = useCalendarBookings()
  return (
    <Card className={className ?? s.meetings}>
      <h2 className={s.cardTitle}>{t('Мои встречи', 'My meetings')}</h2>
      {bookings.isPending ? (
        <Skeleton height={100} />
      ) : bookings.isError ? (
        <ErrorState text={errorMessage(bookings.error)} onRetry={() => void bookings.refetch()} />
      ) : bookings.data.items.length === 0 ? (
        <p className="t-s t-muted">
          {t('В ближайшие 14 дней встреч нет', 'No meetings in the next 14 days')}
        </p>
      ) : (
        <ul className={s.meetList}>
          {bookings.data.items.map((booking) => (
            <li key={booking.id}>
              <Row
                leading={
                  <Avatar
                    name={
                      booking.employee_id === userId ? booking.attendee_name : booking.host_name
                    }
                    size={36}
                  />
                }
                title={formatCalendarTime(booking.starts_at, booking.timezone, lang)}
                subtitle={`${booking.employee_id === userId ? booking.attendee_name : booking.host_name} · ${booking.topic}`}
              />
              <p className="t-s t-muted">{booking.timezone}</p>
              <p className="t-s" style={{ overflowWrap: 'anywhere' }}>
                ID: {booking.id}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function CalendarConfirmation({
  slot,
  userId,
  onClose,
}: {
  slot: CalendarSlot
  userId: string
  onClose: () => void
}) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const client = useQueryClient()
  const [draft, setDraft] = useState(() => readCalendarDraft(userId, slot.id))
  const [topic, setTopic] = useState(draft?.topic ?? '1:1')
  const [result, setResult] = useState<CalendarBooking | null>(null)
  const [localError, setLocalError] = useState('')
  const book = useMutation({
    mutationFn: (input: CalendarDraft) => remoteCalendar.book(userId, input),
    retry: false,
    onSuccess: (booking) => {
      clearCalendarDraft(userId, slot.id)
      setResult(booking)
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'SLOT_UNAVAILABLE') {
        clearCalendarDraft(userId, slot.id)
        setDraft(null)
      }
    },
    onSettled: () => client.invalidateQueries({ queryKey: ['calendar', userId] }),
  })
  const confirm = () => {
    try {
      const saved = prepareCalendarDraft(userId, slot.id, topic)
      setDraft(saved)
      setLocalError('')
      book.mutate(saved)
    } catch (error) {
      setLocalError(errorMessage(error))
    }
  }
  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={result ? t('Записано', 'Booked') : t('Подтвердить запись', 'Confirm booking')}
      footer={
        result ? (
          <Button onClick={onClose}>{t('Готово', 'Done')}</Button>
        ) : (
          <>
            <Button
              onClick={confirm}
              isLoading={book.isPending}
              disabled={
                !topic.trim() || (book.error instanceof ApiError && book.error.status === 409)
              }
            >
              {book.isError || draft
                ? t('Повторить подтверждение', 'Retry confirmation')
                : t('Записаться', 'Book')}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t('Закрыть', 'Close')}
            </Button>
          </>
        )
      }
    >
      <div className={s.dialogBody}>
        <p>
          <b>{slot.host_name}</b>
        </p>
        <p>
          {formatCalendarTime(slot.starts_at, slot.timezone, lang)} · {slot.timezone}
        </p>
        {result ? (
          <Note tone="success" title={t('Бронь сохранена', 'Booking saved')}>
            <p>
              {t(
                'Встреча сохранена в календаре и отображается в «Моих встречах»',
                'The meeting is saved in the calendar and shown in My meetings',
              )}
            </p>
            <p style={{ overflowWrap: 'anywhere' }}>ID: {result.id}</p>
            <Badge>{t('Подтверждено', 'Confirmed')}</Badge>
          </Note>
        ) : (
          <>
            <Input
              label={t('Тема встречи', 'Meeting topic')}
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              maxLength={500}
              disabled={book.isPending || !!draft}
            />
            <p className="t-s t-muted">
              {t(
                'Бронь создаётся только после нажатия «Записаться»',
                'The booking is created only after you press Book',
              )}
            </p>
            {draft && !book.isPending && !book.isError && (
              <Note>
                {t(
                  'Сохранено предыдущее подтверждение. Повтор использует тот же запрос',
                  'A previous confirmation was saved. Retry uses the same request',
                )}
              </Note>
            )}
            {(book.isError || localError) && (
              <div role="alert">
                <p>{localError || errorMessage(book.error)}</p>
                <p className="t-s">
                  {t(
                    'При обрыве связи проверь «Мои встречи» или повтори подтверждение',
                    'If disconnected, check My meetings or retry the confirmation',
                  )}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}

function RemoteSlotList({
  employeeId,
  onPick,
}: {
  employeeId: string
  onPick: (slot: CalendarSlot) => void
}) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const slots = useCalendarSlots(employeeId)
  if (!employeeId) return null
  if (slots.isPending) return <Skeleton height={160} />
  if (slots.isError)
    return <ErrorState text={errorMessage(slots.error)} onRetry={() => void slots.refetch()} />
  if (slots.data.items.length === 0)
    return (
      <EmptyState
        title={t('Свободных приёмных слотов нет', 'No free office-hour slots')}
        text={t(
          'В ближайшие 14 дней нет общего свободного времени. Выбери другого коллегу',
          'No shared free time in the next 14 days. Choose another colleague',
        )}
      />
    )
  return (
    <ul className={s.slots} aria-label={t('Свободные слоты', 'Free slots')}>
      {slots.data.items.map((slot) => (
        <li key={slot.id}>
          <button type="button" className={s.slotBtn} onClick={() => onPick(slot)}>
            <Icon name="calendar" />
            <span>
              <b>{formatCalendarTime(slot.starts_at, slot.timezone, lang)}</b>
              <span className="t-s t-muted">
                {slot.timezone} ·{' '}
                {Math.round((Date.parse(slot.ends_at) - Date.parse(slot.starts_at)) / 60_000)}{' '}
                {t('мин', 'min')}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function RemoteHoursTab() {
  const t = useT()
  const userId = useSession((state) => state.remote?.id)
  const colleagues = useColleagues('')
  const hosts =
    colleagues.data?.pages
      .flatMap((page) => page.items)
      .filter((employee) => employee.id !== userId) ?? []
  const [hostId, setHostId] = useState('')
  const [picked, setPicked] = useState<CalendarSlot | null>(null)
  const close = useCallback(() => setPicked(null), [])
  const host = hosts.find((employee) => employee.id === hostId) ?? hosts[0]
  return (
    <div className={s.grid}>
      <Card className={s.hours}>
        <div className={s.cardHead}>
          <div>
            <h2 className={s.bigTitle}>{t('Приёмные часы', 'Office hours')}</h2>
            <p className="t-s t-muted">
              {t(
                'Выбери коллегу и время. Запись после подтверждения',
                'Choose a colleague and time. Booking requires confirmation',
              )}
            </p>
          </div>
          <IsoArt name="calendar" className={s.headArt} />
        </div>
        {colleagues.isPending ? (
          <Skeleton height={100} />
        ) : colleagues.isError ? (
          <ErrorState
            text={errorMessage(colleagues.error)}
            onRetry={() => void colleagues.refetch()}
          />
        ) : (
          <>
            {hosts.length === 0 ? (
              <EmptyState
                title={t('Коллеги для встречи пока не добавлены', 'No colleagues available yet')}
              />
            ) : (
              <>
                <ChipRow isWrap role="group" aria-label={t('С кем встреча', 'Meet with')}>
                  {hosts.map((employee) => (
                    <Chip
                      key={employee.id}
                      isSelected={employee.id === host?.id}
                      onClick={() => setHostId(employee.id)}
                    >
                      {employee.short_name} · {employee.job_title}
                    </Chip>
                  ))}
                </ChipRow>
                {host && <RemoteSlotList employeeId={host.id} onPick={setPicked} />}
              </>
            )}
            {colleagues.hasNextPage && (
              <Button
                onClick={() => void colleagues.fetchNextPage()}
                disabled={colleagues.isFetchingNextPage}
              >
                {t('Ещё коллеги', 'More colleagues')}
              </Button>
            )}
          </>
        )}
        <Note tone="info" icon="lock">
          {t(
            'Показаны только приёмные часы. Содержание чужих встреч скрыто',
            'Only office hours are shown. Other meeting details are private',
          )}
        </Note>
      </Card>
      <CalendarBookings />
      {picked && userId && (
        <CalendarConfirmation
          key={`${userId}:${picked.id}`}
          slot={picked}
          userId={userId}
          onClose={close}
        />
      )}
    </div>
  )
}
