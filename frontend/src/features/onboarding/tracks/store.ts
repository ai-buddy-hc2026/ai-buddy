import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createCollection, mockDelay } from '@/shared/lib/storage'
import { REQUIRED_TRACK_IDS } from './catalog'
import { ensureRequired, userTracksSchema, type UserTracks } from './logic'

/** Мок `user_tracks`: выбор треков и прогресс модулей (идея 45). Бэкенда пока нет, данные в localStorage. */
function seedUserTracks(): UserTracks {
  const done = { status: 'done' as const, lastScore: null, lastAttempt: null }
  return {
    selected: [...REQUIRED_TRACK_IDS, 'deploy'],
    modules: { 'access-1': done, 'security-1': done, 'first-task-2': done },
  }
}

const tracksDb = createCollection<UserTracks>('tracks', seedUserTracks)

export type TracksUpdate = (state: UserTracks) => UserTracks

export const tracksApi = {
  async get(): Promise<UserTracks> {
    await mockDelay(200)
    const parsed = userTracksSchema.safeParse(tracksDb.read())
    const state = parsed.success ? parsed.data : seedUserTracks()
    return ensureRequired(state, REQUIRED_TRACK_IDS)
  },
  async update(fn: TracksUpdate): Promise<UserTracks> {
    await mockDelay(120)
    const current = userTracksSchema.safeParse(tracksDb.read())
    const base = ensureRequired(
      current.success ? current.data : seedUserTracks(),
      REQUIRED_TRACK_IDS,
    )
    return tracksDb.write(userTracksSchema.parse(fn(base)))
  },
}

export const TRACKS_KEY = ['onboarding', 'tracks'] as const

export function useUserTracks() {
  return useQuery({ queryKey: TRACKS_KEY, queryFn: tracksApi.get })
}

/** Оптимистичное обновление: UI меняется сразу, при ошибке откат. */
export function useUpdateTracks() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (fn: TracksUpdate) => tracksApi.update(fn),
    onMutate: async (fn) => {
      await client.cancelQueries({ queryKey: TRACKS_KEY })
      const previous = client.getQueryData<UserTracks>(TRACKS_KEY)
      if (previous) client.setQueryData(TRACKS_KEY, fn(previous))
      return { previous }
    },
    onError: (_error, _fn, context) => {
      if (context?.previous) client.setQueryData(TRACKS_KEY, context.previous)
    },
    onSuccess: (state) => client.setQueryData(TRACKS_KEY, state),
  })
}
