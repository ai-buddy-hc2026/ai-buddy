import { useState } from 'react'
import { useSettings, type FeatureToggles, type ThemeChoice, type Tone } from '@/entities/settings'
import { IsoArt } from '@/shared/iso'
import { useT, type Translate } from '@/shared/lib/i18n'
import { Card, Chip, ChipRow, Eyebrow, Input, Page, PageHeader, SwitchRow } from '@/shared/ui'
import { ResetDemo } from './ResetDemo'
import { WEEKDAYS, isValidHours, toggleDay } from './logic'
import s from './settings.module.css'

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: ReadonlyArray<{ id: T; label: string }>
  onChange: (id: T) => void
}) {
  return (
    <div className={s.field} role="group" aria-label={label}>
      <span className={s.fieldLabel}>{label}</span>
      <ChipRow isWrap>
        {options.map((option) => (
          <Chip
            key={option.id}
            isSelected={option.id === value}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </Chip>
        ))}
      </ChipRow>
    </div>
  )
}

function AppearanceCard() {
  const t = useT()
  const { theme, lang, tone, setTheme, setLang, setTone } = useSettings()
  const themes: ReadonlyArray<{ id: ThemeChoice; label: string }> = [
    { id: 'system', label: t('Как в системе', 'System') },
    { id: 'light', label: t('Светлая', 'Light') },
    { id: 'dark', label: t('Тёмная', 'Dark') },
  ]
  const tones: ReadonlyArray<{ id: Tone; label: string }> = [
    { id: 'short', label: t('Коротко', 'Short') },
    { id: 'detailed', label: t('Подробно', 'Detailed') },
  ]
  return (
    <Card className={s.card} index={0}>
      <Eyebrow>{t('Вид и язык', 'Look and language')}</Eyebrow>
      <Choice label={t('Тема', 'Theme')} value={theme} options={themes} onChange={setTheme} />
      <Choice
        label={t('Язык', 'Language')}
        value={lang}
        options={[
          { id: 'ru', label: 'Русский' },
          { id: 'en', label: 'English' },
        ]}
        onChange={setLang}
      />
      <Choice
        label={t('Как отвечает бот', 'Bot answers')}
        value={tone}
        options={tones}
        onChange={setTone}
      />
    </Card>
  )
}

function HoursCard() {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const workHours = useSettings((state) => state.workHours)
  const setWorkHours = useSettings((state) => state.setWorkHours)
  const [draft, setDraft] = useState({ start: workHours.start, end: workHours.end })
  const isValid = isValidHours(draft)

  const change = (key: 'start' | 'end', value: string) => {
    const next = { ...draft, [key]: value }
    setDraft(next)
    if (isValidHours(next)) setWorkHours({ ...workHours, ...next })
  }

  return (
    <Card className={s.card} index={1}>
      <Eyebrow>{t('Рабочие часы', 'Work hours')}</Eyebrow>
      <p className="t-s t-muted">
        {t(
          'Вне этих часов бот молчит и не пишет первым',
          'Outside these hours the bot stays quiet',
        )}
      </p>
      <div className={s.hours}>
        <Input
          type="time"
          label={t('С', 'From')}
          value={draft.start}
          onChange={(e) => change('start', e.target.value)}
          isOnSunken
        />
        <Input
          type="time"
          label={t('До', 'To')}
          value={draft.end}
          onChange={(e) => change('end', e.target.value)}
          error={
            isValid ? undefined : t('Конец должен быть позже начала', 'End must be after start')
          }
          isOnSunken
        />
      </div>
      <div className={s.field} role="group" aria-label={t('Рабочие дни', 'Work days')}>
        <span className={s.fieldLabel}>{t('Дни', 'Days')}</span>
        <ChipRow isWrap>
          {WEEKDAYS.map((d) => (
            <Chip
              key={d.day}
              isSelected={workHours.days.includes(d.day)}
              onClick={() => setWorkHours({ ...workHours, days: toggleDay(workHours.days, d.day) })}
            >
              {lang === 'en' ? d.en : d.ru}
            </Chip>
          ))}
        </ChipRow>
      </div>
    </Card>
  )
}

