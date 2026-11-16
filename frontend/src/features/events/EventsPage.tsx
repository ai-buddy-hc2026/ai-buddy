import { useCallback, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useUser } from '@/entities/session'
import { IsoArt } from '@/shared/iso'
import { DEMO_TODAY } from '@/shared/lib/date'
import { useT } from '@/shared/lib/i18n'
import {
  Card,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  Skeleton,
  Tabs,
  type TabItem,
} from '@/shared/ui'
import { BuddyPanel } from './BuddyPanel'
import { useEvents, type EventItem } from './data'
import { EventCard } from './EventCard'
import { EventDialog } from './EventDialog'
import { EventsArt } from './EventsArt'
import { FEED_FILTERS, filterLabel, toTab, type EventsTab } from './kinds'
import { filterFeed, myEvents, type FeedFilter } from './logic'
import { RequiredCourses } from './RequiredCourses'
import s from './events.module.css'

type ListProps = {
  events: EventItem[]
  userId: string
  tab: EventsTab
  empty: { title: string; text: string }
}

function EventList({ events, userId, tab, empty }: ListProps) {
  if (events.length === 0) {
    return <EmptyState art={<IsoArt name="calendar" />} title={empty.title} text={empty.text} />
  }
  return (
    <ul className={s.list}>
      {events.map((event, i) => (
        <li key={event.id}>
          <EventCard
            event={event}
            userId={userId}
            tab={tab === 'feed' ? undefined : tab}
            index={i}
          />
        </li>
      ))}
    </ul>
  )
}

function FeedTab({ events, userId }: { events: EventItem[]; userId: string }) {
  const t = useT()
  const [filter, setFilter] = useState<FeedFilter>('all')
  return (
    <>
      <ChipRow role="group" aria-label={t('Фильтр событий', 'Event filter')}>
        {FEED_FILTERS.map((item) => (
          <Chip key={item} isSelected={item === filter} onClick={() => setFilter(item)}>
            {filterLabel(item, t)}
          </Chip>
        ))}
      </ChipRow>
      <EventList
        events={filterFeed(events, filter, DEMO_TODAY)}
        userId={userId}
        tab="feed"
        empty={{
          title: t('Тут пока пусто', 'Nothing here yet'),
          text: t('Загляни в другие подборки', 'Try another filter'),
        }}
      />
    </>
  )
}

/** Лента событий (идеи 10, 22, 23, 24). ?id= открывает событие, ?tab= - вкладку. */
export function EventsPage() {
  const t = useT()
  const user = useUser()
  const userId = user.employee.id
  const search = useSearch({ strict: false })
  const navigate = useNavigate()
  const events = useEvents()
  const tab = toTab(search.tab)

  const tabs: ReadonlyArray<TabItem<EventsTab>> = [
    { id: 'feed', label: t('Лента', 'Feed'), icon: 'events' },
    { id: 'learning', label: t('Обучение', 'Learning'), icon: 'book' },
    { id: 'mine', label: t('Мои записи', 'My sign-ups'), icon: 'check' },
  ]
  const setTab = (next: EventsTab) =>
    void navigate({ to: '/events', search: next === 'feed' ? {} : { tab: next } })
  const currentTab = search.tab
  // Стабильная ссылка: Dialog перезапускает эффект фокуса при смене onClose
  const closeEvent = useCallback(
    () => void navigate({ to: '/events', search: currentTab ? { tab: currentTab } : {} }),
    [navigate, currentTab],
  )

  const renderTab = (list: EventItem[]) => {
    if (tab === 'learning') {
      return (
        <>
          <RequiredCourses index={1} />
          <h2 className={s.sectionTitle}>{t('Тренинги с записью', 'Trainings to sign up for')}</h2>
          <EventList
            events={filterFeed(list, 'training', DEMO_TODAY)}
            userId={userId}
            tab={tab}
            empty={{
              title: t('Тренингов пока нет', 'No trainings yet'),
              text: t('Напомню, когда появятся', "I'll let you know"),
            }}
          />
        </>
      )
    }
    if (tab === 'mine') {
      return (
        <EventList
          events={myEvents(list, userId, DEMO_TODAY)}
          userId={userId}
          tab={tab}
          empty={{
            title: t('Ты пока никуда не записан', 'No sign-ups yet'),
            text: t(
              'Выбери что-нибудь в ленте и нажми «Записаться»',
              'Pick something in the feed and sign up',
            ),
          }}
        />
      )
    }
    return <FeedTab events={list} userId={userId} />
  }

  return (
    <div className={s.layout}>
      <section className={s.main} aria-labelledby="events-title">
        <header className={s.head}>
          <div>
            <h1 id="events-title" className={s.title}>
              {t('События', 'Events')}
            </h1>
            <p className="t-muted">
              {t('Тренинги, доклады и встречи по интересам', 'Trainings, talks and hobby meetups')}
            </p>
          </div>
          <EventsArt className={s.headArt} />
        </header>
        <Tabs
          items={tabs}
          value={tab}
          onChange={setTab}
          label={t('Разделы событий', 'Event sections')}
        />
        <div className={`${s.scroller} scroll-area`}>
          {events.isPending && (
            <div className={s.list}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={96} radius="var(--radius-card)" />
              ))}
            </div>
          )}
          {events.isError && (
            <Card>
              <ErrorState
                text={t('Не получилось загрузить события', 'Could not load events')}
                onRetry={() => void events.refetch()}
                retryLabel={t('Повторить', 'Retry')}
              />
            </Card>
          )}
          {events.data && renderTab(events.data)}
        </div>
      </section>
      <aside className={s.side} aria-label={t('Сообщения buddy', 'Buddy messages')}>
        <BuddyPanel userId={userId} index={1} />
      </aside>
      <EventDialog eventId={search.id} events={events.data} userId={userId} onClose={closeEvent} />
    </div>
  )
}
