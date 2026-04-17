import { createClient } from '@supabase/supabase-js'

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

  const value = window.localStorage.getItem(AUTH_PERSIST_MODE_KEY)
  return value === PERSIST_MODE_LOCAL ? PERSIST_MODE_LOCAL : PERSIST_MODE_SESSION
}

function getActiveStorage() {
  if (typeof window === 'undefined') {
    return undefined
  }

  return resolvePersistMode() === PERSIST_MODE_LOCAL ? window.localStorage : window.sessionStorage
}

const supabaseStorage = {
  getItem(key) {
    if (typeof window === 'undefined') {
      return null
    }
    const storage = getActiveStorage()
    return storage?.getItem(key) ?? null
  },
  setItem(key, value) {
    if (typeof window === 'undefined') {
      return
    }
    const storage = getActiveStorage()
    storage?.setItem(key, value)
  },
  removeItem(key) {
    if (typeof window === 'undefined') {
      return
    }
    window.localStorage.removeItem(key)
    window.sessionStorage.removeItem(key)
  },
}

export function setAuthPersistMode(rememberMe) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(
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
