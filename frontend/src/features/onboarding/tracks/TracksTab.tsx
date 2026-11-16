import { useState } from 'react'
import { useUser } from '@/entities/session'
import { IsoArt } from '@/shared/iso'
import { useT } from '@/shared/lib/i18n'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Eyebrow,
  Meter,
  Note,
  Row,
  Skeleton,
  toast,
} from '@/shared/ui'
import { QuizDialog } from './QuizDialog'
import { RouteList } from './RouteList'
import { TrackBadge } from './TrackBadge'
import {
  REQUIRED_TRACK_IDS,
  TRACKS,
  findModule,
  getTrack,
  trackColorVar,
  type Track,
} from './catalog'
import {
  addTrack,
  applyQuizResult,
  buildRoute,
  earnedBadges,
  isPassed,
  moveTrack,
  nextModule,
  removeTrack,
  setModuleStatus,
} from './logic'
import { getQuiz } from './quizzes'
import { useUpdateTracks, useUserTracks, type TracksUpdate } from './store'
import s from './tracks.module.css'

const DEMO_WEEK = 2

function useApply(): (fn: TracksUpdate, okText?: string) => void {
  const t = useT()
  const update = useUpdateTracks()
  return (fn, okText) =>
    update.mutate(fn, {
      onSuccess: () => {
        if (okText) toast(okText)
      },
      onError: () =>
        toast.error(t('Не получилось сохранить, попробуй ещё раз', 'Could not save, try again')),
    })
}

function TracksSkeleton() {
  return (
    <div className={s.grid} aria-busy>
      <Skeleton height={240} radius={28} />
      <Skeleton height={240} radius={28} />
      <Skeleton height={420} radius={28} />
    </div>
  )
}

