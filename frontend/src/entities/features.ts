import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { IS_MOCK, request } from '@/shared/api/http'

/** Ответ GET /features (V-10). Флаг только выключает сценарий, права не меняет. */
export const featuresSchema = z.object({
  chat: z.boolean(),
  absences: z.boolean(),
  escalations: z.boolean(),
  kb_publish: z.boolean(),
})
export type Features = z.infer<typeof featuresSchema>

export const ALL_FEATURES_ON: Features = {
  chat: true,
  absences: true,
  escalations: true,
  kb_publish: true,
}

export const FEATURES_KEY = ['features'] as const

/** Пока флаги не загружены или запрос упал, сценарии считаются включёнными: Go всё равно отклонит выключенный. */
export function useFeatures(): Features {
  const query = useQuery({
    queryKey: FEATURES_KEY,
    queryFn: () => request('/features', featuresSchema),
    enabled: !IS_MOCK,
    staleTime: 60_000,
  })
  return query.data ?? ALL_FEATURES_ON
}
