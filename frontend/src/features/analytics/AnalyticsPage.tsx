import { useNavigate, useSearch } from '@tanstack/react-router'
import { useActions } from '@/entities/actions'
import { useAnalyticsSummary } from '@/entities/analytics'
import { useEscalations } from '@/entities/escalations'
import { useSettings } from '@/entities/settings'
import { ApiError, IS_MOCK } from '@/shared/api/http'
import { IsoArt } from '@/shared/iso'
import { useT } from '@/shared/lib/i18n'
import {
  Card,
  EmptyState,
  ErrorState,
  Eyebrow,
  Note,
  Page,
  PageHeader,
  Skeleton,
  Tabs,
  type CardTone,
  type TabItem,
} from '@/shared/ui'
import { BarChart } from './BarChart'
import { PILOT_BASELINE, computeMetrics, dailySeries, isBotResolved } from './logic'
import { formatDuration, formatHours, toDayStats } from './serverMetrics'
import s from './analytics.module.css'

const TAB_IDS = ['metrics', 'questions', 'pilot'] as const
type TabId = (typeof TAB_IDS)[number]

function toTab(value: string | undefined): TabId {
  return TAB_IDS.find((id) => id === value) ?? 'metrics'
}

type Stat = { label: string; value: string; hint: string; tone?: CardTone }

function MetricsTab() {
  const t = useT()
  const actions = useActions()
  const escalations = useEscalations()

  if (actions.isPending || escalations.isPending) {
    return (
      <div className={s.stats} aria-busy>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={160} radius={28} />
        ))}
      </div>
    )
  }
  if (actions.isError || escalations.isError) {
    const retry = () => {
      void actions.refetch()
      void escalations.refetch()
    }
    return (
      <ErrorState
        text={t('Не получилось загрузить метрики', 'Could not load metrics')}
        onRetry={retry}
      />
    )
  }

  const m = computeMetrics(actions.data, escalations.data)
  const days = dailySeries(PILOT_BASELINE, {
    selfServed: actions.data.filter(isBotResolved).length,
    escalated: escalations.data.length,
  })
  const stats: Stat[] = [
    {
      label: t('Закрыто без наставника', 'Closed without mentor'),
      value: String(m.closedWithoutMentor),
      hint: t(
        `${m.selfServeShare}% из ${m.questionsTotal} вопросов`,
        `${m.selfServeShare}% of ${m.questionsTotal} questions`,
      ),
      tone: 'green',
    },
    {
      label: t('Действий выполнено', 'Actions done'),
      value: String(m.actionsDone),
      hint: t('после подтверждения стажёра', 'after intern confirmation'),
    },
    {
      label: t('Эскалаций', 'Escalations'),
      value: String(m.escalations),
      hint: t('вопросов передано наставнику', 'questions sent to mentor'),
    },
    {
      label: t('Отказов политики', 'Policy denials'),
      value: String(m.policyDenied),
      hint: 'policy_denied',
    },
  ]

  return (
    <div className={s.layout}>
      <div className={s.stats}>
        {stats.map((stat, i) => (
          <Card key={stat.label} tone={stat.tone} className={s.stat} index={i}>
            <Eyebrow>{stat.label}</Eyebrow>
            <b className={s.statValue}>{stat.value}</b>
            <span className={s.statHint}>{stat.hint}</span>
          </Card>
        ))}
      </div>
      <Card className={s.chartCard} index={4} aria-labelledby="analytics-chart">
        <h2 id="analytics-chart" className={s.cardTitle}>
          {t('Вопросы за неделю', 'Questions this week')}
        </h2>
        <BarChart days={days} />
        <Note tone="info">
          {t(
            'Вопросы до демо - синтетика пилота. Действия, эскалации и отказы - живые данные этого демо',
            'Questions before the demo are synthetic pilot data. Actions, escalations and denials are live demo data',
          )}
        </Note>
      </Card>
    </div>
  )
}

