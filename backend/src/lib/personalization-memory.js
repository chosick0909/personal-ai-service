import { getAccountProfile } from './account-profile.js'
import { AppError } from './errors.js'
import { getOpenAIClient, getOpenAIModels, hasOpenAIConfig } from './openai.js'
import { getSupabaseAdmin, hasSupabaseAdminConfig } from './supabase.js'

const MAX_RECENT_MESSAGES = 12
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

function formatMemoryRows(rows = []) {
  return rows.map((row) => `- (${row.type}) ${row.value}`).join('\n')
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

  return events
}

async function extractLlmPreferences({ userInput, assistantOutput }) {
  const signalRegex = /(짧게|길게|톤|말투|느낌|별로|싫|좋아|원해|해줘|세련|촌|부드럽|강하게|정리해서)/i
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
          '너는 사용자 선호 추출기다. 사용자 발화에서 선호/비선호를 JSON으로만 뽑아라. 최대 4개. 형식: {"preferences":[{"scope":"global|character|session","type":"tone|style|dislike|preference|goal","value":"...","confidence":0.0}]}',
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
      type: String(item?.type || 'preference').slice(0, 50),
      value: String(item?.value || '').trim(),
      confidence: Number(item?.confidence || 0.75),
    }))
    .filter((item) => item.value)
    .slice(0, 4)
}

export async function buildPersonalizationContext({
  accountId,
  sessionId,
  fallbackSession = 'default',
}) {
  const supabaseAdmin = requireSupabaseAdmin()
  const normalizedSessionId = normalizeSessionId(sessionId, fallbackSession, accountId)

  const profile = await getAccountProfile(accountId)

  let globalRows = []
  let characterRows = []
  let sessionRow = null

  try {
    const [globalRes, characterRes, sessionRes] = await Promise.all([
      supabaseAdmin
        .from('memory_events')
        .select('type, value, confidence, last_seen')
        .eq('account_id', accountId)
        .eq('scope', 'global')
        .order('last_seen', { ascending: false })
        .limit(12),
      supabaseAdmin
        .from('memory_events')
        .select('type, value, confidence, last_seen')
        .eq('account_id', accountId)
        .eq('scope', 'character')
        .order('last_seen', { ascending: false })
        .limit(12),
      supabaseAdmin
        .from('session_memory')
        .select('summary, recent_messages')
        .eq('account_id', accountId)
        .eq('session_id', normalizedSessionId)
        .maybeSingle(),
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

    globalRows = globalRes.data || []
    characterRows = characterRes.data || []
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
    '- 이 컨텍스트는 현재 선택된 캐릭터 계정 전용이다.',
    '- 다른 캐릭터/다른 계정의 카테고리, 상품, 톤, 말투, 메모리가 섞이면 안 된다.',
    '- 메모리와 세팅이 충돌하면 HARD_RULES와 현재 캐릭터 설정을 최우선으로 따른다.',
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
      hardRulesCount: hardRules.length,
      globalCount: globalRows.length,
      characterCount: characterRows.length,
      sessionSummary: sessionSummary || '',
    },
  }
}

export async function updatePersonalizationMemory({
  accountId,
  sessionId,
  userInput,
  assistantOutput,
  fallbackSession = 'default',
}) {
  const supabaseAdmin = requireSupabaseAdmin()
  const normalizedSessionId = normalizeSessionId(sessionId, fallbackSession, accountId)
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
        scope: item.scope,
        session_id: item.scope === 'session' ? normalizedSessionId : '',
        type: item.type,
        value: item.value,
        confidence: Math.min(Math.max(Number(item.confidence || 0.7), 0.1), 1),
        last_seen: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }))

      const { error } = await supabaseAdmin
        .from('memory_events')
        .upsert(rows, {
          onConflict: 'account_id,scope,session_id,type,value',
        })

      if (error) {
        if (isMissingTableError(error)) {
          persisted = false
        } else {
          throw error
        }
      }
    }

    const { data: currentSession, error: fetchSessionError } = await supabaseAdmin
      .from('session_memory')
      .select('summary, recent_messages')
      .eq('account_id', accountId)
      .eq('session_id', normalizedSessionId)
      .maybeSingle()

    if (fetchSessionError) {
      if (isMissingTableError(fetchSessionError)) {
        persisted = false
      } else {
        throw fetchSessionError
      }
    }

    const previousMessages = Array.isArray(currentSession?.recent_messages)
      ? currentSession.recent_messages
      : []
    const nextMessages = [
      ...previousMessages.filter((message) => message?.role === 'user'),
      { role: 'user', content: String(userInput || '').slice(0, 1200), at: new Date().toISOString() },
    ].slice(-MAX_RECENT_MESSAGES)

    const summary = summarizeRecentMessages(nextMessages)
    const { error: saveSessionError } = await supabaseAdmin
      .from('session_memory')
      .upsert(
        {
          account_id: accountId,
          session_id: normalizedSessionId,
          summary,
          recent_messages: nextMessages,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id,session_id' },
      )

    if (saveSessionError) {
      if (isMissingTableError(saveSessionError)) {
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
