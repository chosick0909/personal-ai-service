import { createEmbeddings } from './embeddings.js'
import { logAIError } from './ai-error-logger.js'
import { hasOpenAIConfig } from './openai.js'
import { getSupabaseAdmin, hasSupabaseAdminConfig } from './supabase.js'

const DEFAULT_MATCH_COUNT = Number.parseInt(process.env.NARRATIVE_PATTERN_MATCH_COUNT || '2', 10)
const DEFAULT_BACKFILL_LIMIT = Number.parseInt(process.env.NARRATIVE_PATTERN_BACKFILL_LIMIT || '40', 10)

let backfillPromise = null

function normalizeArray(value = [], maxItems = 8) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, maxItems)
}

function isNarrativePatternUnavailableError(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || error?.details || error?.hint || '')
  return (
    code === '42P01' ||
    code === '42883' ||
    code === 'PGRST202' ||
    /narrative_patterns|match_narrative_patterns|Could not find the function/i.test(message)
  )
}

export function buildNarrativePatternEmbeddingText(pattern = {}) {
  return [
    `title: ${pattern.title || ''}`,
    `narrative_family: ${pattern.narrative_family || pattern.narrativeFamily || ''}`,
    `reference_formats: ${normalizeArray(pattern.reference_formats || pattern.referenceFormats, 8).join(', ')}`,
    `emotional_arc: ${pattern.emotional_arc || pattern.emotionalArc || ''}`,
    `use_when: ${normalizeArray(pattern.use_when || pattern.useWhen, 10).join(', ')}`,
    `avoid_when: ${normalizeArray(pattern.avoid_when || pattern.avoidWhen, 10).join(', ')}`,
    `body_flow_rule: ${pattern.body_flow_rule || pattern.bodyFlowRule || ''}`,
    `rewrite_rule: ${pattern.rewrite_rule || pattern.rewriteRule || ''}`,
    `risk_note: ${pattern.risk_note || pattern.riskNote || ''}`,
    `use_intensity: ${pattern.use_intensity || pattern.useIntensity || ''}`,
    `search_text: ${pattern.search_text || pattern.searchText || ''}`,
  ]
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => !/:$/.test(part))
    .join('\n')
}

export async function ensureNarrativePatternEmbeddings(options = {}) {
  if (!hasSupabaseAdminConfig() || !hasOpenAIConfig()) {
    return { updated: 0, skipped: true, reason: 'missing-config' }
  }

  if (backfillPromise) return backfillPromise

  backfillPromise = (async () => {
    const limit = Math.max(1, Number(options.limit || DEFAULT_BACKFILL_LIMIT) || DEFAULT_BACKFILL_LIMIT)
    const supabaseAdmin = getSupabaseAdmin()

    try {
      const { data, error } = await supabaseAdmin
        .from('narrative_patterns')
        .select(
          'id, title, narrative_family, reference_formats, emotional_arc, use_when, avoid_when, body_flow_rule, rewrite_rule, risk_note, use_intensity, search_text',
        )
        .eq('is_active', true)
        .is('embedding', null)
        .limit(limit)

      if (error) {
        if (isNarrativePatternUnavailableError(error)) {
          return { updated: 0, skipped: true, reason: 'schema-missing' }
        }
        throw error
      }

      const rows = Array.isArray(data) ? data : []
      if (!rows.length) return { updated: 0, skipped: false, reason: 'up-to-date' }

      const embeddingResults = await createEmbeddings(rows.map(buildNarrativePatternEmbeddingText), {
        stage: 'narrative-pattern-backfill',
        count: rows.length,
      })

      const updates = rows.map(async (row, index) => {
        const vector = embeddingResults[index]?.vector
        if (!vector) return false
        const { error: updateError } = await supabaseAdmin
          .from('narrative_patterns')
          .update({ embedding: vector })
          .eq('id', row.id)
        if (updateError) throw updateError
        return true
      })

      const results = await Promise.all(updates)
      return { updated: results.filter(Boolean).length, skipped: false }
    } catch (error) {
      logAIError('narrative-pattern', error, {
        stage: 'embedding-backfill',
      })
      return { updated: 0, skipped: true, reason: 'backfill-failed' }
    } finally {
      backfillPromise = null
    }
  })()

  return backfillPromise
}

