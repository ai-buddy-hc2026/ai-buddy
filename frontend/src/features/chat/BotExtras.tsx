import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useConfirmAction } from '@/entities/actions'
import { mustEmployee } from '@/entities/employees'
import { useCreateEscalation } from '@/entities/escalations'
import { DEMO } from '@/entities/session'
import { useSettings } from '@/entities/settings'
import { Badge, Button, Chip, ChipRow, Dialog, Icon, Note, Tag, toast } from '@/shared/ui'
import { DEMO_TODAY, formatShort, formatTime, nextWorkday } from '@/shared/lib/date'
import { useT } from '@/shared/lib/i18n'
import { AbsenceDraftCard } from './AbsenceDraftCard'
import { ABSENCE_TYPES, buildEscalationContext } from './bot'
import type { AbsenceType, BotMeta, Message, Source } from './model'
import s from './Chat.module.css'

type Props = {
  message: Message
  messages: readonly Message[]
  onPatch: (meta: BotMeta) => void
  onChooseAbsence: (date: string, type: AbsenceType) => void
}

/** То, что бот прикладывает под ответом: источник, кнопки, карточки. */
export function BotExtras({ message, messages, onPatch, onChooseAbsence }: Props) {
  const t = useT()
  const meta = message.meta
  if (!meta) return null
  switch (meta.kind) {
    case 'next':
      return (
        <div className={s.extras}>
          <Link to="/onboarding" search={{ tab: 'plan' }} className={s.linkChip}>
            <Icon name="plan" size={16} />
            {t('Открыть план', 'Open plan')}
          </Link>
        </div>
      )
    case 'kb':
      return <SourceLine source={meta.source} />
    case 'mentor':
      return (
        <div className={s.extras}>
          <Tag icon="user">
            {t('Ответ наставника', 'Mentor answer')}: {meta.mentorName}
            {meta.answeredAt ? `, ${formatShort(meta.answeredAt.slice(0, 10))}` : ''}
          </Tag>
          <span className={s.disclaimer}>
            {t('Сохранён в базу знаний по вопросу', 'Saved to knowledge base for')}: «
            {meta.question}»
          </span>
        </div>
      )
    case 'absenceAsk':
      return <AbsenceAsk meta={meta} onChoose={onChooseAbsence} />
    case 'absenceDraft':
      return <AbsenceDraftCard meta={meta} onChange={onPatch} />
    case 'denied':
      return (
        <div className={s.extras}>
          <Badge tone="error" icon="shield">
            policy_denied
          </Badge>
          <Link to="/actions" className={s.inlineLink}>
            {t('История действий', 'Action history')}
          </Link>
        </div>
      )
    case 'notFound':
      return (
        <Escalate
          messageId={message.id}
          meta={meta}
          context={buildEscalationContext(messages, message.id)}
          onSent={onPatch}
        />
      )
  }
}

function SourceLine({ source }: { source: Source }) {
  const t = useT()
  return (
    <div className={s.extras}>
      <Tag icon="doc">{source.title}</Tag>
      <span className={s.disclaimer}>
        {t('Проверен', 'Reviewed')} {formatShort(source.reviewedAt)}, {t('владелец', 'owner')}:{' '}
        {source.ownerName}
      </span>
      {source.isStale && (
        <Badge tone="warning" icon="alert">
          {t('Может быть устаревшим', 'May be outdated')}
        </Badge>
      )}
      <span className={s.disclaimer}>
        {t('Тестовая инструкция, не регламент Авито', 'Test guide, not an Avito policy')}
      </span>
    </div>
  )
}

type AskMeta = Extract<BotMeta, { kind: 'absenceAsk' }>

function AbsenceAsk({
  meta,
  onChoose,
}: {
  meta: AskMeta
  onChoose: (date: string, type: AbsenceType) => void
}) {
  const t = useT()
  const lang = useSettings((st) => st.lang)
  const [date, setDate] = useState(meta.date)
  return (
    <div className={s.extras}>
      {meta.source && <SourceLine source={meta.source} />}
      <fieldset className={s.fieldset} disabled={meta.isAnswered}>
        <legend>{t('Дата', 'Date')}</legend>
        <ChipRow isWrap>
          {meta.options.map((d) => (
            <Chip key={d} isSelected={d === date} onClick={() => setDate(d)}>
              {formatShort(d, lang)}
            </Chip>
          ))}
        </ChipRow>
      </fieldset>
      <fieldset className={s.fieldset} disabled={meta.isAnswered}>
        <legend>{t('Тип', 'Type')}</legend>
        <ChipRow isWrap>
          {ABSENCE_TYPES.map((type) => (
            <Chip key={type.id} onClick={() => onChoose(date, type.id)}>
              {lang === 'en' ? type.en : type.ru}
            </Chip>
          ))}
        </ChipRow>
      </fieldset>
    </div>
  )
}

