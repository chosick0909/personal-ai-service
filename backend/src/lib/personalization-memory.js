import { getAccountProfile } from './account-profile.js'
import { AppError } from './errors.js'
import { getOpenAIClient, getOpenAIModels, hasOpenAIConfig } from './openai.js'
import { getSupabaseAdmin, hasSupabaseAdminConfig } from './supabase.js'

const MAX_RECENT_MESSAGES = 12
const MAX_MEMORY_FETCH_ROWS = 24
const MAX_PROMPT_MEMORY_ROWS = 5
const MEMORY_SELECT_COLUMNS = 'type, value, confidence, last_seen, weight, source, hits, metadata'
const LEGACY_MEMORY_SELECT_COLUMNS = 'type, value, confidence, last_seen'
const MEMORY_TYPES_BY_MODE = {
  question: new Set(['tone', 'style', 'dislike', 'preference', 'goal', 'target', 'product', 'feedback', 'selection']),
  suggestion: new Set([
    'tone',
    'style',
    'dislike',
    'preference',
    'goal',
    'hook',
    'body',
    'cta',
    'edit_pattern',
    'selection',
  ]),
  feedback: new Set([
    'tone',
    'style',
    'dislike',
    'preference',
    'goal',
    'hook',
    'body',
    'cta',
    'edit_pattern',
    'feedback',
    'selection',
  ]),
  ask: new Set(['tone', 'style', 'dislike', 'preference', 'goal', 'target', 'product']),
  default: new Set([
    'tone',
    'style',
    'dislike',
    'preference',
    'goal',
    'target',
    'product',
    'hook',
    'body',
    'cta',
    'edit_pattern',
    'feedback',
    'selection',
  ]),
}
const MEMORY_SOURCE_WEIGHT_DELTA = {
  applied_edit: 2,
  feedback_apply: 2,
  selected_script: 2,
  explicit_preference: 2,
  copilot_suggestion: 1,
  feedback_request: 1,
  question: 1,
  ask: 1,
  chat: 1,
  undo: -2,
}
const VOICE_TONE_LABELS = {
  expert: '전문가형',
  friendly: '친근한 언니형',
  coach: '코치형',
  storyteller: '스토리텔러형',
  trendy: '트렌디한 MZ 톤',
}

function isMissingTableError(error) {
  if (!error) {
    return false
  }

  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    String(error.message || '').includes('does not exist')
  )
}

