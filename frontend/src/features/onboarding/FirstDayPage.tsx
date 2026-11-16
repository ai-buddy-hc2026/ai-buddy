import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { mustEmployee } from '@/entities/employees'
import { useSettings } from '@/entities/settings'
import { formatShort } from '@/shared/lib/date'
import { useT } from '@/shared/lib/i18n'
import {
  Avatar,
  BuddyAvatar,
  Button,
  Card,
  Checkbox,
  Eyebrow,
  Note,
  Page,
  PageHeader,
} from '@/shared/ui'
import { OfficeScene } from './first-day/OfficeScene'
import {
  FIRST_DAY,
  buildReminder,
  readChecked,
  reminderSendAt,
  saveChecked,
  startPhase,
  toggleChecked,
} from './first-day/data'
import s from './first-day/first-day.module.css'

/** Пребординг (идея 5): когда и куда приходить, как пройти, кто встретит, что взять. */
export function FirstDayPage() {
  const t = useT()
  const lang = useSettings((st) => st.lang)
  const navigate = useNavigate()
  const [checked, setChecked] = useState<string[]>(() => readChecked())
  const [activeStep, setActiveStep] = useState<number | null>(null)
  const day = FIRST_DAY
  const greeter = mustEmployee(day.greeterId)
  const phase = startPhase(day.date)
  const sendAt = reminderSendAt(day.date)
  const dateLabel = `${formatShort(day.date, lang)}, ${day.time}`

  const phaseText = {
    past: t(
      `Первый день был ${dateLabel}. Страница осталась для справки`,
      `Your first day was ${dateLabel}. Kept for reference`,
    ),
    today: t(`Сегодня к ${day.time}`, `Today at ${day.time}`),
    tomorrow: t(`Завтра к ${day.time}`, `Tomorrow at ${day.time}`),
    soon: t(`Старт ${dateLabel}`, `Start ${dateLabel}`),
  }[phase]

  const handleToggle = (id: string) => {
    const next = toggleChecked(checked, id)
    setChecked(next)
    saveChecked(next)
  }
  const requiredLeft = day.bring.filter(
    (item) => item.isRequired && !checked.includes(item.id),
  ).length

  return (
    <Page>
      <PageHeader title={t('Первый день', 'First day')} subtitle={phaseText} />
      <div className={s.grid}>
        <Card className={s.sceneCard} index={0} aria-labelledby="fd-route">
          <Eyebrow>{day.address}</Eyebrow>
          <h2 id="fd-route" className={s.title}>
            {t(`${day.entrance}, ${day.floor} этаж`, `${day.entrance}, floor ${day.floor}`)}
          </h2>
          <div className={s.sceneWrap}>
            <OfficeScene
              label={t(
                'Схема входа в офис: улица, вход, ресепшен, лифты',
                'Office entrance: street, door, reception, lifts',
              )}
              activeStep={activeStep}
            />
            <ol className={s.steps}>
              {day.steps.map((step, i) => (
                <li key={step.id}>
                  <button
                    type="button"
                    className={s.step}
                    aria-pressed={activeStep === i}
                    onClick={() => setActiveStep(activeStep === i ? null : i)}
                    onMouseEnter={() => setActiveStep(i)}
                    onFocus={() => setActiveStep(i)}
                  >
                    <span className={s.stepNum} aria-hidden>
                      {i + 1}
                    </span>
                    <span className={s.stepBody}>
                      <b>{step.title}</b>
                      <span className="t-s t-muted">{step.text}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <p className="t-s t-muted">{day.parking}</p>
          <div>
            <Button
              variant="primary"
              isPill
              icon="route"
              onClick={() => void navigate({ to: '/map', search: { to: day.deskId } })}
            >
              {t('Маршрут до стола на карте', 'Route to your desk')}
            </Button>
          </div>
        </Card>

        <Card tone="violet" className={s.greeter} index={1} aria-labelledby="fd-greeter">
          <Eyebrow>{t('Тебя встретит', 'You will be met by')}</Eyebrow>
          <div className={s.person}>
            <Avatar name={greeter.name} color={greeter.color} size={72} />
            <div>
              <h2 id="fd-greeter" className={s.title}>
                {greeter.name}
              </h2>
              <p className="t-s t-muted">{greeter.role}</p>
            </div>
          </div>
          <p className="t-s">
            {t(
              'Ждёт у лифтов на 3 этаже и проводит к столу',
              'Waits by the lifts on floor 3 and walks you to your desk',
            )}
          </p>
          <Link
            className={s.link}
            to="/chats"
            search={{
              c: greeter.id,
              q: `${greeter.short}, привет! Это Аня, вопрос про первый день`,
            }}
          >
            {t(`Написать: ${greeter.short}`, `Message ${greeter.short}`)}
          </Link>
        </Card>

        <Card className={s.bring} index={2} aria-labelledby="fd-bring">
          <Eyebrow>
            {requiredLeft === 0
              ? t('Всё нужное собрано', 'All set')
              : t(`Обязательных осталось: ${requiredLeft}`, `Required left: ${requiredLeft}`)}
          </Eyebrow>
          <h2 id="fd-bring" className={s.title}>
            {t('Что взять', 'What to bring')}
          </h2>
          <ul className={s.bringList}>
            {day.bring.map((item) => (
              <li key={item.id} className={s.bringItem} data-checked={checked.includes(item.id)}>
                <Checkbox
                  isChecked={checked.includes(item.id)}
                  onChange={() => handleToggle(item.id)}
                  label={item.title}
                />
                <span className={s.bringTitle}>{item.title}</span>
                {item.isRequired && (
                  <span className="t-xs t-muted">{t('обязательно', 'required')}</span>
                )}
              </li>
            ))}
          </ul>
          <Note tone="private" title={t('Видишь только ты', 'Only you see this')}>
            {t('Отметки хранятся у тебя в браузере', 'Checks are stored in your browser')}
          </Note>
        </Card>

        <Card className={s.reminder} index={3} aria-labelledby="fd-reminder">
          <Eyebrow>
            {t(
              `Напоминание за день: ${formatShort(sendAt.slice(0, 10), lang)}, 12:00`,
              `Day-before reminder: ${formatShort(sendAt.slice(0, 10), lang)}, 12:00`,
            )}
          </Eyebrow>
          <h2 id="fd-reminder" className={s.title}>
            {t('Что придёт в Telegram', 'What arrives in Telegram')}
          </h2>
          <div className={s.message}>
            <BuddyAvatar size={36} />
            <p className={s.bubble}>{buildReminder(day, greeter.short)}</p>
          </div>
          <p className="t-s t-muted">
            {t(
              'Текст собран из твоего профиля, без догадок',
              'Built from your profile, no guessing',
            )}
          </p>
        </Card>
      </div>
    </Page>
  )
}
