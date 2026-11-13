import { useState } from 'react'
import { getEmployee } from '@/entities/employees'
import { canNotifyNow, useSettings } from '@/entities/settings'
import { IsoArt } from '@/shared/iso'
import { formatDue, formatShort } from '@/shared/lib/date'
import { useT, type Translate } from '@/shared/lib/i18n'
import {
  Badge,
  Button,
  Card,
  Dialog,
  ErrorState,
  Eyebrow,
  Meter,
  Note,
  Skeleton,
  toast,
  type BadgeTone,
} from '@/shared/ui'
import { isStale } from '../tracks/logic'
import { COURSES, useCompleteModule, useCourseProgress } from './data'
import {
  courseStatus,
  doneOf,
  minutesLeft,
  mostUrgent,
  nextCourseModule,
  reminderDay,
  sortCourses,
  type Course,
  type CourseProgress,
  type CourseStatus,
} from './logic'
import s from './courses.module.css'

function statusBadge(status: CourseStatus, t: Translate): { tone: BadgeTone; text: string } {
  switch (status) {
    case 'done':
      return { tone: 'success', text: t('Пройден', 'Done') }
    case 'overdue':
      return { tone: 'error', text: t('Просрочен', 'Overdue') }
    case 'soon':
      return { tone: 'warning', text: t('Скоро дедлайн', 'Due soon') }
    case 'ok':
      return { tone: 'neutral', text: t('В срок', 'On track') }
    case 'optional':
      return { tone: 'accent', text: t('По желанию', 'Optional') }
  }
}

type RowProps = { course: Course; progress: CourseProgress; onContinue: (course: Course) => void }

function CourseItem({ course, progress, onContinue }: RowProps) {
  const t = useT()
  const lang = useSettings((st) => st.lang)
  const status = courseStatus(course, progress)
  const badge = statusBadge(status, t)
  const done = doneOf(course, progress)
  return (
    <li className={s.item}>
      <div className={s.itemHead}>
        <h3 className={s.itemTitle}>{course.title}</h3>
        <Badge tone={badge.tone}>{badge.text}</Badge>
      </div>
      <Meter
        value={done}
        max={course.modules.length}
        isOnSunken
        color={status === 'done' ? 'var(--brand-green)' : undefined}
        label={t(`Прогресс: ${course.title}`, `Progress: ${course.title}`)}
      />
      <div className={s.itemFoot}>
        <span className="t-s t-muted">
          {t(
            `${done} из ${course.modules.length} модулей`,
            `${done} of ${course.modules.length} modules`,
          )}
          {course.deadline && ` · ${t('дедлайн', 'due')} ${formatDue(course.deadline, lang)}`}
          {status !== 'done' &&
            ` · ${t(`около ${minutesLeft(course, progress)} мин`, `about ${minutesLeft(course, progress)} min`)}`}
        </span>
        {status !== 'done' && (
          <Button
            size="s"
            className={s.touch}
            iconRight="arrowRight"
            onClick={() => onContinue(course)}
          >
            {t('Продолжить', 'Continue')}
          </Button>
        )}
      </div>
    </li>
  )
}

function ReminderNote({ course, progress }: { course: Course; progress: CourseProgress }) {
  const t = useT()
  const canNotify = useSettings((st) => canNotifyNow(st))
  const days = reminderDay(course, progress)
  if (days === null) return null
  if (!canNotify) {
    return (
      <Note tone="info" icon="moon">
        {t('Напоминание подождёт до рабочего времени', 'The reminder waits for working hours')}
      </Note>
    )
  }
  return (
    <Note tone="warning" icon="bell">
      {t(
        `До дедлайна ${days === 1 ? '1 день' : `${days} дня`}: напоминаю заранее`,
        `${days} d to the deadline: early reminder`,
      )}
    </Note>
  )
}

type DialogProps = { course: Course; progress: CourseProgress; onClose: () => void }

function ModuleDialog({ course, progress, onClose }: DialogProps) {
  const t = useT()
  const lang = useSettings((st) => st.lang)
  const complete = useCompleteModule()
  const module = nextCourseModule(course, progress)
  const owner = getEmployee(course.source.ownerId)
  const done = doneOf(course, progress)

  const handleDone = () =>
    complete.mutate(course.id, {
      onSuccess: () => {
        toast(t(`Модуль «${module ?? ''}» пройден`, `Module "${module ?? ''}" done`))
        onClose()
      },
      onError: () =>
        toast.error(t('Не получилось сохранить прогресс', 'Could not save progress'), {
          label: t('Повторить', 'Retry'),
          run: handleDone,
        }),
    })

  const footer = (
    <Button variant="primary" icon="check" isLoading={complete.isPending} onClick={handleDone}>
      {t('Модуль пройден', 'Module done')}
    </Button>
  )
  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={course.title}
      footer={module ? footer : undefined}
      closeLabel={t('Закрыть', 'Close')}
    >
      <div className={s.dialog}>
        <Eyebrow>
          {t(
            `Модуль ${done + 1} из ${course.modules.length}`,
            `Module ${done + 1} of ${course.modules.length}`,
          )}
        </Eyebrow>
        <p className={s.dialogTitle}>{module ?? t('Курс пройден', 'Course done')}</p>
        <p className="t-s t-muted">
          {t(
            `${course.minutesPerModule} мин · Источник`,
            `${course.minutesPerModule} min · Source`,
          )}
          : «{course.source.title}», {t('проверен', 'reviewed')}{' '}
          {formatShort(course.source.reviewedAt, lang)}
          {owner && `, ${t('владелец', 'owner')}: ${owner.name}`}
        </p>
        {isStale(course.source.reviewedAt) && (
          <Note tone="warning">
            {t(
              'Может быть устаревшим: документ проверяли больше 6 месяцев назад',
              'May be outdated: reviewed over 6 months ago',
            )}
          </Note>
        )}
        <Note tone="info">
          {t(
            'Тестовый курс, не регламент Авито. Сам курс открывается в мок-сервисе обучения',
            'Test course, not an Avito policy. The course itself lives in the learning mock',
          )}
        </Note>
      </div>
    </Dialog>
  )
}

