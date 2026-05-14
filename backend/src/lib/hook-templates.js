import { createEmbeddings } from './embeddings.js'
import { logAIError } from './ai-error-logger.js'
import { hasOpenAIConfig } from './openai.js'
import { getSupabaseAdmin, hasSupabaseAdminConfig } from './supabase.js'

const DEFAULT_MATCH_COUNT = Number.parseInt(process.env.HOOK_TEMPLATE_MATCH_COUNT || '6', 10)
const DEFAULT_BACKFILL_LIMIT = Number.parseInt(process.env.HOOK_TEMPLATE_BACKFILL_LIMIT || '40', 10)

let backfillPromise = null

function normalizeArray(value = [], maxItems = 8) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, maxItems)
}

function isHookTemplateUnavailableError(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || error?.details || error?.hint || '')
  return (
    code === '42P01' ||
    code === '42883' ||
    code === 'PGRST202' ||
    /hook_templates|match_hook_templates|Could not find the function/i.test(message)
  )
}

export function buildHookTemplateEmbeddingText(template = {}) {
  return [
    `title: ${template.title || ''}`,
    `hook_family: ${template.hook_family || template.hookFamily || ''}`,
    `template: ${template.template || ''}`,
    `best_for: ${normalizeArray(template.best_for || template.bestFor, 12).join(', ')}`,
    `emotions: ${normalizeArray(template.emotions, 12).join(', ')}`,
    `rewrite_rule: ${template.rewrite_rule || template.rewriteRule || ''}`,
    `search_text: ${template.search_text || template.searchText || ''}`,
  ]
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => !/:$/.test(part))
    .join('\n')
}

export async function ensureHookTemplateEmbeddings(options = {}) {
  if (!hasSupabaseAdminConfig() || !hasOpenAIConfig()) {
    return { updated: 0, skipped: true, reason: 'missing-config' }
  }

  if (backfillPromise) return backfillPromise

  backfillPromise = (async () => {
    const limit = Math.max(1, Number(options.limit || DEFAULT_BACKFILL_LIMIT) || DEFAULT_BACKFILL_LIMIT)
    const supabaseAdmin = getSupabaseAdmin()

    try {
      const { data, error } = await supabaseAdmin
        .from('hook_templates')
        .select('id, title, hook_family, template, best_for, emotions, rewrite_rule, search_text')
        .eq('is_active', true)
        .is('embedding', null)
        .limit(limit)

      if (error) {
        if (isHookTemplateUnavailableError(error)) {
          return { updated: 0, skipped: true, reason: 'schema-missing' }
        }
        throw error
      }

      const rows = Array.isArray(data) ? data : []
      if (!rows.length) return { updated: 0, skipped: false, reason: 'up-to-date' }

      const embeddingResults = await createEmbeddings(rows.map(buildHookTemplateEmbeddingText), {
        stage: 'hook-template-backfill',
        count: rows.length,
      })

      const updates = rows.map(async (row, index) => {
        const vector = embeddingResults[index]?.vector
        if (!vector) return false
        const { error: updateError } = await supabaseAdmin
          .from('hook_templates')
          .update({ embedding: vector })
          .eq('id', row.id)
        if (updateError) throw updateError
        return true
      })

      const results = await Promise.all(updates)
      return { updated: results.filter(Boolean).length, skipped: false }
    } catch (error) {
      logAIError('hook-template', error, {
        stage: 'embedding-backfill',
      })
      return { updated: 0, skipped: true, reason: 'backfill-failed' }
    } finally {
      backfillPromise = null
    }
  })()

  return backfillPromise
}

export function buildHookTemplateQueryText({
  topic = '',
  target = '',
  category = '',
  purpose = '',
  hookAnalysis = '',
  structureBlueprint = {},
  settingCues = [],
} = {}) {
  return [
    topic ? `사용자 주제: ${topic}` : '',
    target ? `타겟: ${target}` : '',
    category ? `계정 카테고리: ${category}` : '',
    purpose ? `콘텐츠 목적: ${purpose}` : '',
    normalizeArray(settingCues, 6).length ? `계정/상품 신호: ${normalizeArray(settingCues, 6).join(', ')}` : '',
    hookAnalysis ? `레퍼런스 후킹 분석: ${String(hookAnalysis).slice(0, 700)}` : '',
    normalizeArray(structureBlueprint?.hookSentencePattern, 4).length
      ? `레퍼런스 HOOK 문장 구조: ${normalizeArray(structureBlueprint.hookSentencePattern, 4).join(' | ')}`
      : '',
    normalizeArray(structureBlueprint?.hookAdvantagePattern, 4).length
      ? `레퍼런스 HOOK 장점: ${normalizeArray(structureBlueprint.hookAdvantagePattern, 4).join(' | ')}`
      : '',
    normalizeArray(structureBlueprint?.desireTriggers, 5).length
      ? `심리/욕구 트리거: ${normalizeArray(structureBlueprint.desireTriggers, 5).join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function retrieveHookTemplates({
  topic = '',
  target = '',
  category = '',
  purpose = '',
  hookAnalysis = '',
  structureBlueprint = {},
  settingCues = [],
  topK = DEFAULT_MATCH_COUNT,
} = {}) {
  if (!hasSupabaseAdminConfig() || !hasOpenAIConfig()) {
    return { templates: [], skipped: true, reason: 'missing-config' }
  }

  const queryText = buildHookTemplateQueryText({
    topic,
    target,
    category,
    purpose,
    hookAnalysis,
    structureBlueprint,
    settingCues,
  })

  if (!queryText.trim()) {
    return { templates: [], skipped: false, reason: 'empty-query' }
  }

  const backfillResult = await ensureHookTemplateEmbeddings()
  if (backfillResult?.reason === 'schema-missing' || backfillResult?.reason === 'missing-config') {
    return { templates: [], skipped: true, reason: backfillResult.reason }
  }

  try {
    const [embeddingResult] = await createEmbeddings(queryText, {
      stage: 'hook-template-query',
      category,
    })
    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin.rpc('match_hook_templates', {
      query_embedding: embeddingResult.vector,
      match_count: Math.min(Math.max(Number(topK) || DEFAULT_MATCH_COUNT, 1), 8),
    })

    if (error) {
      if (isHookTemplateUnavailableError(error)) {
        return { templates: [], skipped: true, reason: 'schema-missing' }
      }
      throw error
    }

    return {
      templates: Array.isArray(data) ? data : [],
      skipped: false,
    }
  } catch (error) {
    logAIError('hook-template', error, {
      stage: 'retrieval',
      category,
    })
    return { templates: [], skipped: true, reason: 'retrieval-failed' }
  }
}

export function formatHookTemplatesForPrompt(templates = [], maxItems = 6) {
  const rows = Array.isArray(templates) ? templates.slice(0, maxItems) : []
  if (!rows.length) return '- 검색된 hook_template 없음'

  return rows
    .map((item, index) => {
      const emotions = normalizeArray(item.emotions, 5)
      return [
        `${index + 1}. ${item.title || item.hook_code || 'hook_template'}`,
        item.hook_family ? `hook_family: ${item.hook_family}` : null,
        item.rewrite_rule ? `rewrite_rule: ${item.rewrite_rule}` : null,
        emotions.length ? `emotions: ${emotions.join(', ')}` : null,
        item.risk_note ? `risk_note: ${item.risk_note}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')
}