/** SA-6: метрики из Go (GET /analytics/summary) для наставника и руководителя. */
function ServerMetricsTab() {
  const t = useT()
  const summary = useAnalyticsSummary()
  const lang = useSettings((st) => st.lang)

  if (summary.isPending) {
    return (
      <div className={s.stats} aria-busy>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={160} radius={28} />
        ))}
      </div>
    )
  }
  if (summary.isError) {
    const denied = summary.error instanceof ApiError && summary.error.status === 403
    return denied ? (
      <Card index={0}>
        <EmptyState
          art={<IsoArt name="chart" isFloating />}
          title={t('Метрики недоступны', 'Metrics unavailable')}
          text={t(
            'Их видят наставник и руководитель команды',
            'Only mentors and team leads can see them',
          )}
        />
      </Card>
    ) : (
      <ErrorState
        text={t('Не получилось загрузить метрики', 'Could not load metrics')}
        onRetry={() => void summary.refetch()}
      />
    )
  }

  const m = summary.data
  const stats: Stat[] = [
    {
      label: t('Закрыто без наставника', 'Closed without mentor'),
      value: `${m.deflection_rate}%`,
      hint: t(
        `${m.questions} вопросов, ${m.escalations} передано наставнику`,
        `${m.questions} questions, ${m.escalations} sent to mentor`,
      ),
      tone: 'green',
    },
    {
      label: t('Сэкономлено наставнику', 'Mentor time saved'),
      value: formatHours(m.mentor_minutes_saved, lang),
      hint: t(
        `допущение: ${m.minutes_per_question} мин на вопрос`,
        `assumption: ${m.minutes_per_question} min per question`,
      ),
    },
    {
      label: t('Действий выполнено', 'Actions done'),
      value: `${m.actions_succeeded} / ${m.actions_proposed}`,
      hint: t(
        `от вопроса до результата: ${formatDuration(m.avg_action_seconds)}`,
        `question to result: ${formatDuration(m.avg_action_seconds)}`,
      ),
    },
    {
      label: t('Чек-лист выполнен', 'Checklist done'),
      value: `${m.checklist_rate}%`,
      hint: t(
        `${m.tasks_done} из ${m.tasks_total} задач, стажёров: ${m.interns}`,
        `${m.tasks_done} of ${m.tasks_total} tasks, interns: ${m.interns}`,
      ),
    },
    {
      label: t('Ответов с источником', 'Answers with source'),
      value: String(m.with_sources),
      hint: t(`«не знаю»: ${m.unknown}`, `"don't know": ${m.unknown}`),
    },
    {
      label: t('Отказов политики', 'Policy denials'),
      value: String(m.policy_denied),
      hint: 'policy_denied',
    },
  ]

  return (
    <div className={s.layout}>
      <div className={s.stats}>
        {stats.map((stat, i) => (
          <Card key={stat.label} tone={stat.tone} className={s.stat} index={i}>
            <Eyebrow>{stat.label}</Eyebrow>
            <b className={s.statValue}>{stat.value}</b>
            <span className={s.statHint}>{stat.hint}</span>
          </Card>
        ))}
      </div>
      <Card className={s.chartCard} index={stats.length} aria-labelledby="analytics-chart">
        <h2 id="analytics-chart" className={s.cardTitle}>
          {t('Вопросы за 7 дней', 'Questions, last 7 days')}
        </h2>
        <BarChart days={toDayStats(m.days)} />
        <Note tone="info">
          {t(
            m.scope === 'team'
              ? 'Данные из БД по всей команде. Экономия времени - оценка по допущению из docs/metrics.md'
              : 'Данные из БД по твоим стажёрам. Экономия времени - оценка по допущению из docs/metrics.md',
            'Live database data. Time saved is an estimate based on docs/metrics.md',
          )}
        </Note>
      </Card>
    </div>
  )
}

/** Аналитика пилота (демо шаг 10). Для MVP полноценная вкладка «Метрики». */
export function AnalyticsPage() {
  const t = useT()
  const search = useSearch({ strict: false })
  const navigate = useNavigate()
  const tab = toTab(search.tab)
  const items: ReadonlyArray<TabItem<TabId>> = [
    { id: 'metrics', label: t('Метрики', 'Metrics'), icon: 'chart' },
    { id: 'questions', label: t('Вопросы', 'Questions'), icon: 'question' },
    { id: 'pilot', label: t('Пилот', 'Pilot'), icon: 'flag' },
  ]

  return (
    <Page>
      <PageHeader
        title={t('Аналитика', 'Analytics')}
        subtitle={t('Как AI-buddy помогает стажёрам', 'How AI-buddy helps interns')}
      />
      <Tabs
        items={items}
        value={tab}
        label={t('Разделы аналитики', 'Analytics sections')}
        onChange={(id) => void navigate({ to: '/analytics', search: { tab: id } })}
      />
      <div role="tabpanel">
        {tab === 'metrics' ? (
          IS_MOCK ? (
            <MetricsTab />
          ) : (
            <ServerMetricsTab />
          )
        ) : (
          <Card index={0}>
            <EmptyState
              art={<IsoArt name="chart" isFloating />}
              title={t('Скоро', 'Coming soon')}
              text={t('Раздел появится после MVP', 'Coming after the MVP')}
            />
          </Card>
        )}
      </div>
    </Page>
  )
}
