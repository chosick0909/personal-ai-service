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

const supabaseStorage = {
  getItem(key) {
    if (typeof window === 'undefined') {
      return null
    }
    const kind = getActiveStorageKind()
    return safeGetStorageItem(key, { kind })
  },
  setItem(key, value) {
    if (typeof window === 'undefined') {
      return
    }
    const kind = getActiveStorageKind()
    safeSetStorageItem(key, value, { kind })
  },
  removeItem(key) {
    if (typeof window === 'undefined') {
      return
    }
    safeRemoveFromAllBrowserStorage(key)
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
