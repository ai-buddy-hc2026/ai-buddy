import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useConfirmAction } from '@/entities/actions'
import { getEmployee } from '@/entities/employees'
import { useUser } from '@/entities/session'
import { errorMessage } from '@/shared/api/http'
import { IsoArt } from '@/shared/iso'
import { useT, type Translate } from '@/shared/lib/i18n'
import { newId } from '@/shared/lib/storage'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  Eyebrow,
  Icon,
  Note,
  Row,
  Skeleton,
  toast,
  type BadgeTone,
  type IconName,
} from '@/shared/ui'
import { useAccess, useCreateAccessRequest } from './data'
import {
  countByStatus,
  isStuck,
  missingOf,
  roleKey,
  type AccessDef,
  type AccessItem,
  type AccessStatus,
} from './logic'
import s from './access.module.css'

function statusView(
  status: AccessStatus,
  t: Translate,
): { tone: BadgeTone; icon: IconName; text: string } {
  switch (status) {
    case 'granted':
      return { tone: 'success', icon: 'check', text: t('Выдан', 'Granted') }
    case 'pending':
      return { tone: 'warning', icon: 'clock', text: t('На согласовании', 'Pending') }
    case 'missing':
      return { tone: 'neutral', icon: 'lock', text: t('Нет доступа', 'No access') }
  }
}

function approversOf(items: readonly AccessDef[]): string {
  const ids = [...new Set(items.map((a) => a.approverId))]
  return ids.map((id) => getEmployee(id)?.name ?? id).join(', ')
}

type DraftProps = { items: readonly AccessDef[]; idempotencyKey: string; onClose: () => void }

/** Черновик заявки. Во внешний сервис уходит только по кнопке «Отправить». */
function RequestDialog({ items, idempotencyKey, onClose }: DraftProps) {
  const t = useT()
  const confirm = useConfirmAction()
  const create = useCreateAccessRequest()
  const isBusy = confirm.isPending || create.isPending
  const names = items.map((a) => a.title).join(', ')

  const send = () =>
    confirm.mutate(
      {
        kind: 'access',
        title: t('Заявка на доступы', 'Access request'),
        details: [
          { label: t('Доступы', 'Access'), value: names },
          { label: t('Согласуют', 'Approvers'), value: approversOf(items) },
        ],
        idempotencyKey,
      },
      {
        onSuccess: (action) =>
          create.mutate(
            { items, externalId: action.externalId ?? idempotencyKey },
            {
              onSuccess: () => {
                toast(
                  t(
                    `Отправлено, заявка ${action.externalId ?? ''}`,
                    `Sent, request ${action.externalId ?? ''}`,
                  ),
                )
                onClose()
              },
              onError: (error) =>
                toast.error(errorMessage(error), { label: t('Повторить', 'Retry'), run: send }),
            },
          ),
        onError: (error) =>
          toast.error(errorMessage(error), { label: t('Повторить', 'Retry'), run: send }),
      },
    )

  const footer = (
    <>
      <Button variant="accent" icon="send" isLoading={isBusy} onClick={send}>
        {t('Отправить', 'Send')}
      </Button>
      <Button variant="ghost" onClick={onClose} disabled={isBusy}>
        {t('Отмена', 'Cancel')}
      </Button>
    </>
  )

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={t('Заявка на доступы', 'Access request')}
      footer={footer}
      closeLabel={t('Закрыть', 'Close')}
    >
      <div className={s.draft}>
        <p>
          {t(
            `Одна заявка на ${items.length}: ${names}`,
            `One request for ${items.length}: ${names}`,
          )}
        </p>
        <dl className={s.draftList}>
          <dt>{t('Согласуют', 'Approvers')}</dt>
          <dd>{approversOf(items)}</dd>
          <dt>{t('Куда', 'Where')}</dt>
          <dd>{t('Мок-сервис доступов', 'Access service mock')}</dd>
        </dl>
        <Note tone="info">
          {t(
            'Отправлю только после кнопки. Результат сохраню в истории действий',
            'Sent only after you press the button. The result goes to the action history',
          )}
        </Note>
      </div>
    </Dialog>
  )
}

