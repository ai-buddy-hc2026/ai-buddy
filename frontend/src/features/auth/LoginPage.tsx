import { useState, type CSSProperties } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { homeFor } from '@/app/nav'
import { mustEmployee } from '@/entities/employees'
import { planApi } from '@/entities/plan'
import { TEST_USERS, useSession, type TestUser } from '@/entities/session'
import { useSettings } from '@/entities/settings'
import { errorMessage, IS_MOCK } from '@/shared/api/http'
import { IsoCity } from '@/shared/iso'
import { useT } from '@/shared/lib/i18n'
import { resetAllMockData } from '@/shared/lib/storage'
import { Avatar, Badge, BrandMark, Button, Icon, Note, toast } from '@/shared/ui'
import s from './LoginPage.module.css'

/** Экран входа (K-9): выбор тестового пользователя, мок SSO. */
export function LoginPage() {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const navigate = useNavigate()
  const signIn = useSession((state) => state.signIn)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Город на экране входа - тот же, что увидит Аня: показываем продукт сразу
  const previewTasks = planApi.peek().tasks

  const handleSignIn = async (user: TestUser) => {
    setPending(user.login)
    setError(null)
    try {
      await signIn(user.login)
      await navigate({ to: homeFor(user.role) })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(null)
    }
  }

  const handleReset = () => {
    resetAllMockData()
    toast(t('Демо-данные сброшены', 'Demo data reset'))
    window.location.reload()
  }

  return (
    <main className={s.page}>
      <section className={s.intro}>
        <div className={s.logo}>
          <BrandMark size={34} />
          <span>buddy</span>
          <Badge tone="neutral">{t('для Авито', 'for Avito')}</Badge>
        </div>
        <h1 className={s.title}>
          {t('Первые недели без лишних вопросов', 'First weeks without the guesswork')}
        </h1>
        <p className={s.lead}>
          {t(
            'Помощник стажёра: план, ответы с источниками и заявки в один клик',
            'Intern assistant: plan, sourced answers and one-click requests',
          )}
        </p>
        <div className={s.city}>
          <IsoCity tasks={previewTasks} label={t('Город прогресса', 'Progress city')} />
        </div>
      </section>

      <section className={s.panel} aria-labelledby="login-title">
        <h2 id="login-title">{t('Кем войти?', 'Sign in as')}</h2>
        <p className={s.hint}>
          {t('Тестовые пользователи, пароль не нужен', 'Test users, no password')}
        </p>

        <ul className={s.users}>
          {TEST_USERS.filter((user) => IS_MOCK || user.role !== 'hr').map((user, i) => {
            const employee = mustEmployee(user.employeeId)
            return (
              <li key={user.login} className="rise" style={{ '--i': i + 1 } as CSSProperties}>
                <button
                  type="button"
                  className={s.user}
                  onClick={() => void handleSignIn(user)}
                  disabled={pending !== null}
                  aria-busy={pending === user.login}
                >
                  <Avatar name={employee.name} color={employee.color} size={48} />
                  <span className={s.userText}>
                    <b>{employee.name}</b>
                    <span>{user.hint[lang]}</span>
                    <code>{user.login}</code>
                  </span>
                  <Icon name="arrowRight" size={20} className={s.arrow} />
                </button>
              </li>
            )
          })}
        </ul>

        {error && (
          <Note tone="error" title={t('Не получилось войти', 'Sign-in failed')}>
            {error}
          </Note>
        )}

        <div className={s.foot}>
          <span>{t('Все данные тестовые, имена выдуманы', 'All data is synthetic')}</span>
          <Button variant="ghost" size="s" icon="refresh" onClick={handleReset}>
            {t('Сбросить демо', 'Reset demo')}
          </Button>
        </div>
      </section>
    </main>
  )
}