export function buildNarrativePatternQueryText({
  request = '',
  sections = {},
  reference = {},
  selectedLabel = '',
  settingCues = [],
} = {}) {
  const normalizedSections = {
    hook: String(sections?.hook || '').trim(),
    body: String(sections?.body || '').trim(),
    cta: String(sections?.cta || '').trim(),
  }
  return [
    request ? `사용자 요청: ${request}` : '',
    selectedLabel ? `선택한 안: ${selectedLabel}` : '',
    reference?.topic ? `현재 주제: ${reference.topic}` : '',
    normalizedSections.hook ? `현재 HOOK: ${normalizedSections.hook.slice(0, 220)}` : '',
    normalizedSections.body ? `현재 BODY 요약: ${normalizedSections.body.slice(0, 360)}` : '',
    normalizedSections.cta ? `현재 CTA 요약: ${normalizedSections.cta.slice(0, 180)}` : '',
    reference?.structure_analysis ? `레퍼런스 구조 분석: ${String(reference.structure_analysis).slice(0, 500)}` : '',
    reference?.hook_analysis ? `레퍼런스 훅 분석: ${String(reference.hook_analysis).slice(0, 400)}` : '',
    reference?.psychology_analysis ? `레퍼런스 심리 분석: ${String(reference.psychology_analysis).slice(0, 400)}` : '',
    normalizeArray(settingCues, 6).length ? `추가 신호: ${normalizeArray(settingCues, 6).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function retrieveNarrativePatterns({
  request = '',
  sections = {},
  reference = {},
  selectedLabel = '',
  settingCues = [],
  topK = DEFAULT_MATCH_COUNT,
} = {}) {
  if (!hasSupabaseAdminConfig() || !hasOpenAIConfig()) {
    return { patterns: [], skipped: true, reason: 'missing-config' }
  }

  const queryText = buildNarrativePatternQueryText({
    request,
    sections,
    reference,
    selectedLabel,
    settingCues,
  })

  if (!queryText.trim()) {
    return { patterns: [], skipped: false, reason: 'empty-query' }
  }

  const backfillResult = await ensureNarrativePatternEmbeddings()
  if (backfillResult?.reason === 'schema-missing' || backfillResult?.reason === 'missing-config') {
    return { patterns: [], skipped: true, reason: backfillResult.reason }
  }

  try {
    const [embeddingResult] = await createEmbeddings(queryText, {
      stage: 'narrative-pattern-query',
    })
    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin.rpc('match_narrative_patterns', {
      query_embedding: embeddingResult.vector,
      match_count: Math.min(Math.max(Number(topK) || DEFAULT_MATCH_COUNT, 1), 4),
    })

    if (error) {
      if (isNarrativePatternUnavailableError(error)) {
        return { patterns: [], skipped: true, reason: 'schema-missing' }
      }
      throw error
    }

    return {
      patterns: Array.isArray(data) ? data : [],
      skipped: false,
    }
  } catch (error) {
    logAIError('narrative-pattern', error, {
      stage: 'retrieval',
    })
    return { patterns: [], skipped: true, reason: 'retrieval-failed' }
  }
}

export function formatNarrativePatternsForPrompt(patterns = [], maxItems = 2) {
  const rows = Array.isArray(patterns) ? patterns.slice(0, maxItems) : []
  if (!rows.length) return '- 검색된 narrative_pattern 없음'

  return rows
    .map((item, index) => {
      const avoidWhen = normalizeArray(item.avoid_when, 4)
      return [
        `${index + 1}. ${item.title || item.narrative_code || 'narrative_pattern'}`,
        item.narrative_family ? `narrative_family: ${item.narrative_family}` : null,
        item.emotional_arc ? `emotional_arc: ${item.emotional_arc}` : null,
        item.body_flow_rule ? `body_flow_rule: ${item.body_flow_rule}` : null,
        item.rewrite_rule ? `rewrite_rule: ${item.rewrite_rule}` : null,
        item.use_intensity ? `use_intensity: ${item.use_intensity}` : null,
        avoidWhen.length ? `avoid_when: ${avoidWhen.join(', ')}` : null,
        item.risk_note ? `risk_note: ${item.risk_note}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')
}
