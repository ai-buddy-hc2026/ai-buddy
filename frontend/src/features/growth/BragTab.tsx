import { useState } from 'react'
import { toMarkdown, useAddBrag, useBrag, useRemoveBrag, type BragItem } from '@/entities/brag'
import { usePlan } from '@/entities/plan'
import { useUser } from '@/entities/session'
import { IsoArt } from '@/shared/iso'
import { formatShort } from '@/shared/lib/date'
import { plural, useT, type Translate } from '@/shared/lib/i18n'
import { useSettings } from '@/entities/settings'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  Note,
  Row,
  Skeleton,
  toast,
  type IconName,
} from '@/shared/ui'
import { BragDialog } from './BragDialog'
import { bragSuggestions, sortBragItems, type BragSuggestion, type BragType } from './bragLogic'
import { useMergeRequests } from './data'
import s from './growth.module.css'

const TYPE_ICON: Record<BragType, IconName> = {
  task: 'check',
  pr: 'share',
  review: 'star',
  feedback: 'chat',
  manual: 'edit',
}

function typeLabel(type: BragType, t: Translate): string {
  const labels: Record<BragType, string> = {
    task: t('Задача', 'Task'),
    pr: t('MR', 'MR'),
    review: t('Отзыв', 'Review'),
    feedback: t('Обратная связь', 'Feedback'),
    manual: t('Своя запись', 'Own entry'),
  }
  return labels[type]
}

function downloadMarkdown(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function Suggestions({ items }: { items: readonly BragSuggestion[] }) {
  const t = useT()
  const add = useAddBrag()
  if (items.length === 0) return null

  const accept = (suggestion: BragSuggestion) =>
    add.mutate(suggestion.item, {
      onSuccess: () => toast(t('Добавила в достижения', 'Added to achievements')),
      onError: () => toast.error(t('Не получилось добавить', 'Could not add')),
    })

  return (
    <Card index={3} className={s.stack}>
      <div className={s.headRow}>
        <Icon name="sparkle" size={20} />
        <b>
          {t(
            'Buddy нашёл новое в чек-листе и GitLab',
            'Buddy found new wins in the checklist and GitLab',
          )}
        </b>
      </div>
      <ul className={s.list}>
        {items.map((suggestion) => (
          <li key={suggestion.id}>
            <Row
              title={suggestion.title}
              subtitle={suggestion.source === 'gitlab' ? 'GitLab' : t('Чек-лист', 'Checklist')}
              trailing={
                <Button
                  size="s"
                  icon="plus"
                  disabled={add.isPending}
                  onClick={() => accept(suggestion)}
                >
                  {t('Добавить', 'Add')}
                </Button>
              }
            />
          </li>
        ))}
      </ul>
    </Card>
  )
}

function BragRow({ item, onEdit }: { item: BragItem; onEdit: () => void }) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const add = useAddBrag()
  const remove = useRemoveBrag()

  const handleRemove = () =>
    remove.mutate(item.id, {
      onSuccess: () =>
        toast(t('Запись удалена', 'Entry removed'), {
          label: t('Вернуть', 'Undo'),
          run: () =>
            add.mutate({ type: item.type, title: item.title, link: item.link, date: item.date }),
        }),
      onError: () => toast.error(t('Не получилось удалить', 'Could not remove')),
    })

  return (
    <li className={s.bragItem}>
      <span className={s.bragIcon} data-type={item.type} aria-hidden>
        <Icon name={TYPE_ICON[item.type]} size={20} />
      </span>
      <div className={s.bragBody}>
        <b>{item.title}</b>
        <span className="t-s t-muted">
          {formatShort(item.date, lang)} · {typeLabel(item.type, t)}
          {item.link && (
            <>
              {' · '}
              <a href={item.link} target="_blank" rel="noopener noreferrer" className={s.link}>
                {t('ссылка', 'link')}
              </a>
            </>
          )}
        </span>
      </div>
      <div className={s.rowActions}>
        <IconButton icon="edit" label={t('Изменить', 'Edit')} onClick={onEdit} />
        <IconButton
          icon="trash"
          label={t('Удалить', 'Remove')}
          onClick={handleRemove}
          disabled={remove.isPending}
        />
      </div>
    </li>
  )
}

