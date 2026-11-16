import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { getEmployee } from '@/entities/employees'
import { useT } from '@/shared/lib/i18n'
import { Badge, Button, Card, ChipRow, Icon, Tag } from '@/shared/ui'
import type { Term } from './data'
import { askBuddyQuestion, formatDate, isStale } from './logic'
import { SimplicityCheck } from './SimplicityCheck'
import s from './glossary.module.css'

type Props = { term: Term; index: number }

export function TermCard({ term, index }: Props) {
  const t = useT()
  const navigate = useNavigate()
  const [isCheckOpen, setCheckOpen] = useState(false)
  const owner = getEmployee(term.source.ownerId)
  const checkId = `check-${term.id}`
  const isOld = isStale(term.source.reviewedAt)

  const ask = () =>
    void navigate({ to: '/chats', search: { c: 'buddy', q: askBuddyQuestion(term.term) } })

  return (
    <Card as="article" className={s.term} index={index} aria-labelledby={`term-${term.id}`}>
      <h2 id={`term-${term.id}`} className={s.termTitle}>
        {term.term}
      </h2>
      {term.synonyms.length > 0 && (
        <ChipRow isWrap aria-label={t('Синонимы', 'Synonyms')}>
          {term.synonyms.map((synonym) => (
            <Tag key={synonym} className={s.synonym}>
              {synonym}
            </Tag>
          ))}
        </ChipRow>
      )}
      <p className={s.definition}>{term.definition}</p>
      <Card kind="sunken" pad="s" className={s.example}>
        <span className="t-s t-muted">{t('Пример', 'Example')}</span>
        <q>{term.example}</q>
      </Card>

      <p className={s.source}>
        <Icon name="doc" size={16} />
        <span>
          {t('Источник', 'Source')}: «{term.source.title}», {t('проверен', 'reviewed')}{' '}
          {formatDate(term.source.reviewedAt)}
          {owner && `, ${t('владелец', 'owner')}: ${owner.name}`}
        </span>
      </p>
      {isOld && (
        <Badge tone="warning" icon="clock" className={s.stale}>
          {t('Может быть устаревшим', 'May be outdated')}
        </Badge>
      )}

      <div className={s.termActions}>
        <Button size="s" icon="chat" onClick={ask}>
          {t('Спросить buddy', 'Ask buddy')}
        </Button>
        <Button
          size="s"
          variant="ghost"
          icon={isCheckOpen ? 'chevronUp' : 'chevronDown'}
          aria-expanded={isCheckOpen}
          aria-controls={checkId}
          onClick={() => setCheckOpen((open) => !open)}
        >
          {t('Проверка простоты', 'Plain language check')}
        </Button>
      </div>
      {isCheckOpen && (
        <div id={checkId}>
          <SimplicityCheck text={term.definition} />
        </div>
      )}
    </Card>
  )
}
