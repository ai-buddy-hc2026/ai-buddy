import { expect, test, type Page } from '@playwright/test'

const browserErrors = new WeakMap<Page, string[]>()

test('календарь создаёт бронь после подтверждения, восстанавливает её и показывает наставнику', async ({
  page,
}) => {
  await signIn(page, 'intern_anya')
  await page.goto('/people?tab=hours')
  const slots = page.getByRole('list', { name: 'Свободные слоты' })
  await expect(slots).toBeVisible()
  const posts: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/calendar/bookings'))
      posts.push(request.url())
  })
  await slots.getByRole('button').first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  expect(posts).toHaveLength(0)
  const topic = `Первая задача ${Date.now()}`
  await dialog.getByRole('textbox', { name: 'Тема встречи' }).fill(topic)
  const saved = page
    .waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith('/api/calendar/bookings'),
    )
    .then(async (response) => ({
      status: response.status(),
      booking: await response.json(),
      key: response.request().headers()['idempotency-key'],
    }))
  await dialog.getByRole('button', { name: 'Записаться', exact: true }).click()
  const { status, booking, key } = await saved
  expect(status).toBe(200)
  expect(booking.status).toBe('confirmed')
  await expect(dialog.getByText('Бронь сохранена', { exact: true })).toBeVisible()
  const token = await page.evaluate(() => sessionStorage.getItem('buddy.token'))
  const replay = await page.request.post('/api/calendar/bookings', {
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': key },
    data: { slot_id: booking.slot_id, topic, confirmed: true },
  })
  expect(replay.status()).toBe(200)
  expect((await replay.json()).id).toBe(booking.id)
  await dialog.getByRole('button', { name: 'Готово', exact: true }).click()
  await page.reload()
  await expect(page.getByText(`ID: ${booking.id}`, { exact: true })).toBeVisible()
  await page.goto('/onboarding')
  await expect(page.getByText(`ID: ${booking.id}`, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Меню профиля' }).click()
  await page.getByText('Сменить пользователя', { exact: true }).click()
  await signIn(page, 'buddy_ilya', false)
  await page.goto('/mentor')
  await expect(page.getByText(`ID: ${booking.id}`, { exact: true })).toBeVisible()
  await expect(page.getByText(topic, { exact: false })).toBeVisible()
  await page.screenshot({ path: 'test-results/calendar.png', fullPage: true })
})

