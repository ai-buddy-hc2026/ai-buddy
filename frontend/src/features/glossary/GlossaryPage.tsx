import { useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { IsoArt } from '@/shared/iso'
import { useT } from '@/shared/lib/i18n'
import {
  Button,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  Input,
  Page,
  Skeleton,
} from '@/shared/ui'
import { useGlossary, type Term } from './data'
import { GlossaryArt } from './GlossaryArt'
import { askBuddyQuestion, searchTerms, type CategoryFilter } from './logic'
import { ProposeDialog } from './ProposeDialog'
import { TermCard } from './TermCard'
import s from './glossary.module.css'

const SKELETON_COUNT = 4

function TermList({
  terms,
  query,
  onPropose,
}: {
  terms: Term[]
  query: string
  onPropose: () => void
}) {
  const t = useT()
  const navigate = useNavigate()
  if (terms.length === 0) {
    const ask = () =>
      void navigate({ to: '/chats', search: { c: 'buddy', q: askBuddyQuestion(query.trim()) } })
    return (
      <Card className={s.wide}>
        <EmptyState
          art={<IsoArt name="plot" />}
          title={t(`Не нашёл «${query.trim()}»`, `Nothing found for "${query.trim()}"`)}
          text={t(
            'В словаре такого нет. Спроси buddy или предложи термин',
            'Not in the glossary yet. Ask buddy or suggest the term',
          )}
          action={
            <>
              <Button icon="chat" onClick={ask}>
                {t('Спросить buddy', 'Ask buddy')}
              </Button>
              <Button variant="ghost" icon="plus" onClick={onPropose}>
                {t('Предложить термин', 'Suggest a term')}
              </Button>
            </>
          }
        />
      </Card>
    )
  }
  return (
    <>
      {terms.map((term, i) => (
        <TermCard key={term.id} term={term} index={i + 1} />
      ))}
    </>
  )
}

export function GlossaryPage() {
  const t = useT()
  const search = useSearch({ strict: false })
  const glossary = useGlossary()
  const [query, setQuery] = useState(() => search.q ?? '')
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [isProposeOpen, setProposeOpen] = useState(false)

  const filters: { id: CategoryFilter; label: string }[] = [
    { id: 'all', label: t('Все', 'All') },
    { id: 'dev', label: t('Разработка', 'Engineering') },
    { id: 'process', label: t('Процессы', 'Processes') },
    { id: 'company', label: t('Компания', 'Company') },
  ]
  const terms = glossary.data ? searchTerms(glossary.data, query, category) : []

  return (
    <Page className={s.grid}>
      <Card className={s.hero} index={0}>
        <div className={s.heroText}>
          <h1 className={s.title}>{t('Словарь', 'Glossary')}</h1>
          <p className={s.lead}>
            {t(
              'Внутренние слова Авито простым языком. У каждого есть источник и владелец',
              'Avito jargon in plain words. Each term has a source and an owner',
            )}
          </p>
          <Input
            type="search"
            aria-label={t('Поиск по словарю', 'Search the glossary')}
            placeholder={t('Например, МР или дежурство', 'For example, МР or on-call')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ChipRow role="group" aria-label={t('Тема', 'Topic')}>
            {filters.map((filter) => (
              <Chip
                key={filter.id}
                isSelected={category === filter.id}
                onClick={() => setCategory(filter.id)}
              >
                {filter.label}
              </Chip>
            ))}
          </ChipRow>
          <div>
            <Button variant="primary" icon="plus" onClick={() => setProposeOpen(true)}>
              {t('Предложить термин', 'Suggest a term')}
            </Button>
          </div>
        </div>
        <GlossaryArt className={s.heroArt} />
      </Card>

      {glossary.isPending &&
        Array.from({ length: SKELETON_COUNT }, (_, i) => (
          <Card key={i} className={s.term}>
            <Skeleton height={28} width="40%" />
            <Skeleton height={64} />
          </Card>
        ))}
      {glossary.isError && (
        <Card className={s.wide}>
          <ErrorState
            text={t('Не получилось загрузить словарь', 'Could not load the glossary')}
            retryLabel={t('Повторить', 'Retry')}
            onRetry={() => void glossary.refetch()}
          />
        </Card>
      )}
      {glossary.data && (
        <TermList terms={terms} query={query} onPropose={() => setProposeOpen(true)} />
      )}

      {isProposeOpen && (
        <ProposeDialog
          isOpen
          onClose={() => setProposeOpen(false)}
          terms={glossary.data ?? []}
          initialTerm={terms.length === 0 ? query.trim() : ''}
        />
      )}
    </Page>
  )
}
