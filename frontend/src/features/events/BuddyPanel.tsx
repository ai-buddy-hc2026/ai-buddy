import { Link } from '@tanstack/react-router'
import { useMyBookings } from '@/entities/calendar'
import { usePlan } from '@/entities/plan'
import { canNotifyNow, useSettings } from '@/entities/settings'
import { DEMO_TODAY } from '@/shared/lib/date'
import { useT } from '@/shared/lib/i18n'
import {
  Badge,
  BuddyAvatar,
  Button,
  Card,
  ErrorState,
  Icon,
  Note,
  Skeleton,
  toast,
} from '@/shared/ui'
import { useEvents, useMarkSeen, useRequiredCourses, useSeenNotes } from './data'
import { buildDigest, courseReminders, eventHints, groupNotes, type BuddyNote } from './logic'
import s from './events.module.css'

/** Собирает сообщения buddy из данных. Тумблеры брифинга и подсказок уважаются. */
function useBuddyNotes(userId: string) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const toggles = useSettings((state) => state.toggles)
  const workDays = useSettings((state) => state.workHours.days)
  const plan = usePlan()
  const slots = useMyBookings(userId)
  const events = useEvents()
  const courses = useRequiredCourses()
  const queries = [plan, slots, events, courses]

  const isPending = queries.some((q) => q.isPending)
  const isError = queries.some((q) => q.isError)
  const retry = () => queries.forEach((q) => void q.refetch())
  if (!plan.data || !slots.data || !events.data || !courses.data)
    return { notes: [], isPending, isError, retry }

  const digest = toggles.briefing
    ? buildDigest(
        {
          today: DEMO_TODAY,
          workDays,
          userId,
          slots: slots.data,
          events: events.data,
          courses: courses.data,
          tasks: plan.data.tasks,
        },
        t,
        lang,
      )
    : null
  const notes: BuddyNote[] = [
    ...(digest ? [digest] : []),
    ...courseReminders(courses.data, DEMO_TODAY, t),
    ...(toggles.hints ? eventHints(events.data, userId, DEMO_TODAY, t) : []),
  ]
  return { notes, isPending, isError, retry }
}

function NoteItem({ note, isNew }: { note: BuddyNote; isNew: boolean }) {
  const t = useT()
  return (
    <li className={s.note}>
      <div className={s.noteHead}>
        <span className="t-s t-muted t-num">{note.time}</span>
        {isNew && <Badge tone="accent">{t('Новое', 'New')}</Badge>}
      </div>
      <b className={s.noteTitle}>{note.title}</b>
      {note.lines.length > 0 && (
        <ul className={s.noteLines}>
          {note.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {note.focus && (
        <p className={s.focus}>
          <Icon name="target" size={18} />
          <span>
            {t('Главный шаг', 'Main step')}: <b>{note.focus}</b>
          </span>
        </p>
      )}
      <div className={s.noteLinks}>
        {note.links.map((link) => (
          <Link key={link.label} to={link.to} search={link.search} className={s.inlineLink}>
            {link.label}
          </Link>
        ))}
      </div>
    </li>
  )
}

/** Проактивный buddy в ленте: брифинг, напоминания, подсказки. Тихий режим не шумит. */
export function BuddyPanel({ userId, index }: { userId: string; index: number }) {
  const t = useT()
  const canNotify = useSettings(canNotifyNow)
  const { notes, isPending, isError, retry } = useBuddyNotes(userId)
  const seen = useSeenNotes()
  const markSeen = useMarkSeen()

  if (isError || seen.isError) {
    return (
      <Card index={index} className={s.buddy}>
        <ErrorState
          text={t('Не получилось собрать сводку', 'Could not build the digest')}
          onRetry={() => {
            retry()
            void seen.refetch()
          }}
          retryLabel={t('Повторить', 'Retry')}
        />
      </Card>
    )
  }

  const groups = groupNotes(notes, seen.data ?? [], canNotify)
  const markRead = () =>
    markSeen.mutate(
      groups.fresh.map((n) => n.id),
      {
        onError: () => toast.error(t('Не получилось отметить', 'Could not mark as read')),
      },
    )

  return (
    <Card index={index} className={s.buddy} aria-labelledby="buddy-feed-title">
      <div className={s.buddyHead}>
        <BuddyAvatar size={44} />
        <div>
          <h2 id="buddy-feed-title" className={s.cardTitle}>
            {t('От buddy', 'From buddy')}
          </h2>
          <p className="t-s t-muted">
            {t('Сводка дня и напоминания', 'Daily digest and reminders')}
          </p>
        </div>
      </div>

      {!canNotify && (
        <Note tone="info" icon="dayOff" title={t('Тихий режим', 'Quiet mode')}>
          {t(
            'Сейчас не беспокою. Сообщения ждут в очереди и не помечаются новыми',
            "I'm not disturbing you now. Messages wait in the queue, not marked as new",
          )}
        </Note>
      )}

      {isPending || seen.isPending ? (
        <Skeleton height={180} radius="var(--radius-inner)" />
      ) : (
        <>
          <ul className={s.noteList} aria-live="polite">
            {groups.fresh.map((note) => (
              <NoteItem key={note.id} note={note} isNew />
            ))}
          </ul>
          {groups.fresh.length > 0 && (
            <Button
              variant="secondary"
              size="s"
              icon="checkDouble"
              isLoading={markSeen.isPending}
              onClick={markRead}
            >
              {t('Отметить прочитанным', 'Mark as read')}
            </Button>
          )}
          {groups.fresh.length === 0 && groups.quiet.length === 0 && (
            <p className="t-s t-muted">{t('Новых сообщений нет', 'No new messages')}</p>
          )}
          <NoteGroup
            title={t(`В очереди: ${groups.quiet.length}`, `Queued: ${groups.quiet.length}`)}
            notes={groups.quiet}
          />
          <NoteGroup
            title={t(`Прочитанные: ${groups.read.length}`, `Read: ${groups.read.length}`)}
            notes={groups.read}
          />
        </>
      )}
    </Card>
  )
}

function NoteGroup({ title, notes }: { title: string; notes: BuddyNote[] }) {
  if (notes.length === 0) return null
  return (
    <details className={s.noteGroup}>
      <summary>{title}</summary>
      <ul className={s.noteList}>
        {notes.map((note) => (
          <NoteItem key={note.id} note={note} isNew={false} />
        ))}
      </ul>
    </details>
  )
}
