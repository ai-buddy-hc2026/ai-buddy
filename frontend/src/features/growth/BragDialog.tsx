import { useState, type FormEvent } from 'react'
import { useAddBrag, type BragItem } from '@/entities/brag'
import { DEMO_TODAY } from '@/shared/lib/date'
import { useT, type Translate } from '@/shared/lib/i18n'
import { Button, Chip, ChipRow, Dialog, Input, Textarea, toast } from '@/shared/ui'
import {
  normalizeBragInput,
  TITLE_MAX,
  validateBragInput,
  type BragErrors,
  type BragType,
} from './bragLogic'
import { useUpdateBrag } from './data'
import s from './growth.module.css'

type Props = {
  /** null - новая запись */
  item: BragItem | null
  onClose: () => void
}

const EDITABLE_TYPES: readonly BragType[] = ['manual', 'task', 'pr', 'review', 'feedback']

function typeName(type: BragType, t: Translate): string {
  const names: Record<BragType, string> = {
    manual: t('Своё', 'Own'),
    task: t('Задача', 'Task'),
    pr: 'MR',
    review: t('Отзыв', 'Review'),
    feedback: t('Обратная связь', 'Feedback'),
  }
  return names[type]
}

function errorText(errors: BragErrors, t: Translate) {
  return {
    title:
      errors.title === 'required'
        ? t('Напиши, что получилось', 'Describe what you did')
        : errors.title === 'tooLong'
          ? t(`Не длиннее ${TITLE_MAX} символов`, `Up to ${TITLE_MAX} characters`)
          : undefined,
    date: errors.date ? t('Выбери дату', 'Pick a date') : undefined,
    link: errors.link
      ? t('Ссылка должна начинаться с https://', 'The link must start with https://')
      : undefined,
  }
}

/** Добавить или поправить запись brag document. */
export function BragDialog({ item, onClose }: Props) {
  const t = useT()
  const add = useAddBrag()
  const update = useUpdateBrag()
  const [form, setForm] = useState(() => ({
    type: item?.type ?? ('manual' as BragType),
    title: item?.title ?? '',
    date: item?.date ?? DEMO_TODAY,
    link: item?.link ?? '',
  }))
  const [errors, setErrors] = useState<BragErrors>({})
  const isSaving = add.isPending || update.isPending
  const texts = errorText(errors, t)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const input = normalizeBragInput(form)
    const found = validateBragInput(input)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    const callbacks = {
      onSuccess: () => {
        toast(item ? t('Запись обновлена', 'Entry updated') : t('Запись добавлена', 'Entry added'))
        onClose()
      },
      onError: () => toast.error(t('Не получилось сохранить', 'Could not save')),
    }
    if (item) update.mutate({ id: item.id, patch: input }, callbacks)
    else add.mutate(input, callbacks)
  }

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={item ? t('Изменить запись', 'Edit entry') : t('Новое достижение', 'New achievement')}
      closeLabel={t('Закрыть', 'Close')}
      footer={
        <>
          <Button variant="primary" type="submit" form="brag-form" isLoading={isSaving}>
            {t('Сохранить', 'Save')}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            {t('Отмена', 'Cancel')}
          </Button>
        </>
      }
    >
      <form id="brag-form" className={s.form} onSubmit={handleSubmit} noValidate>
        <fieldset className={s.fieldset}>
          <legend className={s.legend}>{t('Тип', 'Type')}</legend>
          <ChipRow isWrap>
            {EDITABLE_TYPES.map((type) => (
              <Chip
                key={type}
                isSelected={form.type === type}
                onClick={() => setForm({ ...form, type })}
              >
                {typeName(type, t)}
              </Chip>
            ))}
          </ChipRow>
        </fieldset>
        <Textarea
          label={t('Что получилось', 'What you did')}
          value={form.title}
          maxLength={TITLE_MAX}
          rows={3}
          error={texts.title}
          placeholder={t(
            'Например: разобралась, как устроен деплой',
            'For example: figured out how deploy works',
          )}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
        />
        <Input
          label={t('Дата', 'Date')}
          type="date"
          value={form.date}
          error={texts.date}
          onChange={(event) => setForm({ ...form, date: event.target.value })}
        />
        <Input
          label={t('Ссылка, если есть', 'Link, optional')}
          type="url"
          value={form.link}
          error={texts.link}
          placeholder="https://"
          onChange={(event) => setForm({ ...form, link: event.target.value })}
        />
      </form>
    </Dialog>
  )
}
