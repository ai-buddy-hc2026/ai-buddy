import { Link } from '@tanstack/react-router'
import { EMPLOYEES } from '@/entities/employees'
import { useUser } from '@/entities/session'
import { canNotifyNow, useSettings } from '@/entities/settings'
import { DEMO_TODAY, formatShort } from '@/shared/lib/date'
import { plural, useT } from '@/shared/lib/i18n'
import { Avatar, Badge, Card, Icon, Note, SwitchRow } from '@/shared/ui'
import { upcomingBirthdays } from './logic'
import s from './people.module.css'

/** ДР коллег (идея 15): только день и месяц, только своя команда, напоминание по тумблеру. */
export function Birthdays({ index }: { index?: number }) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const isOn = useSettings((state) => state.toggles.birthdayReminders)
  const setToggle = useSettings((state) => state.setToggle)
  const canNotify = useSettings(canNotifyNow)
  const user = useUser()
  const list = upcomingBirthdays(EMPLOYEES, user.employee, DEMO_TODAY)
  const today = list.filter((b) => b.inDays === 0)

  const when = (inDays: number, date: string) => {
    if (inDays === 0) return t('сегодня', 'today')
    if (inDays === 1) return t('завтра', 'tomorrow')
    return lang === 'en'
      ? `${formatShort(date, 'en')}, in ${inDays} d`
      : `${formatShort(date)}, через ${inDays} ${plural(inDays, ['день', 'дня', 'дней'])}`
  }

  return (
    <Card className={s.birthdays} index={index} aria-labelledby="people-bdays">
      <div className={s.cardHead}>
        <h2 id="people-bdays" className={s.cardTitle}>
          {t('Дни рождения', 'Birthdays')}
        </h2>
        <Icon name="heart" size={22} className={s.headIcon} />
      </div>

      {isOn && canNotify && today.length > 0 && (
        <div aria-live="polite">
          {today.map(({ employee }) => (
            <Note
              key={employee.id}
              tone="success"
              icon="heart"
              title={t(`Сегодня ДР: ${employee.short}`, `${employee.short}'s birthday today`)}
              action={
                <Link
                  to="/chats"
                  search={{ c: employee.id, q: `${employee.short}, с днём рождения!` }}
                  className={s.linkBtn}
                >
                  {t('Поздравить', 'Congratulate')}
                </Link>
              }
            >
              {t('Можно поздравить в чате', 'You can say it in chat')}
            </Note>
          ))}
        </div>
      )}

      {list.length === 0 ? (
        <p className="t-s t-muted">
          {t('В ближайший месяц дней рождения нет', 'No birthdays in the next month')}
        </p>
      ) : (
        <ul className={s.bdayList}>
          {list.map(({ employee, inDays, date }) => (
            <li key={employee.id} className={s.bdayItem}>
              <Avatar name={employee.name} color={employee.color} size={36} />
              <span className={s.bdayText}>
                <b>{employee.name}</b>
                <span className="t-s t-muted">{when(inDays, date)}</span>
              </span>
              {inDays === 0 && <Badge tone="success">{t('Сегодня', 'Today')}</Badge>}
            </li>
          ))}
        </ul>
      )}

      <SwitchRow
        title={t('Напоминать о ДР коллег', 'Remind me of birthdays')}
        hint={t(
          'Утром в рабочие часы. Год рождения не показываем',
          'In the morning, in work hours. No birth years',
        )}
        isChecked={isOn}
        onChange={(next) => setToggle('birthdayReminders', next)}
      />
    </Card>
  )
}
