import { z } from 'zod'

/** Мок сервиса сотрудников. Все имена выдуманы, данные тестовые. */
export const brandColorSchema = z.enum(['green', 'blue', 'red', 'violet', 'yellow', 'orange'])
export type BrandColor = z.infer<typeof brandColorSchema>

export const employeeSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Имя для обращения: «Илья» */
  short: z.string(),
  role: z.string(),
  kind: z.enum(['intern', 'mentor', 'lead', 'hr', 'colleague']),
  teamId: z.string(),
  teamName: z.string(),
  color: brandColorSchema,
  /** Зоны ответственности для «Кого спросить» (идея 19) */
  tags: z.array(z.string()),
  askAbout: z.string(),
  workHours: z.object({ start: z.string(), end: z.string() }),
  /** День и месяц «MM-DD», без года. null - скрыт в профиле */
  birthday: z.string().nullable(),
  interests: z.array(z.string()),
  /** id точки на карте офиса. null - работает удалённо */
  deskId: z.string().nullable(),
  online: z.boolean(),
})
export type Employee = z.infer<typeof employeeSchema>

export const TEAM_ADS = 'team-ads'
export const TEAM_DELIVERY = 'team-delivery'

const base = { workHours: { start: '10:00', end: '19:00' }, online: true }

export const EMPLOYEES: readonly Employee[] = [
  {
    ...base,
    id: 'anya',
    name: 'Аня Тестова',
    short: 'Аня',
    role: 'Стажёр Backend',
    kind: 'intern',
    teamId: TEAM_ADS,
    teamName: 'Тестовая команда Объявлений',
    color: 'violet',
    tags: [],
    askAbout: '',
    birthday: '03-21',
    interests: ['футбол', 'настолки'],
    deskId: 'desk-anya',
  },
  {
    ...base,
    id: 'ilya',
    name: 'Илья Наставников',
    short: 'Илья',
    role: 'Senior Backend, наставник',
    kind: 'mentor',
    teamId: TEAM_ADS,
    teamName: 'Тестовая команда Объявлений',
    color: 'blue',
    tags: ['code review', 'архитектура', 'онбординг', 'go'],
    askAbout: 'Code review, архитектура сервисов, любые вопросы по онбордингу',
    birthday: '06-02',
    interests: ['бег', 'настолки'],
    deskId: 'desk-ilya',
  },
  {
    ...base,
    id: 'maria',
    name: 'Мария Руководова',
    short: 'Мария',
    role: 'Руководитель команды',
    kind: 'lead',
    teamId: TEAM_ADS,
    teamName: 'Тестовая команда Объявлений',
    color: 'red',
    tags: ['отгулы', 'отпуск', 'цели', 'экватор'],
    askAbout: 'Отгулы и отпуска, цели на стажировку, экватор и оффер',
    birthday: null,
    interests: ['йога'],
    deskId: 'desk-maria',
    online: false,
  },
  {
    ...base,
    id: 'oleg',
    name: 'Олег Деплоев',
    short: 'Олег',
    role: 'DevOps команды',
    kind: 'colleague',
    teamId: TEAM_ADS,
    teamName: 'Тестовая команда Объявлений',
    color: 'green',
    tags: ['деплой', 'ci', 'мониторинг', 'grafana', 'k8s', 'доступы'],
    askAbout: 'CI, деплой, мониторинг в Grafana, доступы к k8s',
    birthday: '11-20',
    interests: ['велосипед', 'футбол'],
    deskId: 'desk-oleg',
  },
  {
    ...base,
    id: 'sveta',
    name: 'Света Аналитикова',
    short: 'Света',
    role: 'Продуктовый аналитик',
    kind: 'colleague',
    teamId: TEAM_ADS,
    teamName: 'Тестовая команда Объявлений',
    color: 'orange',
    tags: ['метрики', 'аналитика', 'a/b', 'данные'],
    askAbout: 'Метрики, A/B-тесты, где взять тестовые данные',
    birthday: '11-12',
    interests: ['настолки', 'рисование'],
    deskId: 'desk-sveta',
  },
  {
    ...base,
    id: 'timur',
    name: 'Тимур Тестировщиков',
    short: 'Тимур',
    role: 'QA-инженер',
    kind: 'colleague',
    teamId: TEAM_ADS,
    teamName: 'Тестовая команда Объявлений',
    color: 'yellow',
    tags: ['тесты', 'стенды', 'баги', 'автотесты'],
    askAbout: 'Тестовые стенды, автотесты, как заводить баги',
    birthday: '01-15',
    interests: ['бег'],
    deskId: null,
  },
  {
    ...base,
    id: 'dasha',
    name: 'Даша Эйчарова',
    short: 'Даша',
    role: 'HR BP',
    kind: 'hr',
    teamId: 'team-hr',
    teamName: 'HR',
    color: 'violet',
    tags: ['документы', 'дмс', 'оффер', 'программа стажировки'],
    askAbout: 'Документы, ДМС, программа стажировки, оффер',
    birthday: '08-09',
    interests: ['йога', 'рисование'],
    deskId: 'desk-dasha',
  },
  {
    ...base,
    id: 'dima',
    name: 'Дима Доставкин',
    short: 'Дима',
    role: 'Стажёр Backend',
    kind: 'intern',
    teamId: TEAM_DELIVERY,
    teamName: 'Авито Доставка',
    color: 'blue',
    tags: [],
    askAbout: '',
    birthday: '04-04',
    interests: ['футбол', 'велосипед'],
    deskId: null,
  },
  {
    ...base,
    id: 'lena',
    name: 'Лена Фронтова',
    short: 'Лена',
    role: 'Стажёр Frontend',
    kind: 'intern',
    teamId: 'team-search',
    teamName: 'Поиск',
    color: 'green',
    tags: [],
    askAbout: '',
    birthday: '09-30',
    interests: ['настолки', 'рисование'],
    deskId: null,
  },
  {
    ...base,
    id: 'petya',
    name: 'Петя Соседов',
    short: 'Петя',
    role: 'Backend-разработчик',
    kind: 'colleague',
    teamId: TEAM_DELIVERY,
    teamName: 'Авито Доставка',
    color: 'red',
    tags: [],
    askAbout: '',
    birthday: null,
    interests: [],
    deskId: null,
  },
]

export function getEmployee(id: string): Employee | undefined {
  return EMPLOYEES.find((e) => e.id === id)
}

/** Сотрудник обязан существовать (ошибка в данных - ошибка разработчика). */
export function mustEmployee(id: string): Employee {
  const found = getEmployee(id)
  if (!found) throw new Error(`Нет сотрудника ${id}`)
  return found
}

export function teamOf(teamId: string): Employee[] {
  return EMPLOYEES.filter((e) => e.teamId === teamId)
}

export function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
}

/**
 * «Кого спросить» (идея 19): ищем владельца темы только в команде стажёра.
 * Никого не нашли - возвращаем наставника.
 */
export function findOwner(topic: string, teamId: string, mentorId: string): Employee {
  const query = topic.toLowerCase()
  const owner = teamOf(teamId).find((e) => e.tags.some((tag) => query.includes(tag)))
  return owner ?? mustEmployee(mentorId)
}
