import { Link } from '@tanstack/react-router'
import { useSettings } from '@/entities/settings'
import { daysUntil, formatDue } from '@/shared/lib/date'
import { useT } from '@/shared/lib/i18n'
import { Badge, Card, ErrorState, Eyebrow, Meter, Skeleton, type BadgeTone } from '@/shared/ui'
import { useRequiredCourses, type Course } from './data'
import s from './events.module.css'

function deadlineTone(course: Course): BadgeTone {
  if (course.modulesDone >= course.modulesTotal) return 'success'
  const diff = daysUntil(course.deadline)
  if (diff < 0) return 'error'
  return diff <= 3 ? 'warning' : 'neutral'
}

/** Обязательные курсы (идея 10): прогресс, дедлайн, «Продолжить». */
export function RequiredCourses({ index }: { index: number }) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const courses = useRequiredCourses()

  return (
    <Card index={index} className={s.courses}>
      <Eyebrow>{t('Обязательно', 'Required')}</Eyebrow>
      <h2 className={s.cardTitle}>{t('Обязательные курсы', 'Required courses')}</h2>
      {courses.isPending && <Skeleton height={160} radius="var(--radius-inner)" />}
      {courses.isError && (
        <ErrorState
          text={t('Не получилось загрузить курсы', 'Could not load courses')}
          onRetry={() => void courses.refetch()}
          retryLabel={t('Повторить', 'Retry')}
        />
      )}
      {courses.data && (
        <ul className={s.courseList}>
          {courses.data.map((course) => {
            const isDone = course.modulesDone >= course.modulesTotal
            return (
              <li key={course.id} className={s.courseItem}>
                <div className={s.courseHead}>
                  <b>{course.title}</b>
                  <Badge tone={deadlineTone(course)}>
                    {isDone ? t('Пройден', 'Done') : formatDue(course.deadline, lang)}
                  </Badge>
                </div>
                <Meter
                  value={course.modulesDone}
                  max={course.modulesTotal}
                  color={isDone ? 'var(--brand-green)' : 'var(--brand-blue)'}
                  label={t(`${course.title}: прогресс`, `${course.title}: progress`)}
                  isOnSunken
                />
                <div className={s.courseFoot}>
                  <span className="t-s t-muted t-num">
                    {t(
                      `${course.modulesDone} из ${course.modulesTotal} модулей`,
                      `${course.modulesDone} of ${course.modulesTotal} modules`,
                    )}
                    {!isDone &&
                      t(`, около ${course.minutesLeft} мин`, `, about ${course.minutesLeft} min`)}
                  </span>
                  {!isDone && (
                    <Link to="/onboarding" search={{ tab: 'courses' }} className={s.inlineLink}>
                      {t('Продолжить', 'Continue')}
                    </Link>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
