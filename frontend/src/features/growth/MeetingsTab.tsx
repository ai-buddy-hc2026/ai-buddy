import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { formatSlot, useMyBookings, type Slot } from '@/entities/calendar'
import { getEmployee } from '@/entities/employees'
import { usePlan, type Task } from '@/entities/plan'
import { useUser } from '@/entities/session'
import { useSettings } from '@/entities/settings'
import { IsoArt } from '@/shared/iso'
import { useT, type Translate } from '@/shared/lib/i18n'
import { newId } from '@/shared/lib/storage'
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  IconButton,
  Row,
  Skeleton,
  Tag,
  toast,
  Avatar,
} from '@/shared/ui'
import {
  addPoint,
  agendaToText,
  mergeAgenda,
  POINT_MAX,
  removePoint,
  suggestAgenda,
  togglePoint,
  upcomingMeetings,
  pastMeetings,
  visiblePoints,
  type AgendaPoint,
  type AgendaSource,
} from './agendaLogic'
import { useAgendas, useFeedbackRequests, useSaveAgenda } from './data'
import type { FeedbackRequest } from './feedbackLogic'
import s from './growth.module.css'

function sourceLabel(source: AgendaSource, t: Translate): string {
  const labels: Record<AgendaSource, string> = {
    blocked: t('блокер', 'blocker'),
    stuck: t('зависла', 'stuck'),
    due: t('срок', 'due'),
    feedback: t('отзыв', 'feedback'),
    manual: t('своё', 'own'),
  }
  return labels[source]
}

type EditorProps = {
  slot: Slot
  saved: AgendaPoint[] | undefined
  tasks: readonly Task[]
  requests: readonly FeedbackRequest[]
}

/** Подготовка повестки: подсказки из плана и отзывов, свои пункты, черновик в чат наставнику. */
function AgendaEditor({ slot, saved, tasks, requests }: EditorProps) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const navigate = useNavigate()
  const saveAgenda = useSaveAgenda()
  const [points, setPoints] = useState(() => mergeAgenda(saved, suggestAgenda(tasks, requests)))
  const [draft, setDraft] = useState('')
  const host = getEmployee(slot.employeeId)
  const label = formatSlot(slot.start, lang)
  const shown = visiblePoints(points)
  const text = agendaToText(points, formatSlot(slot.start, 'ru'))

  const handleAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPoints(addPoint(points, draft, newId('pt')))
    setDraft('')
  }

  const save = (then?: () => void) =>
    saveAgenda.mutate(
      { slotId: slot.id, points },
      {
        onSuccess: () => (then ? then() : toast(t('Повестка сохранена', 'Agenda saved'))),
        onError: () =>
          toast.error(t('Не получилось сохранить повестку', 'Could not save the agenda')),
      },
    )

  const sendToChat = () =>
    save(() => void navigate({ to: '/chats', search: { c: slot.employeeId, q: text } }))

  return (
    <Card className={s.main} index={1}>
      <div className={s.cardHead}>
        <div>
          <h2 className={s.cardTitle}>{t('Повестка', 'Agenda')}</h2>
          <p className="t-s t-muted">
            1:1 · {host?.name ?? slot.employeeId} · {label}
          </p>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="t-s t-muted">
          {t(
            'Блокеров нет. Добавь, что хочешь обсудить',
            'No blockers. Add what you want to discuss',
          )}
        </p>
      ) : (
        <ul className={s.agenda}>
          {shown.map((point) => (
            <li key={point.id} className={s.point} data-on={point.isOn}>
              <Checkbox
                isChecked={point.isOn}
                label={point.text}
                onChange={() => setPoints(togglePoint(points, point.id))}
              />
              <span className={s.pointText}>{point.text}</span>
              <Tag className={s.pointTag}>{sourceLabel(point.source, t)}</Tag>
              <IconButton
                icon="close"
                size="s"
                label={t('Убрать пункт', 'Remove item')}
                onClick={() => setPoints(removePoint(points, point.id))}
              />
            </li>
          ))}
        </ul>
      )}
      <form className={s.addRow} onSubmit={handleAdd}>
        <input
          className={s.addInput}
          value={draft}
          maxLength={POINT_MAX}
          placeholder={t(
            'Свой пункт, например: как готовиться к экватору',
            'Your item, e.g. how to prepare for the midpoint',
          )}
          aria-label={t('Новый пункт повестки', 'New agenda item')}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" icon="plus" disabled={!draft.trim()}>
          {t('Добавить', 'Add')}
        </Button>
      </form>
      <div className={s.actions}>
        <Button
          variant="primary"
          icon="send"
          disabled={!text}
          isLoading={saveAgenda.isPending}
          onClick={sendToChat}
        >
          {t('Черновик в чат', 'Draft to chat')}
        </Button>
        <Button variant="ghost" disabled={saveAgenda.isPending} onClick={() => save()}>
          {t('Сохранить', 'Save')}
        </Button>
      </div>
      <p className="t-s t-muted">
        {t(
          'Откроется чат с наставником, текст будет в поле ввода. Отправишь сама',
          'Opens the chat with your mentor with the text in the input. You send it yourself',
        )}
      </p>
    </Card>
  )
}

