import { useState } from 'react'
import { getEmployee } from '@/entities/employees'
import { useT } from '@/shared/lib/i18n'
import { Button, Dialog, Note } from '@/shared/ui'
import type { TrackModule } from './catalog'
import { PASS_SCORE, isPassed, scoreQuiz } from './logic'
import type { Quiz } from './quizzes'
import s from './tracks.module.css'

type Props = {
  module: TrackModule
  quiz: Quiz
  onClose: () => void
  /** Сохраняет результат. Вызывается один раз, по кнопке «Проверить» */
  onSubmit: (score: number) => void
}

/** Тест «Я это знаю»: 5 вопросов, 4 верных - модуль засчитан. Родитель монтирует с key = id модуля. */
export function QuizDialog({ module, quiz, onClose, onSubmit }: Props) {
  const t = useT()
  const [answers, setAnswers] = useState<(number | null)[]>(() => quiz.questions.map(() => null))
  const [score, setScore] = useState<number | null>(null)
  const isComplete = answers.every((a) => a !== null)
  const owner = getEmployee(module.source.ownerId)

  const handleCheck = () => {
    const result = scoreQuiz(quiz, answers)
    setScore(result)
    onSubmit(result)
  }

  const footer =
    score === null ? (
      <Button variant="primary" disabled={!isComplete} onClick={handleCheck}>
        {t('Проверить', 'Check')}
      </Button>
    ) : (
      <Button variant="primary" onClick={onClose}>
        {t('Готово', 'Done')}
      </Button>
    )

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={t('Я это знаю', 'I know this')}
      footer={footer}
      width={520}
      closeLabel={t('Закрыть', 'Close')}
    >
      <p className="t-s t-muted">
        {module.title} · {t(`нужно ${PASS_SCORE} из 5`, `${PASS_SCORE} of 5 to pass`)}
      </p>
      {score === null ? (
        <ol className={s.quiz}>
          {quiz.questions.map((question, qi) => (
            <li key={question.text}>
              <fieldset className={s.question}>
                <legend className={s.questionText}>
                  {qi + 1}. {question.text}
                </legend>
                {question.options.map((option, oi) => (
                  <label key={option} className={s.option}>
                    <input
                      type="radio"
                      name={`${quiz.id}-${qi}`}
                      checked={answers[qi] === oi}
                      onChange={() => setAnswers((prev) => prev.map((a, i) => (i === qi ? oi : a)))}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </fieldset>
            </li>
          ))}
        </ol>
      ) : (
        <div aria-live="polite">
          {isPassed(score) ? (
            <Note tone="success" title={t(`Засчитано: ${score} из 5`, `Passed: ${score} of 5`)}>
              {t(
                'Этот модуль можно пропустить, план пересчитан',
                'You can skip this module, the plan is updated',
              )}
            </Note>
          ) : (
            <Note
              tone="warning"
              title={t(`${score} из 5, пока не засчитано`, `${score} of 5, not passed yet`)}
            >
              {t(
                `Почитай «${module.source.title}»${owner ? `, владелец: ${owner.name}` : ''}. Пересдать можно завтра`,
                `Read "${module.source.title}"${owner ? `, owner: ${owner.name}` : ''}. You can retake it tomorrow`,
              )}
            </Note>
          )}
        </div>
      )}
    </Dialog>
  )
}
