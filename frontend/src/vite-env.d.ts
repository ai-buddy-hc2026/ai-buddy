/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Адрес Go API. Задан - реальный режим, пусто - демо на моках (см. .env.example) */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
