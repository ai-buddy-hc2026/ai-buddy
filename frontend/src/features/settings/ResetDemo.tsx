import { useState } from 'react'
import { resetAllMockData } from '@/shared/lib/storage'
import { useT } from '@/shared/lib/i18n'
import { Button, Dialog, toast } from '@/shared/ui'

/** Сброс демо: стирает все мок-данные и перезагружает страницу, чтобы сторы прочитали seed заново. */
export function ResetDemo() {
  const t = useT()
  const [isOpen, setOpen] = useState(false)

  const reset = () => {
    try {
      resetAllMockData()
      window.location.reload()
    } catch {
      toast.error(t('Не получилось сбросить данные', 'Could not reset the data'))
    }
  }

  return (
    <>
      <Button variant="danger" icon="refresh" onClick={() => setOpen(true)}>
        {t('Сбросить демо', 'Reset demo')}
      </Button>
      <Dialog
        isOpen={isOpen}
        onClose={() => setOpen(false)}
        title={t('Сбросить демо?', 'Reset the demo?')}
        closeLabel={t('Закрыть', 'Close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('Отмена', 'Cancel')}
            </Button>
            <Button variant="danger" onClick={reset}>
              {t('Сбросить', 'Reset')}
            </Button>
          </>
        }
      >
        <p>
          {t(
            'План, вопросы, история действий и настройки вернутся к исходным. Вход тоже сбросится',
            'Plan, questions, action history and settings go back to the start. You will be signed out too',
          )}
        </p>
      </Dialog>
    </>
  )
}
