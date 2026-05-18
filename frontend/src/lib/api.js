import { supabase } from './supabase'
import { safeGetStorageItem, safeRemoveStorageItem, safeSetStorageItem } from './safeStorage'

const ACCOUNT_STORAGE_KEY = 'studio:selected-account-id'
const CHARACTER_STORAGE_KEY = 'studio:selected-character-id'
const RAW_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').trim()
const DEFAULT_API_BASE_URL = 'https://api.hookai.kr'

function getDefaultApiBaseUrl() {
  if (RAW_API_BASE_URL) {
    return RAW_API_BASE_URL
  }

  if (typeof window !== 'undefined') {
    const { hostname, protocol } = window.location
    const isLocalHost =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0'

    if (isLocalHost) {
      return `${protocol}//${hostname}:3001`
    }
  }

  return DEFAULT_API_BASE_URL
}

const API_BASE_URL = getDefaultApiBaseUrl().replace(/\/$/, '')

function mergeAbortSignals(signals = []) {
  const activeSignals = signals.filter(Boolean)

  if (activeSignals.length === 0) {
    return undefined
  }

  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return AbortSignal.any(activeSignals)
  }

  if (activeSignals.length === 1) {
    return activeSignals[0]
  }

  const controller = new AbortController()
  const abort = (signal) => {
    if (controller.signal.aborted) {
      return
    }
    try {
      controller.abort(signal?.reason)
    } catch {
      controller.abort()
    }
  }

  activeSignals.forEach((signal) => {
    if (signal.aborted) {
      abort(signal)
      return
    }
    signal.addEventListener('abort', () => abort(signal), { once: true })
  })

  return controller.signal
}

function resolveApiUrl(input) {
  if (!API_BASE_URL || typeof input !== 'string') {
    return input
  }

  if (/^https?:\/\//i.test(input)) {
    return input
  }

  if (!input.startsWith('/')) {
    return input
  }

  return `${API_BASE_URL}${input}`
}

export async function parseApiResponse(response) {
  const raw = await response.text()

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`서버 응답을 해석하지 못했습니다 (${response.status})`)
  }
}

export function getStoredAccountId() {
  return safeGetStorageItem(ACCOUNT_STORAGE_KEY, { fallback: '' }) || ''
}

export function setStoredAccountId(accountId) {
  const previousAccountId = getStoredAccountId()
  if (!accountId) {
    safeRemoveStorageItem(ACCOUNT_STORAGE_KEY)
    safeRemoveStorageItem(CHARACTER_STORAGE_KEY)
    return
  }

  safeSetStorageItem(ACCOUNT_STORAGE_KEY, accountId)
  if (previousAccountId && previousAccountId !== accountId) {
    safeRemoveStorageItem(CHARACTER_STORAGE_KEY)
  }
}

export function getStoredCharacterId() {
  return safeGetStorageItem(CHARACTER_STORAGE_KEY, { fallback: '' }) || ''
}

export function setStoredCharacterId(characterId) {
  if (!characterId) {
    safeRemoveStorageItem(CHARACTER_STORAGE_KEY)
    return
  }

  safeSetStorageItem(CHARACTER_STORAGE_KEY, characterId)
}

export async function apiFetch(input, init = {}) {
  const { timeoutMs, ...requestInit } = init
  const headers = new Headers(init.headers || {})
  const accountId = getStoredAccountId()
  const characterId = getStoredCharacterId()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (accountId) {
    headers.set('x-account-id', accountId)
  }

  if (characterId) {
    headers.set('x-character-id', characterId)
  }

  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`)
  }

  const controller = new AbortController()
  const signals = [controller.signal]
  if (requestInit.signal) {
    signals.push(requestInit.signal)
  }
  const signal = mergeAbortSignals(signals)
  const timer = timeoutMs && Number(timeoutMs) > 0
    ? setTimeout(() => controller.abort(new DOMException('Request timeout', 'AbortError')), Number(timeoutMs))
    : null

  try {
    return await fetch(resolveApiUrl(input), {
      ...requestInit,
      headers,
      signal,
    })
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

export function createApiError(response, payload, fallbackMessage) {
  const code = payload?.error?.code || `HTTP_${response.status}`
  const message = payload?.error?.message || fallbackMessage
  const details = payload?.error?.details || null
  const requestId = payload?.error?.requestId || null
  const detailText =
    details && typeof details === 'object'
      ? Object.entries(details)
          .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
          .join(' | ')
      : details

  const error = new Error(
    `[${code}] ${message}${detailText ? ` · ${detailText}` : ''}${requestId ? ` · requestId: ${requestId}` : ''}`,
  )

  error.code = code
  error.details = details
  error.requestId = requestId

  return error
}
