import { useNavigate, useSearch } from '@tanstack/react-router'
import { useActions } from '@/entities/actions'
import { useEscalations } from '@/entities/escalations'
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
          <MetricsTab />
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
