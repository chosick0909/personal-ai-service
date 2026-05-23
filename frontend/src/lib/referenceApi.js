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
    .replace(/[“”"'[\]{}()<>.,!?;:·•\-–—_~`|/\\]/g, ' ')
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
      currentStage: analysis.current_stage || '',
      projectId: analysis.project_id || null,
      structureAnalysis: analysis.structure_analysis || '구조 분석이 없습니다.',
      hookAnalysis: analysis.hook_analysis || '후킹 분석이 없습니다.',
      psychologyAnalysis: analysis.psychology_analysis || '심리 기제 분석이 없습니다.',
      frameInsight: summarizeFrameInsight(analysis.frame_notes || []),
      keyPoints: buildKeyPoints(analysis),
      transcript: analysis.transcript || '',
      aiFeedback: analysis.ai_feedback || '',
      hasAnalysisPreview: Boolean(
        (analysis.transcript || '').trim() ||
          (analysis.structure_analysis || '').trim() ||
          (analysis.hook_analysis || '').trim() ||
          (analysis.psychology_analysis || '').trim() ||
          (analysis.ai_feedback || '').trim(),
      ),
      errorMessage: analysis.error_message || '',
      analysisStageMetrics:
        analysis.analysis_stage_metrics && typeof analysis.analysis_stage_metrics === 'object'
          ? analysis.analysis_stage_metrics
          : {},
      transcriptQuality:
        analysis.transcript_quality && typeof analysis.transcript_quality === 'object'
          ? analysis.transcript_quality
          : {},
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

export async function createReferenceUploadSession({
  clientUploadId,
  file,
  topic,
  title,
  accountId,
  projectId,
  signal,
}) {
  const response = await apiFetch('/api/reference-videos/upload-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(clientUploadId ? { 'x-idempotency-key': clientUploadId } : {}),
    },
    timeoutMs: 20000,
    body: JSON.stringify({
      clientUploadId,
      accountId,
      projectId: projectId || null,
      title: title?.trim() || '',
      topic: topic?.trim() || '',
      originalFilename: file?.name || '',
      mimeType: file?.type || '',
      fileSize: Number(file?.size || 0),
    }),
    signal,
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '업로드 세션을 만들지 못했습니다.')
  }

  return mapReferenceAnalysisToUi(payload.analysis)
}

export async function fetchReferenceUploadSessionByClientUploadId({
  clientUploadId,
  signal,
}) {
  const normalizedClientUploadId = String(clientUploadId || '').trim()
  if (!normalizedClientUploadId) {
    return null
  }

  const response = await apiFetch(
    `/api/reference-videos/upload-session/${encodeURIComponent(normalizedClientUploadId)}`,
    {
      method: 'GET',
      timeoutMs: 15000,
      signal,
    },
  )
  const payload = await parseApiResponse(response)

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw createApiError(response, payload, '업로드 세션을 확인하지 못했습니다.')
  }

  return mapReferenceAnalysisToUi(payload.analysis)
}

export async function analyzeReferenceVideo({
  file,
  topic,
  title,
  accountId,
  projectId,
  referenceId,
  clientUploadId,
  signal,
}) {
  const formData = new FormData()
  formData.append('video', file)
  formData.append('asyncProcessing', '1')
  if (referenceId) {
    formData.append('referenceId', String(referenceId))
  }
  if (clientUploadId) {
    formData.append('clientUploadId', String(clientUploadId))
    formData.append('idempotencyKey', String(clientUploadId))
  }
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
    headers: clientUploadId
      ? {
          'x-idempotency-key': String(clientUploadId),
        }
      : undefined,
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
    currentStage: item.current_stage || '',
    projectId: item.project_id || null,
    hasAnalysisPreview: Boolean(
      (item.transcript || '').trim() ||
        (item.structure_analysis || '').trim() ||
        (item.hook_analysis || '').trim() ||
        (item.psychology_analysis || '').trim() ||
        (item.ai_feedback || '').trim(),
    ),
    analysisStageMetrics:
      item.analysis_stage_metrics && typeof item.analysis_stage_metrics === 'object'
        ? item.analysis_stage_metrics
        : {},
    transcriptQuality:
      item.transcript_quality && typeof item.transcript_quality === 'object'
        ? item.transcript_quality
        : {},
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

export async function generateScriptFeedback({
  accountId,
  referenceId,
  scriptId,
  currentVersionId,
  selectedLabel,
  sections,
}) {
  const response = await apiFetch('/api/scripts/feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      accountId,
      referenceId,
      scriptId,
      currentDraftId: scriptId,
      currentVersionId,
      scriptVersionId: currentVersionId,
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

export async function applyScriptFeedback({
  accountId,
  referenceId,
  scriptId,
  currentVersionId,
  selectedLabel,
  sections,
  feedback,
  editTarget,
  copilotMemory,
}) {
  const response = await apiFetch('/api/scripts/feedback/apply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      accountId,
      referenceId,
      scriptId,
      currentDraftId: scriptId,
      currentVersionId,
      scriptVersionId: currentVersionId,
      selectedLabel,
      sections,
      feedback,
      editTarget,
      copilotMemory,
    }),
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '피드백 반영 수정본 생성에 실패했습니다.')
  }

  const appliedSections = payload.sections || payload.proposedSections || {
    hook: payload.hook || '',
    body: payload.body || '',
    cta: payload.cta || '',
  }

  return {
    sections: appliedSections,
    message: payload.message || '',
    qualityGate: payload.qualityGate || null,
  }
}

export async function generateChatReply({
  accountId,
  referenceId,
  scriptId,
  currentVersionId,
  editTarget,
  selectedLabel,
  message,
  editorSections,
  copilotMemory,
}) {
  const response = await apiFetch('/api/scripts/copilot', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      accountId,
      referenceId,
      scriptId,
      currentDraftId: scriptId,
      currentVersionId,
      scriptVersionId: currentVersionId,
      editTarget,
      selectedLabel,
      message,
      sections: editorSections,
      copilotMemory,
    }),
  })
  const payload = await parseApiResponse(response)

  if (!response.ok) {
    throw createApiError(response, payload, '수정 제안 생성에 실패했습니다.')
  }

  return {
    type: payload.type || 'refine',
    mode: payload.mode || payload.type || 'suggestion',
    autoApplied: Boolean(payload.autoApplied),
    canUndo: Boolean(payload.canUndo),
    intent: payload.intent || payload.copilotIntent || null,
    responseMode: payload.responseMode || payload.intent?.responseMode || null,
    message: payload.message,
    proposedSections: payload.proposedSections || payload.sections,
    feedback: payload.feedback,
    structureDiagnosis: payload.structureDiagnosis || payload.feedback?.structureDiagnosis || null,
    editTarget: payload.editTarget,
    changedSections: payload.changedSections,
    diff: payload.diff || null,
    flowValidation: payload.flowValidation,
  }
}
