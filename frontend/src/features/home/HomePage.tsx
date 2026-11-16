import type { FormEvent } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { EMPLOYEES } from '@/entities/employees'
import {
  STAGES,
  countDone,
  pickNextStep,
  usePlan,
  useSetTaskStatus,
  type Task,
} from '@/entities/plan'
import { useUser } from '@/entities/session'
import { useIsNotMyDay, useSettings } from '@/entities/settings'
import { IsoArt, IsoCity } from '@/shared/iso'
import { DEMO_TODAY, formatDue } from '@/shared/lib/date'
import { useT } from '@/shared/lib/i18n'
import {
  BuddyAvatar,
  Button,
  Card,
  Chip,
  ChipRow,
  ErrorState,
  Eyebrow,
  Icon,
  Meter,
  Page,
  Skeleton,
  toast,
  type IconName,
} from '@/shared/ui'
import s from './HomePage.module.css'

interface TodayItem {
  icon: IconName
  title: string
  note: string
  to: string
  tab?: string
}

/** Короткая сводка дня (идея 23). Факты берутся из данных, не из LLM. */
function useTodayItems(): TodayItem[] {
  const t = useT()
  const user = useUser()
  const isBirthdaysOn = useSettings((state) => state.toggles.birthdayReminders)
  const todayKey = DEMO_TODAY.slice(5)
  const birthday = EMPLOYEES.find(
    (e) =>
      e.teamId === user.employee.teamId && e.id !== user.employee.id && e.birthday === todayKey,
  )

  const items: TodayItem[] = [
    {
      icon: 'calendar',
      title: t('1:1 с Ильёй', '1:1 with Ilya'),
      note: '14:00',
      to: '/people',
      tab: 'hours',
    },
    {
      icon: 'shield',
      title: t('Курс по ИБ', 'Security course'),
      note: t('до пятницы, 20 минут', 'by Friday, 20 min'),
      to: '/onboarding',
      tab: 'courses',
    },
  ]
  if (isBirthdaysOn && birthday) {
    items.push({
      icon: 'heart',
      title: t(
        `День рождения у ${birthday.short.replace(/а$/, 'ы')}`,
        `${birthday.short}'s birthday`,
      ),
      note: t('сегодня', 'today'),
      to: '/chats',
    })
  }
  return items
}

function NextStep({ task }: { task: Task | null }) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const setStatus = useSetTaskStatus()

  if (!task) {
    return (
      <Card tone="green" className={s.next} index={1}>
        <Eyebrow>{t('Следующий шаг', 'Next step')}</Eyebrow>
        <h2 className={s.nextTitle}>{t('Все задачи закрыты', 'All tasks are done')}</h2>
        <p>{t('Город построен. Ты молодец', 'The city is built. Well done')}</p>
        <IsoArt name="trophy" className={s.nextArt} isFloating />
      </Card>
    )
  }

  const complete = () =>
    setStatus.mutate(
      { taskId: task.id, status: 'done' },
      {
        onSuccess: () => toast(t('Готово. В городе новый дом', 'Done. A new building is up')),
        onError: () => toast.error(t('Не получилось сохранить', 'Could not save')),
      },
    )

  return (
    <Card tone="yellow" className={s.next} index={1}>
      <Eyebrow>{t('Следующий шаг', 'Next step')}</Eyebrow>
      <h2 className={s.nextTitle}>{task.title}</h2>
      <p className={s.nextNote}>
        {[task.due && formatDue(task.due, lang), task.note].filter(Boolean).join(' · ')}
      </p>
      <div className={s.nextActions}>
        <Button
          variant="onColor"
          isPill
          icon="check"
          onClick={complete}
          isLoading={setStatus.isPending}
        >
          {t('Готово', 'Done')}
        </Button>
        <Link
          to="/chats"
          search={{ c: 'buddy', q: `${t('Помоги с задачей', 'Help me with')}: ${task.title}` }}
          className={s.nextHelp}
        >
          {t('Нужна помощь', 'Need help')}
        </Link>
      </div>
      <IsoArt name="books" className={s.nextArt} isFloating />
    </Card>
  )
}

