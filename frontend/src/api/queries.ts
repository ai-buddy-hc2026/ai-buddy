import { queryOptions } from '@tanstack/react-query'
import { mockMessages, mockPlan } from './mocks'

// Пока отдаём заглушки. Следующим шагом queryFn заменим на запросы к API.

export const onboardingPlanQuery = queryOptions({
  queryKey: ['onboarding', 'plan'],
  queryFn: () => Promise.resolve(mockPlan),
})

export const chatHistoryQuery = queryOptions({
  queryKey: ['chat', 'history'],
  queryFn: () => Promise.resolve(mockMessages),
})
