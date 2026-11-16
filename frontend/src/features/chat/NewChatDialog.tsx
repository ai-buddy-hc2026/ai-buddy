import { useState } from 'react'
import type { Employee } from '@/entities/employees'
import { Avatar, Dialog, Icon } from '@/shared/ui'
import { useT } from '@/shared/lib/i18n'
import s from './Chat.module.css'
import { matchContact } from './threads'

type Props = {
  isOpen: boolean
  contacts: readonly Employee[]
  onClose: () => void
  onPick: (employeeId: string) => void
}

/** «+» в списке чатов: все сотрудники с поиском, выбор открывает личный чат. */
export function NewChatDialog({ isOpen, contacts, onClose, onPick }: Props) {
  const t = useT()
  const [query, setQuery] = useState('')
  const visible = contacts.filter((e) => matchContact(e, query))
  const close = () => {
    setQuery('')
    onClose()
  }

  return (
    <Dialog isOpen={isOpen} onClose={close} title={t('Новый чат', 'New chat')}>
      <label className={s.search}>
        <Icon name="search" size={18} />
        <span className="visually-hidden">{t('Поиск по людям', 'Search people')}</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Имя, роль или команда', 'Name, role or team')}
          type="search"
          autoFocus
        />
      </label>
      <ul className={`${s.contacts} scroll-area`}>
        {visible.map((employee) => (
          <li key={employee.id}>
            <button
              type="button"
              className={s.thread}
              onClick={() => {
                setQuery('')
                onPick(employee.id)
              }}
            >
              <Avatar
                name={employee.name}
                color={employee.color}
                isSquare
                isOnline={employee.online}
                size={40}
              />
              <span className={s.threadBody}>
                <span className={s.threadTop}>
                  <b>{employee.name}</b>
                </span>
                <span className={s.preview}>
                  {employee.role} · {employee.teamName}
                </span>
              </span>
            </button>
          </li>
        ))}
        {visible.length === 0 && (
          <li className={s.noResults}>{t('Никого не нашли', 'Nobody found')}</li>
        )}
      </ul>
    </Dialog>
  )
}
