import { getSupabaseAdmin, hasSupabaseAdminConfig } from './supabase.js'

const COPILOT_EVENT_TYPES = new Set([
  'suggestion_created',
  'suggestion_applied',
  'feedback_created',
  'feedback_applied',
  'reply_only',
  'failed',
])

const SECTION_KEYS = ['hook', 'body', 'cta']

function readString(value, maxLength = 1000) {
  const normalized = String(value || '').trim()
  if (!normalized) return null
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized
}

function readUuidLike(value) {
  const normalized = String(value || '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null
}

function readLatency(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null
}

function sanitizeChangedSections(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((item) => SECTION_KEYS.includes(item))
    .filter((item, index, list) => list.indexOf(item) === index)
}

function compactJson(value, depth = 0) {
  if (depth > 4) return '[TRUNCATED]'
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    return value.length > 1200 ? `${value.slice(0, 1200)}…` : value
  }
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => compactJson(item, depth + 1))

  const output = {}
  for (const [key, item] of Object.entries(value)) {
    output[key] = compactJson(item, depth + 1)
  }
  return output
}

export function buildEditPlanSummary(editPlan = {}) {
  if (!editPlan || typeof editPlan !== 'object') return {}

  return compactJson({
    operationType: editPlan.operationType || null,
    qaMode: editPlan.qaMode || null,
    strategy: editPlan.strategy || null,
    editTarget: editPlan.editTarget || null,
    targetSections: Array.isArray(editPlan.targetSections) ? editPlan.targetSections : [],
    preserveSections: Array.isArray(editPlan.preserveSections) ? editPlan.preserveSections : [],
    newSubject: editPlan.newSubject || null,
    requestedMaterials: Array.isArray(editPlan.requestedMaterials)
      ? editPlan.requestedMaterials
      : [],
    targetDurationSeconds: editPlan.targetDurationSeconds || null,
    targetCharRange: editPlan.targetCharRange || null,
    mustKeep: Array.isArray(editPlan.mustKeep) ? editPlan.mustKeep.slice(0, 12) : [],
    mustChange: Array.isArray(editPlan.mustChange) ? editPlan.mustChange.slice(0, 12) : [],
    mustAvoid: Array.isArray(editPlan.mustAvoid) ? editPlan.mustAvoid.slice(0, 12) : [],
  })
}

export function normalizeCopilotQualityEvent(payload = {}) {
  const eventType = COPILOT_EVENT_TYPES.has(payload.eventType)
    ? payload.eventType
    : 'failed'

  return {
    account_id: readUuidLike(payload.accountId),
    user_id: readUuidLike(payload.userId),
    reference_id: readUuidLike(payload.referenceId),
    script_id: readUuidLike(payload.scriptId),
    script_version_id: readUuidLike(payload.scriptVersionId),
    session_id: readString(payload.sessionId, 300),
    event_type: eventType,
    user_request: readString(payload.userRequest, 3000),
    intent: readString(payload.intent, 120),
    operation_type: readString(payload.operationType, 120),
    edit_target: readString(payload.editTarget, 80),
    changed_sections: sanitizeChangedSections(payload.changedSections),
    quality_gate: compactJson(payload.qualityGate || {}),
    edit_plan_summary: buildEditPlanSummary(payload.editPlan || payload.editPlanSummary || {}),
    latency_ms: readLatency(payload.latencyMs ?? payload.latency_ms),
    error_code: readString(payload.errorCode, 120),
    metadata: compactJson(payload.metadata || {}),
  }
}

export async function recordCopilotQualityEvent(payload = {}) {
  if (!hasSupabaseAdminConfig()) return null

  const row = normalizeCopilotQualityEvent(payload)
  const { error } = await getSupabaseAdmin()
    .from('copilot_quality_events')
    .insert(row)

  if (error) {
    console.warn('[copilot-quality-log-failed]', {
      eventType: row.event_type,
      code: error.code,
      message: error.message,
    })
    return null
  }

  return row
}

export function recordCopilotQualityEventSafe(payload = {}) {
  void recordCopilotQualityEvent(payload).catch((error) => {
    console.warn('[copilot-quality-log-failed]', {
      eventType: payload?.eventType || '',
      message: error?.message || String(error),
    })
  })
}

export async function recordAIUsageLog(payload = {}) {
  if (!hasSupabaseAdminConfig()) return null

  const row = {
    account_id: readUuidLike(payload.accountId),
    user_id: readUuidLike(payload.userId),
    reference_id: readUuidLike(payload.referenceId),
    session_id: readString(payload.sessionId, 300),
    operation: readString(payload.operation, 160) || 'unknown',
    model: readString(payload.model, 160),
    prompt_tokens: Math.max(0, Math.round(Number(payload.promptTokens || 0))),
    completion_tokens: Math.max(0, Math.round(Number(payload.completionTokens || 0))),
    total_tokens: Math.max(0, Math.round(Number(payload.totalTokens || 0))),
    estimated_cost_usd: Number.isFinite(payload.estimatedCostUsd)
      ? payload.estimatedCostUsd
      : null,
    latency_ms: readLatency(payload.latencyMs ?? payload.latency_ms),
    metadata: compactJson(payload.metadata || {}),
  }

  const { error } = await getSupabaseAdmin()
    .from('ai_usage_logs')
    .insert(row)

  if (error) {
    console.warn('[ai-usage-db-log-failed]', {
      operation: row.operation,
      model: row.model,
      code: error.code,
      message: error.message,
    })
    return null
  }

  return row
}

export function recordAIUsageLogSafe(payload = {}) {
  void recordAIUsageLog(payload).catch((error) => {
    console.warn('[ai-usage-db-log-failed]', {
      operation: payload?.operation || '',
      message: error?.message || String(error),
    })
  })
}
