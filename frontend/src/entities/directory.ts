import { getEmployee } from './employees'

/**
 * Связь пользователей Go API (UUID из seed, docs/users.md) с карточками сотрудников фронта.
 * Бэкенд знает только логин, имя и роль; аватар, цвет и зоны ответственности - данные фронта.
 * Неизвестный пользователь остаётся со своим UUID, а имя берём из ответа API.
 */
const SEED_LOGINS: Readonly<Record<string, string>> = {
  'a24a3478-cf42-51b1-b05b-9833260247a5': 'intern_anya',
  '4a59a828-3b1a-55e4-bf9b-81db5ad6183a': 'buddy_ilya',
  '10000000-0000-0000-0000-000000000003': 'lead_maria',
  '2db7cc77-4114-52d8-a833-f670ab60e4e0': 'intern_petr',
  '0f8153be-1c96-5e0f-aa4c-55b7ed7bf47a': 'buddy_olga',
  '10000000-0000-0000-0000-000000000006': 'lead_alexey',
}

const LOGIN_TO_EMPLOYEE: Readonly<Record<string, string>> = {
  intern_anya: 'anya',
  buddy_ilya: 'ilya',
  lead_maria: 'maria',
}

export function employeeIdForLogin(login: string): string | null {
  return LOGIN_TO_EMPLOYEE[login] ?? null
}

/** UUID пользователя -> id сотрудника фронта; без совпадения возвращает сам UUID. */
export function employeeIdForUser(
  userId: string,
  known: Readonly<Record<string, string>> = {},
): string {
  const login = known[userId] ?? SEED_LOGINS[userId]
  return (login && employeeIdForLogin(login)) || userId
}

/** Имя для карточки: сотрудник фронта или исходное значение. */
export function displayNameForUser(userId: string): string {
  return getEmployee(employeeIdForUser(userId))?.name ?? userId
}
