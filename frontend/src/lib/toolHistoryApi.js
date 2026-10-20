import { apiFetch, createApiError, parseApiResponse } from './api'

export async function toolHistoryRequest(accountId, path = '', { method = 'GET', body } = {}) {
  const response = await apiFetch(`/api/tool-history${path}`, {
    method,
    headers: { 'x-account-id': accountId, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    timeoutMs: 20000,
  })
  const payload = await parseApiResponse(response)
  if (!response.ok) throw createApiError(response, payload, '도구 내역을 저장하거나 불러오지 못했습니다.')
  return payload
}

export async function historyThumbnail(file) {
  if (!file) return null
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.7)
  } finally {
    bitmap.close()
  }
}
