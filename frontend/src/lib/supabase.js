import { createClient } from '@supabase/supabase-js'
import {
  safeGetStorageItem,
  safeRemoveFromAllBrowserStorage,
  safeSetStorageItem,
} from './safeStorage'

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || 'https://example.supabase.co'
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'demo-anon-key'

const AUTH_PERSIST_MODE_KEY = 'hookai:auth:persist-mode'
const PERSIST_MODE_LOCAL = 'local'
const PERSIST_MODE_SESSION = 'session'

function resolvePersistMode() {
  if (typeof window === 'undefined') {
    return PERSIST_MODE_SESSION
  }

  const value = safeGetStorageItem(AUTH_PERSIST_MODE_KEY)
  return value === PERSIST_MODE_LOCAL ? PERSIST_MODE_LOCAL : PERSIST_MODE_SESSION
}

function getActiveStorageKind() {
  if (typeof window === 'undefined') {
    return 'session'
  }

  return resolvePersistMode() === PERSIST_MODE_LOCAL ? 'local' : 'session'
}

// Without 자동 로그인 the sign-in lives in the tab's session storage, which a new tab or window does not get. The
// studio is used with several plans open in their own windows, so the tabs of this browser share it: a new tab asks
// an open one for the sign-in, and every change (a refreshed token, a sign-out) reaches all of them. Each tab then
// refreshes with the newest token instead of one already used by another tab. Nothing outlives the browser session.
const authChannel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('hookai-auth') : null
const ASK_TIMEOUT_MS = 400

function askOpenTabs(key) {
  return new Promise(resolve => {
    const id = `${Date.now()}-${Math.random()}`
    const done = value => { authChannel.removeEventListener('message', onMessage); clearTimeout(timer); resolve(value) }
    const onMessage = event => { if (event.data?.type === 'give' && event.data.id === id && typeof event.data.value === 'string') done(event.data.value) }
    const timer = setTimeout(() => done(null), ASK_TIMEOUT_MS)
    authChannel.addEventListener('message', onMessage)
    authChannel.postMessage({ type: 'ask', id, key })
  })
}

authChannel?.addEventListener('message', event => {
  const { type, key, value, id } = event.data || {}
  if (typeof key !== 'string' || getActiveStorageKind() !== 'session') return
  if (type === 'ask') {
    const mine = safeGetStorageItem(key, { kind: 'session' })
    if (mine) authChannel.postMessage({ type: 'give', id, key, value: mine })
  } else if (type === 'set' && typeof value === 'string') {
    safeSetStorageItem(key, value, { kind: 'session' })
  } else if (type === 'remove') {
    safeRemoveFromAllBrowserStorage(key)
  }
})

const supabaseStorage = {
  getItem(key) {
    if (typeof window === 'undefined') {
      return null
    }
    const kind = getActiveStorageKind()
    const value = safeGetStorageItem(key, { kind })
    if (value || kind !== 'session' || !authChannel) return value
    return askOpenTabs(key).then(found => {
      if (found) safeSetStorageItem(key, found, { kind: 'session' })
      return found
    })
  },
  setItem(key, value) {
    if (typeof window === 'undefined') {
      return
    }
    const kind = getActiveStorageKind()
    safeSetStorageItem(key, value, { kind })
    if (kind === 'session') authChannel?.postMessage({ type: 'set', key, value })
  },
  removeItem(key) {
    if (typeof window === 'undefined') {
      return
    }
    safeRemoveFromAllBrowserStorage(key)
    authChannel?.postMessage({ type: 'remove', key })
  },
}

export function setAuthPersistMode(rememberMe) {
  if (typeof window === 'undefined') {
    return
  }

  safeSetStorageItem(
    AUTH_PERSIST_MODE_KEY,
    rememberMe ? PERSIST_MODE_LOCAL : PERSIST_MODE_SESSION,
  )
}

export function getAuthPersistMode() {
  return resolvePersistMode() === PERSIST_MODE_LOCAL
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: supabaseStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
})
