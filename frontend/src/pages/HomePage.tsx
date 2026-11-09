import { ChatPanel } from '../components/ChatPanel'
import { OnboardingPanel } from '../components/OnboardingPanel'

export function HomePage() {
  return (
    <main className="layout">
      <OnboardingPanel />
      <ChatPanel />
    </main>
  )
}
