import { useQuery } from '@tanstack/react-query'
import { onboardingPlanQuery } from '../api/queries'
import type { OnboardingPlan, TaskStatus } from '../api/schemas'

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'Не начато',
  in_progress: 'В работе',
  done: 'Готово',
}

function countProgress(plan: OnboardingPlan) {
  const tasks = plan.stages.flatMap((stage) => stage.tasks)
  const done = tasks.filter((task) => task.status === 'done').length
  return { done, total: tasks.length }
}

export function OnboardingPanel() {
  const { data: plan, isPending, isError } = useQuery(onboardingPlanQuery)

  return (
    <aside className="panel onboarding" aria-labelledby="onboarding-title">
      <h2 id="onboarding-title" className="panel__title">
        Мой онбординг
      </h2>
      {isPending && <p className="muted">Загружаю план...</p>}
      {isError && <p className="error">Не удалось загрузить план</p>}
      {plan && <PlanView plan={plan} />}
    </aside>
  )
}

function PlanView({ plan }: { plan: OnboardingPlan }) {
  const { done, total } = countProgress(plan)
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)

  return (
    <>
      <div className="progress">
        <div className="progress__label">
          Выполнено {done} из {total}
        </div>
        <div
          className="progress__bar"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="progress__fill" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div className="next-step">
        <div className="next-step__label">Следующий шаг</div>
        <div>{plan.nextStep}</div>
      </div>
      {plan.stages.map((stage) => (
        <section key={stage.id} className="stage">
          <h3 className="stage__title">{stage.title}</h3>
          <ul className="tasks">
            {stage.tasks.map((task) => (
              <li key={task.id} className={`task task--${task.status}`}>
                <span className="task__title">{task.title}</span>
                <span className="task__meta">
                  {STATUS_LABELS[task.status]} - {task.deadline}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}
