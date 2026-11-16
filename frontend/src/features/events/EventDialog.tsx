import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { formatSlot } from '@/entities/calendar'
import { getEmployee } from '@/entities/employees'
import { useSettings } from '@/entities/settings'
import { useT } from '@/shared/lib/i18n'
import { newId } from '@/shared/lib/storage'
import { Badge, Button, Dialog, EmptyState, Icon, Meter, Note, Tag, toast } from '@/shared/ui'
import { IsoArt } from '@/shared/iso'
import { useJoinEvent, useLeaveEvent, type EventItem } from './data'
import { kindLabel } from './kinds'
import { buildEventDraft, eventQuestion, isJoined, seatsLeft } from './logic'
import s from './events.module.css'

type Step = { mode: 'view' } | { mode: 'join' | 'leave'; key: string }

type Props = {
  eventId: string | undefined
  events: readonly EventItem[] | undefined
  userId: string
  onClose: () => void
}

/** Событие из ?id=. Пока список грузится, ничего не показываем. */
export function EventDialog({ eventId, events, userId, onClose }: Props) {
  const t = useT()
  if (!eventId || !events) return null
  const event = events.find((e) => e.id === eventId)

  if (!event) {
    return (
      <Dialog
        isOpen
        onClose={onClose}
        title={t('Событие', 'Event')}
        closeLabel={t('Закрыть', 'Close')}
      >
        <EmptyState
          art={<IsoArt name="plot" />}
          title={t('Не нашёл такое событие', "Can't find this event")}
          text={t('Возможно, его уже убрали из ленты', 'It may have been removed from the feed')}
        />
      </Dialog>
    )
  }
  return <EventDialogBody key={event.id} event={event} userId={userId} onClose={onClose} />
}

function EventDialogBody({
  event,
  userId,
  onClose,
}: {
  event: EventItem
  userId: string
  onClose: () => void
}) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const [step, setStep] = useState<Step>({ mode: 'view' })
  const join = useJoinEvent()
  const leave = useLeaveEvent()
  const when = formatSlot(event.start, lang)
  const left = seatsLeft(event)
  const isMine = isJoined(event, userId)
  const host = getEmployee(event.hostId)

  const submit = (mode: 'join' | 'leave', key: string) => {
    const mutation = mode === 'join' ? join : leave
    const draft = buildEventDraft(event, mode, key, when, t)
    mutation.mutate(
      { eventId: event.id, userId, draft },
      {
        onSuccess: () => {
          setStep({ mode: 'view' })
          toast(
            mode === 'join'
              ? t('Записал. Событие в календаре', 'Done. The event is in your calendar')
              : t('Запись отменена, место свободно', 'Cancelled, the seat is free'),
          )
        },
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : t('Не получилось', 'Something went wrong'),
          ),
      },
    )
  }

  const footer = (
    <DialogFooter
      step={step}
      event={event}
      isMine={isMine}
      isBusy={join.isPending || leave.isPending}
      onStep={setStep}
      onSubmit={submit}
    />
  )

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={event.title}
      footer={footer}
      width={520}
      closeLabel={t('Закрыть', 'Close')}
    >
      <div className={s.dialogContent}>
        <div className={s.dialogTags}>
          <Tag>{kindLabel(event.kind, t)}</Tag>
          {event.tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </div>
        <dl className={s.facts}>
          <div>
            <dt>
              <Icon name="clock" size={18} /> {t('Когда', 'When')}
            </dt>
            <dd>
              {when}, {event.minutes} {t('мин', 'min')}
            </dd>
          </div>
          <div>
            <dt>
              <Icon name="pin" size={18} /> {t('Где', 'Where')}
            </dt>
            <dd>
              {event.placeId ? (
                <Link to="/map" search={{ to: event.placeId }} className={s.inlineLink}>
                  {event.placeName}
                </Link>
              ) : (
                event.placeName
              )}
            </dd>
          </div>
          {host && (
            <div>
              <dt>
                <Icon name="user" size={18} /> {t('Ведёт', 'Host')}
              </dt>
              <dd>{host.name}</dd>
            </div>
          )}
        </dl>
        <p>{event.description}</p>
        <Seats event={event} />
        {left === 0 && !isMine && (
          <Note tone="warning" title={t('Мест нет', 'No seats left')}>
            {t(
              'Спроси buddy - подскажет, будет ли повтор',
              'Ask buddy whether it will be repeated',
            )}
          </Note>
        )}
        <StepNote step={step} event={event} when={when} />
        <Link
          to="/chats"
          search={{ c: 'buddy', q: eventQuestion(event, t) }}
          className={s.inlineLink}
        >
          {t('Спросить buddy про событие', 'Ask buddy about it')}
        </Link>
      </div>
    </Dialog>
  )
}

