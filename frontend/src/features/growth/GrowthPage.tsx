import { useNavigate, useSearch } from '@tanstack/react-router'
import { useT } from '@/shared/lib/i18n'
import { Page, PageHeader, Tabs, type TabItem } from '@/shared/ui'
import { BragTab } from './BragTab'
import { FeedbackTab } from './FeedbackTab'
import { GrowthHero } from './GrowthHero'
import { MeetingsTab } from './MeetingsTab'
import { SkillsTab } from './SkillsTab'
import { toGrowthTab, type GrowthTab } from './tabs'

function TabPanel({ tab }: { tab: GrowthTab }) {
  switch (tab) {
    case 'skills':
      return <SkillsTab />
    case 'feedback':
      return <FeedbackTab />
    case 'meetings':
      return <MeetingsTab />
    default:
      return <BragTab />
  }
}

/** Рост (идеи 29, 48, 6): достижения, карта навыков, обратная связь, встречи 1:1. Вкладки в ?tab=. */
export function GrowthPage() {
  const t = useT()
  const search = useSearch({ strict: false })
  const navigate = useNavigate()
  const tab = toGrowthTab(search.tab)

  const items: ReadonlyArray<TabItem<GrowthTab>> = [
    { id: 'brag', label: t('Достижения', 'Achievements'), icon: 'star' },
    { id: 'skills', label: t('Навыки', 'Skills'), icon: 'target' },
    { id: 'feedback', label: t('Обратная связь', 'Feedback'), icon: 'chat' },
    { id: 'meetings', label: t('Встречи 1:1', '1:1 meetings'), icon: 'calendar' },
  ]

  return (
    <Page>
      <PageHeader
        title={t('Рост', 'Growth')}
        subtitle={t(
          'Что уже получилось и что подтянуть к экватору',
          'What you have done and what to improve before the midpoint',
        )}
      />
      <GrowthHero />
      <Tabs
        items={items}
        value={tab}
        label={t('Разделы роста', 'Growth sections')}
        onChange={(id) => void navigate({ to: '/growth', search: { tab: id } })}
      />
      <div role="tabpanel" aria-label={items.find((item) => item.id === tab)?.label}>
        <TabPanel tab={tab} />
      </div>
    </Page>
  )
}
