import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { BRAG_KEY, bragApi, bragItemSchema, type BragItem } from '@/entities/brag'
import { DEMO_TODAY } from '@/shared/lib/date'
import { createCollection, mockDelay, newId } from '@/shared/lib/storage'
import { agendaPointSchema, agendasSchema, type AgendaPoint, type Agendas } from './agendaLogic'
import { updateBragItem, type BragInput } from './bragLogic'
import {
  createRequest,
  feedbackRequestSchema,
  markSaved,
  type FeedbackDraft,
  type FeedbackRequest,
} from './feedbackLogic'
import {
  mergeRequestSchema,
  setLevel,
  skillLevelsSchema,
  type MergeRequest,
  type SkillLevels,
} from './skillsLogic'

/* ---------- Мок GitLab: MR стажёра ---------- */

const GITLAB = 'https://gitlab.test/ads/-/merge_requests'

const mr = (
  number: number,
  title: string,
  reviewerId: string,
  flags: Pick<MergeRequest, 'needsTests' | 'hasTests' | 'touchesSql' | 'reviewRounds'>,
  date: string,
): MergeRequest => ({
  id: `mr-${number}`,
  number,
  title,
  url: `${GITLAB}/${number}`,
  reviewerId,
  date,
  ...flags,
})

const MR_SEED: MergeRequest[] = [
  mr(
    412,
    'Поправила опечатки в README сервиса',
    'ilya',
    { needsTests: false, hasTests: false, touchesSql: false, reviewRounds: 1 },
    '2026-11-10',
  ),
  mr(
    418,
    'Валидация цены в форме объявления',
    'oleg',
    { needsTests: true, hasTests: true, touchesSql: false, reviewRounds: 2 },
    '2026-11-10',
  ),
  mr(
    421,
    'Ручка списка избранного',
    'ilya',
    { needsTests: true, hasTests: false, touchesSql: false, reviewRounds: 3 },
    '2026-11-11',
  ),
  mr(
    425,
    'Логи в обработчике поиска',
    'ilya',
    { needsTests: true, hasTests: false, touchesSql: false, reviewRounds: 1 },
    '2026-11-12',
  ),
]

/* ---------- Seed ---------- */

const FEEDBACK_SEED: FeedbackRequest[] = [
  {
    id: 'fb-1',
    toId: 'oleg',
    artifactUrl: `${GITLAB}/418`,
    artifactTitle: 'MR !418: Валидация цены в форме объявления',
    question: 'Что улучшить в моих тестах?',
    status: 'answered',
    answer: 'тесты норм, добавь кейсы на пустой ответ API',
    sentAt: '2026-11-10',
    answeredAt: '2026-11-11',
    savedToBrag: false,
    externalId: 'FB-1040',
  },
  {
    id: 'fb-2',
    toId: 'ilya',
    artifactUrl: `${GITLAB}/421`,
    artifactTitle: 'MR !421: Ручка списка избранного',
    question: 'Норм ли я разделила ручку на слои?',
    status: 'sent',
    answer: null,
    sentAt: '2026-11-11',
    answeredAt: null,
    savedToBrag: false,
    externalId: 'FB-1041',
  },
]

const SKILLS_SEED: SkillLevels = { go: 2, tests: 1, review: 2, sql: 2, infra: 1, comms: 3 }

const feedbackDb = createCollection<FeedbackRequest[]>('growth.feedback', () => FEEDBACK_SEED)
const skillsDb = createCollection<SkillLevels>('growth.skills', () => SKILLS_SEED)
const agendasDb = createCollection<Agendas>('growth.agendas', () => ({}))
/** Тот же ключ, что у entities/brag: там нет update, правку пишем сюда поверх прочитанного списка. */
const bragStore = createCollection<BragItem[] | null>('brag', () => null)

/* ---------- API ---------- */