function AskBuddy() {
  const t = useT()
  const navigate = useNavigate()
  const ask = (question: string) =>
    void navigate({ to: '/chats', search: { c: 'buddy', q: question } })

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const input = event.currentTarget.elements.namedItem('q')
    if (!(input instanceof HTMLInputElement)) return
    const question = input.value.trim()
    if (question) ask(question)
  }

  const quick = [
    t('Что мне делать дальше?', 'What should I do next?'),
    t('Как проходит code review?', 'How does code review work?'),
    t('Хочу отгул в пятницу', 'I want Friday off'),
  ]

  return (
    <Card className={s.ask} index={2}>
      <div className={s.askHead}>
        <BuddyAvatar size={44} />
        <div>
          <h2 className={s.cardTitle}>{t('Спроси buddy', 'Ask buddy')}</h2>
          <p className="t-s t-muted">
            {t(
              'Ответит по базе знаний и покажет источник',
              'Answers from the knowledge base with a source',
            )}
          </p>
        </div>
      </div>
      <form className={s.askForm} onSubmit={handleSubmit}>
        <input
          name="q"
          className={s.askInput}
          placeholder={t('Например: где переговорка Байкал?', 'For example: where is room Baikal?')}
          aria-label={t('Вопрос для buddy', 'Question for buddy')}
          autoComplete="off"
        />
        <button type="submit" className={s.askSend} aria-label={t('Спросить', 'Ask')}>
          <Icon name="send" size={20} />
        </button>
      </form>
      <ChipRow>
        {quick.map((question) => (
          <Chip key={question} onClick={() => ask(question)}>
            {question}
          </Chip>
        ))}
      </ChipRow>
    </Card>
  )
}

function Today() {
  const t = useT()
  const items = useTodayItems()
  const isNotMyDay = useIsNotMyDay()

  return (
    <Card className={s.today} index={3}>
      <h2 className={s.cardTitle}>{t('Сегодня', 'Today')}</h2>
      {isNotMyDay ? (
        <p className={s.quiet}>
          <Icon name="dayOff" size={20} />
          {t(
            'Тихий день. Напоминаний не будет, шаги перенесены на завтра',
            'Quiet day. No reminders, steps moved to tomorrow',
          )}
        </p>
      ) : (
        <ul className={s.todayList}>
          {items.map((item) => (
            <li key={item.title}>
              <Link to={item.to} search={item.tab ? { tab: item.tab } : {}} className={s.todayItem}>
                <span className={s.todayIcon}>
                  <Icon name={item.icon} size={20} />
                </span>
                <span className={s.todayText}>
                  <b>{item.title}</b>
                  <span>{item.note}</span>
                </span>
                <Icon name="chevronRight" size={18} className={s.todayArrow} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** Главная: только город, следующий шаг, вопрос к buddy и сводка дня. Остальное - во вкладках. */
export function HomePage() {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const user = useUser()
  const navigate = useNavigate()
  const plan = usePlan()

  if (plan.isError) {
    return (
      <ErrorState
        text={t('Не получилось загрузить план', 'Could not load the plan')}
        onRetry={() => void plan.refetch()}
      />
    )
  }

  const tasks = plan.data?.tasks ?? []
  const done = countDone(tasks)
  const next = pickNextStep(tasks)

  return (
    <Page className={s.grid}>
      <Card className={s.hero} index={0}>
        <div className={s.heroText}>
          <Eyebrow>
            {t(`Неделя ${plan.data?.week ?? 2}`, `Week ${plan.data?.week ?? 2}`)} ·{' '}
            {user.employee.role}
          </Eyebrow>
          <h1 className={s.hello}>
            {t(`Привет, ${user.employee.short}`, `Hi, ${user.employee.short}`)}
          </h1>
          <p className={s.heroLead}>
            {t(
              'Каждая закрытая задача - новый дом в твоём городе',
              'Every closed task is a new building in your city',
            )}
          </p>
          {plan.isPending ? (
            <Skeleton height={44} width={220} />
          ) : (
            <div className={s.progress}>
              <div className={s.progressNumbers}>
                <b className="t-num">{done}</b>
                <span>
                  {t('из', 'of')} {tasks.length}
                </span>
              </div>
              <Meter
                value={done}
                max={tasks.length}
                color="var(--brand-green)"
                label={t('Прогресс онбординга', 'Onboarding progress')}
              />
            </div>
          )}
          <ul className={s.legend}>
            {STAGES.map((stage) => (
              <li key={stage.index}>
                <i style={{ background: `var(--brand-${stage.color})` }} />
                {stage.title[lang].split(':')[0]}
              </li>
            ))}
          </ul>
        </div>
        <div className={s.city}>
          {plan.isPending ? (
            <Skeleton height={260} radius="var(--radius-inner)" />
          ) : (
            <IsoCity
              tasks={tasks}
              currentId={next?.id}
              label={t(
                `Город прогресса: построено ${done} из ${tasks.length}`,
                `Progress city: ${done} of ${tasks.length} built`,
              )}
              onSelect={() => void navigate({ to: '/onboarding' })}
            />
          )}
        </div>
      </Card>

      {plan.isPending ? (
        <Skeleton height={260} radius="var(--radius-card)" />
      ) : (
        <NextStep task={next} />
      )}
      <AskBuddy />
      <Today />
    </Page>
  )
}
