import { apiFetch, createApiError, parseApiResponse } from './api'

export async function loadMyEntitlement({ referenceId } = {}) {
  const query = referenceId ? `?referenceId=${encodeURIComponent(referenceId)}` : ''
  const response = await apiFetch(`/api/entitlements/me${query}`)
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '이용권 정보를 불러오지 못했습니다.')
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
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '쿠폰 적용에 실패했습니다.')
  }

  return payload
}
