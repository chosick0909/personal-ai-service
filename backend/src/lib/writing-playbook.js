import { createEmbeddings } from './embeddings.js'
import { logAIError } from './ai-error-logger.js'
import { hasOpenAIConfig } from './openai.js'
import { getSupabaseAdmin, hasSupabaseAdminConfig } from './supabase.js'

const DEFAULT_BACKFILL_LIMIT = Number.parseInt(
  process.env.WRITING_PLAYBOOK_EMBEDDING_BACKFILL_LIMIT || '40',
  10,
)
const DEFAULT_RULE_MATCH_COUNT = Number.parseInt(
  process.env.WRITING_PLAYBOOK_RULE_MATCH_COUNT || '3',
  10,
)
const ENABLE_AUTO_BACKFILL =
  String(process.env.FEATURE_WRITING_PLAYBOOK_AUTO_BACKFILL || 'false') === 'true'
const VALID_STAGES = new Set(['HOOK', 'BODY', 'CTA', 'STYLE', 'VALIDATION'])
const VALID_SENTENCE_ROLES = new Set([
  'HOOK_START',
  'HOOK_EXPAND',
  'BODY_PROBLEM',
  'BODY_CAUSE',
  'BODY_SOLUTION',
  'BODY_PROOF',
  'BODY_TRANSITION',
  'CTA',
  'STYLE',
  'VALIDATION',
])

let backfillPromise = null

function normalizeArray(value = [], maxItems = 8) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, maxItems)
}

function normalizeStage(value = '', fallback = 'BODY') {
  const normalized = String(value || '').trim().toUpperCase()
  return VALID_STAGES.has(normalized) ? normalized : fallback
}

function inferBodyRoleFromPosition(index = 0, total = 1) {
  const safeTotal = Math.max(1, Number(total) || 1)
  const safeIndex = Math.max(0, Number(index) || 0)
  const ratio = safeTotal <= 1 ? 1 : safeIndex / Math.max(1, safeTotal - 1)
  if (ratio <= 0.22) return 'BODY_PROBLEM'
  if (ratio <= 0.42) return 'BODY_CAUSE'
  if (ratio <= 0.68) return 'BODY_SOLUTION'
  if (ratio <= 0.84) return 'BODY_PROOF'
  return 'BODY_TRANSITION'
}

export function normalizeWritingSentenceRole(value = '', context = {}) {
  const normalized = String(value || '').trim().toUpperCase()
  if (VALID_SENTENCE_ROLES.has(normalized)) return normalized

  const section = String(context.section || context.stage || '').trim().toLowerCase()
  const roleText = String(context.role || context.roleText || '').toLowerCase()
  if (section === 'hook') {
    const index = Number(context.sectionIndex ?? context.index ?? 0)
    return index <= 0 ? 'HOOK_START' : 'HOOK_EXPAND'
  }
  if (section === 'cta') return 'CTA'
  if (section === 'style') return 'STYLE'
  if (section === 'validation') return 'VALIDATION'

  if (/(문제|고민|불안|실패|공감|pain|problem|empathy)/i.test(roleText)) {
    return 'BODY_PROBLEM'
  }
  if (/(원인|이유|착각|오해|cause|reason|false)/i.test(roleText)) {
    return 'BODY_CAUSE'
  }
  if (/(해결|방법|기준|원리|solution|mechanism|tip)/i.test(roleText)) {
    return 'BODY_SOLUTION'
  }
  if (/(근거|사례|증거|경험|proof|authority|evidence)/i.test(roleText)) {
    return 'BODY_PROOF'
  }
  if (/(전환|반전|다음|연결|transition|bridge|reframe)/i.test(roleText)) {
    return 'BODY_TRANSITION'
  }

  return inferBodyRoleFromPosition(context.sectionIndex ?? context.index ?? 0, context.sectionTotal ?? context.total ?? 1)
}

