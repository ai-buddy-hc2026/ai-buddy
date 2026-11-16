import { useQuestionClusters } from '@/entities/meetings'
import { useUser } from '@/entities/session'
import { IsoArt } from '@/shared/iso'
import { useT } from '@/shared/lib/i18n'
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '@/shared/ui'
import s from './mentor.module.css'

/** Частые вопросы без ответа своей команды, сгруппированные AI. Только buddy и lead. */
export function QuestionClustersCard() {
  const t = useT()
  const user = useUser()
  const isAllowed = user.role === 'buddy' || user.role === 'lead'
  const query = useQuestionClusters(isAllowed)

  if (!isAllowed) return null
  if (query.isPending) return <Skeleton height={200} radius={28} />
  if (query.isError) {
    return (
      <Card className={s.clusters}>
        <ErrorState
          text={t('Не получилось загрузить группы вопросов', 'Could not load question groups')}
          onRetry={() => void query.refetch()}
        />
      </Card>
    )
  }

  return (
    <Card className={s.clusters} index={2} aria-labelledby="mentor-clusters">
      <header className={s.cardHead}>
        <h2 id="mentor-clusters" className={s.cardTitle}>
          {t('Частые вопросы без ответа', 'Frequent unanswered questions')}
        </h2>
        <Badge>{t('за 30 дней', 'last 30 days')}</Badge>
      </header>
      {query.data.length === 0 ? (
        <EmptyState
          art={<IsoArt name="chat" />}
          title={t('Вопросов без ответа нет', 'No unanswered questions')}
          text={t('База знаний покрывает вопросы команды', 'The knowledge base covers the team')}
        />
      ) : (
        <ul className={s.clusterList}>
          {query.data.map((cluster) => (
            <li key={cluster.label} className={s.cluster}>
              <p className={s.clusterHead}>
                <b>{cluster.label}</b>
                <Badge tone="sale">{cluster.size}</Badge>
              </p>
              <ul className={s.clusterQuestions}>
                {cluster.questions.slice(0, 3).map((question, index) => (
                  <li key={question.id ?? index} className="t-s t-muted">
                    {question.text}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