type DialogState = { mode: 'closed' } | { mode: 'new' } | { mode: 'edit'; item: BragItem }

/** Brag document (идея 29): записи собираются сами, стажёр добавляет, правит, удаляет, выгружает в Markdown. */
export function BragTab() {
  const t = useT()
  const user = useUser()
  const brag = useBrag()
  const plan = usePlan()
  const mrs = useMergeRequests()
  const [dialog, setDialog] = useState<DialogState>({ mode: 'closed' })

  if (brag.isError) {
    return (
      <ErrorState
        text={t('Не получилось загрузить достижения', 'Could not load achievements')}
        onRetry={() => void brag.refetch()}
      />
    )
  }

  const items = sortBragItems(brag.data ?? [])
  const suggestions = bragSuggestions(plan.data?.tasks ?? [], mrs.data ?? [], items)
  const markdown = toMarkdown(items, user.employee.name)

  const copy = () =>
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(markdown))
      .then(() => toast(t('Скопировала Markdown', 'Markdown copied')))
      .catch(() => toast.error(t('Не получилось скопировать', 'Could not copy')))

  return (
    <div className={s.split}>
      <Card className={s.main} index={1}>
        <div className={s.cardHead}>
          <div>
            <h2 className={s.cardTitle}>{t('Мои достижения', 'My achievements')}</h2>
            <p className="t-s t-muted">
              {t('Brag document для экватора и оффера', 'Brag document for the midpoint and offer')}
            </p>
          </div>
          <Button variant="primary" icon="plus" onClick={() => setDialog({ mode: 'new' })}>
            {t('Добавить', 'Add')}
          </Button>
        </div>

        {brag.isPending ? (
          <div className={s.stack}>
            <Skeleton height={56} />
            <Skeleton height={56} />
            <Skeleton height={56} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            art={<IsoArt name="trophy" isFloating />}
            title={t('Пока пусто', 'Nothing yet')}
            text={t(
              'Закрой задачу из чек-листа или добавь свою запись',
              'Close a checklist task or add your own entry',
            )}
          />
        ) : (
          <ul className={s.bragList}>
            {items.map((item) => (
              <BragRow key={item.id} item={item} onEdit={() => setDialog({ mode: 'edit', item })} />
            ))}
          </ul>
        )}
      </Card>

      <div className={s.side}>
        <Card index={2} className={s.stack}>
          <Note tone="private" title={t('Видишь только ты', 'Only you can see this')}>
            {t(
              'Наставник и руководитель увидят документ, только если ты сама им его отправишь',
              'Your mentor and lead see it only if you send it yourself',
            )}
          </Note>
          <div className={s.exportRow}>
            <Button
              icon="download"
              disabled={items.length === 0}
              onClick={() => downloadMarkdown(markdown, 'brag-document.md')}
            >
              {t('Скачать .md', 'Download .md')}
            </Button>
            <Button variant="ghost" icon="copy" disabled={items.length === 0} onClick={copy}>
              {t('Копировать', 'Copy')}
            </Button>
          </div>
          <div className={s.badges}>
            <Badge tone="success" icon="check">
              {t(
                `${items.length} ${plural(items.length, ['запись', 'записи', 'записей'])}`,
                `${items.length} entries`,
              )}
            </Badge>
          </div>
        </Card>
        <Suggestions items={suggestions} />
      </div>

      {dialog.mode !== 'closed' && (
        <BragDialog
          key={dialog.mode === 'edit' ? dialog.item.id : 'new'}
          item={dialog.mode === 'edit' ? dialog.item : null}
          onClose={() => setDialog({ mode: 'closed' })}
        />
      )}
    </div>
  )
}