/** Вкладка «Курсы» (идея 10): обязательные курсы с прогрессом и дедлайном, soft skills по желанию. */
export function CoursesTab() {
  const t = useT()
  const lang = useSettings((st) => st.lang)
  const query = useCourseProgress()
  const [openId, setOpenId] = useState<string | null>(null)

  if (query.isPending) {
    return (
      <div className={s.grid} aria-busy>
        <Skeleton height={240} radius={28} />
        <Skeleton height={240} radius={28} />
      </div>
    )
  }
  if (query.isError) {
    return (
      <ErrorState
        text={t('Не получилось загрузить курсы', 'Could not load courses')}
        onRetry={() => void query.refetch()}
        retryLabel={t('Повторить', 'Retry')}
      />
    )
  }

  const progress = query.data
  const required = sortCourses(
    COURSES.filter((c) => c.kind === 'required'),
    progress,
  )
  const optional = COURSES.filter((c) => c.kind === 'optional')
  const urgent = mostUrgent(COURSES, progress)
  const requiredDone = required.filter((c) => courseStatus(c, progress) === 'done').length
  const opened = COURSES.find((c) => c.id === openId)
  const handleContinue = (course: Course) => setOpenId(course.id)

  return (
    <div className={s.grid}>
      <Card tone="blue" className={s.hero} index={0}>
        <Eyebrow>
          {t(
            `Обязательные: ${requiredDone} из ${required.length}`,
            `Required: ${requiredDone} of ${required.length}`,
          )}
        </Eyebrow>
        {urgent ? (
          <>
            <h2 className={s.heroTitle}>{urgent.title}</h2>
            <p className={s.heroMeta}>
              {t(
                `${doneOf(urgent, progress)} из ${urgent.modules.length} модулей`,
                `${doneOf(urgent, progress)} of ${urgent.modules.length} modules`,
              )}
              {urgent.deadline && `, ${t('дедлайн', 'due')} ${formatDue(urgent.deadline, lang)}`}.{' '}
              {t(
                `Осталось около ${minutesLeft(urgent, progress)} минут`,
                `About ${minutesLeft(urgent, progress)} minutes left`,
              )}
            </p>
            <Meter
              value={doneOf(urgent, progress)}
              max={urgent.modules.length}
              label={t('Прогресс курса', 'Course progress')}
            />
            <ReminderNote course={urgent} progress={progress} />
            <div>
              <Button
                variant="primary"
                isPill
                iconRight="arrowRight"
                onClick={() => handleContinue(urgent)}
              >
                {t('Продолжить', 'Continue')}
              </Button>
            </div>
          </>
        ) : (
          <h2 className={s.heroTitle}>
            {t('Все обязательные курсы пройдены', 'All required courses are done')}
          </h2>
        )}
        <IsoArt name="books" className={s.heroArt} isFloating />
      </Card>

      <Card className={s.list} index={1} aria-labelledby="courses-required">
        <Eyebrow>{t('Обязательные', 'Required')}</Eyebrow>
        <h2 id="courses-required" className={s.cardTitle}>
          {t('Дедлайны не двигаются', 'Deadlines are fixed')}
        </h2>
        <ul className={s.items}>
          {required.map((course) => (
            <CourseItem
              key={course.id}
              course={course}
              progress={progress}
              onContinue={handleContinue}
            />
          ))}
        </ul>
      </Card>

      <Card className={s.soft} index={2} aria-labelledby="courses-soft">
        <Eyebrow>{t('Soft skills, по желанию', 'Soft skills, optional')}</Eyebrow>
        <h2 id="courses-soft" className={s.cardTitle}>
          {t('Короткие, по 5-10 минут', 'Short, 5-10 minutes each')}
        </h2>
        <ul className={s.items}>
          {optional.map((course) => (
            <CourseItem
              key={course.id}
              course={course}
              progress={progress}
              onContinue={handleContinue}
            />
          ))}
        </ul>
      </Card>

      {opened && (
        <ModuleDialog
          key={opened.id}
          course={opened}
          progress={progress}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}