export function buildWritingPlaybookRuleEmbeddingText(rule = {}) {
  const parts = [
    `rule_key: ${rule.rule_key || rule.ruleKey || ''}`,
    `stage: ${rule.stage || ''}`,
    `sentence_role: ${rule.sentence_role || rule.sentenceRole || ''}`,
    `role: ${rule.role || ''}`,
    `funnel_stage: ${rule.funnel_stage || rule.funnelStage || ''}`,
    `purpose: ${rule.purpose || ''}`,
    `use_when: ${normalizeArray(rule.use_when || rule.useWhen, 10).join(' | ')}`,
    `do_items: ${normalizeArray(rule.do_items || rule.doItems, 10).join(' | ')}`,
    `dont_items: ${normalizeArray(rule.dont_items || rule.dontItems, 10).join(' | ')}`,
    `rewrite_pattern: ${rule.rewrite_pattern || rule.rewritePattern || ''}`,
    `retrieval_tags: ${normalizeArray(rule.retrieval_tags || rule.retrievalTags, 12).join(', ')}`,
  ]

  return parts
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => !/:$/.test(part))
    .join('\n')
}

function isWritingPlaybookUnavailableError(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || error?.details || error?.hint || '')
  return (
    code === '42P01' ||
    code === '42883' ||
    code === 'PGRST202' ||
    /writing_playbook_rules|match_writing_playbook_rules|Could not find the function/i.test(message)
  )
}

export async function ensureWritingPlaybookRuleEmbeddings(options = {}) {
  if (!hasSupabaseAdminConfig() || !hasOpenAIConfig()) {
    return { updated: 0, skipped: true, reason: 'missing-config' }
  }

  if (backfillPromise) return backfillPromise

  backfillPromise = (async () => {
    const limit = Math.max(1, Number(options.limit || DEFAULT_BACKFILL_LIMIT) || DEFAULT_BACKFILL_LIMIT)
    const supabaseAdmin = getSupabaseAdmin()

    try {
      const { data, error } = await supabaseAdmin
        .from('writing_playbook_rules')
        .select(
          [
            'id',
            'rule_key',
            'stage',
            'sentence_role',
            'role',
            'funnel_stage',
            'purpose',
            'use_when',
            'do_items',
            'dont_items',
            'rewrite_pattern',
            'retrieval_tags',
          ].join(', '),
        )
        .eq('is_active', true)
        .is('embedding', null)
        .limit(limit)

      if (error) {
        if (isWritingPlaybookUnavailableError(error)) {
          return { updated: 0, skipped: true, reason: 'schema-missing' }
        }
        throw error
      }

      const rows = Array.isArray(data) ? data : []
      if (!rows.length) return { updated: 0, skipped: false, reason: 'up-to-date' }

      const embeddingResults = await createEmbeddings(rows.map(buildWritingPlaybookRuleEmbeddingText), {
        stage: 'writing-playbook-backfill',
        count: rows.length,
      })

      const updates = rows.map(async (row, index) => {
        const vector = embeddingResults[index]?.vector
        if (!vector) return false
        const { error: updateError } = await supabaseAdmin
          .from('writing_playbook_rules')
          .update({ embedding: vector })
          .eq('id', row.id)
        if (updateError) throw updateError
        return true
      })

      const results = await Promise.all(updates)
      return { updated: results.filter(Boolean).length, skipped: false }
    } catch (error) {
      logAIError('writing-playbook', error, {
        stage: 'embedding-backfill',
      })
      return { updated: 0, skipped: true, reason: 'backfill-failed' }
    } finally {
      backfillPromise = null
    }
  })()

  return backfillPromise
}

