import type { MeetingSummary } from '@/entities/meetings'
import { DEMO_TODAY } from '@/shared/lib/date'
import {
  detectOwner,
  meetingDraftSchema,
  parseDue,
  SUMMARY_MAX,
  WHAT_MAX,
  type Agreement,
  type MeetingDraft,
  type Person,
} from './meetingNotesLogic'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function clip(text: string, max: number): string {
  const clean = text.trim()
  return clean.length > max ? `${clean.slice(0, max - 3).trimEnd()}...` : clean
}

/** Срок из ответа AI: ISO-дата как есть, иначе «до среды», «18.11» через parseDue. */
export function dueFromAi(
  due: string | null | undefined,
  today: string = DEMO_TODAY,
): string | null {
  const text = due?.trim()
  if (!text) return null
  if (ISO_DATE_RE.test(text)) return text
  return parseDue(text, today)?.date ?? null
}

/** Ответ POST /meetings/summary -> черновик, который правит стажёр перед сохранением в план. */
export function summaryToDraft(
  summary: MeetingSummary,
  people: readonly Person[],
  today: string = DEMO_TODAY,
): MeetingDraft | null {
  const agreements: Agreement[] = summary.action_items
    .map((item) => clip(item.title, WHAT_MAX))
    .map((what, index) => ({ what, item: summary.action_items[index] }))
    .filter(({ what }) => what.length > 0)
    .map(({ what, item }, index) => ({
      id: `ag-${index + 1}`,
      owner: item.owner?.trim() ? detectOwner(item.owner, people) : 'intern',
      what,
      due_date: dueFromAi(item.due, today),
    }))
  const base =
    summary.agreements.length > 0
      ? summary.agreements.map((line) => line.trim().replace(/[.;]+$/u, '')).join('. ')
      : agreements.length > 0
        ? `Договорились: ${agreements.map((a) => a.what).join('; ')}`
        : ''
  const parsed = meetingDraftSchema.safeParse({ summary: clip(base, SUMMARY_MAX), agreements })
  return parsed.success ? parsed.data : null
}
