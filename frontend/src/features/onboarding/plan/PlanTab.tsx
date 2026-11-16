import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  STAGES,
  countDone,
  pickNextStep,
  usePlan,
  useSetTaskStatus,
  type Task,
  type TaskStatus,
} from '@/entities/plan'
import { canNotifyNow, useSettings } from '@/entities/settings'
import { IsoArt } from '@/shared/iso'
import { formatDue } from '@/shared/lib/date'
import { useT } from '@/shared/lib/i18n'
import { Button, Card, ErrorState, Eyebrow, Icon, Meter, Row, Skeleton, toast } from '@/shared/ui'
import { StuckCard } from './StuckCard'
import { TaskRow } from './TaskRow'
import {
  isSnoozed,
  isStuckWorkdays,
  readSnoozes,
  snoozeTask,
  stuckPrompts,
  writeSnoozes,
} from './snooze'
import {
  attentionList,
  currentStageIndex,
  stageColorVar,
  summarizeStages,
  type AttentionItem,
} from './status'
import s from './plan.module.css'

type ChangeStatus = (task: Task, status: TaskStatus) => void

function useChangeStatus(): ChangeStatus {
  const t = useT()
  const setStatus = useSetTaskStatus()
  return (task, status) =>
    setStatus.mutate(
      { taskId: task.id, status },
      {
        onError: () =>
          toast.error(t('Не получилось сохранить статус', 'Could not save the status')),
      },
    )
}

function NextStepCard({ task, onStatus }: { task: Task | null; onStatus: ChangeStatus }) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  if (!task) {
    return (
      <Card tone="green" className={s.next} index={1}>
        <Eyebrow>{t('Следующий шаг', 'Next step')}</Eyebrow>
        <h2 className={s.nextTitle}>{t('Все задачи закрыты', 'All tasks are done')}</h2>
        <IsoArt name="trophy" className={s.nextArt} isFloating />
      </Card>
    )
  }
  const meta = [task.due && formatDue(task.due, lang), task.note].filter(Boolean).join(' · ')
  return (
    <Card tone="yellow" className={s.next} index={1}>
      <Eyebrow>{t('Следующий шаг', 'Next step')}</Eyebrow>
      <h2 className={s.nextTitle}>{task.title}</h2>
      {meta && <p className={s.nextMeta}>{meta}</p>}
      <div className={s.nextActions}>
        <Button variant="primary" isPill icon="check" onClick={() => onStatus(task, 'done')}>
          {t('Готово', 'Done')}
        </Button>
        <Link
          className={s.helpLink}
          to="/chats"
          search={{ c: 'buddy', q: `${t('Помоги с задачей', 'Help me with')}: ${task.title}` }}
        >
          {t('Нужна помощь', 'Need help')}
        </Link>
      </div>
      <IsoArt name="books" className={s.nextArt} isFloating />
    </Card>
  )
}

function AttentionCard({ items }: { items: readonly AttentionItem[] }) {
  const t = useT()
  if (items.length === 0) return null
  return (
    <Card className={s.attention} index={2} aria-labelledby="plan-attention">
      <Eyebrow>{t('Застряло', 'Stuck')}</Eyebrow>
      <h2 id="plan-attention" className={s.cardTitle}>
        {t('Здесь можно попросить помощь', 'You can ask for help here')}
      </h2>
      <div className={s.rows}>
        {items.map(({ task, reason }) => (
          <Row
            key={task.id}
            leading={<Icon name={reason === 'blocked' ? 'lock' : 'clock'} size={20} />}
            title={task.title}
            subtitle={
              reason === 'blocked'
                ? task.note || t('Ждёт чужого решения', 'Waiting on someone else')
                : t('В работе 3+ дня без движения', 'In progress for 3+ days')
            }
            trailing={
              <Link
                className={s.helpLink}
                to="/chats"
                search={{ c: 'buddy', q: `${t('Застряла на задаче', 'Stuck on')}: ${task.title}` }}
              >
                {t('Спросить', 'Ask')}
              </Link>
            }
          />
        ))}
      </div>
    </Card>
  )
}

