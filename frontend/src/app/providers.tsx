import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { useSession } from '@/entities/session'
import { router } from './router'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
})

// Другой пользователь - другие данные: кэш прошлой сессии не показываем
useSession.subscribe((state, previous) => {
  if (state.login !== previous.login) queryClient.clear()
})

export function AppProviders() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
