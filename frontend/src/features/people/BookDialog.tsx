import { useState } from 'react'
import { useConfirmAction, type Action } from '@/entities/actions'
import { formatSlot, useBookSlot, type Slot } from '@/entities/calendar'
import type { Employee } from '@/entities/employees'
import { useSettings } from '@/entities/settings'
import { ApiError, errorMessage } from '@/shared/api/http'
import { useT } from '@/shared/lib/i18n'
import { Button, Dialog, Input, Note, toast } from '@/shared/ui'
import { bookingDraft } from './logic'
import s from './people.module.css'

const CONFLICT = 409
const DEFAULT_TOPIC = '1:1'

type Props = {
  slot: Slot
  host: Employee
  attendeeId: string
  onClose: () => void
}

/** Подтверждение брони слота (идея 6): черновик -> «Записаться» -> статус «Записано». */
export function BookDialog({ slot, host, attendeeId, onClose }: Props) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const [topic, setTopic] = useState(DEFAULT_TOPIC)
  const [result, setResult] = useState<Action | null>(null)
  const [isBooked, setIsBooked] = useState(false)
  const book = useBookSlot()
  const confirm = useConfirmAction()
  const when = formatSlot(slot.start, lang)
  const cleanTopic = topic.trim() || DEFAULT_TOPIC

  const logAction = () =>
    confirm.mutate(bookingDraft(slot, host, attendeeId, cleanTopic, formatSlot(slot.start)), {
      onSuccess: (action) => setResult(action),
      onError: (error) =>
        toast.error(
          `${t('Встреча создана, но не попала в историю', 'Booked, but not saved to history')}: ${errorMessage(error)}`,
          {
            label: t('Повторить', 'Retry'),
            run: logAction,
          },
        ),
    })

  const handleBook = () =>
    book.mutate(
      { slotId: slot.id, attendeeId, topic: cleanTopic },
      {
        onSuccess: () => {
          setIsBooked(true)
          logAction()
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === CONFLICT) {
            toast.error(t('Слот уже занят. Выбери другой', 'This slot is taken. Pick another one'))
            onClose()
            return
          }
          toast.error(errorMessage(error))
        },
      },
    )

  const isDone = isBooked && result !== null

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={
        isDone ? t('Записано', 'Booked') : t(`Записаться к ${host.short}?`, `Book ${host.short}?`)
      }
      closeLabel={t('Закрыть', 'Close')}
      footer={
        isDone ? (
          <Button variant="primary" onClick={onClose}>
            {t('Готово', 'Done')}
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              icon="check"
              onClick={handleBook}
              isLoading={book.isPending || confirm.isPending}
              disabled={isBooked}
            >
              {t('Записаться', 'Book')}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t('Отмена', 'Cancel')}
            </Button>
          </>
        )
      }
    >
      <div className={s.dialogBody}>
        <p className={s.slotWhen}>
          <b>{when}</b>
          <span className="t-s t-muted">
            {host.name} · {slot.minutes} {t('мин', 'min')}
          </span>
        </p>
        {isDone ? (
          <Note
            tone="success"
            title={t(`${host.short} получил приглашение`, `${host.short} got the invite`)}
          >
            {t(
              `Номер в календаре ${result.externalId ?? ''}. Встреча есть в истории действий`,
              `Calendar ID ${result.externalId ?? ''}. Saved to action history`,
            )}
          </Note>
        ) : (
          <>
            <Input
              label={t('Тема встречи', 'Meeting topic')}
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              maxLength={80}
              disabled={isBooked}
            />
            <p className="t-s t-muted">
              {t(
                'Без твоего «Записаться» ничего не отправлю',
                'Nothing is sent until you press Book',
              )}
            </p>
          </>
        )}
      </div>
    </Dialog>
  )
}
