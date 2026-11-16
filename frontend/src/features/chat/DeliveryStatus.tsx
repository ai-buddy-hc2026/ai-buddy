import { Badge, Button } from '@/shared/ui'
import { formatShort } from '@/shared/lib/date'
import { useT, type Translate } from '@/shared/lib/i18n'
import { deliveryWhen } from './delivery'
import s from './Insights.module.css'

type Props = {
  deliverAt: string
  sentAt: string
  onSendNow: () => void
}

/** «Доставлю завтра в 10:00» + «Отправить сейчас» для срочного (идея 43). */
export function DeliveryStatus({ deliverAt, sentAt, onSendNow }: Props) {
  const t = useT()
  return (
    <div className={s.delivery}>
      <Badge tone="accent" icon="clock">
        {deliveryLabel(deliverAt, sentAt, t)}
      </Badge>
      <Button variant="ghost" size="s" icon="send" onClick={onSendNow}>
        {t('Отправить сейчас', 'Send now')}
      </Button>
    </div>
  )
}

/** Подсказка над полем ввода: у получателя нерабочее время. */
export function OffHoursHint({
  name,
  deliverAt,
  sentAt,
}: {
  name: string
  deliverAt: string
  sentAt: string
}) {
  const t = useT()
  return (
    <p className={s.offHours} role="status">
      {t(
        `${name} сейчас не на работе. ${deliveryLabel(deliverAt, sentAt, t)}`,
        `${name} is off work now. ${deliveryLabel(deliverAt, sentAt, t)}`,
      )}
    </p>
  )
}

function deliveryLabel(deliverAt: string, sentAt: string, t: Translate): string {
  const when = deliveryWhen(deliverAt, sentAt)
  if (when.dayOffset === 0)
    return t(`Доставлю сегодня в ${when.localTime}`, `Will deliver today at ${when.localTime}`)
  if (when.dayOffset === 1)
    return t(`Доставлю завтра в ${when.localTime}`, `Will deliver tomorrow at ${when.localTime}`)
  return t(
    `Доставлю ${formatShort(when.localDate)} в ${when.localTime}`,
    `Will deliver ${formatShort(when.localDate, 'en')} at ${when.localTime}`,
  )
}
