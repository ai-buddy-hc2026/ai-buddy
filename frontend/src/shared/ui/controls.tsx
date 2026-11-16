import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { initials, type BrandColor } from '@/entities/employees'
import { cn } from '@/shared/lib/cn'
import { Icon, type IconName } from './Icon'
import s from './ui.module.css'

/* ---------- Chip ---------- */

type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  isSelected?: boolean
  icon?: IconName
  /** Чип лежит на белой карточке: фон тёплый серый */
  children: ReactNode
}

/** Быстрые ответы и фильтры. Выбранный - чёрный. */
export function Chip({
  isSelected = false,
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={isSelected}
      className={cn(s.chip, isSelected && s.selected, className)}
      {...rest}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  )
}

/** Статичный чип-метка (источник ответа, тег). */
export function Tag({
  icon,
  children,
  className,
}: {
  icon?: IconName
  children: ReactNode
  className?: string
}) {
  return (
    <span className={cn(s.chip, className)}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </span>
  )
}

export function ChipRow({
  isWrap = false,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { isWrap?: boolean }) {
  return <div className={cn(s.chipRow, isWrap && s.wrap, className)} {...rest} />
}

/* ---------- Badge ---------- */

export type BadgeTone =
  'neutral' | 'success' | 'warning' | 'error' | 'accent' | 'pay' | 'solid' | 'sale'

export function Badge({
  tone = 'neutral',
  icon,
  children,
  className,
}: {
  tone?: BadgeTone
  icon?: IconName
  children: ReactNode
  className?: string
}) {
  return (
    <span className={cn(s.badge, s[`badge-${tone}`], className)}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  )
}

/** Красный счётчик непрочитанного. */
export function Counter({ value, label }: { value: number; label?: string }) {
  if (value <= 0) return null
  return (
    <span className={s.counter} aria-label={label}>
      {value > 99 ? '99+' : value}
    </span>
  )
}

/* ---------- Avatar ---------- */

type AvatarProps = {
  name: string
  color?: BrandColor | 'neutral'
  size?: number
  isOnline?: boolean
  isSquare?: boolean
  /** Вместо инициалов: иконка или знак buddy */
  children?: ReactNode
  className?: string
}

export function Avatar({
  name,
  color = 'neutral',
  size = 40,
  isOnline = false,
  isSquare = false,
  children,
  className,
}: AvatarProps) {
  return (
    <span
      className={cn(
        s.avatar,
        s[`avatar-${color}`],
        isOnline && s.online,
        isSquare && s.square,
        className,
      )}
      style={{ '--avatar-size': `${size}px` } as CSSProperties}
      role="img"
      aria-label={name}
    >
      {children ?? initials(name)}
    </span>
  )
}

/* ---------- Switch ---------- */

type SwitchProps = {
  isChecked: boolean
  onChange: (next: boolean) => void
  label: string
  isDisabled?: boolean
}

export function Switch({ isChecked, onChange, label, isDisabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isChecked}
      aria-label={label}
      disabled={isDisabled}
      className={s.switch}
      onClick={() => onChange(!isChecked)}
    />
  )
}

/** Строка настройки: заголовок, пояснение и тумблер. Кликабельна целиком. */
export function SwitchRow({
  title,
  hint,
  isChecked,
  onChange,
  isDisabled = false,
}: {
  title: string
  hint?: string
  isChecked: boolean
  onChange: (next: boolean) => void
  isDisabled?: boolean
}) {
  return (
    <div className={s.switchRow}>
      <div className={s.switchText}>
        <b>{title}</b>
        {hint && <span>{hint}</span>}
      </div>
      <Switch isChecked={isChecked} onChange={onChange} label={title} isDisabled={isDisabled} />
    </div>
  )
}

/* ---------- Checkbox ---------- */

export function Checkbox({
  isChecked,
  onChange,
  label,
  color,
}: {
  isChecked: boolean
  onChange: (next: boolean) => void
  label: string
  /** CSS-цвет галочки, по умолчанию бренд-зелёный */
  color?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isChecked}
      aria-label={label}
      className={s.checkbox}
      style={color ? ({ '--check-color': color } as CSSProperties) : undefined}
      onClick={(event) => {
        event.stopPropagation()
        onChange(!isChecked)
      }}
    >
      <Icon name="check" size={16} strokeWidth={3} />
    </button>
  )
}

/* ---------- Meter ---------- */

export function Meter({
  value,
  max = 100,
  color,
  label,
  isOnSunken = false,
}: {
  value: number
  max?: number
  /** CSS-цвет заполнения, например var(--brand-green) */
  color?: string
  label: string
  isOnSunken?: boolean
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  return (
    <div
      className={cn(s.meter, isOnSunken && s.onSunken)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <div
        className={s.meterFill}
        style={
          {
            transform: `scaleX(${ratio})`,
            ...(color ? { '--meter-color': color } : {}),
          } as CSSProperties
        }
      />
    </div>
  )
}
