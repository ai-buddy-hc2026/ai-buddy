import { useT } from '@/shared/lib/i18n'
import { IconButton } from '@/shared/ui'
import { agreementSchema, WHAT_MAX, type Agreement } from './meetingNotesLogic'
import s from './meetingNotes.module.css'

type Props = {
  item: Agreement
  index: number
  onChange: (patch: Partial<Omit<Agreement, 'id'>>) => void
  onRemove: () => void
}

const ownerSchema = agreementSchema.shape.owner

/** Один пункт черновика: кто, что, к какому сроку. */
export function AgreementEditor({ item, index, onChange, onRemove }: Props) {
  const t = useT()
  const n = index + 1
  return (
    <li className={s.agreement}>
      <select
        className={s.owner}
        value={item.owner}
        aria-label={t(`Кто делает, пункт ${n}`, `Owner, item ${n}`)}
        onChange={(event) => {
          const parsed = ownerSchema.safeParse(event.target.value)
          if (parsed.success) onChange({ owner: parsed.data })
        }}
      >
        <option value="intern">{t('Я', 'Me')}</option>
        <option value="mentor">{t('Наставник', 'Mentor')}</option>
        <option value="other">{t('Другой человек', 'Someone else')}</option>
      </select>
      <input
        className={s.what}
        value={item.what}
        maxLength={WHAT_MAX}
        placeholder={t('Что сделать', 'What to do')}
        aria-label={t(`Договорённость ${n}`, `Agreement ${n}`)}
        onChange={(event) => onChange({ what: event.target.value })}
      />
      <input
        className={s.due}
        type="date"
        value={item.due_date ?? ''}
        aria-label={t(`Срок, пункт ${n}. Пусто - без срока`, `Due, item ${n}. Empty - no due`)}
        onChange={(event) => onChange({ due_date: event.target.value || null })}
      />
      <IconButton
        icon="trash"
        size="s"
        label={t(`Удалить пункт ${n}`, `Remove item ${n}`)}
        onClick={onRemove}
      />
    </li>
  )
}
