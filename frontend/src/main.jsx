import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initFrontendSentry, installSentryTestHelpers } from './lib/sentry'
import logoWebp from './Logo.webp'

initFrontendSentry()
installSentryTestHelpers()

function applyFavicon() {
  if (typeof document === 'undefined') {
    return
  }

  let favicon = document.querySelector("link[rel='icon']")
  if (!favicon) {
    favicon = document.createElement('link')
    favicon.setAttribute('rel', 'icon')
    document.head.appendChild(favicon)
  }
  favicon.setAttribute('type', 'image/webp')
  favicon.setAttribute('href', logoWebp)
}

applyFavicon()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
