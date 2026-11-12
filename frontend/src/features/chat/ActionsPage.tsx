import { Link } from '@tanstack/react-router'
import { useActions, type Action, type ActionKind } from '@/entities/actions'
import { IsoArt } from '@/shared/iso'
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  Page,
  PageHeader,
  Skeleton,
  type BadgeTone,
  type IconName,
} from '@/shared/ui'
import { formatShort, formatTime } from '@/shared/lib/date'
import { useT, type Translate } from '@/shared/lib/i18n'
import { POLICY_DENIED } from './model'
import s from './ActionsPage.module.css'

const KIND_ICON: Record<ActionKind, IconName> = {
  absence: 'dayOff',
  escalation: 'question',
  booking: 'calendar',
  access: 'key',
  feedback: 'star',
  message: 'chat',
}

type StatusView = { tone: BadgeTone; icon: IconName; label: string; code: string }

function isDenied(action: Action): boolean {
  return (
    action.idempotencyKey.startsWith(POLICY_DENIED) ||
    action.details.some((d) => d.value === POLICY_DENIED)
  )
}

function statusView(action: Action, t: Translate): StatusView {
  if (isDenied(action))
    return {
      tone: 'error',
      icon: 'shield',
      label: t('Отказано: нет прав', 'Denied: no access'),
      code: POLICY_DENIED,
    }
  const map: Record<Action['status'], Omit<StatusView, 'code'>> = {
    pending_approval: {
      tone: 'warning',
      icon: 'clock',
      label: t('Ждёт согласования', 'Pending approval'),
    },
    approved: { tone: 'success', icon: 'check', label: t('Согласовано', 'Approved') },
    sent: { tone: 'success', icon: 'checkDouble', label: t('Выполнено', 'Done') },
    scheduled: { tone: 'accent', icon: 'clock', label: t('Запланировано', 'Scheduled') },
    failed: { tone: 'error', icon: 'alert', label: t('Ошибка', 'Failed') },
  }
  return { ...map[action.status], code: action.status }
}

/** K-11: история действий - всё, что buddy сделал во внешних сервисах после подтверждения. */
export function ActionsPage() {
  const t = useT()
  const actions = useActions()

  return (
    <Page>
      <PageHeader
        title={t('История действий', 'Action history')}
        subtitle={t(
          'Заявки, вопросы наставнику и отказы. Без твоего «Отправить» сюда ничего не попадает',
          'Requests, mentor questions and denials',
        )}
      />
      {actions.isLoading ? (
        <div className={s.list}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={96} radius="var(--radius-card)" />
          ))}
        </div>
      ) : actions.isError ? (
        <Card>
          <ErrorState
            text={t('Не получилось загрузить историю', 'Could not load history')}
            onRetry={() => void actions.refetch()}
            retryLabel={t('Повторить', 'Retry')}
          />
        </Card>
      ) : !actions.data || actions.data.length === 0 ? (
        <Card>
          <EmptyState
            art={<IsoArt name="plot" isFloating />}
            title={t('Пока пусто', 'Nothing yet')}
            text={t(
              'Попроси buddy оформить отгул - заявка появится здесь',
              'Ask buddy for a day off - it will show up here',
            )}
            action={
              <Link
                to="/chats"
                search={{ c: 'buddy', q: 'Хочу отгул в пятницу' }}
                className={s.cta}
              >
                {t('Оформить отгул', 'Request a day off')}
              </Link>
            }
          />
        </Card>
      ) : (
        <ul className={s.list}>
          {actions.data.map((a, i) => (
            <ActionCard key={a.id} action={a} index={i} />
          ))}
        </ul>
      )}
    </Page>
  )
}

function ActionCard({ action, index }: { action: Action; index: number }) {
  const t = useT()
  const status = statusView(action, t)
  const at = action.createdAt
  return (
    <Card as="li" index={index} pad="s" className={s.card}>
      <span className={s.icon} aria-hidden>
        <Icon name={isDenied(action) ? 'shield' : KIND_ICON[action.kind]} size={22} />
      </span>
      <div className={s.body}>
        <div className={s.top}>
          <h2 className={s.title}>{action.title}</h2>
          {action.externalId && <span className={s.number}>{action.externalId}</span>}
        </div>
        <dl className={s.details}>
          {action.details.map((d) => (
            <div key={d.label}>
              <dt>{d.label}</dt>
              <dd>{d.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className={s.side}>
        <Badge tone={status.tone} icon={status.icon}>
          {status.label}
        </Badge>
        <code className={s.code}>{status.code}</code>
        <time dateTime={at} className={s.time}>
          {formatShort(at.slice(0, 10))}, {formatTime(at)}
        </time>
      </div>
    </Card>
  )
}
