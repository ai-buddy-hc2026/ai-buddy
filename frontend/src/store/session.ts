import { create } from 'zustand'
import { mockUser } from '../api/mocks'
import type { User } from '../api/schemas'

// Сессия пользователя. Позже сюда придёт токен из POST /auth/mock-login.

type SessionState = {
  user: User | null
  token: string | null
  setToken: (token: string | null) => void
}

export const useSession = create<SessionState>((set) => ({
  user: mockUser,
  token: null,
  setToken: (token) => set({ token }),
}))
