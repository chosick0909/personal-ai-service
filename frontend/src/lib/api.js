import { supabase } from './supabase'

const ACCOUNT_STORAGE_KEY = 'studio:selected-account-id'
const RAW_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').trim()
const DEFAULT_API_BASE_URL = 'https://api.hookai.kr'
const API_BASE_URL = (RAW_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '')

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
  if (typeof window === 'undefined') {
    return ''
  }

  return window.localStorage.getItem(ACCOUNT_STORAGE_KEY) || ''
}

export function setStoredAccountId(accountId) {
  if (typeof window === 'undefined') {
    return
  }

  if (!accountId) {
    window.localStorage.removeItem(ACCOUNT_STORAGE_KEY)
    return
  }

  window.localStorage.setItem(ACCOUNT_STORAGE_KEY, accountId)
}

export async function apiFetch(input, init = {}) {
  const { timeoutMs, ...requestInit } = init
  const headers = new Headers(init.headers || {})
  const accountId = getStoredAccountId()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (accountId) {
    headers.set('x-account-id', accountId)
  }

  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`)
  }

  const controller = new AbortController()
  const signals = [controller.signal]
  if (requestInit.signal) {
    signals.push(requestInit.signal)
  }
  const signal = AbortSignal.any(signals)
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