export const growthApi = {
  async mergeRequests(): Promise<MergeRequest[]> {
    await mockDelay(150)
    return z.array(mergeRequestSchema).parse(MR_SEED)
  },
  async skills(): Promise<SkillLevels> {
    await mockDelay(100)
    return skillLevelsSchema.parse(skillsDb.read())
  },
  async setSkill(id: string, level: number): Promise<SkillLevels> {
    await mockDelay(80)
    return skillsDb.write(setLevel(skillLevelsSchema.parse(skillsDb.read()), id, level))
  },
  async feedback(): Promise<FeedbackRequest[]> {
    await mockDelay(150)
    return z.array(feedbackRequestSchema).parse(feedbackDb.read())
  },
  async createFeedback(draft: FeedbackDraft, externalId: string | null): Promise<void> {
    await mockDelay(80)
    feedbackDb.update((list) =>
      createRequest(list, draft, { id: newId('fb'), externalId }, DEMO_TODAY),
    )
  },
  async markFeedbackSaved(id: string): Promise<void> {
    await mockDelay(50)
    feedbackDb.update((list) => markSaved(list, id))
  },
  async agendas(): Promise<Agendas> {
    await mockDelay(100)
    return agendasSchema.parse(agendasDb.read())
  },
  async saveAgenda(slotId: string, points: readonly AgendaPoint[]): Promise<void> {
    await mockDelay(120)
    const valid = z.array(agendaPointSchema).parse(points)
    agendasDb.update((all) => ({ ...all, [slotId]: valid }))
  },
  async updateBrag(id: string, patch: BragInput): Promise<void> {
    await mockDelay(150)
    const current = await bragApi.list()
    if (!current.some((item) => item.id === id)) throw new Error('Запись не найдена')
    bragStore.write(z.array(bragItemSchema).parse(updateBragItem(current, id, patch)))
  },
}

/* ---------- Hooks ---------- */

const GROWTH_KEY = ['growth'] as const
const MR_KEY = [...GROWTH_KEY, 'mrs'] as const
const SKILLS_KEY = [...GROWTH_KEY, 'skills'] as const
const FEEDBACK_KEY = [...GROWTH_KEY, 'feedback'] as const
const AGENDAS_KEY = [...GROWTH_KEY, 'agendas'] as const

export function useMergeRequests() {
  return useQuery({ queryKey: MR_KEY, queryFn: growthApi.mergeRequests })
}

export function useSkillLevels() {
  return useQuery({ queryKey: SKILLS_KEY, queryFn: growthApi.skills })
}

export function useSetSkillLevel() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, level }: { id: string; level: number }) => growthApi.setSkill(id, level),
    onSuccess: (levels) => client.setQueryData(SKILLS_KEY, levels),
  })
}

export function useFeedbackRequests() {
  return useQuery({ queryKey: FEEDBACK_KEY, queryFn: growthApi.feedback })
}

export function useCreateFeedback() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ draft, externalId }: { draft: FeedbackDraft; externalId: string | null }) =>
      growthApi.createFeedback(draft, externalId),
    onSuccess: () => client.invalidateQueries({ queryKey: FEEDBACK_KEY }),
  })
}

/** Ответ -> запись в brag document и отметка «сохранено». */
export function useSaveFeedbackToBrag() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ requestId, item }: { requestId: string; item: BragInput }) => {
      await bragApi.add(item)
      await growthApi.markFeedbackSaved(requestId)
    },
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: FEEDBACK_KEY }),
        client.invalidateQueries({ queryKey: BRAG_KEY }),
      ]),
  })
}

export function useAgendas() {
  return useQuery({ queryKey: AGENDAS_KEY, queryFn: growthApi.agendas })
}

export function useSaveAgenda() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ slotId, points }: { slotId: string; points: readonly AgendaPoint[] }) =>
      growthApi.saveAgenda(slotId, points),
    onSuccess: () => client.invalidateQueries({ queryKey: AGENDAS_KEY }),
  })
}

export function useUpdateBrag() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: BragInput }) =>
      growthApi.updateBrag(id, patch),
    onSuccess: () => client.invalidateQueries({ queryKey: BRAG_KEY }),
  })
}
