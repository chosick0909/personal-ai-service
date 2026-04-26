import { apiFetch, createApiError, parseApiResponse } from './api'

function appendAccountQuery(path, accountId) {
  const normalizedAccountId = String(accountId || '').trim()
  if (!normalizedAccountId) {
    return path
  }

  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}accountId=${encodeURIComponent(normalizedAccountId)}`
}

export async function listProjects(accountId) {
  const response = await apiFetch(appendAccountQuery('/api/projects', accountId))
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '프로젝트 목록을 불러오지 못했습니다.')
  }

  return payload.items || []
}

export async function createProject(input = {}) {
  const response = await apiFetch('/api/projects', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '프로젝트 생성에 실패했습니다.')
  }

  return payload.item || null
}

export async function deleteProjectById(projectId, accountId) {
  const response = await apiFetch(appendAccountQuery(`/api/projects/${projectId}`, accountId), {
    method: 'DELETE',
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '프로젝트 삭제에 실패했습니다.')
  }

  return payload.item || null
}
