import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { mustEmployee } from '@/entities/employees'
import { useEscalations } from '@/entities/escalations'
import { DEMO } from '@/entities/session'
import { useT } from '@/shared/lib/i18n'
import { Badge, Button, Card, Eyebrow } from '@/shared/ui'
import { StuckEscalateDialog } from './StuckEscalateDialog'
import { guideQuestion, hasOpenEscalation, type StuckPrompt } from './snooze'
import s from './stuck.module.css'

type Props = {
  prompts: readonly StuckPrompt[]
  onSnooze: (taskId: string) => void
}

type ItemProps = {
  prompt: StuckPrompt
  isSent: boolean
  onEscalate: () => void
  onSnooze: () => void
}

function StuckItem({ prompt, isSent, onEscalate, onSnooze }: ItemProps) {
  const t = useT()
  const mentor = mustEmployee(DEMO.mentorId)
  const { task, days } = prompt
  return (
    <li className={s.item}>
      <p className={s.question}>
        {t(
          `Задача «${task.title}» висит ${days} раб. дн. Застряла? Могу подсказать по гайду или передать вопрос ${mentor.short} с контекстом`,
          `"${task.title}" has not moved for ${days} workdays. Stuck? I can point you to a guide or pass the question to ${mentor.short}`,
        )}
      </p>
      <div className={s.buttons}>
        <Link className={s.linkButton} to="/chats" search={{ c: 'buddy', q: guideQuestion(task) }}>
          {t('Подсказать по гайду', 'Guide hint')}
        </Link>
        {isSent ? (
          <Badge tone="success" icon="check">
            {t(`Передано ${mentor.short}`, `Sent to ${mentor.short}`)}
          </Badge>
        ) : (
          <Button size="s" icon="user" onClick={onEscalate}>
            {t(`Передать ${mentor.short}`, `Ask ${mentor.short}`)}
          </Button>
        )}
        <Button size="s" variant="ghost" onClick={onSnooze}>
          {t('Всё ок, просто долго', "I'm fine, it just takes time")}
        </Button>
      </div>
    </li>
  )
}

/** Мягкий вопрос при застревании (идея 25): без давления, три варианта ответа. */
export function StuckCard({ prompts, onSnooze }: Props) {
  const t = useT()
  const escalations = useEscalations()
  const [openId, setOpenId] = useState<string | null>(null)
  const [sentIds, setSentIds] = useState<ReadonlySet<string>>(() => new Set())
  if (prompts.length === 0) return null
  const open = prompts.find((prompt) => prompt.task.id === openId)
  const isSent = (prompt: StuckPrompt) =>
    sentIds.has(prompt.task.id) || hasOpenEscalation(escalations.data ?? [], prompt.task)

  return (
    <Card tone="blue" className={s.card} index={2} aria-labelledby="plan-stuck">
      <Eyebrow>{t('Buddy спрашивает', 'Buddy asks')}</Eyebrow>
      <h2 id="plan-stuck" className={s.title}>
        {t('Как идёт? Не спешу, просто проверяю', 'How is it going? No rush, just checking')}
      </h2>
      <ul className={s.list} aria-live="polite">
        {prompts.map((prompt) => (
          <StuckItem
            key={prompt.task.id}
            prompt={prompt}
            isSent={isSent(prompt)}
            onEscalate={() => setOpenId(prompt.task.id)}
            onSnooze={() => onSnooze(prompt.task.id)}
          />
        ))}
      </ul>
      {open && (
        <StuckEscalateDialog
          key={open.task.id}
          task={open.task}
          days={open.days}
          isOpen
          onClose={() => setOpenId(null)}
          onSent={() => {
            setSentIds((prev) => new Set([...prev, open.task.id]))
            setOpenId(null)
          }}
        />
      )}
    </Card>
  )
}
