import { useConfirmAction, type Action } from '@/entities/actions'
import type { KnowledgeSource } from '@/entities/knowledge'
import { Badge, Button, Note, Tag, type BadgeTone, type IconName } from '@/shared/ui'
import { useT, type Translate } from '@/shared/lib/i18n'
import type { BotMeta } from './model'
import s from './Chat.module.css'

type RemoteMeta = Extract<BotMeta, { kind: 'remote' }>

type Props = {
  meta: RemoteMeta
  onPatch: (meta: BotMeta) => void
}

/** Ответ Go API: источники и карточки предложенных действий (S-2, S-3, S-5). */
export function RemoteExtras({ meta, onPatch }: Props) {
  const replace = (next: Action) =>
    onPatch({ ...meta, actions: meta.actions.map((a) => (a.id === next.id ? next : a)) })
  return (
    <>
      {meta.sources.length > 0 && <SourceList sources={meta.sources} />}
      {meta.actions.map((action) => (
        <ProposalCard key={action.id} action={action} onChange={replace} />
      ))}
    </>
  )
}

/** Ссылку показываем только для http(s) и относительных адресов. */
function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || (url.startsWith('/') && !url.startsWith('//'))
}

function SourceList({ sources }: { sources: readonly KnowledgeSource[] }) {
  const t = useT()
  return (
    <div className={s.extras}>
      {sources.map((source) => {
        const label = source.section ? `${source.title}, ${source.section}` : source.title
        const tag = <Tag icon="doc">{label}</Tag>
        return isSafeUrl(source.url) ? (
          <a
            key={`${source.docId}:${source.revision}`}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className={s.inlineLink}
          >
            {tag}
          </a>
        ) : (
          <span key={`${source.docId}:${source.revision}`}>{tag}</span>
        )
      })}
      <span className={s.disclaimer}>
        {t('Тестовая инструкция, не регламент Авито', 'Test guide, not an Avito policy')}
      </span>
    </div>
  )
}

type StatusView = { tone: BadgeTone; icon: IconName; label: string }

function statusView(status: Action['status'], t: Translate): StatusView {
  switch (status) {
    case 'draft':
      return { tone: 'accent', icon: 'clock', label: t('Черновик', 'Draft') }
    case 'scheduled':
      return { tone: 'accent', icon: 'clock', label: t('Выполняется', 'In progress') }
    case 'pending_approval':
      return { tone: 'warning', icon: 'clock', label: t('Ждёт согласования', 'Pending approval') }
    case 'approved':
    case 'sent':
      return { tone: 'success', icon: 'check', label: t('Выполнено', 'Done') }
    case 'failed':
      return { tone: 'error', icon: 'alert', label: t('Ошибка', 'Failed') }
    case 'cancelled':
      return { tone: 'neutral', icon: 'close', label: t('Отменено', 'Cancelled') }
  }
}

/** Действие уходит только по кнопке «Отправить»: POST /actions/{id}/confirm. */
function ProposalCard({ action, onChange }: { action: Action; onChange: (next: Action) => void }) {
  const t = useT()
  const confirm = useConfirmAction()
  const view = statusView(action.status, t)
  const canSend = action.status === 'draft' || action.status === 'failed'

  const send = () =>
    confirm.mutate(
      {
        kind: action.kind,
        title: action.title,
        details: action.details,
        idempotencyKey: action.idempotencyKey,
        serverId: action.serverId ?? action.id,
      },
      { onSuccess: (result) => onChange({ ...result, id: action.id }) },
    )

  return (
    <div className={s.card} role="group" aria-label={action.title}>
      <div className={s.cardHead}>
        <b>{action.title}</b>
        <Badge tone={view.tone} icon={view.icon}>
          {view.label}
        </Badge>
      </div>
      <dl className={s.details}>
        {action.details.map((d) => (
          <div key={d.label}>
            <dt>{d.label}</dt>
            <dd>{d.value}</dd>
          </div>
        ))}
        {action.externalId && (
          <div>
            <dt>{t('Номер', 'Number')}</dt>
            <dd className="t-num">
              <b>{action.externalId}</b>
            </dd>
          </div>
        )}
      </dl>
      {confirm.isError && (
        <Note tone="error" title={t('Не получилось отправить', 'Could not send')}>
          {confirm.error.message}
        </Note>
      )}
      {canSend && (
        <div className={s.cardActions}>
          <Button
            variant="primary"
            icon={confirm.isError ? 'refresh' : 'send'}
            isLoading={confirm.isPending}
            onClick={send}
          >
            {confirm.isError ? t('Повторить', 'Retry') : t('Отправить', 'Send')}
          </Button>
        </div>
      )}
      {action.status === 'draft' && (
        <p className={s.cardFoot}>
          {t('Без «Отправить» ничего не уйдёт', 'Nothing is sent until you press Send')}
        </p>
      )}
    </div>
  )
}
