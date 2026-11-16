import { useEffect, useSyncExternalStore } from 'react'
import { useSettings, type ThemeChoice } from '@/entities/settings'

export type ResolvedTheme = 'light' | 'dark'

const darkQuery = '(prefers-color-scheme: dark)'

function subscribeSystem(onChange: () => void): () => void {
  const media = window.matchMedia(darkQuery)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

export function resolveTheme(choice: ThemeChoice, systemDark: boolean): ResolvedTheme {
  if (choice === 'system') return systemDark ? 'dark' : 'light'
  return choice
}

/** Текущая тема с учётом системной. */
export function useResolvedTheme(): ResolvedTheme {
  const choice = useSettings((s) => s.theme)
  const systemDark = useSyncExternalStore(
    subscribeSystem,
    () => window.matchMedia(darkQuery).matches,
    () => false,
  )
  return resolveTheme(choice, systemDark)
}

/** Ставит data-theme и lang на <html>. Вызывается один раз в корне. */
export function useApplyTheme(): void {
  const theme = useResolvedTheme()
  const lang = useSettings((s) => s.lang)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') root.dataset.theme = 'dark'
    else delete root.dataset.theme
  }, [theme])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
}
