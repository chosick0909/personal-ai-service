import { apiFetch, createApiError, parseApiResponse } from './api'

export async function loadAccountProfile() {
  const response = await apiFetch('/api/account/profile')
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '계정 설정을 불러오지 못했습니다.')
  }

  return payload
}

export async function saveAccountProfile(input) {
  const response = await apiFetch('/api/account/profile', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '계정 설정을 저장하지 못했습니다.')
  }

  return payload
}

export async function listAccounts() {
  const response = await apiFetch('/api/accounts')
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '계정 목록을 불러오지 못했습니다.')
  }

  return payload.accounts || []
}

export async function createAccount(input) {
  const response = await apiFetch('/api/accounts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '계정을 생성하지 못했습니다.')
  }

  return payload.account
}

export async function deleteAccountById(accountId) {
  const response = await apiFetch(`/api/accounts/${accountId}`, {
    method: 'DELETE',
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '계정을 삭제하지 못했습니다.')
  }

  return payload.account
}