/** Вкладка «Треки» (идея 45): обязательный минимум, треки на выбор, порядок, тест «Я это знаю», бейджи. */
export function TracksTab() {
  const t = useT()
  const user = useUser()
  const query = useUserTracks()
  const apply = useApply()
  const [quizModuleId, setQuizModuleId] = useState<string | null>(null)

  if (query.isPending) return <TracksSkeleton />
  if (query.isError) {
    return (
      <ErrorState
        text={t('Не получилось загрузить треки', 'Could not load tracks')}
        onRetry={() => void query.refetch()}
        retryLabel={t('Повторить', 'Retry')}
      />
    )
  }

  const state = query.data
  const selected = state.selected
    .map(getTrack)
    .filter((track): track is Track => track !== undefined)
  const route = buildRoute(selected, state, DEMO_WEEK)
  const next = nextModule(selected, state)
  const badges = earnedBadges(selected, state)
  const catalog = TRACKS.filter((track) => !track.required && !state.selected.includes(track.id))
  const totalModules = selected.reduce((sum, track) => sum + track.modules.length, 0)
  const closedModules = route.reduce((sum, step) => sum + step.progress.done, 0)
  const quizTarget = quizModuleId ? findModule(quizModuleId) : undefined
  const quiz = quizTarget?.module.quizId ? getQuiz(quizTarget.module.quizId) : undefined

  const markDone = (moduleId: string) =>
    apply(
      (st) => setModuleStatus(st, moduleId, 'done'),
      t('Модуль закрыт, маршрут пересчитан', 'Module closed, route updated'),
    )

  return (
    <div className={s.grid}>
      <Card tone="yellow" className={s.hero} index={0}>
        <Eyebrow>
          {t(`Мой онбординг · ${user.employee.role}`, `My onboarding · ${user.employee.role}`)}
        </Eyebrow>
        <p className={s.bigNumber}>
          <b>{closedModules}</b> {t(`из ${totalModules} модулей`, `of ${totalModules} modules`)}
        </p>
        <Meter
          value={closedModules}
          max={totalModules}
          color="var(--iso-ink)"
          label={t('Прогресс по трекам', 'Tracks progress')}
        />
        {next ? (
          <div className={s.next}>
            <span className="t-s">{t('Следующий шаг', 'Next step')}</span>
            <h2 className={s.nextTitle}>{next.module.title}</h2>
            <span className="t-s">
              {next.track.title} · {t(`${next.module.minutes} мин`, `${next.module.minutes} min`)}
            </span>
            <div className={s.nextActions}>
              <Button
                variant="primary"
                isPill
                icon="check"
                onClick={() => markDone(next.module.id)}
              >
                {t('Пройдено', 'Done')}
              </Button>
            </div>
          </div>
        ) : (
          <h2 className={s.nextTitle}>
            {t('Все выбранные треки пройдены', 'All chosen tracks are done')}
          </h2>
        )}
        <IsoArt name="trophy" className={s.heroArt} isFloating />
      </Card>

      <Card className={s.badges} index={1} aria-labelledby="tracks-badges">
        <Eyebrow>{t('Бейджи', 'Badges')}</Eyebrow>
        <h2 id="tracks-badges" className={s.cardTitle}>
          {t(
            `${badges.filter((b) => b.isEarned).length} из ${badges.length}`,
            `${badges.filter((b) => b.isEarned).length} of ${badges.length}`,
          )}
        </h2>
        <ul className={s.badgeList}>
          {badges.map((badge) => (
            <TrackBadge key={badge.id} badge={badge} />
          ))}
        </ul>
      </Card>

      <Card className={s.routeCard} index={2} aria-labelledby="tracks-route">
        <Eyebrow>{t('Маршрут', 'Route')}</Eyebrow>
        <h2 id="tracks-route" className={s.cardTitle}>
          {t('Порядок прохождения', 'Your order')}
        </h2>
        <p className="t-s t-muted">
          {t(
            'Перетащи трек или нажми стрелки. Неделя считается по темпу 2 часа в неделю',
            'Drag a track or use the arrows. Weeks assume 2 hours per week',
          )}
        </p>
        <RouteList
          steps={route}
          state={state}
          nextModuleId={next?.module.id ?? null}
          onMove={(trackId, to) => apply((st) => moveTrack(st, trackId, to))}
          onRemove={(trackId) =>
            apply(
              (st) => removeTrack(st, trackId, REQUIRED_TRACK_IDS),
              t('Трек убран', 'Track removed'),
            )
          }
          onModuleDone={markDone}
          onQuiz={setQuizModuleId}
        />
      </Card>

      <Card className={s.catalog} index={3} aria-labelledby="tracks-catalog">
        <Eyebrow>{t('На выбор', 'Optional')}</Eyebrow>
        <h2 id="tracks-catalog" className={s.cardTitle}>
          {t('Каталог треков', 'Track catalog')}
        </h2>
        <Note tone="info">
          {t(
            'Доступы, ИБ и первая задача обязательны, их не убрать',
            'Access, security and first task are required',
          )}
        </Note>
        {catalog.length === 0 ? (
          <EmptyState
            art={<IsoArt name="books" />}
            title={t('Ты взял все треки', 'You took every track')}
          />
        ) : (
          <ul className={s.catalogList}>
            {catalog.map((track) => (
              <li key={track.id}>
                <Row
                  leading={
                    <span
                      className={s.catalogDot}
                      style={{ background: trackColorVar(track.color) }}
                      aria-hidden
                    />
                  }
                  title={track.title}
                  subtitle={`${track.about} · ${track.modules.reduce((sum, m) => sum + m.minutes, 0)} ${t('мин', 'min')}`}
                  trailing={
                    <Button
                      size="s"
                      className={s.touch}
                      icon="plus"
                      onClick={() =>
                        apply(
                          (st) => addTrack(st, track.id),
                          t(`Трек «${track.title}» добавлен`, `Track "${track.title}" added`),
                        )
                      }
                    >
                      {t('Добавить', 'Add')}
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {quizTarget && quiz && (
        <QuizDialog
          key={quizTarget.module.id}
          module={quizTarget.module}
          quiz={quiz}
          onClose={() => setQuizModuleId(null)}
          onSubmit={(score) =>
            apply(
              (st) => applyQuizResult(st, quizTarget.module.id, score),
              isPassed(score)
                ? t('Засчитано, модуль можно пропустить', 'Passed, you can skip this module')
                : undefined,
            )
          }
        />
      )}
    </div>
  )
}
