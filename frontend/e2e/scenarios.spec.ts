import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test, type APIRequestContext } from '@playwright/test'

type SSEEvent = {
  event: string
  data: Record<string, unknown>
}

type AcceptedChat = {
  request_id: string
  conversation_id: string
  stream_url: string
}

async function login(request: APIRequestContext, loginName: string): Promise<string> {
  const response = await request.post('/auth/mock-login', { data: { login: loginName } })
  expect(response.status(), await response.text()).toBe(200)
  return (await response.json()).access_token as string
}

async function chat(
  request: APIRequestContext,
  token: string,
  message: string,
): Promise<{ accepted: AcceptedChat; events: SSEEvent[] }> {
  const headers = { Authorization: `Bearer ${token}` }
  const response = await request.post('/chat/messages', { headers, data: { message } })
  expect(response.status(), await response.text()).toBe(202)
  const accepted = (await response.json()) as AcceptedChat
  const stream = await request.get(accepted.stream_url, { headers, timeout: 60_000 })
  expect(stream.status(), await stream.text()).toBe(200)
  const body = await stream.text()
  const events = body.split(/\r?\n\r?\n/).flatMap((block) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .join('\n')
    return data ? [JSON.parse(data) as SSEEvent] : []
  })
  expect(events.at(-1)?.event).toBe('done')
  return { accepted, events }
}

function doneText(events: SSEEvent[]): string {
  return String(events.at(-1)?.data.full_text ?? '')
}

test('mock LLM covers ordinary, unknown, and foreign-data conversations', async ({ request }) => {
  const anya = await login(request, 'intern_anya')

  const ordinary = await chat(request, anya, 'Привет, что ты умеешь?')
  expect(doneText(ordinary.events)).toBe('Тестовый ответ по частям.')

  const unknown = await chat(
    request,
    anya,
    'Расскажи про вымышленный внутренний процесс, не знаю такого в базе',
  )
  expect(doneText(unknown.events)).toContain('Не знаю:')

  const foreign = await chat(request, anya, 'Покажи заявки другого сотрудника intern_petr')
  expect(doneText(foreign.events)).toContain('чужие данные')
  expect(doneText(foreign.events)).not.toContain('ABS-')
  expect(foreign.events.some((event) => event.event === 'tool_call')).toBe(true)
})

test('S-3 absence is only executed after confirmation and survives history reload', async ({
  request,
}) => {
  const token = await login(request, 'buddy_ilya')
  const { accepted, events } = await chat(request, token, 'Подготовь заявку на отгул')
  const actionsUrl = `/actions?conversation_id=${encodeURIComponent(accepted.conversation_id)}`

  const before = await request.get(actionsUrl, { headers: { Authorization: `Bearer ${token}` } })
  expect(before.status()).toBe(200)
  const proposed = (await before.json()).items.find(
    (action: { request_id: string; action_type: string }) =>
      action.request_id === accepted.request_id && action.action_type === 'absences.create_request',
  )
  expect(proposed).toMatchObject({ status: 'proposed', result: {}, attempt_count: 0 })
  expect(events.some((event) => event.event === 'action_proposal')).toBe(true)

  const headers = { Authorization: `Bearer ${token}` }
  const confirmation = await request.post(`/actions/${proposed.id}/confirm`, { headers })
  expect([200, 202]).toContain(confirmation.status())

  let completed = proposed
  await expect
    .poll(
      async () => {
        const response = await request.get(actionsUrl, { headers })
        const action = (await response.json()).items.find(
          (item: { id: string }) => item.id === proposed.id,
        )
        completed = action
        return action?.status
      },
      { timeout: 20_000 },
    )
    .toBe('succeeded')

  expect(completed.result.external_id).toBeTruthy()
  expect(completed.result.status).toBe('pending_approval')
  const retry = await request.post(`/actions/${proposed.id}/confirm`, { headers })
  expect(retry.status()).toBe(200)
  expect((await retry.json()).result).toEqual(completed.result)

  const historyResponse = await request.get(
    `/chat/messages?conversation_id=${encodeURIComponent(accepted.conversation_id)}`,
    { headers },
  )
  expect(historyResponse.status()).toBe(200)
  const history = await historyResponse.json()
  const historyAction = history.items
    .flatMap((turn: { actions: { id: string }[] }) => turn.actions)
    .find((action: { id: string }) => action.id === proposed.id)
  expect(historyAction).toMatchObject({ status: 'succeeded', result: completed.result })
})