function Seats({ event }: { event: EventItem }) {
  const t = useT()
  const left = seatsLeft(event)
  if (event.capacity === null || left === null) {
    return (
      <p className="t-s t-muted">
        {t(
          `Без ограничения мест, идут ${event.attendees.length}`,
          `No seat limit, ${event.attendees.length} going`,
        )}
      </p>
    )
  }
  return (
    <div className={s.seats}>
      <div className={s.seatsHead}>
        <b>{t('Места', 'Seats')}</b>
        <span className="t-s t-muted t-num">
          {t(
            `занято ${event.attendees.length} из ${event.capacity}, свободно ${left}`,
            `${event.attendees.length} of ${event.capacity} taken, ${left} free`,
          )}
        </span>
      </div>
      <Meter
        value={event.attendees.length}
        max={event.capacity}
        color={left === 0 ? 'var(--brand-red)' : 'var(--brand-green)'}
        label={t('Занятые места', 'Taken seats')}
      />
    </div>
  )
}

function StepNote({ step, event, when }: { step: Step; event: EventItem; when: string }) {
  const t = useT()
  if (step.mode === 'join') {
    return (
      <Note tone="info" title={t('Проверь перед записью', 'Check before signing up')}>
        {t(
          `Запишу тебя на ${when}, место: ${event.placeName}. Событие появится в календаре`,
          `I'll sign you up for ${when}, ${event.placeName}. It will appear in your calendar`,
        )}
      </Note>
    )
  }
  if (step.mode === 'leave') {
    return (
      <Note tone="warning" title={t('Отменить запись?', 'Cancel sign-up?')}>
        {t('Место освободится, его сможет занять другой', 'The seat will go to someone else')}
      </Note>
    )
  }
  return null
}

type FooterProps = {
  step: Step
  event: EventItem
  isMine: boolean
  isBusy: boolean
  onStep: (step: Step) => void
  onSubmit: (mode: 'join' | 'leave', key: string) => void
}

/** Действие только после подтверждения: сначала черновик, потом кнопка «Подтвердить». */
function DialogFooter({ step, event, isMine, isBusy, onStep, onSubmit }: FooterProps) {
  const t = useT()
  if (step.mode !== 'view') {
    const isJoin = step.mode === 'join'
    return (
      <>
        <Button
          variant={isJoin ? 'primary' : 'danger'}
          icon="check"
          isLoading={isBusy}
          onClick={() => onSubmit(step.mode, step.key)}
        >
          {isJoin ? t('Подтвердить запись', 'Confirm sign-up') : t('Да, отменить', 'Yes, cancel')}
        </Button>
        <Button variant="ghost" disabled={isBusy} onClick={() => onStep({ mode: 'view' })}>
          {t('Назад', 'Back')}
        </Button>
      </>
    )
  }
  if (isMine) {
    return (
      <>
        <Badge tone="success" icon="check">
          {t('Ты в списке', "You're on the list")}
        </Badge>
        <Button
          variant="secondary"
          onClick={() => onStep({ mode: 'leave', key: newId(`leave-${event.id}`) })}
        >
          {t('Отменить запись', 'Cancel sign-up')}
        </Button>
      </>
    )
  }
  const isEventFull = seatsLeft(event) === 0
  return (
    <Button
      variant="primary"
      icon="plus"
      disabled={isEventFull}
      onClick={() => onStep({ mode: 'join', key: newId(`join-${event.id}`) })}
    >
      {isEventFull ? t('Мест нет', 'Full') : t('Записаться', 'Sign up')}
    </Button>
  )
}
