import { create } from 'zustand'
import { cn } from '@/shared/lib/cn'
import { newId } from '@/shared/lib/storage'
import s from './ui.module.css'

interface ToastItem {
  id: string
  text: string
  isError: boolean
  action?: { label: string; run: () => void }
}

interface ToastState {
  items: ToastItem[]
  push: (item: Omit<ToastItem, 'id'>) => void
  dismiss: (id: string) => void
}

const TOAST_LIFETIME_MS = 4500
const MAX_VISIBLE = 3

const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push: (item) => {
    const id = newId('toast')
    set((state) => ({ items: [...state.items, { ...item, id }].slice(-MAX_VISIBLE) }))
    setTimeout(() => get().dismiss(id), TOAST_LIFETIME_MS)
  },
  dismiss: (id) => set((state) => ({ items: state.items.filter((t) => t.id !== id) })),
}))

/**
 * Короткое уведомление внизу экрана.
 *   toast('Заявка отправлена')
 *   toast.error('Не получилось сохранить', { label: 'Повторить', run: retry })
 */
export function toast(text: string, action?: ToastItem['action']): void {
  useToasts.getState().push({ text, isError: false, action })
}
toast.error = (text: string, action?: ToastItem['action']): void => {
  useToasts.getState().push({ text, isError: true, action })
}

/** Контейнер тостов. Стоит один раз в корне приложения. */
export function Toaster() {
  const items = useToasts((state) => state.items)
  const dismiss = useToasts((state) => state.dismiss)
  return (
    <div className={s.toaster} role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={cn(s.toast, item.isError && s.error)}>
          <span>{item.text}</span>
          {item.action && (
            <button
              type="button"
              className={s.toastAction}
              onClick={() => {
                item.action?.run()
                dismiss(item.id)
              }}
            >
              {item.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
