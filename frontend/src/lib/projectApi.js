import { apiFetch, createApiError, parseApiResponse } from './api'

export async function listProjects() {
  const response = await apiFetch('/api/projects')
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

export async function deleteProjectById(projectId) {
  const response = await apiFetch(`/api/projects/${projectId}`, {
    method: 'DELETE',
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '프로젝트 삭제에 실패했습니다.')
  }

  return payload.item || null
}
