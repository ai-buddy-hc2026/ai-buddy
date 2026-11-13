import { useState } from 'react'
import { useConfirmAction } from '@/entities/actions'
import { mustEmployee } from '@/entities/employees'
import { useCreateEscalation } from '@/entities/escalations'
import type { Task } from '@/entities/plan'
import { DEMO } from '@/entities/session'
import { useSettings } from '@/entities/settings'
import { DEMO_TODAY, nextWorkday } from '@/shared/lib/date'
import { useT } from '@/shared/lib/i18n'
import { Button, Dialog, Note, Textarea, toast } from '@/shared/ui'
import { TRIED_MAX, escalationKey, escalationQuestion } from './snooze'
import s from './stuck.module.css'

type Props = {
  task: Task
  days: number
  isOpen: boolean
  onClose: () => void
  onSent: () => void
}

const MENTOR_START = '10:00'

/** Черновик эскалации наставнику (идея 25). Уходит только по кнопке «Отправить». */
export function StuckEscalateDialog({ task, days, isOpen, onClose, onSent }: Props) {
  const t = useT()
  const mentor = mustEmployee(DEMO.mentorId)
  const isNight = useSettings((state) => state.simulateNight)
  const confirm = useConfirmAction()
  const create = useCreateEscalation()
  const [tried, setTried] = useState('')
  const question = escalationQuestion(task, days)
  const isBusy = confirm.isPending || create.isPending
  const error = confirm.error ?? create.error

  const submit = async () => {
    const deliverAt = isNight ? `${nextWorkday(DEMO_TODAY)}T${MENTOR_START}:00` : null
    const cleanTried = tried.trim().slice(0, TRIED_MAX)
    try {
      await confirm.mutateAsync({
        kind: 'escalation',
        title: 'Вопрос наставнику по зависшей задаче',
        details: [
          { label: 'Задача', value: task.title },
          { label: 'Без движения', value: `${days} раб. дн.` },
          { label: 'Что пробовала', value: cleanTried || '-' },
          { label: 'Кому', value: mentor.name },
        ],
        idempotencyKey: escalationKey(task),
        status: deliverAt ? 'scheduled' : 'sent',
      })
      await create.mutateAsync({
        internId: DEMO.internId,
        mentorId: mentor.id,
        question,
        context: [],
        tried: cleanTried,
        deliverAt,
      })
      toast(
        deliverAt
          ? t(
              `Передано. ${mentor.short} увидит утром`,
              `Sent. ${mentor.short} will see it in the morning`,
            )
          : t(`Передано: ${mentor.name}`, `Sent to ${mentor.name}`),
      )
      onSent()
    } catch {
      // Ошибка показана в диалоге, там же можно повторить
    }
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t(`Передать ${mentor.short}?`, `Send to ${mentor.short}?`)}
      closeLabel={t('Закрыть', 'Close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isBusy}>
            {t('Отмена', 'Cancel')}
          </Button>
          <Button variant="primary" icon="send" isLoading={isBusy} onClick={() => void submit()}>
            {error ? t('Повторить', 'Retry') : t('Отправить', 'Send')}
          </Button>
        </>
      }
    >
      <div className={s.dialogBody}>
        <dl className={s.details}>
          <div>
            <dt>{t('Задача', 'Task')}</dt>
            <dd>{task.title}</dd>
          </div>
          <div>
            <dt>{t('Без движения', 'Stalled for')}</dt>
            <dd>{t(`${days} раб. дн.`, `${days} workdays`)}</dd>
          </div>
          <div>
            <dt>{t('Кому', 'To')}</dt>
            <dd>{mentor.name}</dd>
          </div>
        </dl>
        <Textarea
          label={t('Что я уже пробовала', 'What I already tried')}
          value={tried}
          maxLength={TRIED_MAX}
          rows={4}
          placeholder={t(
            'Например: прошла гайд до шага 4, падает docker compose',
            'E.g. followed the guide to step 4, docker compose fails',
          )}
          onChange={(event) => setTried(event.target.value)}
        />
        {error && (
          <Note tone="error" title={t('Не отправилось', 'Not sent')}>
            {error.message}
          </Note>
        )}
        <p className="t-s t-muted">
          {t(
            'Без твоей кнопки наставнику ничего не уходит',
            'Nothing goes to your mentor until you press the button',
          )}
        </p>
      </div>
    </Dialog>
  )
}
