import { Link } from '@tanstack/react-router'
import type { Employee } from '@/entities/employees'
import { cn } from '@/shared/lib/cn'
import { useT } from '@/shared/lib/i18n'
import { Avatar, Badge, Card, ChipRow, Icon, Tag } from '@/shared/ui'
import { messageDraft } from './logic'
import s from './people.module.css'

const MAX_TAGS = 4

type Props = {
  employee: Employee
  /** Вопрос, с которым идём: попадёт в черновик сообщения */
  topic?: string
  /** Тег, по которому нашли человека */
  matched?: string | null
  index?: number
  className?: string
}

/** Карточка коллеги: роль, зона ответственности, ссылки на чат и на стол. */
export function PersonCard({ employee, topic = '', matched, index, className }: Props) {
  const t = useT()
  const status = employee.online ? t('в сети', 'online') : t('не в сети', 'offline')

  return (
    <Card as="article" className={cn(s.person, className)} index={index} aria-label={employee.name}>
      <div className={s.personHead}>
        <Avatar name={employee.name} color={employee.color} size={52} isOnline={employee.online} />
        <div className={s.personName}>
          <h3>{employee.name}</h3>
          <p className="t-s t-muted">
            {employee.role} · {status}
          </p>
        </div>
      </div>

      {employee.askAbout ? (
        <p className={s.askAbout}>
          <span className="t-s t-muted">{t('С чем идти', 'Ask about')}</span>
          {employee.askAbout}
        </p>
      ) : (
        <p className="t-s t-muted">{employee.teamName}</p>
      )}

      {employee.tags.length > 0 && (
        <ChipRow isWrap>
          {matched && (
            <Badge tone="success" icon="check">
              {matched}
            </Badge>
          )}
          {employee.tags
            .filter((tag) => tag !== matched)
            .slice(0, MAX_TAGS)
            .map((tag) => (
              <Tag key={tag} className={s.tag}>
                {tag}
              </Tag>
            ))}
        </ChipRow>
      )}

      <div className={s.personActions}>
        <Link
          to="/chats"
          search={{ c: employee.id, q: messageDraft(employee, topic) }}
          className={cn(s.linkBtn, s.linkBtnMain)}
        >
          <Icon name="chat" size={18} />
          {t('Написать', 'Message')}
        </Link>
        {employee.deskId ? (
          <Link to="/map" search={{ to: employee.deskId }} className={s.linkBtn}>
            <Icon name="pin" size={18} />
            {t('Где сидит', 'Find desk')}
          </Link>
        ) : (
          <span className={cn(s.remote, 't-s')}>
            <Icon name="globe" size={16} />
            {t('Работает удалённо', 'Works remotely')}
          </span>
        )}
      </div>
    </Card>
  )
}
