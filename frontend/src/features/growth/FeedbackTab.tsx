import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useConfirmAction } from '@/entities/actions'
import { getEmployee, teamOf } from '@/entities/employees'
import { DEMO, useUser } from '@/entities/session'
import { useSettings } from '@/entities/settings'
import { IsoArt } from '@/shared/iso'
import { formatShort } from '@/shared/lib/date'
import { useT, type Translate } from '@/shared/lib/i18n'
import { newId } from '@/shared/lib/storage'
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  Input,
  Note,
  Skeleton,
  Textarea,
  toast,
} from '@/shared/ui'
import {
  useCreateFeedback,
  useFeedbackRequests,
  useMergeRequests,
  useSaveFeedbackToBrag,
} from './data'
import {
  answerToBrag,
  buildFeedbackAction,
  effectiveStatus,
  MAX_OPEN_PER_PERSON,
  openCountTo,
  QUESTION_MAX,
  recipientsFor,
  sortRequests,
  validateFeedbackDraft,
  type FeedbackDraft,
  type FeedbackErrors,
  type FeedbackRequest,
} from './feedbackLogic'
import type { MergeRequest } from './skillsLogic'
import s from './growth.module.css'

const OWN_LINK = 'own'

function quickQuestions(t: Translate): string[] {
  return [
    t('Что улучшить в моих тестах?', 'What should I improve in my tests?'),
    t('Понятно ли написан код?', 'Is the code easy to read?'),
    t('Что бы ты сделал по-другому?', 'What would you do differently?'),
  ]
}

function errorTexts(errors: FeedbackErrors, t: Translate) {
  return {
    toId:
      errors.toId === 'limit'
        ? t(
            `У человека уже ${MAX_OPEN_PER_PERSON} открытых запроса. Подожди ответа`,
            `This person already has ${MAX_OPEN_PER_PERSON} open requests`,
          )
        : errors.toId
          ? t('Выбери, кого спросить', 'Pick who to ask')
          : undefined,
    artifactUrl: errors.artifactUrl
      ? t('Нужна ссылка https://', 'An https:// link is needed')
      : undefined,
    question:
      errors.question === 'tooLong'
        ? t(`Не длиннее ${QUESTION_MAX} символов`, `Up to ${QUESTION_MAX} characters`)
        : errors.question
          ? t('Задай конкретный вопрос', 'Ask a specific question')
          : undefined,
  }
}

type Prepared = { draft: FeedbackDraft; key: string }

function DraftCard({
  prepared,
  onEdit,
  onSent,
}: {
  prepared: Prepared
  onEdit: () => void
  onSent: () => void
}) {
  const t = useT()
  const confirm = useConfirmAction()
  const create = useCreateFeedback()
  const recipient = getEmployee(prepared.draft.toId)
  const action = buildFeedbackAction(
    prepared.draft,
    recipient?.name ?? prepared.draft.toId,
    prepared.key,
  )
  const isBusy = confirm.isPending || create.isPending

  const send = () =>
    confirm.mutate(action, {
      onSuccess: (result) =>
        create.mutate(
          { draft: prepared.draft, externalId: result.externalId },
          {
            onSuccess: () => {
              toast(
                t(
                  `Запрос ушёл, номер ${result.externalId ?? ''}`,
                  `Request sent, number ${result.externalId ?? ''}`,
                ),
              )
              onSent()
            },
            onError: () =>
              toast.error(
                t('Запрос ушёл, но не сохранился в списке', 'Sent, but not saved to the list'),
              ),
          },
        ),
    })

  return (
    <div className={s.stack} role="group" aria-label={t('Черновик запроса', 'Request draft')}>
      <div className={s.headRow}>
        <Badge tone="accent">{t('Черновик', 'Draft')}</Badge>
        <span className="t-s t-muted">
          {t('Уйдёт только после кнопки «Отправить»', 'Goes out only after you press Send')}
        </span>
      </div>
      <dl className={s.details}>
        {action.details.map((detail) => (
          <div key={detail.label}>
            <dt>{detail.label}</dt>
            <dd>{detail.value}</dd>
          </div>
        ))}
      </dl>
      {recipient && (
        <p className="t-s t-muted">
          {t(
            `${recipient.short} получит запрос в рабочие часы (${recipient.workHours.start}-${recipient.workHours.end})`,
            `${recipient.short} gets it during work hours (${recipient.workHours.start}-${recipient.workHours.end})`,
          )}
        </p>
      )}
      {confirm.isError && (
        <Note tone="error" title={t('Не получилось отправить', 'Could not send')}>
          {confirm.error.message}
        </Note>
      )}
      <div className={s.actions}>
        <Button
          variant="primary"
          icon={confirm.isError ? 'refresh' : 'send'}
          isLoading={isBusy}
          onClick={send}
        >
          {confirm.isError ? t('Повторить', 'Retry') : t('Отправить', 'Send')}
        </Button>
        <Button variant="ghost" disabled={isBusy} onClick={onEdit}>
          {t('Изменить', 'Edit')}
        </Button>
      </div>
    </div>
  )
}

