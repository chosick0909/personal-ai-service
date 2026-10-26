import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initFrontendSentry, installSentryTestHelpers } from './lib/sentry'
import { apiFetch } from './lib/api'
import { supabase } from './lib/supabase'
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

// A client trial link (/studio?trial=…) signs the visitor in as that link's trial account before the app starts,
// so the studio opens with no login and no coupon. The key is taken out of the address bar right away.
async function enterTrial() {
  const url = new URL(window.location.href)
  const token = url.searchParams.get('trial')
  if (!token) return
  url.searchParams.delete('trial')
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  try {
    const response = await apiFetch('/api/trial/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), timeoutMs: 30000 })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) { window.alert(payload?.error?.message || payload?.message || '체험 링크로 들어가지 못했어요. 링크를 다시 확인해 주세요.'); return }
    await supabase.auth.setSession({ access_token: payload.access_token, refresh_token: payload.refresh_token })
  } catch {
    window.alert('체험 링크로 들어가지 못했어요. 잠시 후 다시 열어 주세요.')
  }
}

void enterTrial().finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
