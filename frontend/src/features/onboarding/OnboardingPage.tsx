import { useNavigate, useSearch } from '@tanstack/react-router'
import { IsoArt, type IsoArtName } from '@/shared/iso'
import { useT } from '@/shared/lib/i18n'
import { Card, EmptyState, Page, PageHeader, Tabs, type TabItem } from '@/shared/ui'
import { PlanTab } from './plan/PlanTab'

const TAB_IDS = ['plan', 'tracks', 'courses', 'access'] as const
type TabId = (typeof TAB_IDS)[number]

function toTab(value: string | undefined): TabId {
  return TAB_IDS.find((id) => id === value) ?? 'plan'
}

const SOON_ART: Record<Exclude<TabId, 'plan'>, IsoArtName> = {
  tracks: 'trophy',
  courses: 'books',
  access: 'access',
}

function SoonTab({ tab }: { tab: Exclude<TabId, 'plan'> }) {
  const t = useT()
  return (
    <Card index={0}>
      <EmptyState
        art={<IsoArt name={SOON_ART[tab]} isFloating />}
        title={t('Скоро', 'Coming soon')}
        text={t(
          'Раздел появится после MVP. Пока весь план во вкладке «План»',
          'Coming after the MVP. For now everything is in the Plan tab',
        )}
      />
    </Card>
  )
}

/** Онбординг (S-1): вкладки в ?tab=. Для MVP полноценная только «План». */
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
      <div role="tabpanel">{tab === 'plan' ? <PlanTab /> : <SoonTab tab={tab} />}</div>
    </Page>
  )
}
