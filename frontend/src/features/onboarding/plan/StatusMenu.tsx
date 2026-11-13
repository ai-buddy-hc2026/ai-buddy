import { taskStatusSchema, type TaskStatus } from '@/entities/plan'
import { useT } from '@/shared/lib/i18n'
import { STATUS_ORDER, statusLabel } from './status'
import s from './plan.module.css'

type Props = {
  value: TaskStatus
  onChange: (status: TaskStatus) => void
  label: string
}

/** Выбор статуса задачи. Нативный select: работает с клавиатуры и на телефоне. */
export function StatusMenu({ value, onChange, label }: Props) {
  const t = useT()
  return (
    <select
      className={s.status}
      data-status={value}
      value={value}
      aria-label={label}
      onChange={(event) => {
        const parsed = taskStatusSchema.safeParse(event.target.value)
        if (parsed.success) onChange(parsed.data)
      }}
    >
      {STATUS_ORDER.map((status) => (
        <option key={status} value={status}>
          {statusLabel(status, t)}
        </option>
      ))}
    </select>
  )
}
