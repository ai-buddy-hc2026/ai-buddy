import { Link } from '@tanstack/react-router'
import { useSettings } from '@/entities/settings'
import { useT, type Translate } from '@/shared/lib/i18n'
import { Button, Card, ErrorState, Eyebrow, Icon, Note, Skeleton, toast } from '@/shared/ui'
import { useCompetencyMatrix, useMergeRequests, useSetSkillLevel } from './data'
import {
  averageLevel,
  levelOf,
  MAX_LEVEL,
  skillHints,
  weakestSkill,
  type Competency,
  type CompetencyMatrix,
  type SkillHint,
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

const TRACK_LABELS: Record<string, string> = { backend: 'Backend', frontend: 'Frontend' }

function MatrixRow({
  competency,
  level,
  hint,
}: {
  competency: Competency
  level: number
  hint: SkillHint | undefined
}) {
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
    <tr>
      <th scope="row" className={s.matrixName}>
        <b>{competency.name[lang]}</b>
        {hint && (
          <span className={s.hint}>
            <Icon name="sparkle" size={16} />
            {hintText(hint, t)}
          </span>
        )}
      </th>
      {LEVELS.map((value) => {
        const isCurrent = value === level
        return (
          <td key={value}>
            <button
              type="button"
              className={s.matrixCell}
              aria-pressed={isCurrent}
              aria-label={`${competency.name[lang]}: ${t('уровень', 'level')} ${value}, ${levelName(value, t)}`}
              onClick={() => choose(value)}
            >
              <span className={s.levelDots} aria-hidden>
                {LEVELS.map((dot) => (
                  <i key={dot} data-on={dot <= value} />
                ))}
              </span>
              {competency.levels[value - 1]?.[lang] ?? levelName(value, t)}
            </button>
          </td>
        )
      })}
    </tr>
  )
}

function Matrix({ matrix, hints }: { matrix: CompetencyMatrix; hints: readonly SkillHint[] }) {
  const t = useT()
  return (
    <div className={s.matrixScroll}>
      <table className={s.matrix}>
        <caption className="visually-hidden">
          {t('Матрица компетенций: уровни 1-4', 'Competency matrix: levels 1-4')}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t('Компетенция', 'Competency')}</th>
            {LEVELS.map((value) => (
              <th key={value} scope="col">
                {value}. {levelName(value, t)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.competencies.map((competency) => (
            <MatrixRow
              key={competency.id}
              competency={competency}
              level={levelOf(matrix.levels, competency.id)}
              hint={hints.find((h) => h.skillId === competency.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Focus({ matrix, hints }: { matrix: CompetencyMatrix; hints: readonly SkillHint[] }) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const weakest = weakestSkill(matrix.competencies, matrix.levels, hints)
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

/** Матрица компетенций (идея 29): самооценка + подсказки по фактам. Видит только стажёр. */
export function SkillsTab() {
  const t = useT()
  const levels = useCompetencyMatrix()
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
  const matrix = levels.data
  const average = averageLevel(matrix.competencies, matrix.levels)
  const track = TRACK_LABELS[matrix.track] ?? matrix.track

  return (
    <div className={s.split}>
      <Card className={s.main} index={0}>
        <div className={s.cardHead}>
          <div>
            <h2 className={s.cardTitle}>
              {t(`Матрица компетенций ${track}`, `${track} competency matrix`)}
            </h2>
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
        <Matrix matrix={matrix} hints={hints} />
      </Card>
      <div className={s.side}>
        <Focus matrix={matrix} hints={hints} />
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
