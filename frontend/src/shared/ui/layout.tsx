import type {
  CSSProperties,
  ElementType,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react'
import { useId } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from './Button'
import { Icon, type IconName } from './Icon'
import s from './ui.module.css'

/* ---------- Card ---------- */

export type CardTone = 'yellow' | 'blue' | 'green' | 'violet' | 'red' | 'inverse'

type CardProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType
  tone?: CardTone
  /** sunken - серая плашка внутри карточки, outline - с рамкой. Карточку в карточку не кладём. */
  kind?: 'card' | 'sunken' | 'outline'
  pad?: 'm' | 's' | '0'
  /** Порядок появления (анимация rise) */
  index?: number
}

export function Card({
  as: Component = 'section',
  tone,
  kind = 'card',
  pad = 'm',
  index,
  className,
  style,
  ...rest
}: CardProps) {
  return (
    <Component
      className={cn(
        s.card,
        tone && s[`tone-${tone}`],
        kind !== 'card' && s[kind],
        pad !== 'm' && s[`pad-${pad}`],
        index !== undefined && 'rise',
        className,
      )}
      style={index !== undefined ? ({ '--i': index, ...style } as CSSProperties) : style}
      {...rest}
    />
  )
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(s.eyebrow, className)}>{children}</div>
}

/* ---------- Page ---------- */

export function Page({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(s.page, className)} {...rest} />
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className={cn(s.pageHeader, 'rise')}>
      <div className={s.pageHeaderText}>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className={s.pageHeaderActions}>{actions}</div>}
    </header>
  )
}

/* ---------- Tabs ---------- */

export interface TabItem<T extends string> {
  id: T
  label: string
  icon?: IconName
  badge?: ReactNode
}

/** Вкладки-пилюли. Состояние держит родитель (обычно в search-параметре URL). */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  isOnCard = false,
}: {
  items: ReadonlyArray<TabItem<T>>
  value: T
  onChange: (id: T) => void
  label: string
  isOnCard?: boolean
}) {
  return (
    <div className={cn(s.tabs, isOnCard && s.onCard)} role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === value}
          className={s.tab}
          onClick={() => onChange(item.id)}
        >
          {item.icon && <Icon name={item.icon} size={18} />}
          {item.label}
          {item.badge}
        </button>
      ))}
    </div>
  )
}

/* ---------- Field ---------- */

type FieldShell = { label?: string; error?: string; hint?: string; isOnSunken?: boolean }

export function Input({
  label,
  error,
  hint,
  isOnSunken = false,
  className,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & FieldShell) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <div className={s.field}>
      {label && (
        <label className={s.fieldLabel} htmlFor={inputId}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={cn(s.input, isOnSunken && s.onSunken, className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${inputId}-note` : undefined}
        {...rest}
      />
      {(error || hint) && (
        <span
          id={`${inputId}-note`}
          className={error ? s.fieldError : s.fieldHint}
          role={error ? 'alert' : undefined}
        >
          {error ?? hint}
        </span>
      )}
    </div>
  )
}

export function Textarea({
  label,
  error,
  hint,
  isOnSunken = false,
  className,
  id,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldShell) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <div className={s.field}>
      {label && (
        <label className={s.fieldLabel} htmlFor={inputId}>
          {label}
        </label>
      )}
      <textarea
        id={inputId}
        className={cn(s.textarea, isOnSunken && s.onSunken, className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${inputId}-note` : undefined}
        {...rest}
      />
      {(error || hint) && (
        <span
          id={`${inputId}-note`}
          className={error ? s.fieldError : s.fieldHint}
          role={error ? 'alert' : undefined}
        >
          {error ?? hint}
        </span>
      )}
    </div>
  )
}

/* ---------- States ---------- */

export function EmptyState({
  title,
  text,
  art,
  action,
}: {
  title: string
  text?: string
  /** Изометрическая иллюстрация из shared/iso */
  art?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className={s.empty}>
      {art && <div className={s.emptyArt}>{art}</div>}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action && <div className={s.emptyActions}>{action}</div>}
    </div>
  )
}

export function ErrorState({
  text,
  onRetry,
  retryLabel = 'Повторить',
}: {
  text: string
  onRetry?: () => void
  retryLabel?: string
}) {
  return (
    <div className={s.empty} role="alert">
      <Icon name="alert" size={32} />
      <h3>{text}</h3>
      {onRetry && (
        <div className={s.emptyActions}>
          <Button icon="refresh" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      )}
    </div>
  )
}

export function Skeleton({
  height = 20,
  width = '100%',
  radius,
  isOnSunken = false,
}: {
  height?: number | string
  width?: number | string
  radius?: number | string
  isOnSunken?: boolean
}) {
  return (
    <div
      className={cn(s.skeleton, isOnSunken && s.onSunken)}
      style={{ height, width, borderRadius: radius }}
      aria-hidden
    />
  )
}

export type NoteTone = 'info' | 'success' | 'warning' | 'error' | 'private'

/** Информационная плашка. private - сиреневая «Видишь только ты». */
export function Note({
  tone = 'info',
  icon,
  title,
  children,
  action,
}: {
  tone?: NoteTone
  icon?: IconName
  title?: string
  children?: ReactNode
  action?: ReactNode
}) {
  const fallbackIcon: Record<NoteTone, IconName> = {
    info: 'info',
    success: 'check',
    warning: 'alert',
    error: 'alert',
    private: 'eyeOff',
  }
  return (
    <div className={cn(s.note, s[`note-${tone}`])} role={tone === 'error' ? 'alert' : undefined}>
      <Icon name={icon ?? fallbackIcon[tone]} size={20} />
      <div className={s.noteBody}>
        {title && <b>{title}</b>}
        {children && <span>{children}</span>}
      </div>
      {action}
    </div>
  )
}

/* ---------- Row ---------- */

type RowProps = {
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  onClick?: () => void
  className?: string
}

/** Строка списка: аватар или иконка, заголовок, подпись, действие справа. */
export function Row({ leading, title, subtitle, trailing, onClick, className }: RowProps) {
  const body = (
    <>
      {leading}
      <span className={s.rowBody}>
        <span className={s.rowTitle}>{title}</span>
        {subtitle && <span className={s.rowSub}>{subtitle}</span>}
      </span>
      {trailing}
    </>
  )
  return onClick ? (
    <button type="button" className={cn(s.row, className)} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cn(s.row, className)}>{body}</div>
  )
}
