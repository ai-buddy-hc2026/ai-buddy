import { Link } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { formatSlot, useMyBookings, useOfficeHours, type Slot } from '@/entities/calendar'
import { getEmployee, mustEmployee, type Employee } from '@/entities/employees'
import { useUser } from '@/entities/session'
import { useSettings } from '@/entities/settings'
import { IsoArt } from '@/shared/iso'
import { useT } from '@/shared/lib/i18n'
import {
  Avatar,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  Icon,
  Note,
  Row,
  Skeleton,
} from '@/shared/ui'
import { BookDialog } from './BookDialog'
import { OFFICE_HOURS_HOSTS } from './data'
import { sortSlots } from './logic'
import s from './people.module.css'

const SKELETON_SLOTS = 3

function SlotList({ host, onPick }: { host: Employee; onPick: (slot: Slot) => void }) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const slots = useOfficeHours(host.id)

  if (slots.isPending) {
    return (
      <div className={s.slots}>
        {Array.from({ length: SKELETON_SLOTS }, (_, i) => (
          <Skeleton key={i} height={64} radius="var(--radius-inner)" />
        ))}
      </div>
    )
  }
  if (slots.isError) {
    return (
      <ErrorState
        text={t('Календарь не ответил', 'Calendar did not respond')}
        onRetry={() => void slots.refetch()}
        retryLabel={t('Повторить', 'Retry')}
      />
    )
  }
  if (slots.data.length === 0) {
    return (
      <EmptyState
        art={<IsoArt name="calendar" />}
        title={t(`У ${host.short} нет свободных слотов`, `${host.short} has no free slots`)}
        text={t('Напиши в чат, договоритесь о времени', 'Write in chat to agree on a time')}
      />
    )
  }
  return (
    <ul className={s.slots} aria-label={t('Свободные слоты', 'Free slots')}>
      {sortSlots(slots.data).map((slot) => (
        <li key={slot.id}>
          <button type="button" className={s.slotBtn} onClick={() => onPick(slot)}>
            <Icon name="clock" size={20} />
            <span>
              <b>{formatSlot(slot.start, lang)}</b>
              <span className="t-s t-muted">
                {slot.minutes} {t('мин', 'min')}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function MyMeetings({ attendeeId }: { attendeeId: string }) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const mine = useMyBookings(attendeeId)

  return (
    <Card className={s.meetings} index={1} aria-labelledby="people-meetings">
      <h2 id="people-meetings" className={s.cardTitle}>
        {t('Мои встречи', 'My meetings')}
      </h2>
      {mine.isPending && <Skeleton height={56} />}
      {mine.isError && (
        <ErrorState
          text={t('Не загрузились встречи', 'Could not load meetings')}
          onRetry={() => void mine.refetch()}
          retryLabel={t('Повторить', 'Retry')}
        />
      )}
      {mine.data?.length === 0 && (
        <p className="t-s t-muted">
          {t('Пока ни одной. Выбери слот слева', 'None yet. Pick a slot')}
        </p>
      )}
      {mine.data && mine.data.length > 0 && (
        <ul className={s.meetList} aria-live="polite">
          {sortSlots(mine.data).map((slot) => {
            const host = getEmployee(slot.employeeId)
            return (
              <li key={slot.id}>
                <Row
                  leading={host && <Avatar name={host.name} color={host.color} size={36} />}
                  title={formatSlot(slot.start, lang)}
                  subtitle={`${host?.name ?? slot.employeeId} · ${slot.topic}`}
                  trailing={
                    host && (
                      <Link
                        to="/chats"
                        search={{ c: host.id }}
                        className={s.iconLink}
                        aria-label={t(`Написать ${host.short}`, `Message ${host.short}`)}
                      >
                        <Icon name="chat" size={20} />
                      </Link>
                    )
                  }
                />
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/** Вкладка «Приёмные часы»: слоты наставника, лида и HR BP, бронь в один клик с подтверждением. */
export function HoursTab() {
  const t = useT()
  const user = useUser()
  const hosts = OFFICE_HOURS_HOSTS.filter((id) => id !== user.employee.id).map(mustEmployee)
  const [hostId, setHostId] = useState(hosts[0]?.id ?? '')
  const [picked, setPicked] = useState<Slot | null>(null)
  const host = hosts.find((h) => h.id === hostId) ?? hosts[0]
  // Стабильная ссылка: Dialog перезапускает эффект фокуса при смене onClose
  const closeDialog = useCallback(() => setPicked(null), [setPicked])

  if (!host) {
    return (
      <EmptyState
        art={<IsoArt name="calendar" />}
        title={t('Приёмных часов пока нет', 'No office hours yet')}
      />
    )
  }

  return (
    <div className={s.grid}>
      <Card className={s.hours} index={0} aria-labelledby="people-hours">
        <div className={s.cardHead}>
          <div>
            <h2 id="people-hours" className={s.bigTitle}>
              {t('Приёмные часы', 'Office hours')}
            </h2>
            <p className="t-s t-muted">
              {t(
                'Выбери человека и слот. Запишу после подтверждения',
                'Pick a person and a slot. I book after you confirm',
              )}
            </p>
          </div>
          <IsoArt name="calendar" className={s.headArt} />
        </div>
        <ChipRow isWrap role="group" aria-label={t('С кем встреча', 'Meet with')}>
          {hosts.map((h) => (
            <Chip key={h.id} isSelected={h.id === host.id} onClick={() => setHostId(h.id)}>
              {h.short} · {h.role}
            </Chip>
          ))}
        </ChipRow>
        <SlotList host={host} onPick={setPicked} />
        <Note tone="info" icon="lock">
          {t(
            'Видны только приёмные слоты, а не весь календарь человека',
            'You see only office-hour slots, not the whole calendar',
          )}
        </Note>
      </Card>
      <MyMeetings attendeeId={user.employee.id} />
      {picked && (
        <BookDialog
          key={picked.id}
          slot={picked}
          host={mustEmployee(picked.employeeId)}
          attendeeId={user.employee.id}
          onClose={closeDialog}
        />
      )}
    </div>
  )
}