function MeetingRow({
  slot,
  isActive,
  onSelect,
}: {
  slot: Slot
  isActive: boolean
  onSelect: () => void
}) {
  const lang = useSettings((state) => state.lang)
  const host = getEmployee(slot.employeeId)
  return (
    <li>
      <Row
        className={isActive ? s.activeRow : undefined}
        onClick={onSelect}
        leading={<Avatar name={host?.name ?? slot.employeeId} color={host?.color} size={40} />}
        title={`${slot.topic || '1:1'} · ${host?.short ?? slot.employeeId}`}
        subtitle={formatSlot(slot.start, lang)}
      />
    </li>
  )
}

/** Встречи 1:1 из мока календаря и подготовка к ним. */
export function MeetingsTab() {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const user = useUser()
  const bookings = useMyBookings(user.employee.id)
  const plan = usePlan()
  const requests = useFeedbackRequests()
  const agendas = useAgendas()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const queries = [bookings, plan, requests, agendas]

  if (queries.some((q) => q.isError)) {
    const retry = () => queries.forEach((q) => void q.refetch())
    return (
      <ErrorState
        text={t('Не получилось загрузить встречи', 'Could not load meetings')}
        onRetry={retry}
      />
    )
  }
  if (queries.some((q) => q.isPending)) return <Skeleton height={360} radius="var(--radius-card)" />

  const upcoming = upcomingMeetings(bookings.data ?? [])
  const past = pastMeetings(bookings.data ?? [])
  const selected = upcoming.find((slot) => slot.id === selectedId) ?? upcoming[0]

  if (!selected) {
    return (
      <Card index={0}>
        <EmptyState
          art={<IsoArt name="calendar" isFloating />}
          title={t('Встреч пока нет', 'No meetings yet')}
          text={t(
            'Запишись на приёмные часы наставника или руководителя',
            'Book office hours with your mentor or lead',
          )}
          action={
            <Link to="/people" search={{ tab: 'hours' }} className={s.link}>
              {t('Приёмные часы', 'Office hours')}
            </Link>
          }
        />
      </Card>
    )
  }

  return (
    <div className={s.split}>
      <AgendaEditor
        key={selected.id}
        slot={selected}
        saved={agendas.data?.[selected.id]}
        tasks={plan.data?.tasks ?? []}
        requests={requests.data ?? []}
      />
      <Card className={s.side} index={2}>
        <h2 className={s.cardTitle}>{t('Ближайшие', 'Upcoming')}</h2>
        <ul className={s.list}>
          {upcoming.map((slot) => (
            <MeetingRow
              key={slot.id}
              slot={slot}
              isActive={slot.id === selected.id}
              onSelect={() => setSelectedId(slot.id)}
            />
          ))}
        </ul>
        <Link to="/people" search={{ tab: 'hours' }} className={s.link}>
          {t('Записаться ещё', 'Book another')}
        </Link>
        {past.length > 0 && (
          <>
            <h3 className={s.subTitle}>{t('Прошедшие', 'Past')}</h3>
            <ul className={s.list}>
              {past.map((slot) => (
                <li key={slot.id} className={s.pastRow}>
                  <span className="t-s">{formatSlot(slot.start, lang)}</span>
                  <Link
                    to="/chats"
                    search={{ c: 'buddy', q: t('Итоги встречи 1:1: ', 'Summary of the 1:1: ') }}
                    className={s.link}
                  >
                    {t('Записать итоги', 'Write a summary')}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  )
}
