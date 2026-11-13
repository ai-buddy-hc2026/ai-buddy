import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EMPLOYEES } from '@/entities/employees'
import { PLAN_KEY, planApi } from '@/entities/plan'
import { DEMO } from '@/entities/session'
import { createCollection, mockDelay } from '@/shared/lib/storage'
import {
  agreementsToTasks,
  meetingRecordSchema,
  meetingRecordsSchema,
  type MeetingDraft,
  type MeetingRecord,
  type MeetingRecords,
  type Person,
} from './meetingNotesLogic'

/** Итоги встреч по id слота (идея 8). Задачи пишутся в общий план через entities/plan (planApi.add). */
const notesDb = createCollection<MeetingRecords>('growth.meetingNotes', () => ({}))

/** Люди, которых экстрактор узнаёт в заметках: наставник и коллеги, кроме самой стажёрки. */
export const MEETING_PEOPLE: readonly Person[] = EMPLOYEES.filter(
  (e) => e.id !== DEMO.internId,
).map((e) => ({ short: e.short, role: e.id === DEMO.mentorId ? 'mentor' : 'other' }))

export const meetingNotesApi = {
  async list(): Promise<MeetingRecords> {
    await mockDelay(100)
    const parsed = meetingRecordsSchema.safeParse(notesDb.read())
    return parsed.success ? parsed.data : {}
  },
  /** POST /api/checklist/items для договорённостей, потом сохраняем саммари. */
  async save(meetingId: string, draft: MeetingDraft): Promise<MeetingRecord> {
    const plan = await planApi.get()
    const items = agreementsToTasks(draft.agreements, meetingId, plan.tasks)
    if (items.length > 0) await planApi.add(items)
    await mockDelay(120)
    const record = meetingRecordSchema.parse({
      ...draft,
      meetingId,
      savedAt: new Date().toISOString(),
      taskCount: items.length,
    })
    notesDb.update((all) => ({ ...all, [meetingId]: record }))
    return record
  },
}

const NOTES_KEY = ['growth', 'meetingNotes'] as const

export function useMeetingNotes() {
  return useQuery({ queryKey: NOTES_KEY, queryFn: meetingNotesApi.list })
}

export function useSaveMeetingNotes() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ meetingId, draft }: { meetingId: string; draft: MeetingDraft }) =>
      meetingNotesApi.save(meetingId, draft),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: NOTES_KEY }),
        client.invalidateQueries({ queryKey: PLAN_KEY }),
      ]),
  })
}
