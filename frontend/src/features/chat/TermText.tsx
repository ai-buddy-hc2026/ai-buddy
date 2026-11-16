import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react'
import { Link } from '@tanstack/react-router'
import { useGlossary, type Term } from '@/entities/glossary'
import { useT } from '@/shared/lib/i18n'
import { splitByTerms } from './terms'
import s from './Insights.module.css'

/** Текст ответа бота с подчёркнутыми терминами словаря (идея 30). Без HTML-строк. */
export function TermText({ text }: { text: string }) {
  const glossary = useGlossary()
  const terms = glossary.data
  const segments = useMemo(() => (terms ? splitByTerms(text, terms) : null), [text, terms])
  if (!segments) return <>{text}</>
  return (
    <>
      {segments.map((segment, i) =>
        segment.kind === 'text' ? (
          segment.text
        ) : (
          <TermHint key={`${segment.term.id}:${i}`} label={segment.text} term={segment.term} />
        ),
      )}
    </>
  )
}

/** Термин-кнопка: по нажатию или фокусу - короткое объяснение и ссылка в словарь. */
function TermHint({ label, term }: { label: string; term: Term }) {
  const t = useT()
  const id = useId()
  const [isOpen, setOpen] = useState(false)
  const boxRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const close = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [isOpen])

  const handleBlur = (event: FocusEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
  }
  const handleKey = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'Escape' && isOpen) {
      event.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <span ref={boxRef} className={s.termBox} onBlur={handleBlur} onKeyDown={handleKey}>
      <button
        type="button"
        className={s.term}
        aria-expanded={isOpen}
        aria-controls={id}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {isOpen && (
        <span id={id} className={s.termPop} role="note" aria-label={term.term}>
          <b className={s.termTitle}>{term.term}</b>
          <span>{term.definition}</span>
          <Link to="/glossary" search={{ q: term.term }} className={s.termLink}>
            {t('Открыть в словаре', 'Open in glossary')}
          </Link>
        </span>
      )}
    </span>
  )
}
