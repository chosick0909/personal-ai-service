import { apiFetch, createApiError, parseApiResponse } from './api'

function splitVariationSections(variation = '') {
  const normalized = variation.trim()

  if (!normalized) {
    return {
      hook: '',
      body: '',
      cta: '',
    }
  }

  const parts = normalized.split(/\n\s*\n/)

  if (parts.length >= 3) {
    return {
      hook: parts[0]?.trim() || '',
      body: parts[1]?.trim() || '',
      cta: parts.slice(2).join('\n\n').trim(),
    }
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return {
    hook: lines[0] || normalized,
    body: lines.slice(1, -1).join(' ') || lines[1] || normalized,
    cta: lines.at(-1) || '이 흐름으로 네 주제에 맞게 마무리해보세요.',
  }
}

function createScriptFromVariation(variation, index) {
  const fallbackLabel = `${String.fromCharCode(65 + index)}안`
  const isStructuredVariation =
    variation && typeof variation === 'object' && !Array.isArray(variation)
  const sections = isStructuredVariation
    ? {
        hook: variation.hook?.trim() || '',
        body: variation.body?.trim() || '',
        cta: variation.cta?.trim() || '',
      }
    : splitVariationSections(variation)
  const label = isStructuredVariation ? variation.label?.trim() || fallbackLabel : fallbackLabel
  const angle = isStructuredVariation
    ? variation.angle?.trim() || sections.hook || `${label} 제안`
    : sections.hook || `${label} 제안`
  const usedKnowledge =
    isStructuredVariation && Array.isArray(variation.usedKnowledge)
      ? variation.usedKnowledge
      : []
  const usedChunkIds =
    isStructuredVariation && Array.isArray(variation.usedChunkIds)
      ? variation.usedChunkIds
      : []

  return {
    id: `script-${index + 1}`,
    label,
    angle,
    tone: '',
    score: null,
    hook: sections.hook,
    body: sections.body,
    cta: sections.cta,
    sections,
    fullContent: [sections.hook, '', sections.body, '', sections.cta].join('\n'),
    globalKnowledgeDebug: usedKnowledge,
    usedChunkIds,
  }
}

function summarizeFrameInsight(frameNotes = []) {
  if (!frameNotes.length) {
    return '첫 3초 프레임 분석 요약이 아직 없습니다.'
  }

  return frameNotes
    .slice(0, 3)
    .map((frame) =>
      [frame.timestamp != null ? `${frame.timestamp}초` : null, frame.observation, frame.hookReason]
        .filter(Boolean)
        .join(' · '),
    )
    .join('\n')
}

function normalizeComparableText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[“”"'\[\]{}()<>.,!?;:·•\-–—_~`|/\\]/g, ' ')
    .replace(/\b(hook|body|cta|ai|a\/b\/c)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isSimilarText(a = '', b = '') {
  const left = normalizeComparableText(a)
  const right = normalizeComparableText(b)
  if (!left || !right) return false
  if (left === right) return true
  if (left.length >= 18 && right.length >= 18 && (left.includes(right) || right.includes(left))) {
    return true
  }

  const leftTokens = new Set(left.split(' ').filter((token) => token.length >= 2))
  const rightTokens = new Set(right.split(' ').filter((token) => token.length >= 2))
  if (!leftTokens.size || !rightTokens.size) return false

  let intersection = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1
  }

  const overlap = intersection / Math.min(leftTokens.size, rightTokens.size)
  return intersection >= 4 && overlap >= 0.72
}

function dedupeTextList(values = [], max = 4, excluded = []) {
  const result = []
  const exclusions = Array.isArray(excluded) ? excluded.filter(Boolean) : []

  for (const value of values) {
    const normalized = String(value || '').trim()
    if (!normalized) continue
    if (exclusions.some((item) => isSimilarText(item, normalized))) continue
    if (result.some((item) => isSimilarText(item, normalized))) continue
    result.push(normalized)
    if (result.length >= max) break
  }

  return result
}

function buildKeyPoints(analysis) {
  const items = [
    analysis.structure_analysis,
    analysis.hook_analysis,
    analysis.psychology_analysis,
    analysis.ai_feedback,
  ]

  const panelItems = [
    analysis.structure_analysis,
    analysis.hook_analysis,
    analysis.psychology_analysis,
    summarizeFrameInsight(analysis.frame_notes || []),
  ]

  return dedupeTextList(items, 4, panelItems)
}

export function mapReferenceAnalysisToUi(analysis) {
  const variations = Array.isArray(analysis.variations) ? analysis.variations : []

  return {
    reference: {
      id: analysis.id,
      title: analysis.title,
      topic: analysis.topic,
      createdAt: analysis.created_at,
      fileName: analysis.original_filename,
      status: analysis.processing_status || 'ready',
      projectId: analysis.project_id || null,
      structureAnalysis: analysis.structure_analysis || '구조 분석이 없습니다.',
      hookAnalysis: analysis.hook_analysis || '후킹 분석이 없습니다.',
      psychologyAnalysis: analysis.psychology_analysis || '심리 기제 분석이 없습니다.',
      frameInsight: summarizeFrameInsight(analysis.frame_notes || []),
      keyPoints: buildKeyPoints(analysis),
      transcript: analysis.transcript || '',
      aiFeedback: analysis.ai_feedback || '',
      errorMessage: analysis.error_message || '',
      globalKnowledgeDebug: Array.isArray(analysis.global_knowledge_debug)
        ? analysis.global_knowledge_debug
        : [],
      globalKnowledgeCategories: Array.isArray(analysis.global_knowledge_categories)
        ? analysis.global_knowledge_categories
        : [],
      categoryPlaybook:
        analysis.category_playbook && typeof analysis.category_playbook === 'object'
          ? {
              category: analysis.category_playbook.category || '',
              label: analysis.category_playbook.label || '',
              insight: analysis.category_playbook.insight || '',
              hookAiRule: analysis.category_playbook.hookai_rule || '',
              mode: analysis.category_playbook.mode || '',
            }
          : null,
    },
    generatedScripts: variations.map((variation, index) => createScriptFromVariation(variation, index)),
  }
}

export async function analyzeReferenceVideo({ file, topic, title, accountId, projectId, signal }) {
  const formData = new FormData()
  formData.append('video', file)
  formData.append('asyncProcessing', '1')
  if (accountId) {
    formData.append('accountId', String(accountId))
  }
  if (topic?.trim()) {
    formData.append('topic', topic.trim())
  }

  if (title?.trim()) {
    formData.append('title', title.trim())
  }
  if (projectId) {
    formData.append('projectId', String(projectId))
  }

  const response = await apiFetch('/api/reference-videos/analyze', {
    method: 'POST',
    timeoutMs: 8 * 60 * 1000,
    body: formData,
    signal,
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '영상 분석에 실패했습니다.')
  }

  return mapReferenceAnalysisToUi(payload.analysis)
}

function appendAccountQuery(path, accountId) {
  const normalizedAccountId = String(accountId || '').trim()
  if (!normalizedAccountId) {
    return path
  }

  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}accountId=${encodeURIComponent(normalizedAccountId)}`
}

export async function listReferenceVideoHistory(accountId) {
  const response = await apiFetch(appendAccountQuery('/api/reference-videos', accountId))
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '레퍼런스 기록을 불러오지 못했습니다.')
  }

  return (payload.items || []).map((item) => ({
    id: item.id,
    title: item.title,
    topic: item.topic,
    fileName: item.original_filename || '',
    transcript: item.transcript || '',
    createdAt: item.created_at,
    status: item.processing_status || 'ready',
    projectId: item.project_id || null,
  }))
}

export async function fetchReferenceVideoDetail(referenceId, accountId) {
  const response = await apiFetch(appendAccountQuery(`/api/reference-videos/${referenceId}`, accountId))
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '레퍼런스 상세를 불러오지 못했습니다.')
  }

  return mapReferenceAnalysisToUi(payload.analysis)
}

export async function deleteReferenceVideo(referenceId, accountId) {
  const response = await apiFetch(appendAccountQuery(`/api/reference-videos/${referenceId}`, accountId), {
    method: 'DELETE',
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '레퍼런스 기록 삭제에 실패했습니다.')
  }

  return payload.item || null
}

export async function updateReferenceVideo(referenceId, input = {}) {
  const response = await apiFetch(`/api/reference-videos/${referenceId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '레퍼런스 수정에 실패했습니다.')
  }

  return payload.item || null
}

export async function generateScriptFeedback({ accountId, referenceId, scriptId, selectedLabel, sections }) {
  const response = await apiFetch('/api/scripts/feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      accountId,
      referenceId,
      scriptId,
      selectedLabel,
      sections,
    }),
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '피드백 생성에 실패했습니다.')
  }

  return payload.feedback
}

export async function generateChatReply({
  accountId,
  referenceId,
  selectedLabel,
  message,
  editorSections,
}) {
  const response = await apiFetch('/api/scripts/refine', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      accountId,
      referenceId,
      selectedLabel,
      request: message,
      sections: editorSections,
    }),
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '수정 제안 생성에 실패했습니다.')
  }

  return {
    message: payload.message,
    proposedSections: payload.sections,
  }
}
