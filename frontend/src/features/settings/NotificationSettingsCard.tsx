import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  remoteNotifications,
  useNotificationSettings,
  type NotificationSettings,
  type NotificationSettingsInput,
} from '@/entities/notifications'
import { useSession } from '@/entities/session'
import { useSettings } from '@/entities/settings'
import { ApiError, errorMessage } from '@/shared/api/http'
import { useT } from '@/shared/lib/i18n'
import {
  Button,
  Card,
  Chip,
  ChipRow,
  ErrorState,
  Eyebrow,
  Input,
  Skeleton,
  SwitchRow,
  toast,
} from '@/shared/ui'
import { WEEKDAYS, isValidHours } from './logic'
import s from './settings.module.css'

function editable(settings: NotificationSettings): NotificationSettingsInput {
  return {
    preferences: { ...settings.preferences },
    work_days: [...settings.work_days],
    work_start: settings.work_start,
    work_end: settings.work_end,
    version: settings.version,
  }
}

function SettingsForm({
  settings,
  userId,
  reload,
}: {
  settings: NotificationSettings
  userId: string
  reload: () => Promise<NotificationSettings | undefined>
}) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const client = useQueryClient()
  const [draft, setDraft] = useState(() => editable(settings))
  const save = useMutation({
    mutationFn: () => remoteNotifications.updateSettings(userId, draft),
    onSuccess: (value) => {
      if (useSession.getState().remote?.id !== userId) return
      client.setQueryData(['notification-settings', userId], value)
      setDraft(editable(value))
      toast(t('Настройки напоминаний сохранены', 'Reminder settings saved'))
    },
  })
  const valid =
    isValidHours({ start: draft.work_start, end: draft.work_end }) && draft.work_days.length > 0
  const refresh = async () => {
    const value = await reload()
    if (value) {
      setDraft(editable(value))
      save.reset()
    }
  }
  return (
    <fieldset className={s.reminderForm} disabled={save.isPending}>
      <p className="t-s t-muted">
        {t('Рабочие часы для напоминаний о встречах', 'Working hours for meeting reminders')} ·{' '}
        {settings.timezone}
      </p>
      <SwitchRow
        title={t('Напоминания о встречах', 'Meeting reminders')}
        hint={t(
          'За 30 минут до начала, в рабочее время',
          '30 minutes before the start, during work hours',
        )}
        isChecked={draft.preferences.meeting_reminders}
        onChange={(on) => setDraft({ ...draft, preferences: { meeting_reminders: on } })}
      />
      <div className={s.hours}>
        <Input
          type="time"
          label={t('Начало рабочего дня', 'Workday starts')}
          value={draft.work_start}
          onChange={(event) => setDraft({ ...draft, work_start: event.target.value })}
        />
        <Input
          type="time"
          label={t('Конец рабочего дня', 'Workday ends')}
          value={draft.work_end}
          onChange={(event) => setDraft({ ...draft, work_end: event.target.value })}
          error={valid ? undefined : t('Конец должен быть позже начала', 'End must be after start')}
        />
      </div>
      <ChipRow isWrap role="group" aria-label={t('Рабочие дни напоминаний', 'Reminder work days')}>
        {WEEKDAYS.map((day) => (
          <Chip
            key={day.day}
            isSelected={draft.work_days.includes(day.day)}
            disabled={
              save.isPending || (draft.work_days.length === 1 && draft.work_days.includes(day.day))
            }
            onClick={() =>
              setDraft({
                ...draft,
                work_days: draft.work_days.includes(day.day)
                  ? draft.work_days.filter((value) => value !== day.day)
                  : [...draft.work_days, day.day],
              })
            }
          >
            {lang === 'en' ? day.en : day.ru}
          </Chip>
        ))}
      </ChipRow>
      <Button isLoading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
        {t('Сохранить напоминания', 'Save reminder settings')}
      </Button>
      {save.isError && (
        <div role="alert">
          <p>{errorMessage(save.error)}</p>
          {save.error instanceof ApiError && save.error.status === 409 && (
            <Button onClick={() => void refresh()}>
              {t('Загрузить актуальные настройки', 'Load current settings')}
            </Button>
          )}
        </div>
      )}
    </fieldset>
  )
}

export function NotificationSettingsCard() {
  const t = useT()
  const userId = useSession((state) => state.remote?.id)
  const query = useNotificationSettings()
  return (
    <Card className={s.card}>
      <Eyebrow>{t('Уведомления о встречах', 'Meeting notifications')}</Eyebrow>
      {query.isPending ? (
        <Skeleton height={220} />
      ) : query.isError ? (
        <ErrorState text={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        userId && (
          <SettingsForm
            key={userId}
            settings={query.data}
            userId={userId}
            reload={async () => (await query.refetch()).data}
          />
        )
      )}
    </Card>
  )
}
