import { Link, useSearch } from '@tanstack/react-router'
import { getEmployee } from '@/entities/employees'
import { useEscalations } from '@/entities/escalations'
import { countDone, pickNextStep, usePlan } from '@/entities/plan'
import { DEMO } from '@/entities/session'
import { IsoArt, IsoCity } from '@/shared/iso'
import { useT } from '@/shared/lib/i18n'
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Eyebrow,
  Icon,
  Meter,
  Page,
  PageHeader,
  Row,
  Skeleton,
} from '@/shared/ui'
import { QuestionCard } from './QuestionCard'
import { answeredQuestions, openQuestions, resolveInternId, tasksNeedingHelp } from './logic'
import s from './mentor.module.css'

function ProgressCard({ internId }: { internId: string }) {
  const t = useT()
  const plan = usePlan()

  if (internId !== DEMO.internId) {
    return (
      <Card className={s.progress} index={0}>
        <EmptyState art={<IsoArt name="plot" />} title={t('Плана пока нет', 'No plan yet')} />
      </Card>
    )
  }
  if (plan.isPending) return <Skeleton height={360} radius={28} />
  if (plan.isError) {
    return (
      <Card className={s.progress}>
        <ErrorState
          text={t('Не получилось загрузить план', 'Could not load the plan')}
          onRetry={() => void plan.refetch()}
        />
      </Card>
    )
  }

  const tasks = plan.data.tasks
  const done = countDone(tasks)
  const next = pickNextStep(tasks)
  const help = tasksNeedingHelp(tasks)

  return (
    <Card className={s.progress} index={0}>
      <Eyebrow>{t(`Неделя ${plan.data.week}`, `Week ${plan.data.week}`)}</Eyebrow>
      <p className={s.bigNumber}>
        <b>{done}</b> {t(`из ${tasks.length} задач`, `of ${tasks.length} tasks`)}
      </p>
      <Meter
        value={done}
        max={tasks.length}
        label={t('Прогресс онбординга', 'Onboarding progress')}
      />
      <IsoCity
        tasks={tasks}
        currentId={next?.id}
        className={s.city}
        label={t('Город прогресса стажёра', 'Intern progress city')}
      />
      {next && (
        <p className="t-s">
          <span className="t-muted">{t('Сейчас: ', 'Now: ')}</span>
          <b>{next.title}</b>
        </p>
      )}
      {help.length > 0 && (
        <div className={s.help}>
          <Eyebrow>{t('Может понадобиться помощь', 'May need help')}</Eyebrow>
          {help.map((task) => (
            <Row
              key={task.id}
              leading={<Icon name={task.status === 'blocked' ? 'lock' : 'clock'} size={20} />}
              title={task.title}
              subtitle={
                task.status === 'blocked'
                  ? task.note || t('Заблокирована', 'Blocked')
                  : t('Давно без движения', 'Stalled')
              }
            />
          ))}
        </div>
      )}
    </Card>
  )
}

function QuestionsCard({ internId, internName }: { internId: string; internName: string }) {
  const t = useT()
  const query = useEscalations()

  if (query.isPending) return <Skeleton height={360} radius={28} />
  if (query.isError) {
    return (
      <Card className={s.questions}>
        <ErrorState
          text={t('Не получилось загрузить вопросы', 'Could not load questions')}
          onRetry={() => void query.refetch()}
        />
      </Card>
    )
  }

  const open = openQuestions(query.data, internId)
  const answered = answeredQuestions(query.data, internId)

  return (
    <Card className={s.questions} index={1} aria-labelledby="mentor-questions">
      <header className={s.cardHead}>
        <h2 id="mentor-questions" className={s.cardTitle}>
          {t('Вопросы', 'Questions')}
        </h2>
        {open.length > 0 && (
          <Badge tone="sale">{t(`${open.length} ждут`, `${open.length} waiting`)}</Badge>
        )}
      </header>

      <div aria-live="polite" className={s.questionList}>
        {open.length === 0 ? (
          <EmptyState
            art={<IsoArt name="chat" />}
            title={t('Новых вопросов нет', 'No new questions')}
            text={t('Бот справляется сам', 'The bot handles it')}
          />
        ) : (
          open.map((item) => <QuestionCard key={item.id} item={item} internName={internName} />)
        )}
      </div>

      {answered.length > 0 && (
        <details className={s.answered}>
          <summary>{t(`Отвеченные (${answered.length})`, `Answered (${answered.length})`)}</summary>
          {answered.map((item) => (
            <Row
              key={item.id}
              title={item.question}
              subtitle={item.answer}
              trailing={
                item.addedToKb ? (
                  <Badge tone="success" icon="book">
                    {t('В базе знаний', 'In KB')}
                  </Badge>
                ) : undefined
              }
            />
          ))}
        </details>
      )}
    </Card>
  )
}

/** Экран наставника (S-5, S-6, демо шаг 8): прогресс стажёра и его вопросы. */
export function MentorPage() {
  const t = useT()
  const search = useSearch({ strict: false })
  const internId = resolveInternId(search.id)
  const intern = getEmployee(internId)
  const name = intern?.name ?? internId
  const short = intern?.short ?? name

  return (
    <Page>
      <PageHeader
        title={name}
        subtitle={t('Сводка для наставника', 'Mentor summary')}
        actions={
          <Link to="/chats" search={{ c: internId }} className={s.chatLink}>
            <Avatar name={name} color={intern?.color ?? 'neutral'} size={32} />
            {t('Написать', 'Message')}
          </Link>
        }
      />
      <div className={s.grid}>
        <ProgressCard internId={internId} />
        <QuestionsCard internId={internId} internName={short} />
      </div>
    </Page>
  )
}
