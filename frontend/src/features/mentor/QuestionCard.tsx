import { useState } from 'react'
import { useAnswerEscalation, type Escalation } from '@/entities/escalations'
import { formatShort } from '@/shared/lib/date'
import { useT } from '@/shared/lib/i18n'
import { Button, Checkbox, Dialog, Note, Textarea, toast } from '@/shared/ui'
import { isAnswerValid } from './logic'
import s from './mentor.module.css'

type Props = {
  item: Escalation
  internName: string
}

/** Вопрос стажёра с перепиской перед ним (S-5) и форма ответа с «Добавить в базу знаний» (S-6). */
export function QuestionCard({ item, internName }: Props) {
  const t = useT()
  const answer = useAnswerEscalation()
  const [text, setText] = useState('')
  const [addToKb, setAddToKb] = useState(true)
  const [isConfirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const askConfirm = () => {
    if (!isAnswerValid(text)) {
      setError(t('Напиши ответ, хотя бы пару слов', 'Write an answer, at least a few words'))
      return
    }
    setError(undefined)
    setConfirmOpen(true)
  }

  const send = () =>
    answer.mutate(
      { id: item.id, answer: text.trim(), addToKb },
      {
        onSuccess: () => {
          setConfirmOpen(false)
          toast(
            addToKb
              ? t(
                  'Ответ отправлен и добавлен в базу знаний',
                  'Sent and added to the knowledge base',
                )
              : t('Ответ отправлен', 'Answer sent'),
          )
        },
        onError: () =>
          toast.error(t('Не получилось отправить ответ', 'Could not send the answer'), {
            label: t('Повторить', 'Retry'),
            run: send,
          }),
      },
    )

  return (
    <article className={s.question}>
      <header className={s.questionHead}>
        <span className="t-s t-muted">
          {internName} · {formatShort(item.createdAt.slice(0, 10))}
          {item.status === 'scheduled' &&
            ` · ${t('доставится в рабочее время', 'delivered in work hours')}`}
        </span>
        <h3 className={s.questionTitle}>{item.question}</h3>
      </header>

      {item.context.length > 0 && (
        <details className={s.context}>
          <summary>{t('Переписка перед вопросом', 'Chat before the question')}</summary>
          <ol className={s.transcript}>
            {item.context.map((line, i) => (
              <li key={i} className={line.from === 'bot' ? s.fromBot : s.fromIntern}>
                <b>{line.from === 'bot' ? 'buddy' : internName}</b>
                <span>{line.text}</span>
              </li>
            ))}
          </ol>
        </details>
      )}

      {item.tried && (
        <Note tone="info" title={t('Что уже пробовала', 'Already tried')}>
          {item.tried}
        </Note>
      )}

      <Textarea
        label={t('Твой ответ', 'Your answer')}
        value={text}
        rows={3}
        error={error}
        onChange={(event) => setText(event.target.value)}
        isOnSunken
      />
      <div className={s.answerFoot}>
        <label className={s.kbToggle}>
          <Checkbox
            isChecked={addToKb}
            onChange={setAddToKb}
            label={t('Добавить в базу знаний', 'Add to knowledge base')}
          />
          {/* Клик по подписи label передаёт кнопке-чекбоксу */}
          <span aria-hidden>{t('Добавить в базу знаний', 'Add to knowledge base')}</span>
        </label>
        <Button variant="primary" icon="send" onClick={askConfirm}>
          {t('Ответить', 'Reply')}
        </Button>
      </div>

      <Dialog
        isOpen={isConfirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t(`Отправить ответ: ${internName}?`, `Send the answer to ${internName}?`)}
        closeLabel={t('Закрыть', 'Close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              {t('Отмена', 'Cancel')}
            </Button>
            <Button variant="primary" icon="send" isLoading={answer.isPending} onClick={send}>
              {t('Отправить', 'Send')}
            </Button>
          </>
        }
      >
        <div className={s.confirm}>
          <p className={s.confirmText}>{text.trim()}</p>
          {addToKb && (
            <Note tone="success" icon="book">
              {t(
                'Бот будет сам отвечать на такой вопрос другим стажёрам',
                'The bot will answer this question for other interns',
              )}
            </Note>
          )}
        </div>
      </Dialog>
    </article>
  )
}