function requireSupabaseAdmin() {
  if (!hasSupabaseAdminConfig()) {
    throw new AppError('Supabase admin client is not configured', {
      code: 'SUPABASE_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  return getSupabaseAdmin()
}

function normalizeSessionId(sessionId, fallback, accountId = '') {
  const value = String(sessionId || '').trim()
  const normalizedAccountId = String(accountId || '').trim()
  const raw = value || fallback
  if (!normalizedAccountId) {
    return raw
  }
  const accountPrefix = `account:${normalizedAccountId}:`
  return raw.startsWith(accountPrefix) ? raw : `${accountPrefix}${raw}`
}

function normalizeMemoryMode(mode = 'default') {
  const value = String(mode || '').trim().toLowerCase()
  if (value === 'reply') return 'question'
  if (value === 'refine' || value === 'edit') return 'suggestion'
  if (MEMORY_TYPES_BY_MODE[value]) return value
  return 'default'
}

function normalizeMemoryType(type = 'preference') {
  const value = String(type || 'preference').trim().toLowerCase()
  return MEMORY_TYPES_BY_MODE.default.has(value) ? value : 'preference'
}

function clampNumber(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return min
  }
  return Math.min(Math.max(number, min), max)
}

function normalizeMemoryRow(row = {}) {
  return {
    type: normalizeMemoryType(row.type),
    value: String(row.value || '').trim(),
    confidence: clampNumber(row.confidence ?? 0.7, 0.1, 1),
    last_seen: row.last_seen || null,
    weight: clampNumber(row.weight ?? 1, 0, 10),
    source: String(row.source || 'legacy').trim() || 'legacy',
    hits: clampNumber(row.hits ?? 1, 1, 999),
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
  }
}

function formatMemoryRows(rows = []) {
  return rows
    .map((row) => {
      const normalized = normalizeMemoryRow(row)
      return `- (${normalized.type}) ${normalized.value}`
    })
    .join('\n')
}

function tokenizeForMemoryQuery(value = '') {
  return Array.from(
    new Set(
      String(value || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
        .slice(0, 20),
    ),
  )
}

function scoreMemoryRow(row = {}, { mode = 'default', query = '' } = {}) {
  const normalized = normalizeMemoryRow(row)
  const allowedTypes = MEMORY_TYPES_BY_MODE[normalizeMemoryMode(mode)] || MEMORY_TYPES_BY_MODE.default
  if (!normalized.value || normalized.weight <= 0 || !allowedTypes.has(normalized.type)) {
    return -1
  }

  const queryTokens = tokenizeForMemoryQuery(query)
  const memoryText = `${normalized.type} ${normalized.value}`.toLowerCase()
  const overlap = queryTokens.reduce(
    (count, token) => count + (memoryText.includes(token) ? 1 : 0),
    0,
  )
  const lastSeenMs = normalized.last_seen ? new Date(normalized.last_seen).getTime() : 0
  const recency = Number.isFinite(lastSeenMs) && lastSeenMs > 0 ? Math.min(Date.now() - lastSeenMs, 1000 * 60 * 60 * 24 * 90) : 0
  const recencyScore = recency ? 1 - recency / (1000 * 60 * 60 * 24 * 90) : 0

  return normalized.weight * 4 + normalized.confidence * 2 + Math.min(normalized.hits, 5) * 0.4 + overlap * 1.2 + recencyScore
}

function filterMemoryRows(rows = [], { mode = 'default', query = '', limit = MAX_PROMPT_MEMORY_ROWS } = {}) {
  const deduped = new Map()

  rows.map(normalizeMemoryRow).forEach((row) => {
    if (!row.value) {
      return
    }
    const key = `${row.type}:${row.value}`
    const existing = deduped.get(key)
    if (!existing || scoreMemoryRow(row, { mode, query }) > scoreMemoryRow(existing, { mode, query })) {
      deduped.set(key, row)
    }
  })

  return Array.from(deduped.values())
    .map((row) => ({
      row,
      score: scoreMemoryRow(row, { mode, query }),
    }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.row)
    .slice(0, limit)
}

function isMissingColumnError(error) {
  if (!error) {
    return false
  }

  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    String(error.message || '').includes('column') ||
    String(error.message || '').includes('schema cache')
  )
}

function summarizeRecentMessages(recentMessages = []) {
  const userMessages = recentMessages
    .filter((message) => message.role === 'user')
    .slice(-5)
    .map((message, index) => `${index + 1}. ${String(message.content || '').slice(0, 220)}`)

  if (!userMessages.length) {
    return ''
  }

  return ['최근 사용자 요청 요약', ...userMessages].join('\n')
}

function stripDraftLikeContent(value = '') {
  return String(value || '')
    .replace(/HOOK\s*:[\s\S]*?(?=\n\s*BODY\s*:|$)/gi, '')
    .replace(/BODY\s*:[\s\S]*?(?=\n\s*CTA\s*:|$)/gi, '')
    .replace(/CTA\s*:[\s\S]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
}

function extractQuickPreferences(input = '') {
  const text = String(input || '')
  const lowered = text.toLowerCase()
  const events = []

  if (text.includes('짧게') || text.includes('짧은')) {
    events.push({ scope: 'global', type: 'style', value: '짧은 답변 선호', confidence: 0.82 })
  }

  if (text.includes('길게') || text.includes('자세히')) {
    events.push({ scope: 'global', type: 'style', value: '자세한 설명 선호', confidence: 0.82 })
  }

  if (text.includes('촌') || lowered.includes('cringe')) {
    events.push({ scope: 'global', type: 'dislike', value: '촌스러운 표현 비선호', confidence: 0.88 })
  }

  if (text.includes('세련')) {
    events.push({ scope: 'global', type: 'style', value: '세련된 톤 선호', confidence: 0.86 })
  }

  if (text.includes('친근')) {
    events.push({ scope: 'character', type: 'tone', value: '친근한 대화체 선호', confidence: 0.8 })
  }

  if (text.includes('전문') || text.includes('논리')) {
    events.push({ scope: 'character', type: 'tone', value: '전문적이고 구조적인 답변 선호', confidence: 0.8 })
  }

  if (/(훅|hook|후킹)/i.test(text) && /(짧|직설|강하게|세게|바로|첫\s*문장)/i.test(text)) {
    events.push({ scope: 'character', type: 'hook', value: '훅은 짧고 직설적으로 바로 문제를 찌르는 방향 선호', confidence: 0.88 })
  }

  if (/(cta|씨티에이|행동\s*유도|마무리)/i.test(text) && /(dm|디엠|댓글|상담|문의|저장|구매)/i.test(text)) {
    events.push({ scope: 'character', type: 'cta', value: 'CTA는 사용자가 원하는 행동으로 바로 이어지게 구체적으로 쓰는 방향 선호', confidence: 0.84 })
  }

  if (/합니다\s*말투|하십시오|보고서체|딱딱한\s*말투/i.test(text) && /(싫|별로|빼|하지\s*마|없애)/i.test(text)) {
    events.push({ scope: 'character', type: 'dislike', value: '딱딱한 보고서체와 과한 합니다체 비선호', confidence: 0.9 })
  }

  if (/(레퍼런스|구조|흐름|문장\s*수|길이)/i.test(text) && /(유지|맞춰|비슷|따라|살려)/i.test(text)) {
    events.push({ scope: 'character', type: 'edit_pattern', value: '수정할 때 레퍼런스 구조와 길이감을 유지하는 방향 선호', confidence: 0.9 })
  }

  return events
}

async function extractLlmPreferences({ userInput, assistantOutput }) {
  const signalRegex = /(짧게|길게|톤|말투|느낌|별로|싫|좋아|원해|해줘|세련|촌|부드럽|강하게|정리해서|훅|cta|구조|레퍼런스|길이|반복|고쳐|수정)/i
  if (!signalRegex.test(String(userInput || ''))) {
    return []
  }

  if (!hasOpenAIConfig()) {
    return []
  }

  const openai = getOpenAIClient()
  const { chatModel } = getOpenAIModels()

  const response = await openai.chat.completions.create({
    model: chatModel,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          [
            '너는 사용자 선호 추출기다. 사용자 발화에서 장기적으로 재사용 가능한 선호/비선호만 JSON으로 뽑아라. 최대 4개.',
            '단발 질문, 욕설/감정 표현, 초안 원문, 레퍼런스 원문 내용, 개인정보, 상품 상세 문구 자체는 저장하지 않는다.',
            '허용 type: tone, style, dislike, preference, goal, hook, body, cta, edit_pattern, selection, feedback, product, target',
            '형식: {"preferences":[{"scope":"global|character|session","type":"tone|style|dislike|preference|goal|hook|body|cta|edit_pattern|selection|feedback|product|target","value":"...","confidence":0.0}]}',
          ].join('\n'),
      },
      {
        role: 'user',
        content: `USER:\n${userInput || ''}\n\nASSISTANT_SUMMARY_WITHOUT_DRAFT:\n${stripDraftLikeContent(assistantOutput)}`,
      },
    ],
  })

  const raw = response.choices[0]?.message?.content || '{}'
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (_error) {
    return []
  }

  const preferences = Array.isArray(parsed?.preferences) ? parsed.preferences : []
  return preferences
    .map((item) => ({
      scope: item?.scope === 'session' || item?.scope === 'character' ? item.scope : 'global',
      type: normalizeMemoryType(item?.type),
      value: String(item?.value || '').trim(),
      confidence: Number(item?.confidence || 0.75),
    }))
    .filter((item) => item.value)
    .slice(0, 4)
}

function addCharacterMemoryFilter(query, { scope, characterId } = {}) {
  const normalizedCharacterId = String(characterId || '').trim()

  if (scope === 'global') {
    return query.is('character_id', null)
  }

  return normalizedCharacterId ? query.eq('character_id', normalizedCharacterId) : query
}

function addSessionCharacterFilter(query, { characterId } = {}) {
  const normalizedCharacterId = String(characterId || '').trim()

  return normalizedCharacterId ? query.eq('character_id', normalizedCharacterId) : query
}

async function fetchMemoryRows(supabaseAdmin, { accountId, scope, characterId }) {
  const baseQuery = () =>
    addCharacterMemoryFilter(
      supabaseAdmin
        .from('memory_events')
        .select(MEMORY_SELECT_COLUMNS)
        .eq('account_id', accountId)
        .eq('scope', scope),
      { scope, characterId },
    )
      .order('weight', { ascending: false })
      .order('last_seen', { ascending: false })
      .limit(MAX_MEMORY_FETCH_ROWS)

  const result = await baseQuery()
  if (!result.error) {
    return result
  }

  if (!isMissingColumnError(result.error)) {
    return result
  }

  return supabaseAdmin
    .from('memory_events')
    .select(LEGACY_MEMORY_SELECT_COLUMNS)
    .eq('account_id', accountId)
    .eq('scope', scope)
    .order('last_seen', { ascending: false })
    .limit(MAX_MEMORY_FETCH_ROWS)
}

async function fetchSessionMemoryRow(supabaseAdmin, { accountId, characterId, sessionId }) {
  const result = await addSessionCharacterFilter(
    supabaseAdmin
      .from('session_memory')
      .select('id, summary, recent_messages')
      .eq('account_id', accountId)
      .eq('session_id', sessionId),
    { characterId },
  ).maybeSingle()

  if (!result.error || !isMissingColumnError(result.error)) {
    return result
  }

  return supabaseAdmin
    .from('session_memory')
    .select('id, summary, recent_messages')
    .eq('account_id', accountId)
    .eq('session_id', sessionId)
    .maybeSingle()
}

async function saveSessionMemoryRow(
  supabaseAdmin,
  { accountId, characterId, sessionId, summary, recentMessages },
) {
  const now = new Date().toISOString()
  const current = await fetchSessionMemoryRow(supabaseAdmin, { accountId, characterId, sessionId })

  if (current.error) {
    return current
  }

  if (current.data?.id) {
    const result = await supabaseAdmin
      .from('session_memory')
      .update({
        summary,
        recent_messages: recentMessages,
        updated_at: now,
      })
      .eq('id', current.data.id)

    return result
  }

  const payload = {
    account_id: accountId,
    character_id: String(characterId || '').trim() || null,
    session_id: sessionId,
    summary,
    recent_messages: recentMessages,
    updated_at: now,
  }

  const result = await supabaseAdmin.from('session_memory').insert(payload)
  if (!result.error || !isMissingColumnError(result.error)) {
    return result
  }

  const legacyPayload = {
    account_id: accountId,
    session_id: sessionId,
    summary,
    recent_messages: recentMessages,
    updated_at: now,
  }

  return supabaseAdmin.from('session_memory').upsert(legacyPayload, {
    onConflict: 'account_id,session_id',
  })
}

export async function buildPersonalizationContext({
  accountId,
  characterId,
  sessionId,
  fallbackSession = 'default',
  mode = 'default',
  query = '',
  maxMemoryRows = MAX_PROMPT_MEMORY_ROWS,
}) {
  const supabaseAdmin = requireSupabaseAdmin()
  const normalizedSessionId = normalizeSessionId(sessionId, fallbackSession, accountId)
  const normalizedCharacterId = String(characterId || '').trim()
  const memoryMode = normalizeMemoryMode(mode)

  const profile = await getAccountProfile(accountId)

  let globalRows = []
  let characterRows = []
  let sessionRow = null

  try {
    const [globalRes, characterRes, sessionRes] = await Promise.all([
      fetchMemoryRows(supabaseAdmin, { accountId, scope: 'global', characterId: normalizedCharacterId }),
      fetchMemoryRows(supabaseAdmin, { accountId, scope: 'character', characterId: normalizedCharacterId }),
      fetchSessionMemoryRow(supabaseAdmin, {
        accountId,
        characterId: normalizedCharacterId,
        sessionId: normalizedSessionId,
      }),
    ])

    if (globalRes.error && !isMissingTableError(globalRes.error)) {
      throw globalRes.error
    }
    if (characterRes.error && !isMissingTableError(characterRes.error)) {
      throw characterRes.error
    }
    if (sessionRes.error && !isMissingTableError(sessionRes.error)) {
      throw sessionRes.error
    }

    const filteredGlobalRows = filterMemoryRows(globalRes.data || [], {
      mode: memoryMode,
      query,
      limit: Math.min(maxMemoryRows, 2),
    })
    globalRows = filteredGlobalRows
    characterRows = filterMemoryRows(characterRes.data || [], {
      mode: memoryMode,
      query,
      limit: Math.max(maxMemoryRows - filteredGlobalRows.length, 0),
    })
    sessionRow = sessionRes.data || null
  } catch (_error) {
    // v1: table missing/fetch issue should not block answer generation
  }

  const settings = profile?.settings && typeof profile.settings === 'object' ? profile.settings : {}
  const persona = settings.persona && typeof settings.persona === 'object' ? settings.persona : {}
  const strategyPreferences = Array.isArray(settings.strategyPreferences)
    ? settings.strategyPreferences.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  const products = Array.isArray(settings.products)
    ? settings.products
        .map((item) => ({
          name: String(item?.name || '').trim(),
          price: String(item?.price || '').trim(),
          description: String(item?.description || '').trim(),
          ctaType: String(item?.ctaType || '').trim(),
        }))
        .filter((item) => item.name || item.price || item.description || item.ctaType)
    : []
  const voiceTone = Array.isArray(settings?.voiceTones)
    ? settings.voiceTones
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 2)
        .map((item) => VOICE_TONE_LABELS[item] || item)
        .join(' + ')
    : VOICE_TONE_LABELS[String(settings?.voiceTone || '').trim()] || settings?.voiceTone

  const hardRules = [
    settings?.forbiddenExpressions ? `- 금지 표현: ${settings.forbiddenExpressions}` : null,
    settings?.toneGuide ? `- 톤 가이드: ${settings.toneGuide}` : null,
    settings?.responseGoal ? `- 응답 목표: ${settings.responseGoal}` : null,
    voiceTone ? `- 브랜드 보이스/톤: ${voiceTone}` : null,
    settings?.accountGoal ? `- 운영 목적: ${settings.accountGoal}` : null,
    settings?.category ? `- 계정 카테고리: ${settings.category}` : null,
    settings?.aiAdditionalInfo ? `- AI 추가 정보: ${settings.aiAdditionalInfo}` : null,
    settings?.characterPrompt ? `- 캐릭터 프롬프트: ${settings.characterPrompt}` : null,
  ].filter(Boolean)

  const profileLines = [
    profile?.tone ? `- tone: ${profile.tone}` : null,
    profile?.persona ? `- persona: ${profile.persona}` : null,
    profile?.target_audience ? `- target audience: ${profile.target_audience}` : null,
    profile?.goal ? `- goal: ${profile.goal}` : null,
    profile?.strategy ? `- strategy: ${profile.strategy}` : null,
    settings?.instagramId ? `- instagram id: @${String(settings.instagramId).replace(/^@/, '')}` : null,
    persona?.age ? `- persona age: ${String(persona.age).trim()}` : null,
    persona?.gender && String(persona.gender).trim() !== '선택'
      ? `- persona gender: ${String(persona.gender).trim()}`
      : null,
    persona?.job ? `- persona job: ${String(persona.job).trim()}` : null,
    persona?.interests ? `- persona interests: ${String(persona.interests).trim()}` : null,
    persona?.painPoints ? `- persona pain points: ${String(persona.painPoints).trim()}` : null,
    persona?.desiredChange ? `- persona desired change: ${String(persona.desiredChange).trim()}` : null,
    strategyPreferences.length ? `- strategy preferences: ${strategyPreferences.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const productLines = products.length
    ? products
        .map((item, index) => {
          const parts = [
            item.name ? `name=${item.name}` : null,
            item.price ? `price=${item.price}` : null,
            item.description ? `description=${item.description}` : null,
            item.ctaType ? `cta=${item.ctaType}` : null,
          ]
            .filter(Boolean)
            .join(' | ')
          return `- product ${index + 1}: ${parts}`
        })
        .join('\n')
    : ''

  const sessionSummary =
    sessionRow?.summary?.trim() ||
    summarizeRecentMessages(Array.isArray(sessionRow?.recent_messages) ? sessionRow.recent_messages : [])

  const context = [
    '[CURRENT_CHARACTER_BOUNDARY]',
    `- account_id: ${accountId}`,
    normalizedCharacterId ? `- character_id: ${normalizedCharacterId}` : '- character_id: default account character',
    '- 이 컨텍스트는 현재 선택된 캐릭터 계정 전용이다.',
    '- 다른 캐릭터/다른 계정의 카테고리, 상품, 톤, 말투, 메모리가 섞이면 안 된다.',
    '- 메모리와 세팅이 충돌하면 HARD_RULES와 현재 캐릭터 설정을 최우선으로 따른다.',
    `- 현재 코파일럿 모드: ${memoryMode}. 이 모드에 필요한 메모리만 선별해서 사용한다.`,
    '',
    '[HARD_RULES]',
    hardRules.length ? hardRules.join('\n') : '- 없음',
    '',
    '[GLOBAL_MEMORY]',
    globalRows.length ? formatMemoryRows(globalRows) : '- 없음',
    '',
    '[CHARACTER_MEMORY]',
    [profileLines, productLines || null, characterRows.length ? formatMemoryRows(characterRows) : null]
      .filter(Boolean)
      .join('\n') || '- 없음',
    '',
    '[SESSION_MEMORY]',
    sessionSummary || '- 없음',
  ].join('\n')

  return {
    sessionId: normalizedSessionId,
    context,
    snapshot: {
      mode: memoryMode,
      characterId: normalizedCharacterId || null,
      hardRulesCount: hardRules.length,
      globalCount: globalRows.length,
      characterCount: characterRows.length,
      selectedMemoryCount: globalRows.length + characterRows.length,
      sessionSummary: sessionSummary || '',
    },
  }
}

async function upsertLegacyMemoryEvent(supabaseAdmin, row) {
  return supabaseAdmin
    .from('memory_events')
    .upsert(
      {
        account_id: row.account_id,
        scope: row.scope,
        session_id: row.session_id,
        type: row.type,
        value: row.value,
        confidence: row.confidence,
        last_seen: row.last_seen,
        updated_at: row.updated_at,
      },
      {
        onConflict: 'account_id,scope,session_id,type,value',
      },
    )
}

async function upsertWeightedMemoryEvent(supabaseAdmin, row, weightDelta) {
  const match = await addCharacterMemoryFilter(
    supabaseAdmin
      .from('memory_events')
      .select('id, weight, hits, confidence, metadata')
      .eq('account_id', row.account_id)
      .eq('scope', row.scope)
      .eq('session_id', row.session_id)
      .eq('type', row.type)
      .eq('value', row.value),
    { scope: row.scope, characterId: row.character_id },
  ).maybeSingle()

  if (match.error) {
    if (isMissingColumnError(match.error)) {
      return upsertLegacyMemoryEvent(supabaseAdmin, row)
    }
    return { error: match.error }
  }

  const existing = match.data || null
  const nextWeight = clampNumber((existing?.weight ?? 0) + weightDelta, 0, 10)
  const nextHits = clampNumber((existing?.hits ?? 0) + 1, 1, 999)
  const nextMetadata = {
    ...(existing?.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}),
    ...(row.metadata && typeof row.metadata === 'object' ? row.metadata : {}),
  }

  if (existing?.id) {
    return supabaseAdmin
      .from('memory_events')
      .update({
        confidence: Math.max(Number(existing.confidence || 0.7), row.confidence),
        weight: nextWeight,
        source: row.source,
        hits: nextHits,
        metadata: nextMetadata,
        last_seen: row.last_seen,
        updated_at: row.updated_at,
      })
      .eq('id', existing.id)
  }

  return supabaseAdmin.from('memory_events').insert({
    ...row,
    weight: Math.max(1, nextWeight),
    hits: 1,
    metadata: nextMetadata,
  })
}

export async function updatePersonalizationMemory({
  accountId,
  characterId,
  sessionId,
  userInput,
  assistantOutput,
  fallbackSession = 'default',
  mode = 'default',
  source = 'chat',
  metadata = {},
}) {
  const supabaseAdmin = requireSupabaseAdmin()
  const normalizedSessionId = normalizeSessionId(sessionId, fallbackSession, accountId)
  const normalizedCharacterId = String(characterId || '').trim()
  const normalizedSource = String(source || 'chat').trim() || 'chat'
  const memoryMode = normalizeMemoryMode(mode)
  const sourceWeightDelta = MEMORY_SOURCE_WEIGHT_DELTA[normalizedSource] ?? MEMORY_SOURCE_WEIGHT_DELTA.chat
  let persisted = true

  const quick = extractQuickPreferences(userInput)
  const llm = await extractLlmPreferences({ userInput, assistantOutput }).catch(() => [])
  const merged = [...quick, ...llm]

  const deduped = Array.from(
    merged.reduce((map, item) => {
      const key = `${item.scope}:${item.type}:${item.value}`
      const existing = map.get(key)
      if (!existing || Number(item.confidence || 0) > Number(existing.confidence || 0)) {
        map.set(key, item)
      }
      return map
    }, new Map()).values(),
  )

  try {
    if (deduped.length) {
      const rows = deduped.map((item) => ({
        account_id: accountId,
        character_id: item.scope === 'global' ? null : normalizedCharacterId || null,
        scope: item.scope,
        session_id: item.scope === 'session' ? normalizedSessionId : '',
        type: normalizeMemoryType(item.type),
        value: item.value,
        confidence: Math.min(Math.max(Number(item.confidence || 0.7), 0.1), 1),
        source: normalizedSource,
        metadata: {
          ...metadata,
          mode: memoryMode,
        },
        last_seen: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }))

      let error = null
      for (const row of rows) {
        const result = await upsertWeightedMemoryEvent(supabaseAdmin, row, sourceWeightDelta)
        if (result.error) {
          error = result.error
          break
        }
      }

      if (error) {
        if (isMissingTableError(error)) {
          persisted = false
        } else {
          throw error
        }
      }
    }

    const { data: currentSession, error: fetchSessionError } = await fetchSessionMemoryRow(
      supabaseAdmin,
      {
        accountId,
        characterId: normalizedCharacterId,
        sessionId: normalizedSessionId,
      },
    )

    if (fetchSessionError) {
      if (isMissingTableError(fetchSessionError) || isMissingColumnError(fetchSessionError)) {
        persisted = false
      } else {
        throw fetchSessionError
      }
    }

    const previousMessages = Array.isArray(currentSession?.recent_messages)
      ? currentSession.recent_messages
      : []
    const nextMessages = [
      ...previousMessages.filter((message) => message?.role === 'user' || message?.role === 'assistant'),
      {
        role: 'user',
        mode: memoryMode,
        source: normalizedSource,
        content: String(userInput || '').slice(0, 1200),
        at: new Date().toISOString(),
      },
      assistantOutput
        ? {
            role: 'assistant',
            mode: memoryMode,
            source: normalizedSource,
            content: stripDraftLikeContent(assistantOutput).slice(0, 700),
            at: new Date().toISOString(),
          }
        : null,
    ].filter(Boolean).slice(-MAX_RECENT_MESSAGES)

    const summary = summarizeRecentMessages(nextMessages)
    const { error: saveSessionError } = await saveSessionMemoryRow(supabaseAdmin, {
      accountId,
      characterId: normalizedCharacterId,
      sessionId: normalizedSessionId,
      summary,
      recentMessages: nextMessages,
    })

    if (saveSessionError) {
      if (isMissingTableError(saveSessionError) || isMissingColumnError(saveSessionError)) {
        persisted = false
      } else {
        throw saveSessionError
      }
    }
  } catch (_error) {
    // v1: memory update failure should not block core response
    persisted = false
  }

  return {
    sessionId: normalizedSessionId,
    updatedPreferenceCount: deduped.length,
    persisted,
  }
}