type NotFoundMeta = Extract<BotMeta, { kind: 'notFound' }>

type EscalateProps = {
  messageId: string
  meta: NotFoundMeta
  context: Array<{ from: 'intern' | 'bot'; text: string }>
  onSent: (meta: NotFoundMeta) => void
}

const MENTOR_START = '10:00'

/** S-5: вопрос наставнику уходит только после подтверждения в диалоге. */
function Escalate({ messageId, meta, context, onSent }: EscalateProps) {
  const t = useT()
  const [isOpen, setOpen] = useState(false)
  const confirm = useConfirmAction()
  const create = useCreateEscalation()
  const mentor = mustEmployee(DEMO.mentorId)
  const isNight = useSettings((st) => st.simulateNight)
  const isBusy = confirm.isPending || create.isPending
  const error = confirm.error ?? create.error

  if (meta.status === 'sent') {
    return (
      <div className={s.extras}>
        <Badge tone="success" icon="check">
          {meta.deliverAt
            ? t(
                `Передано, ${mentor.short} увидит в ${formatTime(meta.deliverAt)}`,
                `Sent, ${mentor.short} will see it at ${formatTime(meta.deliverAt)}`,
              )
            : t(`Передано: ${mentor.name}`, `Sent to ${mentor.name}`)}
        </Badge>
      </div>
    )
  }

  const submit = async () => {
    const deliverAt = isNight ? `${nextWorkday(DEMO_TODAY)}T${MENTOR_START}:00` : null
    try {
      await confirm.mutateAsync({
        kind: 'escalation',
        title: 'Вопрос наставнику',
        details: [
          { label: 'Вопрос', value: meta.question },
          { label: 'Кому', value: mentor.name },
        ],
        idempotencyKey: `esc-${messageId}`,
        status: deliverAt ? 'scheduled' : 'sent',
      })
      await create.mutateAsync({
        internId: DEMO.internId,
        mentorId: mentor.id,
        question: meta.question,
        context,
        tried: '',
        deliverAt,
      })
      setOpen(false)
      onSent({ ...meta, status: 'sent', deliverAt })
      toast(t('Вопрос передан наставнику', 'Question sent to your mentor'))
    } catch {
      // Ошибка показана в диалоге, там же кнопка «Повторить»
    }
  }

  return (
    <div className={s.extras}>
      <Button variant="accent" size="s" icon="user" onClick={() => setOpen(true)}>
        {t('Передать наставнику', 'Ask the mentor')}
      </Button>
      <Dialog
        isOpen={isOpen}
        onClose={() => setOpen(false)}
        title={t('Передать вопрос наставнику?', 'Send to your mentor?')}
        closeLabel={t('Закрыть', 'Close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isBusy}>
              {t('Не сейчас', 'Not now')}
            </Button>
            <Button
              variant="primary"
              icon={error ? 'refresh' : 'send'}
              isLoading={isBusy}
              onClick={() => void submit()}
            >
              {error
                ? t('Повторить', 'Retry')
                : t(`Отправить ${mentor.short}`, `Send to ${mentor.short}`)}
            </Button>
          </>
        }
      >
        <div className={s.dialogBody}>
          <p>
            <b>{mentor.name}</b>{' '}
            {t(
              'увидит вопрос и переписку перед ним',
              'will see the question and the chat before it',
            )}
          </p>
          <blockquote className={s.quote}>{meta.question}</blockquote>
          {context.length > 0 && (
            <ul className={s.contextList}>
              {context.map((c, i) => (
                <li key={i}>
                  <b>{c.from === 'intern' ? t('Ты', 'You') : 'buddy'}:</b> {c.text}
                </li>
              ))}
            </ul>
          )}
          {isNight && (
            <Note tone="info" icon="clock">
              {t(
                `Сейчас нерабочее время. Доставлю в ${MENTOR_START}`,
                `Out of hours. Will deliver at ${MENTOR_START}`,
              )}
            </Note>
          )}
          {error && (
            <Note tone="error" title={t('Не получилось отправить', 'Could not send')}>
              {error.message}
            </Note>
          )}
        </div>
      </Dialog>
    </div>
  )
}
