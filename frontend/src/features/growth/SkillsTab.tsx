import { Link } from '@tanstack/react-router'
import { useSettings } from '@/entities/settings'
import { useT, type Translate } from '@/shared/lib/i18n'
import { Button, Card, ErrorState, Eyebrow, Icon, Meter, Note, Skeleton, toast } from '@/shared/ui'
import { useMergeRequests, useSetSkillLevel, useSkillLevels } from './data'
import {
  averageLevel,
  BACKEND_COMPETENCIES,
  levelOf,
  MAX_LEVEL,
  skillHints,
  weakestSkill,
  type Competency,
  type SkillHint,
  type SkillLevels,
} from './skillsLogic'
import s from './growth.module.css'

const LEVELS = [1, 2, 3, 4] as const

function levelName(level: number, t: Translate): string {
  const names = [
    t('Знакомлюсь', 'Learning'),
    t('С помощью', 'With help'),
    t('Сама', 'On my own'),
    t('Могу научить', 'Can teach'),
  ]
  return names[level - 1] ?? ''
}

function hintText(hint: SkillHint, t: Translate): string {
  switch (hint.kind) {
    case 'missingTests':
      return t(
        `В ${hint.missing} из ${hint.total} MR с кодом нет тестов`,
        `${hint.missing} of ${hint.total} code MRs have no tests`,
      )
    case 'manyRounds':
      return t(
        `${hint.rounds} из ${hint.total} MR прошли больше двух кругов ревью`,
        `${hint.rounds} of ${hint.total} MRs took more than two review rounds`,
      )
    case 'noSql':
      return t(
        `Пока ни в одном из ${hint.total} MR нет работы с SQL`,
        `None of your ${hint.total} MRs touch SQL yet`,
      )
  }
}

function LevelPicker({ competency, level }: { competency: Competency; level: number }) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const setLevel = useSetSkillLevel()
  const choose = (next: number) =>
    setLevel.mutate(
      { id: competency.id, level: next },
      {
        onError: () => toast.error(t('Не получилось сохранить оценку', 'Could not save the level')),
      },
    )

  return (
    <div
      className={s.levels}
      role="radiogroup"
      aria-label={`${t('Мой уровень', 'My level')}: ${competency.name[lang]}`}
    >
      {LEVELS.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={value === level}
          className={s.level}
          onClick={() => choose(value)}
        >
          <span className={s.levelDots} aria-hidden>
            {LEVELS.map((dot) => (
              <i key={dot} data-on={dot <= value} />
            ))}
          </span>
          {levelName(value, t)}
        </button>
      ))}
    </div>
  )
}

function Focus({ levels, hints }: { levels: SkillLevels; hints: readonly SkillHint[] }) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const weakest = weakestSkill(BACKEND_COMPETENCIES, levels, hints)
  if (!weakest) return null
  const hint = hints.find((h) => h.skillId === weakest.id)
  const question = t(
    `Что почитать про тему «${weakest.name.ru}»?`,
    `What to read about ${weakest.name.en}?`,
  )

  return (
    <Card tone="violet" index={1} className={s.focus}>
      <Eyebrow>{t('Что подтянуть', 'What to improve')}</Eyebrow>
      <h2 className={s.focusTitle}>{weakest.name[lang]}</h2>
      <p className={s.focusText}>
        {hint
          ? hintText(hint, t)
          : t('Ты оценила этот навык ниже остальных', 'You rated this skill lowest')}
      </p>
      <div className={s.focusActions}>
        <Link to="/onboarding" search={{ tab: 'courses' }} className={s.focusLink}>
          <Icon name="book" size={18} />
          {t('Курс на 30 минут', '30-minute course')}
        </Link>
        <Link to="/chats" search={{ c: 'buddy', q: question }} className={s.focusLink}>
          <Icon name="chat" size={18} />
          {t('Спросить buddy', 'Ask buddy')}
        </Link>
      </div>
    </Card>
  )
}

/** Карта компетенций (идея 29): самооценка + подсказки по фактам. Видит только стажёр. */
export function SkillsTab() {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const levels = useSkillLevels()
  const mrs = useMergeRequests()

  if (levels.isError || mrs.isError) {
    const retry = () => {
      void levels.refetch()
      void mrs.refetch()
    }
    return (
      <ErrorState
        text={t('Не получилось загрузить карту навыков', 'Could not load the skill map')}
        onRetry={retry}
      />
    )
  }
  if (levels.isPending || mrs.isPending) {
    return <Skeleton height={420} radius="var(--radius-card)" />
  }

  const hints = skillHints(mrs.data)
  const average = averageLevel(BACKEND_COMPETENCIES, levels.data)

  return (
    <div className={s.split}>
      <Card className={s.main} index={0}>
        <div className={s.cardHead}>
          <div>
            <h2 className={s.cardTitle}>{t('Карта навыков Backend', 'Backend skill map')}</h2>
            <p className="t-s t-muted">
              {t(
                'Оцени себя честно, это только для тебя',
                'Rate yourself honestly, it is just for you',
              )}
            </p>
          </div>
          <div className={s.average}>
            <b className="t-num">{average}</b>
            <span className="t-s t-muted">{t(`из ${MAX_LEVEL}`, `of ${MAX_LEVEL}`)}</span>
          </div>
        </div>
        <Note tone="private" title={t('Видишь только ты', 'Only you can see this')}>
          {t(
            'Слабые места никто не видит: карта не попадает в сводку наставнику',
            'Nobody sees your weak spots: the map is not in the mentor summary',
          )}
        </Note>
        <ul className={s.skillList}>
          {BACKEND_COMPETENCIES.map((competency) => {
            const level = levelOf(levels.data, competency.id)
            const hint = hints.find((h) => h.skillId === competency.id)
            return (
              <li key={competency.id} className={s.skill}>
                <div className={s.skillHead}>
                  <b>{competency.name[lang]}</b>
                  <span className="t-s t-muted">{levelName(level, t)}</span>
                </div>
                <Meter
                  value={level}
                  max={MAX_LEVEL}
                  color="var(--brand-violet)"
                  label={competency.name[lang]}
                  isOnSunken
                />
                <LevelPicker competency={competency} level={level} />
                {hint && (
                  <p className={s.hint}>
                    <Icon name="sparkle" size={16} />
                    {hintText(hint, t)}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </Card>
      <div className={s.side}>
        <Focus levels={levels.data} hints={hints} />
        <Card index={2}>
          <p className="t-s t-muted">
            {t(
              'Подсказки buddy берёт из твоих MR в GitLab, а не придумывает',
              'Buddy hints come from your GitLab MRs, not guesses',
            )}
          </p>
          <Button
            variant="ghost"
            icon="refresh"
            onClick={() => void mrs.refetch()}
            isLoading={mrs.isFetching}
          >
            {t('Обновить из GitLab', 'Refresh from GitLab')}
          </Button>
        </Card>
      </div>
    </div>
  )
}
