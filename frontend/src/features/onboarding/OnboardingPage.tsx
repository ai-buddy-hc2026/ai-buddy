import { useNavigate, useSearch } from '@tanstack/react-router'
import { useT } from '@/shared/lib/i18n'
import { Page, PageHeader, Tabs, type TabItem } from '@/shared/ui'
import { AccessTab } from './access/AccessTab'
import { CoursesTab } from './courses/CoursesTab'
import { PlanTab } from './plan/PlanTab'
import { TracksTab } from './tracks/TracksTab'
import s from './OnboardingPage.module.css'

const TAB_IDS = ['plan', 'tracks', 'courses', 'access'] as const
type TabId = (typeof TAB_IDS)[number]

function toTab(value: string | undefined): TabId {
  return TAB_IDS.find((id) => id === value) ?? 'plan'
}

/** Онбординг (S-1): вкладки в ?tab=: план, треки, курсы, доступы. */
export function OnboardingPage() {
  const t = useT()
  const search = useSearch({ strict: false })
  const navigate = useNavigate()
  const tab = toTab(search.tab)

  const items: ReadonlyArray<TabItem<TabId>> = [
    { id: 'plan', label: t('План', 'Plan'), icon: 'plan' },
    { id: 'tracks', label: t('Треки', 'Tracks'), icon: 'route' },
    { id: 'courses', label: t('Курсы', 'Courses'), icon: 'book' },
    { id: 'access', label: t('Доступы', 'Access'), icon: 'key' },
  ]

  return (
    <Page>
      <PageHeader
        title={t('Онбординг', 'Onboarding')}
        subtitle={t(
          'План на первые недели: что сделано и что дальше',
          'Your first weeks: what is done and what is next',
        )}
      />
      <Tabs
        items={items}
        value={tab}
        label={t('Разделы онбординга', 'Onboarding sections')}
        onChange={(id) => void navigate({ to: '/onboarding', search: { tab: id } })}
      />
      <div
        role="tabpanel"
        className={s.panel}
        aria-label={items.find((item) => item.id === tab)?.label}
      >
        {tab === 'plan' && <PlanTab />}
        {tab === 'tracks' && <TracksTab />}
        {tab === 'courses' && <CoursesTab />}
        {tab === 'access' && <AccessTab />}
      </div>
    </Page>
  )
}
