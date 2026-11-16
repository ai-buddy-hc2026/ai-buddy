import { useState } from 'react'
import { plural, useT } from '@/shared/lib/i18n'
import { newId } from '@/shared/lib/storage'
import { Button, Dialog, Note, Textarea, toast } from '@/shared/ui'
import { AgreementEditor } from './AgreementEditor'
import { MEETING_PEOPLE, useSaveMeetingNotes } from './meetingNotesData'
import {
  addAgreement,
  extractMeeting,
  extractWithRetry,
  finalizeDraft,
  NOTES_MAX,
  removeAgreement,
  SUMMARY_MAX,
  updateAgreement,
  type MeetingDraft,
  type MeetingRecord,
} from './meetingNotesLogic'
import s from './meetingNotes.module.css'

type Props = {
  meetingId: string
  /** «1:1 · Илья · чт, 12.11 14:00» */
  label: string
  saved: MeetingRecord | undefined
  onClose: () => void
}

function DraftEditor({
  draft,
  onChange,
}: {
  draft: MeetingDraft
  onChange: (next: MeetingDraft) => void
}) {
  const t = useT()
  const setAgreements = (agreements: MeetingDraft['agreements']) =>
    onChange({ ...draft, agreements })
  return (
    <>
      <Textarea
        label={t('Саммари', 'Summary')}
        value={draft.summary}
        maxLength={SUMMARY_MAX}
        rows={3}
        onChange={(event) => onChange({ ...draft, summary: event.target.value })}
      />
      <h3 className={s.subTitle}>{t('Договорённости', 'Agreements')}</h3>
      {draft.agreements.length === 0 ? (
        <p className="t-s t-muted">
          {t(
            'Договорённостей не нашла. Сохраню только саммари или добавь пункт сама',
            'No agreements found. I will save only the summary, or add an item',
          )}
        </p>
      ) : (
        <ul className={s.agreements}>
          {draft.agreements.map((item, index) => (
            <AgreementEditor
              key={item.id}
              item={item}
              index={index}
              onChange={(patch) => setAgreements(updateAgreement(draft.agreements, item.id, patch))}
              onRemove={() => setAgreements(removeAgreement(draft.agreements, item.id))}
            />
          ))}
        </ul>
      )}
      <div>
        <Button
          size="s"
          variant="ghost"
          icon="plus"
          onClick={() => setAgreements(addAgreement(draft.agreements, newId('ag')))}
        >
          {t('Добавить пункт', 'Add item')}
        </Button>
      </div>
      <Note>
        {t(
          'Задачи наставника тоже попадут в план с пометкой, их видите оба',
          'Mentor tasks also go to the plan with a label, you both see them',
        )}
      </Note>
    </>
  )
}

/** Итоги встречи (идея 8): заметки -> черновик -> правка -> «Сохранить» -> задачи в чек-листе. */
export function MeetingNotesDialog({ meetingId, label, saved, onClose }: Props) {
  const t = useT()
  const save = useSaveMeetingNotes()
  const [notes, setNotes] = useState('')
  const [draft, setDraft] = useState<MeetingDraft | null>(() =>
    saved ? { summary: saved.summary, agreements: saved.agreements } : null,
  )
  const [error, setError] = useState<string | null>(null)

  const analyze = () => {
    const result = extractWithRetry(() => extractMeeting(notes, MEETING_PEOPLE))
    if (!result.ok) {
      setError(
        t(
          'Не получилось разобрать заметки. Допиши пару фраз и попробуй ещё раз',
          'Could not parse the notes. Add a few phrases and try again',
        ),
      )
      return
    }
    setError(null)
    setDraft(result.draft)
  }

  const submit = () => {
    const final = draft && finalizeDraft(draft)
    if (!final) {
      setError(t('Напиши пару слов в саммари', 'Write a few words in the summary'))
      return
    }
    setError(null)
    save.mutate(
      { meetingId, draft: final },
      {
        onSuccess: (record) => {
          const n = record.taskCount
          toast(
            n > 0
              ? t(
                  `Итоги сохранены. Добавила ${n} ${plural(n, ['задачу', 'задачи', 'задач'])} в чек-лист`,
                  `Summary saved. Added ${n} task(s) to the checklist`,
                )
              : t('Итоги сохранены', 'Summary saved'),
          )
          onClose()
        },
        onError: () =>
          toast.error(t('Не получилось сохранить итоги', 'Could not save the summary')),
      },
    )
  }

  const footer = draft ? (
    <>
      <Button variant="ghost" disabled={save.isPending} onClick={() => setDraft(null)}>
        {t('К заметкам', 'Back to notes')}
      </Button>
      <Button variant="primary" icon="check" isLoading={save.isPending} onClick={submit}>
        {t('Сохранить', 'Save')}
      </Button>
    </>
  ) : (
    <>
      <Button variant="ghost" onClick={onClose}>
        {t('Отмена', 'Cancel')}
      </Button>
      <Button variant="primary" icon="sparkle" disabled={!notes.trim()} onClick={analyze}>
        {t('Разобрать', 'Parse')}
      </Button>
    </>
  )

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={t('Итоги встречи', 'Meeting summary')}
      closeLabel={t('Закрыть', 'Close')}
      width={640}
      footer={footer}
    >
      <div className={s.body}>
        <p className="t-s t-muted">{label}</p>
        {draft ? (
          <DraftEditor draft={draft} onChange={setDraft} />
        ) : (
          <>
            <Textarea
              label={t('Заметки или текст встречи', 'Notes or meeting text')}
              value={notes}
              maxLength={NOTES_MAX}
              rows={7}
              placeholder={t(
                'Например: Илья выдаст доступ к k8s до среды, я читаю гайд по тестам',
                'E.g. Ilya grants k8s access by Wednesday, I read the testing guide',
              )}
              onChange={(event) => setNotes(event.target.value)}
            />
            <Note tone="private" title={t('Видишь только ты', 'Only you see this')}>
              {t(
                'Заметки не сохраняются. В план попадут только пункты, которые ты подтвердишь',
                'Notes are not stored. Only confirmed items go to the plan',
              )}
            </Note>
          </>
        )}
        {error && <Note tone="error">{error}</Note>}
      </div>
    </Dialog>
  )
}
