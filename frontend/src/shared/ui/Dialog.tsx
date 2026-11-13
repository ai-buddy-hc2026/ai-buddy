import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from './Button'
import s from './ui.module.css'

type DialogProps = {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Кнопки действий. На телефоне растягиваются на всю ширину. */
  footer?: ReactNode
  width?: number
  closeLabel?: string
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select, [tabindex]:not([tabindex="-1"])'

/**
 * Модалка на десктопе, bottom sheet на телефоне (design.md).
 * Esc и клик по фону закрывают, фокус заперт внутри и возвращается назад при закрытии.
 */
export function Dialog({
  isOpen,
  onClose,
  title,
  children,
  footer,
  width,
  closeLabel = 'Закрыть',
}: DialogProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus()

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return createPortal(
    <div
      className={s.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={width ? ({ '--dialog-width': `${width}px` } as CSSProperties) : undefined}
      >
        <span className={s.sheetHandle} aria-hidden />
        <div className={s.dialogHead}>
          <h2 id={titleId}>{title}</h2>
          <IconButton icon="close" label={closeLabel} size="s" onClick={onClose} />
        </div>
        <div className={s.dialogBody}>{children}</div>
        {footer && <div className={s.dialogFoot}>{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
