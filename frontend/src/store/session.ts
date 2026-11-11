import { create } from 'zustand'
import { mockUser } from '../api/mocks'
import type { User } from '../api/schemas'

// Сессия пользователя. Позже сюда придёт токен из POST /auth/mock-login.

type SessionState = {
  user: User | null
  token: string | null
}

export const useSession = create<SessionState>(() => ({
  user: mockUser,
  token: null,
}))
