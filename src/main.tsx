import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/query'
import { AuthProvider } from './lib/auth'
import { I18nProvider } from './lib/i18n'
import { FeedbackProvider } from './ui/feedback'
import { App } from './App'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/pages.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <FeedbackProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </FeedbackProvider>
        </I18nProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
)
