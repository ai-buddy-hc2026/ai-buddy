import type { Translate } from '@/shared/lib/i18n'
import type { EventKind } from './data'
import type { FeedFilter } from './logic'

/** Цвет несёт смысл: обучение зелёное, доклады синие и фиолетовые, от коллег жёлтые. */
export const KIND_COLOR: Record<EventKind, 'green' | 'blue' | 'violet' | 'yellow'> = {
  training: 'green',
  avitotech: 'blue',
  internal: 'violet',
  user: 'yellow',
}

export function kindLabel(kind: EventKind, t: Translate): string {
  const labels: Record<EventKind, string> = {
    training: t('Тренинг', 'Training'),
    avitotech: 'AvitoTech',
    internal: t('Внутренний доклад', 'Internal talk'),
    user: t('От коллег', 'By colleagues'),
  }
  return labels[kind]
}

export function filterLabel(filter: FeedFilter, t: Translate): string {
  const labels: Record<FeedFilter, string> = {
    all: t('Все', 'All'),
    training: t('Тренинги', 'Trainings'),
    talks: t('Доклады', 'Talks'),
    user: t('От коллег', 'By colleagues'),
  }
  return labels[filter]
}

export const FEED_FILTERS: readonly FeedFilter[] = ['all', 'training', 'talks', 'user']

export type EventsTab = 'feed' | 'learning' | 'mine'
export const EVENTS_TABS: readonly EventsTab[] = ['feed', 'learning', 'mine']

export function toTab(value: string | undefined): EventsTab {
  return EVENTS_TABS.find((tab) => tab === value) ?? 'feed'
}
