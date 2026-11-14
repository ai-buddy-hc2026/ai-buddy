export const GROWTH_TABS = ['brag', 'skills', 'feedback', 'meetings'] as const
export type GrowthTab = (typeof GROWTH_TABS)[number]

export function toGrowthTab(value: string | undefined): GrowthTab {
  return GROWTH_TABS.find((id) => id === value) ?? 'brag'
}
