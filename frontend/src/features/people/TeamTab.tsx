import type { FormEvent } from 'react'
import { useState } from 'react'
import { EMPLOYEES, findOwner } from '@/entities/employees'
import { DEMO, useUser } from '@/entities/session'
import { useT } from '@/shared/lib/i18n'
import { Button, Card, Chip, ChipRow, Eyebrow, Input, Note } from '@/shared/ui'
import { Birthdays } from './Birthdays'
import { keyPeople, matchedTag } from './logic'
import { PeopleArt } from './PeopleArt'
import { PersonCard } from './PersonCard'
import s from './people.module.css'

function AskWho({ onAsk }: { onAsk: (topic: string) => void }) {
  const t = useT()
  const [value, setValue] = useState('')
  const quick = [
    t('Кто отвечает за мониторинг?', 'Who owns monitoring?'),
    t('Где взять тестовые данные?', 'Where do I get test data?'),
    t('Как заводить баги?', 'How do I file bugs?'),
  ]

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (value.trim()) onAsk(value.trim())
  }

  return (
    <Card className={s.askCard} index={0}>
      <div className={s.askText}>
        <Eyebrow>{t('Кого спросить', 'Who to ask')}</Eyebrow>
        <h2 className={s.bigTitle}>
          {t('Найду человека под твой вопрос', 'I will find the right person')}
        </h2>
        <form className={s.askForm} onSubmit={handleSubmit}>
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={t(
              'Например: деплой, метрики, отпуск',
              'For example: deploy, metrics, vacation',
            )}
            aria-label={t('Тема вопроса', 'Question topic')}
            autoComplete="off"
          />
          <Button type="submit" variant="primary" icon="search" disabled={!value.trim()}>
            {t('Найти', 'Find')}
          </Button>
        </form>
        <ChipRow isWrap>
          {quick.map((question) => (
            <Chip
              key={question}
              onClick={() => {
                setValue(question)
                onAsk(question)
              }}
            >
              {question}
            </Chip>
          ))}
        </ChipRow>
      </div>
      <PeopleArt className={s.askArt} />
    </Card>
  )
}

function OwnerResult({ topic }: { topic: string }) {
  const t = useT()
  const user = useUser()
  const owner = findOwner(topic, user.employee.teamId, DEMO.mentorId)
  const tag = matchedTag(topic, owner)

  return (
    <div className={s.result} aria-live="polite">
      {tag ? (
        <Note
          tone="success"
          title={t(`За «${tag}» отвечает ${owner.short}`, `${owner.short} owns “${tag}”`)}
        >
          {t(
            'Нажми «Написать»: черновик подставится в чат, отправишь сам',
            'Tap Message: a draft goes to chat, you send it',
          )}
        </Note>
      ) : (
        <Note tone="info" title={t('Не нашёл, кто за это отвечает', 'Could not find an owner')}>
          {t(
            `Спроси наставника - ${owner.short} подскажет или перенаправит`,
            `Ask your mentor - ${owner.short} will help or redirect`,
          )}
        </Note>
      )}
      <PersonCard employee={owner} topic={topic} matched={tag} />
    </div>
  )
}

/** Вкладка «Команда»: кого спросить, ключевые люди с ролями, дни рождения. */
export function TeamTab() {
  const t = useT()
  const user = useUser()
  const [topic, setTopic] = useState<string | null>(null)
  const people = keyPeople(EMPLOYEES, user.employee)

  return (
    <div className={s.grid}>
      <AskWho onAsk={setTopic} />
      <Birthdays index={1} />
      {topic && <OwnerResult key={topic} topic={topic} />}
      <h2 className={s.sectionTitle}>
        {t('Твоя команда', 'Your team')} <span className="t-muted">{user.employee.teamName}</span>
      </h2>
      {people.map((employee, i) => (
        <PersonCard key={employee.id} employee={employee} index={i + 2} className={s.span4} />
      ))}
    </div>
  )
}
