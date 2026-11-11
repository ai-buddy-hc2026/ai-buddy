import { Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { Header } from './components/Header'
import { HomePage } from './pages/HomePage'

const rootRoute = createRootRoute({
  component: () => (
    <div className="app">
      <Header />
      <Outlet />
    </div>
  ),
  notFoundComponent: () => <p className="not-found">Страница не найдена</p>,
})

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
})

const routeTree = rootRoute.addChildren([homeRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
