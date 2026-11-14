import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import { Icon, type IconName } from './Icon'
import s from './ui.module.css'

export type ButtonVariant =
  'primary' | 'accent' | 'accentSoft' | 'secondary' | 'success' | 'danger' | 'ghost' | 'onColor'
export type ControlSize = 'xs' | 's' | 'm' | 'l'

const ICON_SIZE: Record<ControlSize, number> = { xs: 16, s: 18, m: 20, l: 22 }

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** На экране одна главная кнопка (primary или accent), остальные secondary / ghost. */
  variant?: ButtonVariant
  size?: ControlSize
  icon?: IconName
  iconRight?: IconName
  isLoading?: boolean
  isBlock?: boolean
  isPill?: boolean
  children?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'm',
  icon,
  iconRight,
  isLoading = false,
  isBlock = false,
  isPill = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        s.btn,
        s[variant],
        size !== 'm' && s[`size-${size}`],
        isBlock && s.block,
        isPill && s.pill,
        className,
      )}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...rest}
    >
      {isLoading ? (
        <span className={s.spinner} aria-hidden />
      ) : (
        icon && <Icon name={icon} size={ICON_SIZE[size]} />
      )}
      {children}
      {iconRight && <Icon name={iconRight} size={ICON_SIZE[size]} />}
    </button>
  )
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: IconName
  /** Обязательная подпись: у кнопки нет видимого текста. */
  label: string
  variant?: ButtonVariant
  size?: ControlSize
  isRound?: boolean
}

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'm',
  isRound = false,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        s.btn,
        s.iconBtn,
        s[variant],
        size !== 'm' && s[`size-${size}`],
        isRound && s.pill,
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={ICON_SIZE[size]} />
    </button>
  )
}
