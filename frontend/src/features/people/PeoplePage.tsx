import { useNavigate, useSearch } from '@tanstack/react-router'
import { useT } from '@/shared/lib/i18n'
import { Page, PageHeader, Tabs, type TabItem } from '@/shared/ui'
import { CoffeeTab } from './CoffeeTab'
import { HoursTab } from './HoursTab'
import { InterestsTab } from './InterestsTab'
import { toTab, type PeopleTab } from './logic'
import { TeamTab } from './TeamTab'

function Panel({ tab }: { tab: PeopleTab }) {
  if (tab === 'hours') return <HoursTab />
  if (tab === 'coffee') return <CoffeeTab />
  if (tab === 'interests') return <InterestsTab />
  return <TeamTab />
}

/** Раздел «Люди»: вкладки в ?tab=team|hours|coffee|interests. */
export function PeoplePage() {
  const t = useT()
  const search = useSearch({ strict: false })
  const navigate = useNavigate()
  const tab = toTab(search.tab)

  const items: ReadonlyArray<TabItem<PeopleTab>> = [
    { id: 'team', label: t('Команда', 'Team'), icon: 'people' },
    { id: 'hours', label: t('Приёмные часы', 'Office hours'), icon: 'calendar' },
    { id: 'coffee', label: t('Random coffee', 'Random coffee'), icon: 'coffee' },
    { id: 'interests', label: t('Интересы', 'Interests'), icon: 'heart' },
  ]

  return (
    <Page>
      <PageHeader
        title={t('Люди', 'People')}
        subtitle={t(
          'Кто за что отвечает, как записаться на встречу и с кем выпить кофе',
          'Who owns what, how to book a meeting and who to grab coffee with',
        )}
      />
      <Tabs
        items={items}
        value={tab}
        label={t('Разделы «Люди»', 'People sections')}
        onChange={(id) => void navigate({ to: '/people', search: { tab: id } })}
      />
      <div role="tabpanel" aria-label={items.find((item) => item.id === tab)?.label}>
        <Panel tab={tab} />
      </div>
    </Page>
  )
}
