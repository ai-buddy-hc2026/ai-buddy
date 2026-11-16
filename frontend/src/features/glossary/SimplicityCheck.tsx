import { useT } from '@/shared/lib/i18n'
import { Badge } from '@/shared/ui'
import { checkSimplicity, MAX_SENTENCE_WORDS } from './simplify'
import s from './glossary.module.css'

/** «Проверка простоты» (идея 31): длина предложений и канцелярит. */
export function SimplicityCheck({ text }: { text: string }) {
  const t = useT()
  const report = checkSimplicity(text)

  return (
    <div className={s.check}>
      <div className={s.checkHead}>
        {report.isSimple ? (
          <Badge tone="success" icon="check">
            {t('Просто', 'Plain')}
          </Badge>
        ) : (
          <Badge tone="warning" icon="alert">
            {t('Можно проще', 'Could be simpler')}
          </Badge>
        )}
        <span className="t-s t-muted">
          {t(
            `Предложений: ${report.sentenceCount}, в среднем ${report.avgWords} слов`,
            `Sentences: ${report.sentenceCount}, ${report.avgWords} words on average`,
          )}
        </span>
      </div>
      <ul className={s.checkList}>
        <li>
          {report.longSentences.length === 0
            ? t(
                `Все предложения до ${MAX_SENTENCE_WORDS} слов`,
                `All sentences under ${MAX_SENTENCE_WORDS} words`,
              )
            : t(
                `Длинных предложений: ${report.longSentences.length}`,
                `Long sentences: ${report.longSentences.length}`,
              )}
        </li>
        <li>
          {report.bureaucratese.length === 0
            ? t('Канцелярита нет', 'No bureaucratic phrases')
            : `${t('Канцелярит', 'Bureaucratic phrases')}: ${report.bureaucratese.join(', ')}`}
        </li>
      </ul>
    </div>
  )
}
