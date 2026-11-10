import type { Role } from '../api/schemas'
import { useSession } from '../store/session'

const ROLE_LABELS: Record<Role, string> = {
  intern: 'Стажёр',
  buddy: 'Наставник',
  lead: 'Руководитель',
}

export function Header() {
  const user = useSession((state) => state.user)

  return (
    <header className="header">
      <div className="header__brand">AI-buddy</div>
      {user && (
        <div className="header__user">
          <div className="header__avatar" aria-hidden="true">
            {user.name.charAt(0)}
          </div>
          <div>
            <div className="header__name">{user.name}</div>
            <div className="header__meta">
              {ROLE_LABELS[user.role]} - {user.team}
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
