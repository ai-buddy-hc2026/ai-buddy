import { Link } from '@tanstack/react-router'
import { useConfirmAction } from '@/entities/actions'
import { Badge, Button, Note } from '@/shared/ui'
import { useT } from '@/shared/lib/i18n'
import { buildAbsenceDraft } from './bot'
import type { BotMeta } from './model'
import s from './Chat.module.css'

type DraftMeta = Extract<BotMeta, { kind: 'absenceDraft' }>

type Props = {
  meta: DraftMeta
  onChange: (meta: DraftMeta) => void
}

/**
 * S-3: карточка заявки на отгул. Уходит только по кнопке «Отправить».
 * Ключ идемпотентности хранится в карточке: «Повторить» после сбоя не создаёт дубль.
 */
export function AbsenceDraftCard({ meta, onChange }: Props) {
  const t = useT()
  const confirm = useConfirmAction()
  const draft = buildAbsenceDraft(meta.date, meta.type, meta.idempotencyKey)

  const send = () =>
    confirm.mutate(draft, {
      onSuccess: (action) =>
        onChange({
          ...meta,
          status: 'sent',
          externalId: action.externalId,
          actionStatus: action.status,
        }),
    })

  const isSent = meta.status === 'sent'
  const isCancelled = meta.status === 'cancelled'

  return (
    <div className={s.card} aria-label={t('Заявка на отгул', 'Day off request')} role="group">
      <div className={s.cardHead}>
        <b>{t('Заявка на отгул', 'Day off request')}</b>
        {isSent && (
          <Badge tone="warning" icon="clock">
            {t('Ждёт согласования', 'Pending approval')}
          </Badge>
        )}
        {isCancelled && <Badge>{t('Отменена', 'Cancelled')}</Badge>}
        {meta.status === 'draft' && <Badge tone="accent">{t('Черновик', 'Draft')}</Badge>}
      </div>
      <dl className={s.details}>
        {draft.details.map((d) => (
          <div key={d.label}>
            <dt>{d.label}</dt>
            <dd>{d.value}</dd>
          </div>
        ))}
        {meta.externalId && (
          <div>
            <dt>{t('Номер', 'Number')}</dt>
            <dd className="t-num">
              <b>{meta.externalId}</b> <span className={s.code}>{meta.actionStatus}</span>
            </dd>
          </div>
        )}
      </dl>

      {confirm.isError && (
        <Note tone="error" title={t('Не получилось отправить', 'Could not send')}>
          {confirm.error.message}
        </Note>
      )}

      {meta.status === 'draft' && (
        <div className={s.cardActions}>
          <Button
            variant="primary"
            icon={confirm.isError ? 'refresh' : 'send'}
            isLoading={confirm.isPending}
            onClick={send}
          >
            {confirm.isError ? t('Повторить', 'Retry') : t('Отправить', 'Send')}
          </Button>
          <Button
            variant="ghost"
            disabled={confirm.isPending}
            onClick={() => onChange({ ...meta, status: 'cancelled' })}
          >
            {t('Отменить', 'Cancel')}
          </Button>
        </div>
      )}
      {isSent && (
        <p className={s.cardFoot}>
          {t('Заявка ушла руководителю. Статус смотри в ', 'Sent to your lead. Track it in ')}
          <Link to="/actions">{t('истории действий', 'action history')}</Link>
        </p>
      )}
    </div>
  )
}