function buildSentenceRuleQuery(sentence = {}, variantLabel = '') {
  return [
    `stage: ${normalizeStage(sentence.stage, 'BODY')}`,
    `sentence_role: ${normalizeWritingSentenceRole(sentence.sentenceRole || sentence.sentence_role, sentence)}`,
    variantLabel ? `variant: ${variantLabel}` : '',
    sentence.role ? `role_hint: ${sentence.role}` : '',
    sentence.text ? `current_sentence: ${String(sentence.text).slice(0, 220)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function retrieveWritingPlaybookRulesForSentences({
  sentences = [],
  variantLabel = '',
  topK = DEFAULT_RULE_MATCH_COUNT,
} = {}) {
  if (!hasSupabaseAdminConfig() || !hasOpenAIConfig()) {
    return { rulesBySentenceId: new Map(), matchedRuleKeys: [], skipped: true, reason: 'missing-config' }
  }

  const normalizedSentences = Array.isArray(sentences)
    ? sentences
        .map((sentence, index) => ({
          ...sentence,
          id: String(sentence?.id || `sentence-${index + 1}`),
          stage: normalizeStage(sentence?.stage, 'BODY'),
          sentenceRole: normalizeWritingSentenceRole(sentence?.sentenceRole || sentence?.sentence_role, {
            ...sentence,
            index,
            total: sentences.length,
          }),
        }))
        .filter((sentence) => sentence.text)
    : []

  if (!normalizedSentences.length) {
    return { rulesBySentenceId: new Map(), matchedRuleKeys: [], skipped: false, reason: 'empty-sentences' }
  }

  if (ENABLE_AUTO_BACKFILL) {
    const backfillResult = await ensureWritingPlaybookRuleEmbeddings()
    if (backfillResult?.reason === 'schema-missing' || backfillResult?.reason === 'missing-config') {
      return {
        rulesBySentenceId: new Map(),
        matchedRuleKeys: [],
        skipped: true,
        reason: backfillResult.reason,
      }
    }
  }

  const supabaseAdmin = getSupabaseAdmin()
  const queryMap = new Map()
  normalizedSentences.forEach((sentence) => {
    const key = `${sentence.stage}:${sentence.sentenceRole}`
    if (!queryMap.has(key)) {
      queryMap.set(key, {
        stage: sentence.stage,
        sentenceRole: sentence.sentenceRole,
        text: buildSentenceRuleQuery(sentence, variantLabel),
      })
    }
  })

  try {
    const queryEntries = Array.from(queryMap.entries())
    const embeddings = await createEmbeddings(
      queryEntries.map(([, query]) => query.text),
      {
        stage: 'writing-playbook-rule-query',
        queryCount: queryEntries.length,
      },
    )

    const rulesByKey = new Map()
    await Promise.all(
      queryEntries.map(async ([key, query], index) => {
        const vector = embeddings[index]?.vector
        if (!vector) return
        const { data, error } = await supabaseAdmin.rpc('match_writing_playbook_rules', {
          query_embedding: vector,
          target_sentence_role: query.sentenceRole,
          target_stage: query.stage,
          target_variant: variantLabel || null,
          match_count: Math.max(1, Number(topK) || DEFAULT_RULE_MATCH_COUNT),
          include_validation: false,
        })
        if (error) {
          if (isWritingPlaybookUnavailableError(error)) return
          throw error
        }
        rulesByKey.set(key, Array.isArray(data) ? data : [])
      }),
    )

    const rulesBySentenceId = new Map()
    const matchedRuleKeys = new Set()
    normalizedSentences.forEach((sentence) => {
      const key = `${sentence.stage}:${sentence.sentenceRole}`
      const rules = rulesByKey.get(key) || []
      rules.forEach((rule) => {
        if (rule?.rule_key) matchedRuleKeys.add(rule.rule_key)
      })
      rulesBySentenceId.set(sentence.id, rules)
    })

    return {
      rulesBySentenceId,
      matchedRuleKeys: Array.from(matchedRuleKeys),
      skipped: false,
    }
  } catch (error) {
    logAIError('writing-playbook', error, {
      stage: 'rule-retrieval',
      variantLabel,
    })
    return { rulesBySentenceId: new Map(), matchedRuleKeys: [], skipped: true, reason: 'retrieval-failed' }
  }
}

export function formatWritingPlaybookRulesForPrompt(rules = []) {
  const safeRules = Array.isArray(rules) ? rules.slice(0, DEFAULT_RULE_MATCH_COUNT) : []
  if (!safeRules.length) return '- 적용할 보정 규칙 없음'

  return safeRules
    .map((rule, index) => {
      const doItems = normalizeArray(rule.do_items || rule.doItems, 4)
      const dontItems = normalizeArray(rule.dont_items || rule.dontItems, 4)
      return [
        `${index + 1}. ${rule.rule_key || 'rule'}`,
        rule.purpose ? `목적: ${rule.purpose}` : null,
        rule.rewrite_pattern ? `패턴: ${rule.rewrite_pattern}` : null,
        doItems.length ? `해야 할 것: ${doItems.join(' / ')}` : null,
        dontItems.length ? `금지: ${dontItems.join(' / ')}` : null,
        rule.structure_risk ? `구조 위험도: ${rule.structure_risk}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')
}
