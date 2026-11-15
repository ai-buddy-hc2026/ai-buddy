import { useInfiniteQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from '@/shared/api/http'
import { useSession } from './session'

// Контракт проекта допускает ненулевые UUID без ограничения версии, включая seed руководителей.
const directoryId = z
  .string()
  .regex(
    /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  )

export const colleagueSchema = z.object({
  id: directoryId,
  team_id: directoryId,
  team_name: z.string(),
  user_id: directoryId.nullable(),
  display_name: z.string(),
  short_name: z.string(),
  job_title: z.string(),
  kind: z.enum(['intern', 'mentor', 'lead', 'hr', 'colleague']),
  tags: z.array(z.string()),
  ask_about: z.string(),
  contact_handle: z.string().nullable(),
  is_key_contact: z.boolean(),
  sort_order: z.number().int().nonnegative(),
})
export type Colleague = z.infer<typeof colleagueSchema>

export const colleaguePageSchema = z.object({
  items: z.array(colleagueSchema),
  next_cursor: z.string().nullable(),
})

export const remoteColleagues = {
  list: (search = '', cursor?: string, signal?: AbortSignal) =>
    request('/employees', colleaguePageSchema, {
      query: { q: search.trim(), limit: 50, cursor },
      signal,
    }),
  get: (id: string, signal?: AbortSignal) =>
    request(`/employees/${encodeURIComponent(id)}`, colleagueSchema, { signal }),
}

export function useColleagues(search: string) {
  const userId = useSession((state) => state.remote?.id)
  return useInfiniteQuery({
    queryKey: ['employees', userId, search.trim().toLowerCase()],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => remoteColleagues.list(search, pageParam, signal),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: !!userId,
  })
}
