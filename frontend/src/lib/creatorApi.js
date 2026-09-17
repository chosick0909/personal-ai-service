import { apiFetch, parseApiResponse, createApiError } from './api'

export async function creatorRequest(path, { method = 'GET', body, signal } = {}) {
  const response = await apiFetch(`/api${path}`, { method, signal, timeoutMs: 20000,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined })
  const payload = await parseApiResponse(response)
  if (!response.ok) throw createApiError(response, payload, '요청을 완료하지 못했습니다.')
  return payload
}
export function safeInstagramHref(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && ['instagram.com','www.instagram.com'].includes(url.hostname) && !url.port && !url.username && !url.password ? url.href : null
  } catch { return null }
}
