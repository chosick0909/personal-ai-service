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

function disableBrowserTranslation() {
  if (typeof document === 'undefined') {
    return
  }

  const markAsNotranslate = (element) => {
    if (!(element instanceof HTMLElement)) {
      return
    }

    element.setAttribute('translate', 'no')
    element.classList.add('notranslate')
  }

  const markTreeAsNotranslate = (node) => {
    if (!(node instanceof HTMLElement)) {
      return
    }

    markAsNotranslate(node)
    node.querySelectorAll('*').forEach(markAsNotranslate)
  }

  document.documentElement.setAttribute('lang', 'ko')
  document.documentElement.setAttribute('translate', 'no')
  document.documentElement.classList.add('notranslate')
  markAsNotranslate(document.body)

  const root = document.getElementById('root')
  markTreeAsNotranslate(root)

  let googleMeta = document.querySelector("meta[name='google']")
  if (!googleMeta) {
    googleMeta = document.createElement('meta')
    googleMeta.setAttribute('name', 'google')
    document.head.appendChild(googleMeta)
  }
  googleMeta.setAttribute('content', 'notranslate')

  let languageMeta = document.querySelector("meta[http-equiv='Content-Language']")
  if (!languageMeta) {
    languageMeta = document.createElement('meta')
    languageMeta.setAttribute('http-equiv', 'Content-Language')
    document.head.appendChild(languageMeta)
  }
  languageMeta.setAttribute('content', 'ko')

  if (!root || window.__hookaiTranslationGuardInstalled) {
    return
  }

  window.__hookaiTranslationGuardInstalled = true
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach(markTreeAsNotranslate)
    })
  })

  observer.observe(root, {
    childList: true,
    subtree: true,
  })
}

disableBrowserTranslation()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
