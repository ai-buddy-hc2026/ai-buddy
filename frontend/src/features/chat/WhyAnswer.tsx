import { Badge, Icon, type BadgeTone } from '@/shared/ui'
import { useT, type Translate } from '@/shared/lib/i18n'
import type { Message } from './model'
import { explain, type ActionNote, type Confidence, type Explanation, type MockTool } from './why'
import s from './Insights.module.css'

/** Свёрнутый блок «Почему я так ответил» под ответом бота (идея 35). */
export function WhyAnswer({ message }: { message: Message }) {
  const t = useT()
  const why = explain(message)
  if (!why) return null
  return (
    <details className={s.why}>
      <summary className={s.whySummary}>
        <Icon name="question" size={16} />
        {t('Почему я так ответил', 'Why this answer')}
        <Icon name="chevronDown" size={16} className={s.whyChevron} />
      </summary>
      <dl className={s.whyBody}>
        <WhySources why={why} />
        <div>
          <dt>{t('Инструменты', 'Tools')}</dt>
          <dd>
            {why.tools.length === 0
              ? t('Не вызывал', 'None called')
              : why.tools.map((tool) =>
                  tool.kind === 'mock' ? (
                    <span key={tool.id} className={s.whyItem}>
                      {toolLabel(tool.id, t)}
                    </span>
                  ) : (
                    <code key={tool.name} className={s.whyItem}>
                      {tool.name}
                    </code>
                  ),
                )}
          </dd>
        </div>
        {why.confidence && <WhyConfidence confidence={why.confidence} />}
        <div>
          <dt>{t('Действия', 'Actions')}</dt>
          <dd>{actionLabel(why.action, t)}</dd>
        </div>
      </dl>
    </details>
  )
}

function WhySources({ why }: { why: Explanation }) {
  const t = useT()
  return (
    <div>
      <dt>{t('Источники', 'Sources')}</dt>
      <dd>
        {why.sources.length === 0
          ? t('Подходящих фрагментов не нашёл', 'No matching fragments found')
          : why.sources.map((source, i) => (
              <span key={`${source.title}:${i}`} className={s.whyItem}>
                «{source.title}»{source.detail ? `, ${source.detail}` : ''}
                {source.isStale && ` (${t('может быть устаревшим', 'may be outdated')})`}
              </span>
            ))}
      </dd>
    </div>
  )
}

const CONFIDENCE_TONE: Record<Confidence, BadgeTone> = {
  high: 'success',
  medium: 'warning',
  low: 'error',
}

function WhyConfidence({ confidence }: { confidence: Confidence }) {
  const t = useT()
  const label = {
    high: t('высокая', 'high'),
    medium: t('средняя', 'medium'),
    low: t('низкая, лучше уточнить у человека', 'low, better ask a person'),
  }[confidence]
  return (
    <div>
      <dt>{t('Уверенность', 'Confidence')}</dt>
      <dd>
        <Badge tone={CONFIDENCE_TONE[confidence]}>{label}</Badge>
      </dd>
    </div>
  )
}

function toolLabel(tool: MockTool, t: Translate): string {
  switch (tool) {
    case 'plan':
      return t('План онбординга', 'Onboarding plan')
    case 'kb':
      return t('Поиск по базе знаний', 'Knowledge base search')
    case 'mentorAnswers':
      return t('Ответы наставника', 'Mentor answers')
    case 'access':
      return t('Проверка прав доступа', 'Access check')
    case 'absences':
      return t('Черновик в сервисе «Отсутствия»', 'Draft in the Absences service')
    case 'escalation':
      return t('Вопрос наставнику', 'Question to the mentor')
  }
}

function actionLabel(action: ActionNote, t: Translate): string {
  switch (action) {
    case 'none':
      return t('Во внешние сервисы ничего не отправлял', 'Nothing was sent to external services')
    case 'confirm':
      return t(
        'Сам ничего не отправляю: черновик уйдёт только после твоего «Отправить»',
        'I never send on my own: the draft goes out only after you press Send',
      )
    case 'denied':
      return t(
        'Отказал: это чужие личные данные, ты видишь только свои',
        'Refused: these are personal data of others, you see only yours',
      )
    case 'done':
      return t('Отправлено после твоего подтверждения', 'Sent after your confirmation')
  }
}
