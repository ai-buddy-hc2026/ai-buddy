import type { CSSProperties } from 'react'
import { cn } from '@/shared/lib/cn'
import s from './ui.module.css'

/**
 * Знак AI-buddy: четыре равные точки 2x2 в цветах палитры Авито.
 * Это не логотип Авито (у него точки разного размера), его мы не перерисовываем.
 */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      aria-hidden
      className={className}
      style={{ flex: 'none' }}
    >
      <circle cx="7" cy="7" r="6" style={{ fill: 'var(--brand-green)' }} />
      <circle cx="21" cy="7" r="6" style={{ fill: 'var(--brand-blue)' }} />
      <circle cx="7" cy="21" r="6" style={{ fill: 'var(--brand-red)' }} />
      <circle cx="21" cy="21" r="6" style={{ fill: 'var(--brand-violet)' }} />
    </svg>
  )
}

/** Аватар бота: знак buddy на тёмной плашке. */
export function BuddyAvatar({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn(s.avatar, s.square, className)}
      style={
        {
          '--avatar-size': `${size}px`,
          '--avatar-bg': 'var(--theme-palette-gray92)',
        } as CSSProperties
      }
      role="img"
      aria-label="buddy"
    >
      <BrandMark size={Math.round(size * 0.55)} />
    </span>
  )
}
