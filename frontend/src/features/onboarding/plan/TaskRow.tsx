import type { Task, TaskStatus } from '@/entities/plan'
import { useSettings } from '@/entities/settings'
import { cn } from '@/shared/lib/cn'
import { formatDue } from '@/shared/lib/date'
import { useT } from '@/shared/lib/i18n'
import { Badge, Checkbox } from '@/shared/ui'
import { StatusMenu } from './StatusMenu'
import { toggleDone } from './status'
import s from './plan.module.css'

type Props = {
  task: Task
  /** CSS-цвет этапа */
  color: string
  isNext?: boolean
  isStuck?: boolean
  onStatus: (status: TaskStatus) => void
}

export function TaskRow({ task, color, isNext = false, isStuck = false, onStatus }: Props) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const isDone = task.status === 'done'
  const isBlocked = task.status === 'blocked'
  const meta = [task.due && formatDue(task.due, lang), task.note].filter(Boolean).join(' · ')

  return (
    <li className={cn(s.task, isDone && s.taskDone)}>
      <Checkbox
        isChecked={isDone}
        onChange={() => onStatus(toggleDone(task.status))}
        label={task.title}
        color={color}
      />
      <div className={s.taskBody}>
        <span className={s.taskTitle}>{task.title}</span>
        {(meta || isNext || isStuck || isBlocked) && (
          <span className={s.taskMeta}>
            {isNext && <Badge tone="accent">{t('Следующий шаг', 'Next step')}</Badge>}
            {isStuck && (
              <Badge tone="warning" icon="clock">
                {t('Давно без движения', 'Stalled')}
              </Badge>
            )}
            {isBlocked && (
              <Badge tone="error" icon="lock">
                {t('Заблокирована', 'Blocked')}
              </Badge>
            )}
            {meta && <span>{meta}</span>}
          </span>
        )}
      </div>
      <StatusMenu
        value={task.status}
        onChange={onStatus}
        label={t(`Статус: ${task.title}`, `Status: ${task.title}`)}
      />
    </li>
  )
}