type FormProps = { mrs: readonly MergeRequest[]; requests: readonly FeedbackRequest[] }

function RequestForm({ mrs, requests }: FormProps) {
  const t = useT()
  const user = useUser()
  const [artifact, setArtifact] = useState<string>(mrs[0]?.id ?? OWN_LINK)
  const [ownUrl, setOwnUrl] = useState('')
  const [toId, setToId] = useState('')
  const [question, setQuestion] = useState('')
  const [errors, setErrors] = useState<FeedbackErrors>({})
  const [prepared, setPrepared] = useState<Prepared | null>(null)

  const mr = mrs.find((m) => m.id === artifact) ?? null
  const recipients = recipientsFor(
    mr,
    teamOf(user.employee.teamId),
    DEMO.mentorId,
    user.employee.id,
  )
  const chosenTo = recipients.some((e) => e.id === toId) ? toId : (recipients[0]?.id ?? '')
  const texts = errorTexts(errors, t)

  const draft: FeedbackDraft = {
    toId: chosenTo,
    artifactUrl: mr ? mr.url : ownUrl,
    artifactTitle: mr ? `MR !${mr.number}: ${mr.title}` : ownUrl,
    question,
  }

  const prepare = () => {
    const found = validateFeedbackDraft(draft, requests)
    setErrors(found)
    if (Object.keys(found).length === 0) setPrepared({ draft, key: newId('fb-req') })
  }

  const reset = () => {
    setPrepared(null)
    setQuestion('')
  }

  if (prepared)
    return <DraftCard prepared={prepared} onEdit={() => setPrepared(null)} onSent={reset} />

  return (
    <div className={s.form}>
      <fieldset className={s.fieldset}>
        <legend className={s.legend}>{t('Что оценить', 'What to review')}</legend>
        <ChipRow isWrap>
          {mrs.map((m) => (
            <Chip key={m.id} isSelected={artifact === m.id} onClick={() => setArtifact(m.id)}>
              MR !{m.number}
            </Chip>
          ))}
          <Chip
            icon="attach"
            isSelected={artifact === OWN_LINK}
            onClick={() => setArtifact(OWN_LINK)}
          >
            {t('Своя ссылка', 'Own link')}
          </Chip>
        </ChipRow>
        {mr && <p className="t-s t-muted">{mr.title}</p>}
        {!mr && (
          <Input
            label={t('Ссылка', 'Link')}
            type="url"
            placeholder="https://"
            value={ownUrl}
            error={texts.artifactUrl}
            onChange={(event) => setOwnUrl(event.target.value)}
          />
        )}
      </fieldset>

      <fieldset className={s.fieldset}>
        <legend className={s.legend}>{t('Кого спросить', 'Who to ask')}</legend>
        <ChipRow isWrap>
          {recipients.map((e) => (
            <Chip key={e.id} isSelected={chosenTo === e.id} onClick={() => setToId(e.id)}>
              {e.name} · {openCountTo(requests, e.id)}/{MAX_OPEN_PER_PERSON}
            </Chip>
          ))}
        </ChipRow>
        <p className="t-s t-muted">
          {t(
            'Ревьюер этого MR или наставник. Цифра - открытые запросы',
            'The MR reviewer or your mentor. The number shows open requests',
          )}
        </p>
        {texts.toId && (
          <p className={s.error} role="alert">
            {texts.toId}
          </p>
        )}
      </fieldset>

      <Textarea
        label={t('Вопрос', 'Question')}
        value={question}
        rows={3}
        maxLength={QUESTION_MAX}
        error={texts.question}
        placeholder={t('Спроси что-то конкретное', 'Ask something specific')}
        onChange={(event) => setQuestion(event.target.value)}
      />
      <ChipRow isWrap>
        {quickQuestions(t).map((q) => (
          <Chip key={q} onClick={() => setQuestion(q)}>
            {q}
          </Chip>
        ))}
      </ChipRow>
      <div className={s.actions}>
        <Button variant="primary" icon="edit" onClick={prepare}>
          {t('Подготовить черновик', 'Prepare a draft')}
        </Button>
      </div>
    </div>
  )
}