function PlanSkeleton() {
  return (
    <div className={s.grid} aria-busy>
      <Skeleton height={220} radius={28} />
      <Skeleton height={220} radius={28} />
      <Skeleton height={320} radius={28} />
    </div>
  )
}

/** Вкладка «План» (S-1): этапы, задачи, следующий шаг, застрявшие задачи. */
export function PlanTab() {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const plan = usePlan()
  const onStatus = useChangeStatus()
  const isNotifyAllowed = useSettings(canNotifyNow)
  const [snoozes, setSnoozes] = useState(readSnoozes)
  const snooze = (taskId: string) => {
    setSnoozes(writeSnoozes(snoozeTask(snoozes, taskId)))
    toast(t('Ок, спрошу через 3 дня', 'Ok, I will ask again in 3 days'))
  }

  if (plan.isPending) return <PlanSkeleton />
  if (plan.isError) {
    return (
      <ErrorState
        text={t('Не получилось загрузить план', 'Could not load the plan')}
        onRetry={() => void plan.refetch()}
      />
    )
  }

  const tasks = plan.data.tasks
  const done = countDone(tasks)
  const next = pickNextStep(tasks)
  const stages = summarizeStages(tasks)
  const current = currentStageIndex(stages)
  // Проактивный вопрос молчит в «Не мой день» и вне рабочих часов (canNotifyNow)
  const prompts = isNotifyAllowed ? stuckPrompts(tasks, snoozes) : []
  const hiddenStuck = new Set([
    ...prompts.map((prompt) => prompt.task.id),
    ...Object.keys(snoozes).filter((id) => isSnoozed(snoozes, id)),
  ])
  const attention = attentionList(tasks, undefined, hiddenStuck)
  const stuckIds = new Set(tasks.filter((task) => isStuckWorkdays(task)).map((task) => task.id))

  return (
    <div className={s.grid}>
      <Card className={s.summary} index={0}>
        <Eyebrow>{t(`Неделя ${plan.data.week}`, `Week ${plan.data.week}`)}</Eyebrow>
        <p className={s.bigNumber}>
          <b>{done}</b> {t(`из ${tasks.length} задач`, `of ${tasks.length} tasks`)}
        </p>
        <Meter
          value={done}
          max={tasks.length}
          label={t('Прогресс онбординга', 'Onboarding progress')}
        />
        <ul className={s.legend}>
          {STAGES.map((stage) => (
            <li key={stage.index} className={stage.index === current ? s.legendCurrent : undefined}>
              <span
                className={s.dot}
                style={{ background: stageColorVar(stage.color) }}
                aria-hidden
              />
              {lang === 'en' ? stage.title.en : stage.title.ru}
              {stage.index === current && (
                <span className="t-muted">{t(' - сейчас', ' - now')}</span>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <NextStepCard task={next} onStatus={onStatus} />
      <StuckCard prompts={prompts} onSnooze={snooze} />
      <AttentionCard items={attention} />

      {stages.map((stage, i) => {
        const meta = STAGES[stage.index]
        const color = stageColorVar(stage.color)
        const headingId = `stage-${stage.index}`
        return (
          <Card key={stage.index} className={s.stage} index={3 + i} aria-labelledby={headingId}>
            <header className={s.stageHead}>
              <span className={s.stageMark} style={{ background: color }} aria-hidden>
                {stage.index + 1}
              </span>
              <h2 id={headingId} className={s.cardTitle}>
                {lang === 'en' ? meta.title.en : meta.title.ru}
              </h2>
              <span className={s.stageCount}>
                {stage.done}/{stage.total}
              </span>
            </header>
            <Meter
              value={stage.done}
              max={stage.total}
              color={color}
              label={t('Прогресс этапа', 'Stage progress')}
            />
            <ul className={s.tasks}>
              {stage.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  color={color}
                  isNext={task.id === next?.id}
                  isStuck={stuckIds.has(task.id)}
                  onStatus={(status) => onStatus(task, status)}
                />
              ))}
            </ul>
          </Card>
        )
      })}
    </div>
  )
}
