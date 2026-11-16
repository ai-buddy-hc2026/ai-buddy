import type { IconName } from '@/shared/ui'

/**
 * Каналы buddy вне веба (идеи 39, 40). Пока только прототипы:
 * реальных интеграций и ссылок на установку нет.
 */
export type Text2 = { ru: string; en: string }

export interface Channel {
  id: 'telegram' | 'extension'
  icon: IconName
  title: Text2
  lead: Text2
  abilities: Text2[]
  howItWorks: Text2
  /** Сценарий, который уже можно пройти в вебе */
  tryIt: { label: Text2; to: '/chats' | '/glossary'; search: { c?: string; q?: string } }
}

export const CHANNELS: readonly Channel[] = [
  {
    id: 'telegram',
    icon: 'telegram',
    title: { ru: 'Бот в Telegram', en: 'Telegram bot' },
    lead: {
      ru: 'Тот же buddy в привычном мессенджере. Права и логика те же',
      en: 'The same buddy in your messenger. Same rights and logic',
    },
    abilities: [
      {
        ru: 'Отвечает на вопросы по базе знаний с источником',
        en: 'Answers from the knowledge base with a source',
      },
      {
        ru: 'Готовит заявки: отгул, доступ, бронь',
        en: 'Drafts requests: day off, access, booking',
      },
      { ru: 'Отправляет только по кнопке «Отправить»', en: 'Sends only after you press Send' },
      {
        ru: 'Напоминает о шагах плана в рабочие часы',
        en: 'Reminds about plan steps during work hours',
      },
    ],
    howItWorks: {
      ru: 'Адаптер ходит в тот же API, своей логики у него нет. Аккаунт привязывается одноразовым кодом из веба',
      en: 'The adapter calls the same API and has no logic of its own. You link the account with a one-time code from the web app',
    },
    tryIt: {
      label: { ru: 'Пройти сценарий в вебе', en: 'Try it in the web app' },
      to: '/chats',
      search: { c: 'buddy', q: 'Оформи отгул на пятницу' },
    },
  },
  {
    id: 'extension',
    icon: 'puzzle',
    title: { ru: 'Расширение браузера', en: 'Browser extension' },
    lead: {
      ru: 'buddy рядом с вики и GitLab: объясняет термины и отвечает по открытой странице',
      en: 'buddy next to the wiki and GitLab: explains terms and answers about the open page',
    },
    abilities: [
      {
        ru: 'Объясняет выделенный термин из словаря',
        en: 'Explains a selected term from the glossary',
      },
      {
        ru: 'Отвечает по открытому документу с источником',
        en: 'Answers about the open document with a source',
      },
      {
        ru: 'Подсказывает, чем твоя команда отличается',
        en: 'Tells you how your team does it differently',
      },
      { ru: 'Работает только на разрешённых доменах', en: 'Works only on allowed domains' },
    ],
    howItWorks: {
      ru: 'Боковая панель берёт адрес и выделенный текст страницы и отправляет вопрос в тот же API',
      en: 'The side panel takes the page address and selected text and sends the question to the same API',
    },
    tryIt: {
      label: { ru: 'Открыть словарь', en: 'Open the glossary' },
      to: '/glossary',
      search: {},
    },
  },
]
