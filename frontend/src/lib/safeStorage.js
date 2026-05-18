function getStorage(kind) {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage
  } catch {
    return null
  }
}

export function safeGetStorageItem(key, { kind = 'local', fallback = null } = {}) {
  try {
    const storage = getStorage(kind)
    return storage?.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

export function safeSetStorageItem(key, value, { kind = 'local' } = {}) {
  try {
    const storage = getStorage(kind)
    storage?.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function safeRemoveStorageItem(key, { kind = 'local' } = {}) {
  try {
    const storage = getStorage(kind)
    storage?.removeItem(key)
    return true
  } catch {
    return false
  }
}

export function safeRemoveFromAllBrowserStorage(key) {
  const removedLocal = safeRemoveStorageItem(key, { kind: 'local' })
  const removedSession = safeRemoveStorageItem(key, { kind: 'session' })
  return removedLocal || removedSession
}
