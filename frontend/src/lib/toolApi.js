import { apiFetch, createApiError, parseApiResponse } from './api'

function isRequestTimeoutError(error) {
  return error?.name === 'AbortError' || /Request timeout|timeout/i.test(String(error?.message || error))
}

export async function generateCaptionDraft({
  topic,
  captionA,
  captionB,
  monetizationModel,
  category,
  strategyText,
  hookDirection,
  bodyFocus,
  ctaExamples,
  riskNotes,
  bannedExpressions,
}) {
  let response
  try {
    response = await apiFetch('/api/tools/caption', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topic,
        captionA,
        captionB,
        monetizationModel,
        category,
        strategyText,
        hookDirection,
        bodyFocus,
        ctaExamples,
        riskNotes,
        bannedExpressions,
      }),
      timeoutMs: 90000,
    })
  } catch (error) {
    if (isRequestTimeoutError(error)) {
      throw new Error('캡션 생성 시간이 길어지고 있습니다. 잠시 후 다시 시도해주세요.')
    }
    throw error
  }
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '캡션 생성에 실패했습니다.')
  }

  return payload
}

export async function loadCaptionCategoryRule({ category }) {
  const params = new URLSearchParams()
  if (category) {
    params.set('category', category)
  }

  const response = await apiFetch(`/api/tools/caption/category-rule?${params.toString()}`, {
    timeoutMs: 30000,
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '카테고리 전략을 불러오지 못했습니다.')
  }

  return payload
}

export async function analyzeThumbnailImage({ image, topic }) {
  const formData = new FormData()
  formData.append('image', image)
  if (topic) {
    formData.append('topic', topic)
  }

  const response = await apiFetch('/api/tools/thumbnail/analyze', {
    method: 'POST',
    body: formData,
    timeoutMs: 60000,
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '썸네일 이미지 분석에 실패했습니다.')
  }

  return payload
}

export async function generateThumbnailTitles({ topic, imageAnalysis }) {
  const response = await apiFetch('/api/tools/thumbnail/titles', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      topic,
      imageAnalysis,
    }),
    timeoutMs: 60000,
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '썸네일 제목 생성에 실패했습니다.')
  }

  return payload
}
