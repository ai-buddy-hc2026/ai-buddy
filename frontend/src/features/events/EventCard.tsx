import { Link } from '@tanstack/react-router'
import { getEmployee } from '@/entities/employees'
import { useSettings } from '@/entities/settings'
import { parseIso } from '@/shared/lib/date'
import { plural, useT } from '@/shared/lib/i18n'
import { Badge, Card, Icon } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import type { EventItem } from './data'
import { KIND_COLOR, kindLabel } from './kinds'
import { eventDay, eventTime, isJoined, seatsLeft } from './logic'
import s from './events.module.css'

const WEEKDAYS = {
  ru: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
} as const

type Props = {
  event: EventItem
  userId: string
  tab?: string
  index: number
}

/** Карточка события в ленте. Вся карточка - ссылка на ?id=. */
export function EventCard({ event, userId, tab, index }: Props) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const date = parseIso(eventDay(event))
  const left = seatsLeft(event)
  const isMine = isJoined(event, userId)
  const host = getEmployee(event.hostId)

  return (
    <Card as="article" pad="s" index={index} className={s.eventCard}>
      <Link to="/events" search={{ id: event.id, ...(tab ? { tab } : {}) }} className={s.eventLink}>
        <span className={cn(s.dateBox, s[`kind-${KIND_COLOR[event.kind]}`])} aria-hidden>
          <b className="t-num">{date.getDate()}</b>
          <span>{WEEKDAYS[lang][date.getDay()]}</span>
        </span>
        <span className={s.eventBody}>
          <span className={s.eventKind}>{kindLabel(event.kind, t)}</span>
          <span className={s.eventTitle}>{event.title}</span>
          <span className={s.eventMeta}>
            <Icon name="clock" size={16} />
            {eventTime(event)}
            <Icon name="pin" size={16} />
            {event.placeName}
            {host && (
              <span className="visually-hidden">{`, ${t('ведёт', 'host')} ${host.name}`}</span>
            )}
          </span>
        </span>
        <span className={s.eventSide}>
          {isMine ? (
            <Badge tone="success" icon="check">
              {t('Ты идёшь', "You're in")}
            </Badge>
          ) : left === 0 ? (
            <Badge tone="error">{t('Мест нет', 'Full')}</Badge>
          ) : left !== null ? (
            <Badge tone={left <= 3 ? 'warning' : 'neutral'}>
              {t(`${left} ${plural(left, ['место', 'места', 'мест'])}`, `${left} left`)}
            </Badge>
          ) : null}
          <Icon name="chevronRight" size={18} className={s.eventArrow} />
        </span>
      </Link>
    </Card>
  )
}
