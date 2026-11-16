import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/avito-tokens.css'
import './styles/global.css'
import { AppProviders } from './app/providers'

const root = document.getElementById('root')
if (!root) throw new Error('Не найден #root')

createRoot(root).render(
  <StrictMode>
    <AppProviders />
  </StrictMode>,
)
