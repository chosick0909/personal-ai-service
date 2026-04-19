import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initFrontendSentry, installSentryTestHelpers } from './lib/sentry'
import faviconWebp from './Logo_1.webp'

initFrontendSentry()
installSentryTestHelpers()

function applyFavicon() {
  if (typeof document === 'undefined') {
    return
  }

  const rels = ['icon', 'shortcut icon', 'apple-touch-icon']
  rels.forEach((rel) => {
    let link = document.querySelector(`link[rel='${rel}']`)
    if (!link) {
      link = document.createElement('link')
      link.setAttribute('rel', rel)
      document.head.appendChild(link)
    }
    link.setAttribute('type', 'image/webp')
    link.setAttribute('sizes', 'any')
    link.setAttribute('href', faviconWebp)
  })
}

applyFavicon()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
