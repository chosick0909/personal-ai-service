import { apiFetch, createApiError, parseApiResponse } from './api'
import { supabase } from './supabase'

const ENTITLEMENT_CACHE_TTL_MS = 30 * 1000

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
    const cached = JSON.parse(window.sessionStorage.getItem(cacheKey) || 'null')
    if (!cached?.status || !cached?.cachedAt) {
      return null
    }

    if (Date.now() - cached.cachedAt > ENTITLEMENT_CACHE_TTL_MS) {
      window.sessionStorage.removeItem(cacheKey)
      return null
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

  window.sessionStorage.setItem(
    cacheKey,
    JSON.stringify({
      cachedAt: Date.now(),
      status,
    }),
  )
}

export async function loadMyEntitlement({ referenceId } = {}) {
  const query = referenceId ? `?referenceId=${encodeURIComponent(referenceId)}` : ''
  const cacheKey = referenceId ? '' : await getEntitlementCacheKey()
  const cached = cacheKey ? readCachedEntitlement(cacheKey) : null
  if (cached) {
    return cached
  }

  const response = await apiFetch(`/api/entitlements/me${query}`, {
    timeoutMs: 5000,
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '이용권 정보를 불러오지 못했습니다.')
  }

  if (cacheKey) {
    writeCachedEntitlement(cacheKey, payload)
  }

  return payload
}

export async function applyCouponCode(couponCode) {
  const response = await apiFetch('/api/coupons/apply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ couponCode }),
    timeoutMs: 10000,
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '쿠폰 적용에 실패했습니다.')
  }

  const cacheKey = await getEntitlementCacheKey()
  writeCachedEntitlement(cacheKey, payload)

  return payload
}
