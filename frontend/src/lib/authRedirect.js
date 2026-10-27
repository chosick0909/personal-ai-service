import { safeGetStorageItem, safeRemoveStorageItem, safeSetStorageItem } from './safeStorage'

const POST_AUTH_REDIRECT_STORAGE_KEY = 'postAuthRedirectPath'

function isSafeLocalPath(path) {
  return Boolean(path && path.startsWith('/') && !path.startsWith('//'))
}

export function setPostAuthRedirectPath(path) {
  if (!isSafeLocalPath(path)) {
    return
  }

  safeSetStorageItem(POST_AUTH_REDIRECT_STORAGE_KEY, path, { kind: 'session' })
}

export function getPostAuthRedirectPath(defaultPath = '/purchase') {
  const nextPath = new URLSearchParams(window.location.search).get('next')
  if (isSafeLocalPath(nextPath)) {
    return nextPath
  }

  const storedPath = safeGetStorageItem(POST_AUTH_REDIRECT_STORAGE_KEY, { kind: 'session' })
  if (isSafeLocalPath(storedPath)) {
    return storedPath
  }

  return defaultPath
}

export function consumePostAuthRedirectPath(defaultPath = '/purchase') {
  const redirectPath = getPostAuthRedirectPath(defaultPath)
  safeRemoveStorageItem(POST_AUTH_REDIRECT_STORAGE_KEY, { kind: 'session' })

  return redirectPath
}

export function getAuthRedirectUrl(redirectPath = getPostAuthRedirectPath('/analyze')) {
  // Google may only return to addresses on the sign-in allow list; /analyze is on it and forwards to /studio,
  // carrying the session along, so the studio is reached through it.
  if (/^\/studio\/?$/.test(redirectPath)) redirectPath = '/analyze'
  if (redirectPath !== '/analyze') {
    return `${window.location.origin}${redirectPath}`
  }

  const configuredRedirectUrl = import.meta.env.VITE_AUTH_REDIRECT_URL?.trim()
  if (configuredRedirectUrl) {
    return configuredRedirectUrl
  }

  return `${window.location.origin}${redirectPath}`
}
