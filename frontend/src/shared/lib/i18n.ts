import { useSettings } from '@/entities/settings'

export type Lang = 'ru' | 'en'
export type Translate = (ru: string, en: string) => string

/**
 * Лёгкий i18n без словарей: обе строки пишутся рядом с местом использования.
 *   const t = useT()
 *   <h1>{t('Мой онбординг', 'My onboarding')}</h1>
 * Тестовые данные (имена, задачи, документы) остаются на русском.
 */
export function useT(): Translate {
  const lang = useSettings((s) => s.lang)
  return (ru, en) => (lang === 'en' ? en : ru)
}

/** Склонение: plural(3, ['задача', 'задачи', 'задач']) -> 'задачи'. */
export function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return forms[2]
  if (last > 1 && last < 5) return forms[1]
  if (last === 1) return forms[0]
  return forms[2]
}