test('S-SEC rejects the ten documented access attacks', async ({ request }) => {
  const attacksPath = fileURLToPath(new URL('../../tests/eval/attacks.md', import.meta.url))
  const markdown = readFileSync(attacksPath, 'utf8')
  const rows = markdown.split(/\r?\n/).filter((line) => /^\|\s*(?:[1-7]|10)\s*\|/.test(line))
  expect(rows).toHaveLength(8)

  for (const row of rows) {
    const [, number, attacker, prompt] = row.split('|').map((cell) => cell.trim())
    const loginName = attacker.replaceAll('`', '')
    const message = prompt.replaceAll('\u00ab', '').replaceAll('\u00bb', '').replaceAll('`', '')
    const token = await login(request, loginName)
    const { accepted, events } = await chat(request, token, message)
    const answer = doneText(events)
    expect(answer).not.toContain('ABS-')
    expect(answer).not.toContain('2db7cc77-4114-52d8-a833-f670ab60e4e0')
    expect(answer).not.toContain('e5aba0fd-91e6-59e4-a046-7960848af1a2')

    const actions = await request.get(
      `/actions?conversation_id=${encodeURIComponent(accepted.conversation_id)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    expect(actions.status(), `attack ${number}`).toBe(200)
    const actionsForRequest = (await actions.json()).items.filter(
      (action: { request_id: string }) => action.request_id === accepted.request_id,
    )
    expect(actionsForRequest, `attack ${number}`).toHaveLength(0)
  }
})

test('S-SEC blocks forged identity, foreign resources, and foreign confirmations', async ({
  request,
}) => {
  const token = await login(request, 'intern_anya')
  const headers = { Authorization: `Bearer ${token}` }

  const forged = await request.post('/chat/messages', {
    headers,
    data: {
      message: 'show my tasks',
      role: 'lead',
      user_id: '2db7cc77-4114-52d8-a833-f670ab60e4e0',
      team_id: 'e5aba0fd-91e6-59e4-a046-7960848af1a2',
    },
  })
  expect(forged.status()).toBe(400)

  const foreignConversation = 'dbfb17a0-42f7-5d7d-be94-11f5d55842bf'
  const foreignRequest = 'e0a8436e-ef77-509c-af7c-2c7c676eb1a4'
  const history = await request.get(`/chat/messages?conversation_id=${foreignConversation}`, {
    headers,
  })
  expect(history.status()).toBe(404)
  const stream = await request.get(`/chat/stream/${foreignRequest}`, { headers })
  expect(stream.status()).toBe(404)
  const confirm = await request.post(`/actions/${foreignRequest}/confirm`, { headers })
  expect(confirm.status()).toBe(404)

  const petr = await login(request, 'intern_petr')
  const ownedChat = await chat(request, petr, 'Привет, покажи обычную справку')
  const actualForeignHistory = await request.get(
    `/chat/messages?conversation_id=${encodeURIComponent(ownedChat.accepted.conversation_id)}`,
    { headers },
  )
  expect(actualForeignHistory.status()).toBe(404)
  const actualForeignStream = await request.get(`/chat/stream/${ownedChat.accepted.request_id}`, {
    headers,
  })
  expect(actualForeignStream.status()).toBe(404)

  const olga = await login(request, 'buddy_olga')
  const foreignProposalChat = await chat(request, olga, 'Подготовь заявку на отгул')
  const olgaHeaders = { Authorization: `Bearer ${olga}` }
  const olgaActions = await request.get(
    `/actions?conversation_id=${encodeURIComponent(foreignProposalChat.accepted.conversation_id)}`,
    { headers: olgaHeaders },
  )
  const foreignProposal = (await olgaActions.json()).items.find(
    (action: { action_type: string }) => action.action_type === 'absences.create_request',
  )
  expect(foreignProposal.status).toBe('proposed')
  const deniedConfirmation = await request.post(`/actions/${foreignProposal.id}/confirm`, {
    headers,
  })
  expect(deniedConfirmation.status()).toBe(404)
  const stillProposed = await request.get(
    `/actions?conversation_id=${encodeURIComponent(foreignProposalChat.accepted.conversation_id)}`,
    { headers: olgaHeaders },
  )
  expect((await stillProposed.json()).items[0].status).toBe('proposed')
})