test('коллеги загружаются из Go, находятся по теме и сохраняются после перезагрузки', async ({
  page,
}) => {
  await signIn(page, 'intern_anya')
  const loaded = page
    .waitForResponse((response) => new URL(response.url()).pathname === '/api/employees')
    .then(async (response) => ({ status: response.status(), directory: await response.json() }))
  await page.goto('/people?tab=team')
  const { status, directory } = await loaded
  expect(status).toBe(200)
  expect(directory.items.length).toBeGreaterThan(0)
  const specialist = directory.items.find((employee: { tags: string[] }) =>
    employee.tags.includes('мониторинг'),
  )
  expect(specialist).toBeDefined()
  await expect(
    page.getByRole('article', { name: specialist.display_name, exact: true }),
  ).toBeVisible()
  await page.getByRole('textbox', { name: 'Поиск коллег' }).fill('мониторинг')
  const searched = page.waitForResponse(
    (result) =>
      new URL(result.url()).pathname === '/api/employees' &&
      new URL(result.url()).searchParams.get('q') === 'мониторинг',
  )
  await page.getByRole('button', { name: 'Найти', exact: true }).click()
  expect((await searched).status()).toBe(200)
  await expect(
    page.getByRole('article', { name: specialist.display_name, exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Написать', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(
    page.getByRole('article', { name: specialist.display_name, exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: 'test-results/colleagues.png', fullPage: true })
})

test.beforeEach(({ page }) => {
  const errors: string[] = []
  browserErrors.set(page, errors)
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
})

test.afterEach(({ page }) => {
  expect(browserErrors.get(page)).toEqual([])
})
async function signIn(page: Page, login: string, navigate = true) {
  if (navigate) await page.goto('/login')
  const profile = page.waitForResponse((response) => response.url().endsWith('/api/me'))
  await page.getByRole('button', { name: new RegExp(login) }).click()
  const response = await profile
  expect(response.status()).toBe(200)
  await expect(page).not.toHaveURL(/\/login$/)
  return response.json() as Promise<{ id: string }>
}

test('UI reads the real plan and persists a task status through Go', async ({ page }) => {
  const planResponse = page.waitForResponse((response) =>
    response.url().includes('/api/onboarding/plan'),
  )
  const user = await signIn(page, 'intern_anya')
  const response = await planResponse
  expect(response.status()).toBe(200)
  const plan = await response.json()
  await page.getByRole('link', { name: 'Онбординг', exact: true }).first().click()
  const task = plan.stages
    .flatMap(
      (stage: {
        tasks: Array<{ id: string; title: string; assignee_id: string; status: string }>
      }) => stage.tasks,
    )
    .find((item: { assignee_id: string }) => item.assignee_id === user.id)
  expect(task).toBeDefined()
  const status = page.getByRole('combobox', { name: `Статус: ${task.title}`, exact: true })
  await expect(status).toHaveValue(task.status)
  const nextStatus = task.status === 'done' ? 'todo' : 'done'
  const patchResponse = page.waitForResponse(
    (result) => result.request().method() === 'PATCH' && result.url().endsWith(`/tasks/${task.id}`),
  )
  await status.selectOption(nextStatus)
  expect((await patchResponse).status()).toBe(200)
  await page.reload()
  await expect(
    page.getByRole('combobox', { name: `Статус: ${task.title}`, exact: true }),
  ).toHaveValue(nextStatus)
})

test('UI streams from Go, confirms a real action and restores it after reload', async ({
  page,
}) => {
  await signIn(page, 'buddy_ilya')
  await page.goto('/chats?c=buddy')
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Отправить', exact: true })).toBeDisabled()
  const acceptedResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/api/chat/messages'),
  )
  await page
    .getByRole('textbox', { name: 'Сообщение', exact: true })
    .fill('Подготовь заявку на отгул')
  await page.getByRole('button', { name: 'Отправить', exact: true }).click()
  expect((await acceptedResponse).status()).toBe(202)
  const proposal = page.getByRole('group', { name: 'Отгул', exact: true }).last()
  await expect(proposal.getByText('Черновик', { exact: true })).toBeVisible({ timeout: 60_000 })
  const confirmedResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/actions\/[^/]+\/confirm$/.test(response.url()),
  )
  await proposal.getByRole('button', { name: 'Отправить', exact: true }).click()
  const result = await confirmedResponse
  expect(result.status()).toBe(200)
  const action = await result.json()
  expect(action.status).toBe('succeeded')
  await expect(proposal.getByText(action.result.external_id, { exact: true })).toBeVisible()
  await page.reload()
  await expect(
    page
      .getByRole('group', { name: 'Отгул', exact: true })
      .filter({ hasText: action.result.external_id }),
  ).toBeVisible()
})

test('switching users does not expose cached conversation from the previous account', async ({
  page,
}) => {
  await signIn(page, 'intern_anya')
  await page.goto('/chats?c=buddy')
  const question = `Привет, проверка сессии ${Date.now()}`
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill(question)
  await page.getByRole('button', { name: 'Отправить', exact: true }).click()
  await expect(page.getByText('Тестовый ответ по частям.', { exact: true }).last()).toBeVisible({
    timeout: 60_000,
  })
  await expect(
    page.getByRole('button', { name: 'Что мне делать дальше?', exact: true }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Меню профиля', exact: true }).click()
  await page.getByText('Сменить пользователя', { exact: true }).click()
  await signIn(page, 'buddy_ilya', false)
  await page.getByRole('link', { name: 'Чаты', exact: true }).first().click()
  await page.getByRole('button', { name: /buddy/ }).first().click()
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeVisible()
  await expect(page.getByText(question, { exact: true })).toHaveCount(0)
})
