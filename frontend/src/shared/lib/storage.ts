/**
 * Мок-«сервер» в браузере. Пока нет бэкенда, все данные лежат в localStorage
 * под ключами `buddy.<имя>`. Когда появится Go API, функции в entities/*
 * переключаются на http-клиент (см. shared/api/http.ts), а этот файл остаётся для демо.
 */
const PREFIX = 'buddy.'

export interface Collection<T> {
  read: () => T
  write: (next: T) => T
  update: (fn: (prev: T) => T) => T
  reset: () => void
}

/** Коллекция с начальными данными. Запись всегда заменяет значение целиком (без мутаций). */
export function createCollection<T>(name: string, seed: () => T): Collection<T> {
  const key = PREFIX + name

  const read = (): T => {
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) return JSON.parse(raw) as T
    } catch {
      // Битые данные в localStorage: молча откатываемся на seed
    }
    return seed()
  }

  const write = (next: T): T => {
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      // Переполнен или недоступен localStorage: работаем в памяти до перезагрузки
    }
    return next
  }

  return {
    read,
    write,
    update: (fn) => write(fn(read())),
    reset: () => localStorage.removeItem(key),
  }
}

/** Сбрасывает все демо-данные (кнопка в настройках и на экране входа). */
export function resetAllMockData(): void {
  Object.keys(localStorage)
    .filter((k) => k.startsWith(PREFIX))
    .forEach((k) => localStorage.removeItem(k))
}

/** Имитация сетевой задержки. В тестах задержка нулевая. */
export function mockDelay(ms = 250): Promise<void> {
  const real = import.meta.env.MODE === 'test' ? 0 : ms
  return new Promise((resolve) => setTimeout(resolve, real))
}

let counter = 0
/** Короткий уникальный id для мок-записей. */
export function newId(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}`
}
