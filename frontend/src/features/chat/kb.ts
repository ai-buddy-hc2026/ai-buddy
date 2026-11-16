import { daysUntil, DEMO_TODAY } from '@/shared/lib/date'

/**
 * Локальная тестовая база знаний для мок-бота (S-2, идея 32).
 * В entities такой нет: когда появится AI-сервис, ответы придут с `sources[]` с бэкенда.
 * Все документы выдуманные: «Тестовая инструкция, не регламент Авито».
 */
export interface KbDoc {
  id: string
  title: string
  /** Дата проверки ISO */
  reviewedAt: string
  ownerName: string
  /** Корни слов, по которым ищем документ */
  keywords: readonly string[]
  answer: string
}

export const KB_DOCS: readonly KbDoc[] = [
  {
    id: 'kb-code-review',
    title: 'Гайд по code review',
    reviewedAt: '2026-10-12',
    ownerName: 'Илья Наставников',
    keywords: ['review', 'ревью', 'merge', 'мерж', 'мёрж', 'пулреквест', 'аппрув', 'апрув'],
    answer:
      'Code review у нас проходит так. Ты открываешь merge request в GitLab и описываешь, что и зачем поменял. ' +
      'Назначаешь ревьюером наставника и ещё одного человека из команды. Ревью делают в течение рабочего дня. ' +
      'Нужен минимум один аппрув и зелёный CI, после этого мёржишь сам. ' +
      'Замечания не принимай на свой счёт: это нормальная часть работы, отвечай в тредах и закрывай их по мере правок',
  },
  {
    id: 'kb-absence',
    title: 'Порядок оформления отгулов и отпуска',
    reviewedAt: '2026-09-01',
    ownerName: 'Мария Руководова',
    keywords: ['отгул', 'отпуск', 'отсутств', 'выходн', 'больничн'],
    answer:
      'Отгул и отпуск оформляются в сервисе «Отсутствия». Заявку согласует руководитель команды. ' +
      'Отгул лучше подавать за 1-2 рабочих дня, отпуск - за две недели. ' +
      'После согласования отсутствие появится в календаре команды, предупреди наставника в чате',
  },
  {
    id: 'kb-access',
    title: 'Как получить доступы',
    reviewedAt: '2026-10-20',
    ownerName: 'Олег Деплоев',
    keywords: ['доступ', 'vpn', 'gitlab', 'гитлаб', 'k8s', 'кубер', 'grafana', 'графан', 'пароль'],
    answer:
      'Доступы запрашиваются через портал заявок: выбери систему (GitLab, VPN, Grafana, k8s) и роль «стажёр». ' +
      'Заявку согласует наставник, обычно в течение дня. Если доступ нужен срочно, напиши Олегу Деплоеву',
  },
  {
    id: 'kb-env',
    title: 'Настройка окружения разработчика',
    reviewedAt: '2026-04-02',
    ownerName: 'Илья Наставников',
    keywords: ['окружени', 'docker', 'докер', 'локальн', 'ide', 'сборк', 'make'],
    answer:
      'Окружение поднимается через `make dev`: он ставит зависимости и запускает сервис в Docker. ' +
      'Нужны Docker, Go последней версии и доступ к GitLab. Если сборка падает, сначала проверь VPN',
  },
]

/** Документ старше 6 месяцев помечаем «Может быть устаревшим» (идея 32). */
const STALE_DAYS = 183

export function isStale(doc: Pick<KbDoc, 'reviewedAt'>, today: string = DEMO_TODAY): boolean {
  return -daysUntil(doc.reviewedAt, today) > STALE_DAYS
}

/** Поиск документа по корням слов. Ничего не совпало - null (бот честно скажет «не нашёл»). */
export function searchKb(question: string, docs: readonly KbDoc[] = KB_DOCS): KbDoc | null {
  const text = question.toLowerCase()
  let best: { doc: KbDoc; score: number } | null = null
  for (const doc of docs) {
    const score = doc.keywords.filter((k) => text.includes(k)).length
    if (score > 0 && (!best || score > best.score)) best = { doc, score }
  }
  return best?.doc ?? null
}

export function findKbDoc(id: string): KbDoc | undefined {
  return KB_DOCS.find((d) => d.id === id)
}
