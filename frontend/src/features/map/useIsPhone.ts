import { useSyncExternalStore } from 'react'

/** Тот же брейкпоинт, что в оболочке: на телефоне панель места - bottom sheet. */
const PHONE_QUERY = '(max-width: 720px)'

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(PHONE_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  )
}