function StatusBadge({ request }: { request: FeedbackRequest }) {
  const t = useT()
  const status = effectiveStatus(request)
  if (status === 'answered')
    return (
      <Badge tone="success" icon="check">
        {t('Ответ есть', 'Answered')}
      </Badge>
    )
  if (status === 'expired')
    return <Badge icon="clock">{t('Без ответа 7 дней', 'No answer in 7 days')}</Badge>
  return (
    <Badge tone="warning" icon="clock">
      {t('Ждёт ответа', 'Waiting')}
    </Badge>
  )
}

function RequestItem({ request }: { request: FeedbackRequest }) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const save = useSaveFeedbackToBrag()
  const author = getEmployee(request.toId)
  const bragItem = answerToBrag(request, author?.short ?? request.toId)

  const handleSave = () => {
    if (!bragItem) return
    save.mutate(
      { requestId: request.id, item: bragItem },
      {
        onSuccess: () => toast(t('Сохранила в достижения', 'Saved to achievements')),
        onError: () => toast.error(t('Не получилось сохранить', 'Could not save')),
      },
    )
  }

  return (
    <li className={s.request}>
      <div className={s.requestHead}>
        <Avatar name={author?.name ?? request.toId} color={author?.color} size={36} />
        <div className={s.bragBody}>
          <b>{author?.name ?? request.toId}</b>
          <span className="t-s t-muted">
            {formatShort(request.sentAt, lang)} ·{' '}
            <a
              href={request.artifactUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={s.link}
            >
              {request.artifactTitle}
            </a>
          </span>
        </div>
        <StatusBadge request={request} />
      </div>
      <p className={s.question}>{request.question}</p>
      {request.answer && <p className={s.answer}>{request.answer}</p>}
      {bragItem &&
        (request.savedToBrag ? (
          <Badge tone="success" icon="star">
            {t('В достижениях', 'In achievements')}
          </Badge>
        ) : (
          <Button size="s" icon="star" isLoading={save.isPending} onClick={handleSave}>
            {t('Сохранить в мои достижения', 'Save to my achievements')}
          </Button>
        ))}
    </li>
  )
}

/** Обратная связь по запросу (идея 48): черновик -> «Отправить» -> ответ -> в brag document по кнопке. */
export function FeedbackTab() {
  const t = useT()
  const mrs = useMergeRequests()
  const requests = useFeedbackRequests()

  if (mrs.isError || requests.isError) {
    const retry = () => {
      void mrs.refetch()
      void requests.refetch()
    }
    return (
      <ErrorState
        text={t('Не получилось загрузить запросы', 'Could not load requests')}
        onRetry={retry}
      />
    )
  }

  const list = sortRequests(requests.data ?? [])

  return (
    <div className={s.split}>
      <Card className={s.main} index={0}>
        <div className={s.cardHead}>
          <div>
            <h2 className={s.cardTitle}>{t('Попросить отзыв', 'Ask for feedback')}</h2>
            <p className="t-s t-muted">
              {t(
                'Не жди экватора: один вопрос по конкретной работе',
                'Do not wait for the midpoint: one question about one piece of work',
              )}
            </p>
          </div>
        </div>
        {mrs.isPending || requests.isPending ? (
          <Skeleton height={320} />
        ) : (
          <RequestForm mrs={mrs.data} requests={requests.data} />
        )}
      </Card>

      <Card className={s.side} index={1}>
        <h2 className={s.cardTitle}>{t('Мои запросы', 'My requests')}</h2>
        {requests.isPending ? (
          <Skeleton height={160} />
        ) : list.length === 0 ? (
          <EmptyState
            art={<IsoArt name="chat" isFloating />}
            title={t('Запросов пока нет', 'No requests yet')}
            text={t('Ответы появятся здесь', 'Answers will show up here')}
          />
        ) : (
          <ul className={s.requestList} aria-live="polite">
            {list.map((request) => (
              <RequestItem key={request.id} request={request} />
            ))}
          </ul>
        )}
        <Link to="/actions" className={s.link}>
          {t('История действий', 'Action history')}
        </Link>
      </Card>
    </div>
  )
}