function toggleItems(
  t: Translate,
): ReadonlyArray<{ key: keyof FeatureToggles; title: string; hint: string }> {
  return [
    {
      key: 'briefing',
      title: t('Утренняя сводка', 'Morning briefing'),
      hint: t('План дня в начале рабочих часов', 'Day plan at the start of work hours'),
    },
    {
      key: 'hints',
      title: t('Подсказки', 'Hints'),
      hint: t('Бот подсказывает следующий шаг', 'The bot suggests the next step'),
    },
    {
      key: 'birthdayReminders',
      title: t('Дни рождения', 'Birthdays'),
      hint: t('Напомнить про коллег из команды', 'Remind about teammates'),
    },
    {
      key: 'randomCoffee',
      title: t('Random coffee', 'Random coffee'),
      hint: t('Знакомство с коллегой раз в неделю', 'Meet a colleague once a week'),
    },
    {
      key: 'showInterests',
      title: t('Показывать интересы', 'Show interests'),
      hint: t('Коллеги видят твои интересы', 'Colleagues see your interests'),
    },
  ]
}

function NotificationsCard() {
  const t = useT()
  const { toggles, setToggle, notMyDayDate, setNotMyDay, telegramLinked, setTelegramLinked } =
    useSettings()
  return (
    <Card className={s.card} index={2}>
      <Eyebrow>{t('Что бот делает сам', 'What the bot does on its own')}</Eyebrow>
      {toggleItems(t).map((item) => (
        <SwitchRow
          key={item.key}
          title={item.title}
          hint={item.hint}
          isChecked={toggles[item.key]}
          onChange={(on) => setToggle(item.key, on)}
        />
      ))}
      <SwitchRow
        title={t('Не мой день', 'Not my day')}
        hint={t(
          'Сегодня без напоминаний, личные шаги перенесём',
          'No reminders today, personal steps move on',
        )}
        isChecked={notMyDayDate !== null}
        onChange={setNotMyDay}
      />
      <SwitchRow
        title="Telegram"
        hint={t('Дублировать сообщения бота в Telegram', 'Mirror bot messages to Telegram')}
        isChecked={telegramLinked}
        onChange={setTelegramLinked}
      />
    </Card>
  )
}

function DemoCard() {
  const t = useT()
  const { simulateFailure, setSimulateFailure, simulateNight, setSimulateNight } = useSettings()
  return (
    <Card className={s.card} index={3}>
      <div className={s.demoHead}>
        <Eyebrow>{t('Для демо', 'Demo tools')}</Eyebrow>
        <IsoArt name="lock" className={s.demoArt} />
      </div>
      <SwitchRow
        title={t('Имитировать сбой сервиса', 'Simulate a service failure')}
        hint={t(
          'Следующая отправка заявки упадёт один раз, потом можно повторить',
          'The next request fails once, then retry works',
        )}
        isChecked={simulateFailure}
        onChange={setSimulateFailure}
      />
      <SwitchRow
        title={t('Сейчас ночь', 'It is night now')}
        hint={t(
          'Проактивные сообщения молчат, вопросы наставнику уходят утром',
          'Proactive messages pause, mentor questions go in the morning',
        )}
        isChecked={simulateNight}
        onChange={setSimulateNight}
      />
      <div className={s.reset}>
        <ResetDemo />
      </div>
    </Card>
  )
}

/** Настройки: тема, язык, тон, рабочие часы, тумблеры, инструменты демо. */
export function SettingsPage() {
  const t = useT()
  return (
    <Page>
      <PageHeader
        title={t('Настройки', 'Settings')}
        subtitle={t('Всё сохраняется сразу', 'Changes save right away')}
      />
      <div className={s.grid}>
        <AppearanceCard />
        <HoursCard />
        <NotificationsCard />
        <DemoCard />
      </div>
    </Page>
  )
}
