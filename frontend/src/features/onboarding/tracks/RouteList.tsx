import { useState } from 'react'
import { getEmployee } from '@/entities/employees'
import { useSettings } from '@/entities/settings'
import { formatShort } from '@/shared/lib/date'
import { useT } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/cn'
import { Badge, Button, Icon, IconButton, Meter } from '@/shared/ui'
import { trackColorVar, type TrackModule } from './catalog'
import { canTakeQuiz, isStale, progressOf, type RouteStep, type UserTracks } from './logic'
import s from './tracks.module.css'

type Props = {
  steps: readonly RouteStep[]
  state: UserTracks
  nextModuleId: string | null
  onMove: (trackId: string, to: number) => void
  onRemove: (trackId: string) => void
  onModuleDone: (moduleId: string) => void
  onQuiz: (moduleId: string) => void
}

type ModuleProps = Pick<Props, 'state' | 'onModuleDone' | 'onQuiz'> & {
  module: TrackModule
  isNext: boolean
}

function ModuleRow({ module, state, isNext, onModuleDone, onQuiz }: ModuleProps) {
  const t = useT()
  const lang = useSettings((st) => st.lang)
  const progress = progressOf(state, module.id)
  const owner = getEmployee(module.source.ownerId)
  const isClosed = progress.status !== 'todo'
  const canQuiz = module.quizId !== null && canTakeQuiz(state, module.id)
  const isRetakeLater = module.quizId !== null && !isClosed && !canQuiz

  return (
    <li className={cn(s.module, isClosed && s.moduleClosed)}>
      <span className={s.moduleMark} aria-hidden>
        {isClosed ? <Icon name="check" size={16} strokeWidth={3} /> : null}
      </span>
      <div className={s.moduleBody}>
        <span className={s.moduleTitle}>
          {module.title}
          {isNext && <Badge tone="accent">{t('Следующий шаг', 'Next step')}</Badge>}
          {progress.status === 'skipped_by_test' && (
            <Badge tone="pay">{t('Закрыт тестом', 'Closed by test')}</Badge>
          )}
        </span>
        <span className={s.moduleMeta}>
          {t(`${module.minutes} мин`, `${module.minutes} min`)} · {t('Источник', 'Source')}: «
          {module.source.title}», {t('проверен', 'reviewed')}{' '}
          {formatShort(module.source.reviewedAt, lang)}
          {owner && `, ${t('владелец', 'owner')}: ${owner.name}`}
          {isStale(module.source.reviewedAt) && (
            <Badge tone="warning" icon="alert">
              {t('Может быть устаревшим', 'May be outdated')}
            </Badge>
          )}
        </span>
      </div>
      {!isClosed && (
        <div className={s.moduleActions}>
          {canQuiz && (
            <Button
              size="s"
              className={s.touch}
              variant="ghost"
              icon="sparkle"
              onClick={() => onQuiz(module.id)}
            >
              {t('Я это знаю', 'I know this')}
            </Button>
          )}
          {isRetakeLater && (
            <span className="t-s t-muted">{t('Пересдача завтра', 'Retake tomorrow')}</span>
          )}
          <Button size="s" className={s.touch} icon="check" onClick={() => onModuleDone(module.id)}>
            {t('Пройдено', 'Done')}
          </Button>
        </div>
      )}
    </li>
  )
}

/** Маршрут: выбранные треки по порядку. Порядок меняется перетаскиванием или кнопками. */
export function RouteList({
  steps,
  state,
  nextModuleId,
  onMove,
  onRemove,
  onModuleDone,
  onQuiz,
}: Props) {
  const t = useT()
  const [dragId, setDragId] = useState<string | null>(null)

  return (
    <ol className={s.route}>
      {steps.map((step, index) => {
        const { track, progress } = step
        const color = trackColorVar(track.color)
        return (
          <li
            key={track.id}
            className={cn(s.routeItem, dragId === track.id && s.dragging)}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              setDragId(track.id)
            }}
            onDragEnd={() => setDragId(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              if (dragId) onMove(dragId, index)
              setDragId(null)
            }}
          >
            <header className={s.routeHead}>
              <span className={s.dragHandle} aria-hidden>
                <Icon name="drag" size={18} />
              </span>
              <span className={s.routeMark} style={{ background: color }} aria-hidden>
                {index + 1}
              </span>
              <div className={s.routeTitle}>
                <h3>{track.title}</h3>
                <span className="t-s t-muted">
                  {progress.isComplete
                    ? t('Пройден', 'Completed')
                    : t(
                        `${progress.done} из ${progress.total} · к неделе ${step.week}`,
                        `${progress.done} of ${progress.total} · by week ${step.week}`,
                      )}
                  {track.required && ` · ${t('обязательный', 'required')}`}
                </span>
              </div>
              <div className={s.routeControls}>
                <IconButton
                  icon="chevronUp"
                  label={t(`Выше: ${track.title}`, `Move up: ${track.title}`)}
                  disabled={index === 0}
                  onClick={() => onMove(track.id, index - 1)}
                />
                <IconButton
                  icon="chevronDown"
                  label={t(`Ниже: ${track.title}`, `Move down: ${track.title}`)}
                  disabled={index === steps.length - 1}
                  onClick={() => onMove(track.id, index + 1)}
                />
                {!track.required && (
                  <IconButton
                    icon="trash"
                    label={t(`Убрать трек ${track.title}`, `Remove track ${track.title}`)}
                    onClick={() => onRemove(track.id)}
                  />
                )}
              </div>
            </header>
            <Meter
              value={progress.done}
              max={progress.total}
              color={color}
              label={t(`Прогресс трека ${track.title}`, `Track progress ${track.title}`)}
            />
            <ul className={s.modules}>
              {track.modules.map((module) => (
                <ModuleRow
                  key={module.id}
                  module={module}
                  state={state}
                  isNext={module.id === nextModuleId}
                  onModuleDone={onModuleDone}
                  onQuiz={onQuiz}
                />
              ))}
            </ul>
          </li>
        )
      })}
    </ol>
  )
}
