import { apiFetch, createApiError, parseApiResponse } from './api'
import { safeGetStorageItem, safeRemoveStorageItem, safeSetStorageItem } from './safeStorage'
import { supabase } from './supabase'

const ENTITLEMENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const ENTITLEMENT_CACHE_VERSION = 3
const inFlightEntitlementRequests = new Map()

async function getEntitlementCacheKey() {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const userId = session?.user?.id || 'anonymous'
  return `hookai:entitlement:${userId}`
}

function readCachedEntitlement(cacheKey) {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const cached = JSON.parse(safeGetStorageItem(cacheKey, { fallback: 'null' }) || 'null')
    if (!cached?.status || !cached?.cachedAt || cached.version !== ENTITLEMENT_CACHE_VERSION) {
      safeRemoveStorageItem(cacheKey)
      return null
    }

    if (Date.now() - cached.cachedAt > ENTITLEMENT_CACHE_TTL_MS) {
      safeRemoveStorageItem(cacheKey)
      return null
    }

    const endsAt = cached.status?.entitlement?.endsAt
    if (endsAt) {
      const endsAtTime = new Date(endsAt).getTime()
      if (Number.isFinite(endsAtTime) && endsAtTime <= Date.now()) {
        safeRemoveStorageItem(cacheKey)
        return null
      }
    }

    return cached.status
  } catch {
    return null
  }
}

function writeCachedEntitlement(cacheKey, status) {
  if (typeof window === 'undefined') {
    return
  }

  safeSetStorageItem(
    cacheKey,
    JSON.stringify({
      version: ENTITLEMENT_CACHE_VERSION,
      cachedAt: Date.now(),
      status,
    }),
  )
}

function createEntitlementError(response, payload) {
  const rawError = createApiError(response, payload, '이용권 정보를 불러오지 못했습니다.')
  const code = rawError.code || payload?.error?.code || `HTTP_${response.status}`
  const detailsText = JSON.stringify(rawError.details || payload?.error?.details || '').toLowerCase()
  const isServiceUnavailable =
    response.status === 503 ||
    code === 'AUTH_SERVICE_UNAVAILABLE' ||
    code === 'ENTITLEMENT_SERVICE_UNAVAILABLE' ||
    code === 'USAGE_SERVICE_UNAVAILABLE' ||
    detailsText.includes('fetch failed') ||
    detailsText.includes('econnreset')
  const isUnauthorized = response.status === 401 || code === 'UNAUTHORIZED'

  let message = '이용권 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'
  if (isServiceUnavailable) {
    message = '서버 연결이 일시적으로 불안정해 접근 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.'
  } else if (isUnauthorized) {
    message = '로그인 상태를 다시 확인해야 합니다. 새로고침 후에도 계속되면 다시 로그인해주세요.'
  }

  const error = new Error(message)
  error.code = code
  error.details = rawError.details
  error.requestId = rawError.requestId
  error.isTransient = isServiceUnavailable
  error.isAuthExpired = isUnauthorized && !isServiceUnavailable
  return error
}

function createEntitlementNetworkError(cause) {
  const rawMessage = String(cause?.message || cause || '')
  const isTimeout = cause?.name === 'AbortError' || /timeout|aborted/i.test(rawMessage)
  const error = new Error(
    isTimeout
      ? '이용권 확인이 평소보다 오래 걸리고 있습니다. 잠시 후 다시 확인해주세요.'
      : '서버에 연결하지 못했습니다. 백엔드 실행 상태와 네트워크를 확인한 뒤 다시 시도해주세요.',
  )
  error.code = isTimeout ? 'ENTITLEMENT_REQUEST_TIMEOUT' : 'ENTITLEMENT_NETWORK_ERROR'
  error.details = null
  error.requestId = null
  error.isTransient = true
  error.isAuthExpired = false
  return error
}

export function readCachedEntitlementForUser(userId) {
  const normalizedUserId = String(userId || '').trim()
  if (!normalizedUserId) {
    return null
  }

  return readCachedEntitlement(`hookai:entitlement:${normalizedUserId}`)
}

export async function loadMyEntitlement({ referenceId, forceRefresh = false } = {}) {
  try {
    const query = referenceId ? `?referenceId=${encodeURIComponent(referenceId)}` : ''
    const cacheKey = referenceId ? '' : await getEntitlementCacheKey()
    const cached = !forceRefresh && cacheKey ? readCachedEntitlement(cacheKey) : null
    if (cached) {
      return cached
    }

    const requestKey = `${cacheKey || 'uncached'}:${referenceId || 'account'}`
    let request = inFlightEntitlementRequests.get(requestKey)
    if (!request) {
      request = (async () => {
        // Login access checks must wait for the server response. Aborting this
        // request can incorrectly block a valid user while Railway or Supabase
        // is waking up.
        const response = await apiFetch(`/api/entitlements/me${query}`)
        const payload = await parseApiResponse(response)

        if (!response.ok) {
          throw createEntitlementError(response, payload)
        }

        return payload
      })()
      inFlightEntitlementRequests.set(requestKey, request)
    }

    try {
      const payload = await request
      if (cacheKey) {
        writeCachedEntitlement(cacheKey, payload)
      }
      return payload
    } finally {
      if (inFlightEntitlementRequests.get(requestKey) === request) {
        inFlightEntitlementRequests.delete(requestKey)
      }
    }
  } catch (error) {
    if (error?.code && (error.isTransient || error.isAuthExpired)) {
      throw error
    }
    throw createEntitlementNetworkError(error)
  }
}

export async function applyCouponCode(couponCode) {
  const response = await apiFetch('/api/coupons/apply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ couponCode }),
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '쿠폰 적용에 실패했습니다.')
  }

  const cacheKey = await getEntitlementCacheKey()
  writeCachedEntitlement(cacheKey, payload)

  return payload
}
