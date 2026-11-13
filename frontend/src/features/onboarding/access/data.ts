import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createCollection, mockDelay, newId } from '@/shared/lib/storage'
import {
  accessStateSchema,
  addRequest,
  hasAutoPending,
  resolveAccess,
  type AccessDef,
  type AccessItem,
  type AccessState,
} from './logic'

/** Мок сервиса доступов. Названия систем тестовые. */
export const ACCESS_CATALOG: readonly AccessDef[] = [
  {
    id: 'gitlab',
    title: 'GitLab',
    about: 'Код и мёрдж-реквесты',
    approverId: 'ilya',
    grantAfterSec: 10,
  },
  { id: 'vpn', title: 'VPN', about: 'Работа вне офиса', approverId: 'oleg', grantAfterSec: 10 },
  {
    id: 'confluence',
    title: 'Confluence',
    about: 'База знаний команды',
    approverId: 'ilya',
    grantAfterSec: 10,
  },
  {
    id: 'jira',
    title: 'Jira',
    about: 'Задачи и доска команды',
    approverId: 'maria',
    grantAfterSec: 15,
  },
  {
    id: 'k8s-dev',
    title: 'k8s-dev',
    about: 'Тестовый кластер',
    approverId: 'oleg',
    grantAfterSec: null,
  },
  {
    id: 'grafana',
    title: 'Grafana',
    about: 'Дашборды и алерты',
    approverId: 'oleg',
    grantAfterSec: 5,
  },
  {
    id: 'kafka-ui',
    title: 'Kafka UI',
    about: 'Топики и сообщения',
    approverId: 'oleg',
    grantAfterSec: 25,
  },
]

/** role_access_templates: какие доступы нужны роли */
const ROLE_TEMPLATES: Record<string, readonly string[]> = {
  backend: ['gitlab', 'vpn', 'confluence', 'jira', 'k8s-dev', 'grafana', 'kafka-ui'],
}

export function templateFor(role: string): AccessDef[] {
  const ids = ROLE_TEMPLATES[role] ?? ROLE_TEMPLATES.backend
  return ACCESS_CATALOG.filter((a) => ids.includes(a.id))
}

const seedAccess = (): AccessState => ({
  granted: ['gitlab', 'vpn', 'confluence'],
  requests: [
    {
      id: 'req-seed',
      externalId: 'ACC-1041',
      createdAt: '2026-11-10T11:00:00',
      items: [{ accessId: 'k8s-dev', grantAfterSec: null }],
    },
  ],
})

const accessDb = createCollection<AccessState>('access', seedAccess)

function readState(): AccessState {
  const parsed = accessStateSchema.safeParse(accessDb.read())
  return parsed.success ? parsed.data : seedAccess()
}

export const accessApi = {
  /** GET /access/{user_id}: статусы считаются «на сервере» в момент запроса */
  async list(role: string): Promise<AccessItem[]> {
    await mockDelay(200)
    return resolveAccess(readState(), templateFor(role), Date.now())
  },
  /** POST /access/requests {items[]}: одна заявка на все пункты */
  async createRequest(items: readonly AccessDef[], externalId: string): Promise<AccessState> {
    await mockDelay(200)
    const meta = { id: newId('req'), externalId, createdAt: new Date().toISOString() }
    return accessDb.write(addRequest(readState(), items, meta))
  },
}

export const ACCESS_KEY = ['onboarding', 'access'] as const
const POLL_MS = 3000

export function useAccess(role: string) {
  return useQuery({
    queryKey: [...ACCESS_KEY, role],
    queryFn: () => accessApi.list(role),
    refetchInterval: (query) =>
      query.state.data && hasAutoPending(query.state.data) ? POLL_MS : false,
  })
}

export function useCreateAccessRequest() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ items, externalId }: { items: readonly AccessDef[]; externalId: string }) =>
      accessApi.createRequest(items, externalId),
    onSuccess: () => client.invalidateQueries({ queryKey: ACCESS_KEY }),
  })
}