function AccessRow({ item }: { item: AccessItem }) {
  const t = useT()
  const view = statusView(item.status, t)
  const approver = getEmployee(item.access.approverId)
  const stuck = isStuck(item)
  const meta = [
    item.access.about,
    item.requestId && t(`заявка ${item.requestId}`, `request ${item.requestId}`),
    stuck && t(`висит ${item.pendingDays} дн.`, `pending ${item.pendingDays} d`),
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <li className={s.rowItem} data-status={item.status}>
      <Row
        leading={
          <span className={s.rowIcon} aria-hidden>
            <Icon name="key" size={20} />
          </span>
        }
        title={item.access.title}
        subtitle={meta}
        trailing={
          <span className={s.trailing}>
            {stuck && approver && (
              <Link
                className={s.nudge}
                to="/chats"
                search={{
                  c: approver.id,
                  q: `${approver.short}, привет! Заявка ${item.requestId ?? ''} на ${item.access.title} висит ${item.pendingDays} дня, глянешь?`,
                }}
              >
                {t(`Напомнить: ${approver.short}`, `Nudge ${approver.short}`)}
              </Link>
            )}
            <Badge tone={view.tone} icon={view.icon}>
              {view.text}
            </Badge>
          </span>
        }
      />
    </li>
  )
}

/** Вкладка «Доступы» (идея 27): пакет доступов по роли, одна заявка, статусы обновляются сами. */
export function AccessTab() {
  const t = useT()
  const user = useUser()
  const query = useAccess(roleKey(user.employee.role))
  const [unpicked, setUnpicked] = useState<readonly string[]>([])
  const [draftKey, setDraftKey] = useState<string | null>(null)

  if (query.isPending) {
    return (
      <div className={s.grid} aria-busy>
        <Skeleton height={260} radius={28} />
        <Skeleton height={260} radius={28} />
      </div>
    )
  }
  if (query.isError) {
    return (
      <ErrorState
        text={t('Не получилось загрузить доступы', 'Could not load access')}
        onRetry={() => void query.refetch()}
        retryLabel={t('Повторить', 'Retry')}
      />
    )
  }

  const items = query.data
  const missing = missingOf(items)
  const picked = missing.filter((a) => !unpicked.includes(a.id))
  const counts = countByStatus(items)
  const toggle = (id: string, isOn: boolean) =>
    setUnpicked((prev) => (isOn ? prev.filter((x) => x !== id) : [...prev, id]))

  return (
    <div className={s.grid}>
      <Card className={s.hero} index={0} aria-labelledby="access-missing">
        <Eyebrow>
          {t(`Пакет для роли: ${user.employee.role}`, `Role package: ${user.employee.role}`)}
        </Eyebrow>
        {missing.length === 0 ? (
          <EmptyState
            art={<IsoArt name="access" />}
            title={t('Все доступы выданы или запрошены', 'All access is granted or requested')}
            text={t('Статусы обновляются сами', 'Statuses update on their own')}
          />
        ) : (
          <>
            <h2 id="access-missing" className={s.heroTitle}>
              {t(`Не хватает ${missing.length}`, `${missing.length} missing`)}
            </h2>
            <ul className={s.pick}>
              {missing.map((a) => (
                <li key={a.id} className={s.pickItem}>
                  <Checkbox
                    isChecked={!unpicked.includes(a.id)}
                    onChange={(isOn) => toggle(a.id, isOn)}
                    label={a.title}
                  />
                  <span>
                    <b>{a.title}</b> <span className="t-s t-muted">{a.about}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div>
              <Button
                variant="primary"
                isPill
                icon="edit"
                disabled={picked.length === 0}
                onClick={() => setDraftKey(newId('access'))}
              >
                {t('Подготовить одну заявку', 'Draft one request')}
              </Button>
            </div>
          </>
        )}
      </Card>

      <Card tone="green" className={s.stats} index={1}>
        <Eyebrow>{t('Мои доступы', 'My access')}</Eyebrow>
        <p className={s.bigNumber}>
          <b>{counts.granted}</b> {t(`из ${items.length} выдано`, `of ${items.length} granted`)}
        </p>
        <p className="t-s">
          {t(
            `На согласовании: ${counts.pending}. Нет: ${counts.missing}`,
            `Pending: ${counts.pending}. Missing: ${counts.missing}`,
          )}
        </p>
        <IsoArt name="access" className={s.statsArt} isFloating />
      </Card>

      <Card className={s.panel} index={2} aria-labelledby="access-panel">
        <h2 id="access-panel" className={s.cardTitle}>
          {t('Статус каждого доступа', 'Status of each access')}
        </h2>
        <ul className={s.rows} aria-live="polite">
          {items.map((item) => (
            <AccessRow key={item.access.id} item={item} />
          ))}
        </ul>
      </Card>

      {draftKey && (
        <RequestDialog
          key={draftKey}
          items={picked}
          idempotencyKey={draftKey}
          onClose={() => setDraftKey(null)}
        />
      )}
    </div>
  )
}
