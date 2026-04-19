import { AppError } from './errors.js'
import { buildCacheKey, cacheConfig, getCacheJson, hashText, setCacheJson } from './cache.js'
import { ingestDocument } from './document-ingest.js'
import { chunkText } from './chunking.js'
import { createEmbeddings } from './embeddings.js'
import { logAIError } from './ai-error-logger.js'
import { parseModelJson } from './model-json.js'
import { getOpenAIClient, getOpenAIModels, hasOpenAIConfig } from './openai.js'
import { getSupabaseAdmin, hasSupabaseAdminConfig } from './supabase.js'
import { retrieveGlobalKnowledgeContext } from './global-knowledge.js'
import { normalizeUploadedText } from './text-normalize.js'
import {
  analyzeVideoFrames,
  cleanupVideoWorkspace,
  createVideoWorkspace,
  extractAudioTrack,
  extractFrames,
  getVideoDuration,
  hasAudioStream,
  transcribeVideoAudio,
} from './video-processing.js'

const VARIATION_CONFIGS = [
  {
    label: 'A안',
    angle: '문제 제기형',
    retrievalHint:
      '문제 제기, 손실 회피, 실수 경고, 잘못된 습관 반전, 위험 신호, 즉시 행동 유도',
  },
  {
    label: 'B안',
    angle: '정보 압축형',
    retrievalHint:
      '핵심 요약, 단계별 설명, 프레임워크, 체크리스트, 실행 순서, 빠른 이해',
  },
  {
    label: 'C안',
    angle: '공감 유도형',
    retrievalHint:
      '감정 공감, 실제 경험, 관계 중심 톤, 심리적 저항 완화, 친근한 설득, 참여 유도',
  },
]

const CATEGORY_ANCHOR_TERMS = {
  뷰티: ['피부', '스킨케어', '메이크업', '화장', '제품', '루틴'],
  육아: ['육아', '아이', '부모', '월령', '아기', '양육'],
  반려동물: ['반려동물', '강아지', '고양이', '보호자', '사료', '간식'],
  살림: ['살림', '정리', '수납', '청소', '주방', '생활'],
  자기계발: ['자기계발', '습관', '생산성', '성장', '목표', '실행'],
  패션: ['패션', '코디', '스타일', '의류', '착장', '핏'],
  AI: ['AI', '자동화', '프롬프트', '업무', '툴', '생산성'],
  '전문직(회사홍보)': ['전문성', '상담', '고객', '사례', '브랜딩', '서비스'],
  재테크: ['재테크', '지출', '예산', '투자', '자산', '가계부'],
  여행: ['여행', '일정', '코스', '숙소', '항공', '예산'],
  요리: ['요리', '레시피', '재료', '식단', '조리', '주방'],
  '테크 가젯': ['가젯', '디바이스', '리뷰', '비교', '사용성', '기능'],
  멘탈케어: ['멘탈', '감정', '스트레스', '회복', '루틴', '심리'],
  교육: ['교육', '학습', '강의', '개념', '설명', '이해'],
  기타: [],
}

const OFF_DOMAIN_FORBIDDEN_TERMS = [
  '건축',
  '절벽',
  '공법',
  '토목',
  '구조기술사',
  '시공',
  '아파트',
  '분양',
  '부동산',
]

const IT_STARTUP_TERMS = ['IT', '창업', '스타트업', '부트캠프', 'SaaS', '코딩', '개발자']
const MAX_VARIATION_RETRIES = 2
const VARIATION_CONTEXT_TEXT_MAX = 800
const MAX_PROMPT_FORBIDDEN_TERMS = 8
const MAX_PROMPT_SETTING_CUES = 3

const ACCOUNT_GOAL_LABELS = {
  'personal-influencer': '퍼스널 인플루언싱',
  'brand-marketing': '브랜드 마케팅',
  'education-content': '교육/지식 콘텐츠',
  'consulting-lead': '상담 문의 전환',
  'community-growth': '커뮤니티 성장',
}

const VOICE_TONE_LABELS = {
  expert: '전문가형',
  friendly: '친근한 언니형',
  coach: '코치형',
  storyteller: '스토리텔러형',
  trendy: '트렌디한 MZ 톤',
}

const SETTING_STOPWORDS = new Set([
  '그리고',
  '또는',
  '중심',
  '강조',
  '가능',
  '반드시',
  '항상',
  '절대',
  '위주',
  '기준',
  '구조',
  '설명',
  '답변',
  '콘텐츠',
  '생성',
  '정보',
  '방법',
  '현실적',
  '효율',
])

const ANALYSIS_PROMPT_VERSION = String(process.env.ANALYSIS_PROMPT_VERSION || 'v2').trim() || 'v2'

function cacheLog(stage, details = {}) {
  const safe = Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  )
  console.info(`[reference-video-analysis][cache:${stage}]`, safe)
}

function buildAnalysisReuseCacheKey({
  accountId,
  topic,
  title,
  originalFilename,
  fileBuffer,
  characterSystemPrompt,
}) {
  const fileHash = hashText(fileBuffer || '')
  const promptHash = hashText(characterSystemPrompt || '')
  return buildCacheKey('analysis:reference-video', {
    accountId,
    topic: String(topic || '').trim().toLowerCase(),
    title: String(title || '').trim().toLowerCase(),
    originalFilename: String(originalFilename || '').trim().toLowerCase(),
    fileHash,
    promptVersion: ANALYSIS_PROMPT_VERSION,
    promptHash,
  })
}

function logStage(level, stage, context = {}) {
  const safeContext = Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  )

  console[level](`[reference-video-analysis][${stage}]`, safeContext)
}

function buildFrameSummaryFromNotes(frameNotes = []) {
  return (frameNotes || [])
    .map((frame) =>
      [frame.timestamp != null ? `${frame.timestamp}초` : null, frame.observation, frame.hookReason]
        .filter(Boolean)
        .join(' · '),
    )
    .filter(Boolean)
    .join('\n')
}

function parseMetadata(value) {
  if (!value) {
    return {}
  }

  if (typeof value === 'object') {
    return value
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (_error) {
      return {}
    }
  }

  return {}
}

function pickFirstNonEmpty(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return ''
}

function mapGlobalKnowledgeDebug(items = []) {
  return (items || []).map((item, index) => ({
    id: item.id || item.chunk_id || `global-${index + 1}`,
    rank: index + 1,
    score: Number(item.final_rank || 0),
    category: pickFirstNonEmpty(item.category, item.chunk_category),
    title: (() => {
      const metadata = parseMetadata(item.metadata)
      return (
        pickFirstNonEmpty(
          item.title,
          item.document_title,
          metadata.legacyTitle,
          metadata.title,
          metadata.fileName,
        ) || `문서 ${String(item.document_id || '').slice(0, 8)}`
      )
    })(),
    chunkIndex:
      parseMetadata(item.metadata)?.chunkIndex ??
      parseMetadata(item.metadata)?.chunk_index ??
      item.chunk_index ??
      item.chunkIndex ??
      null,
    content:
      pickFirstNonEmpty(
        item.content,
        item.chunk_content,
        item.text,
        item.body,
      ) || '(청크 본문이 비어 있습니다)',
    documentId: item.document_id || null,
  }))
}

function toBulletCandidates(text = '') {
  return String(text || '')
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•\d.\s]+/, '').trim())
    .filter(Boolean)
    .flatMap((line) => line.split(/(?<=[.!?。！？])\s+/))
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
}

function normalizeStringList(values = [], max = 3) {
  if (!Array.isArray(values)) {
    return []
  }

  const deduped = []
  for (const value of values) {
    const normalized = String(value || '').trim()
    if (!normalized) continue
    if (deduped.includes(normalized)) continue
    deduped.push(normalized)
    if (deduped.length >= max) break
  }
  return deduped
}

function clampText(text = '', maxLength = 800) {
  const normalized = String(text || '').trim()
  if (!normalized) return ''
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

function extractCueKeywords(text = '', max = 4) {
  const tokens = String(text || '')
    .toLowerCase()
    .split(/[\s,./!?|()[\]{}:;"'`~<>+=_*&^%$#@\-–—→\n\r\t]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length >= 2 && token.length <= 18)
    .filter((token) => !SETTING_STOPWORDS.has(token))
    .filter((token) => !/^\d+$/.test(token))

  const deduped = []
  for (const token of tokens) {
    if (deduped.includes(token)) continue
    deduped.push(token)
    if (deduped.length >= max) break
  }
  return deduped
}

function containsTerm(text = '', term = '') {
  const normalizedText = String(text || '').toLowerCase()
  const normalizedTerm = String(term || '').toLowerCase()
  if (!normalizedText || !normalizedTerm) {
    return false
  }
  return normalizedText.includes(normalizedTerm)
}

function normalizeSettingCue(value = '') {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  return trimmed.replace(/\s+/g, ' ')
}

function buildSettingCues(accountSettings = {}) {
  const persona = accountSettings?.persona && typeof accountSettings.persona === 'object'
    ? accountSettings.persona
    : {}
  const characterPrompt = normalizeSettingCue(accountSettings?.characterPrompt)
  const aiAdditionalInfo = normalizeSettingCue(accountSettings?.aiAdditionalInfo)
  const voiceToneRaw = String(accountSettings?.voiceTone || '').trim()
  const voiceToneLabel = normalizeSettingCue(VOICE_TONE_LABELS[voiceToneRaw] || voiceToneRaw)
  const cues = []
  const goal = normalizeSettingCue(
    ACCOUNT_GOAL_LABELS[String(accountSettings?.accountGoal || '').trim()] ||
      accountSettings?.accountGoal,
  )
  if (goal) {
    cues.push(goal)
  }

  const strategy = Array.isArray(accountSettings?.strategyPreferences)
    ? accountSettings.strategyPreferences
    : []
  for (const item of strategy) {
    const normalized = normalizeSettingCue(item)
    if (normalized) cues.push(normalized)
  }

  const products = Array.isArray(accountSettings?.products) ? accountSettings.products : []
  for (const product of products) {
    const name = normalizeSettingCue(product?.name)
    if (name) cues.push(name)
    const description = normalizeSettingCue(product?.description)
    for (const keyword of extractCueKeywords(description, 2)) {
      cues.push(keyword)
    }
  }

  if (voiceToneLabel) {
    cues.push(voiceToneLabel)
  }

  const personaSignals = [
    normalizeSettingCue(persona?.job),
    normalizeSettingCue(persona?.interests),
    normalizeSettingCue(persona?.painPoints),
    normalizeSettingCue(persona?.desiredChange),
  ].filter(Boolean)
  for (const signal of personaSignals) {
    cues.push(signal)
    for (const keyword of extractCueKeywords(signal, 2)) {
      cues.push(keyword)
    }
  }

  const hardCues = []
  for (const keyword of extractCueKeywords(characterPrompt, 3)) {
    hardCues.push(keyword)
    cues.push(keyword)
  }
  for (const keyword of extractCueKeywords(aiAdditionalInfo, 3)) {
    hardCues.push(keyword)
    cues.push(keyword)
  }

  const deduped = []
  for (const cue of cues) {
    if (deduped.includes(cue)) continue
    deduped.push(cue)
    if (deduped.length >= 12) break
  }

  const dedupedHard = []
  for (const cue of hardCues) {
    if (!cue || dedupedHard.includes(cue)) continue
    dedupedHard.push(cue)
    if (dedupedHard.length >= 4) break
  }

  return {
    all: deduped,
    hard: dedupedHard,
  }
}

function normalizeOptionalProjectId(value) {
  if (value === undefined) {
    return undefined
  }

  const normalized = String(value ?? '').trim()
  if (!normalized || normalized === 'null' || normalized === 'undefined') {
    return null
  }

  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      normalized,
    )
  if (!isUuid) {
    throw new AppError('projectId must be a valid UUID', {
      code: 'INVALID_PROJECT_ID',
      statusCode: 400,
    })
  }

  return normalized
}

function isMissingProjectColumnError(error) {
  const code = String(error?.code || '').trim()
  const message = String(error?.message || '').toLowerCase()
  if (code === '42703' && message.includes('project_id')) {
    return true
  }

  // Supabase PostgREST can surface schema cache misses as PGRST errors
  // like: "Could not find the 'project_id' column ... in the schema cache"
  if (message.includes('project_id') && message.includes('schema cache')) {
    return true
  }

  return false
}

function selectReferenceVideoColumns({ includeProjectId = true, detail = false } = {}) {
  const base = detail
    ? 'id, title, topic, original_filename, duration_seconds, transcript, transcript_segments, frame_timestamps, frame_notes, structure_analysis, hook_analysis, psychology_analysis, variations, ai_feedback, document_id, created_at'
    : 'id, title, topic, original_filename, duration_seconds, structure_analysis, hook_analysis, psychology_analysis, variations, ai_feedback, created_at'

  return includeProjectId ? `${base}, project_id` : base
}

function buildGenerationGuides({ analysisResult }) {
  const insights = [
    ...toBulletCandidates(analysisResult?.hookAnalysis || ''),
    ...toBulletCandidates(analysisResult?.psychologyAnalysis || ''),
  ]

  const checkpoints = [
    ...toBulletCandidates(analysisResult?.structureAnalysis || ''),
    ...toBulletCandidates(analysisResult?.aiFeedback || ''),
  ]

  return {
    keyInsights: normalizeStringList(insights, 4),
    checkpoints: normalizeStringList(checkpoints, 4),
  }
}

function normalizeVariationDraft(parsed, fallback, guides = {}) {
  const sections = {
    hook: parsed?.hook?.trim() || '',
    body: parsed?.body?.trim() || '',
    cta: parsed?.cta?.trim() || '',
  }

  const usedInsights = normalizeStringList(
    parsed?.usedInsights,
    3,
  )
  const usedCheckpoints = normalizeStringList(
    parsed?.usedCheckpoints,
    3,
  )

  return {
    label: fallback.label,
    angle: parsed?.angle?.trim() || fallback.angle,
    coreMessage: parsed?.coreMessage?.trim() || '',
    hookIntent: parsed?.hookIntent?.trim() || '',
    bodyLogic: parsed?.bodyLogic?.trim() || '',
    ctaReason: parsed?.ctaReason?.trim() || '',
    hook: sections.hook,
    body: sections.body,
    cta: sections.cta,
    usedInsights: usedInsights.length ? usedInsights : normalizeStringList(guides.keyInsights, 2),
    usedCheckpoints: usedCheckpoints.length
      ? usedCheckpoints
      : normalizeStringList(guides.checkpoints, 2),
    usedChunkIds: [],
    usedKnowledge: [],
  }
}

function normalizeCategoryLabel(value) {
  const raw = String(value || '').trim()
  if (!raw) return '기타'

  if (CATEGORY_ANCHOR_TERMS[raw]) {
    return raw
  }

  const compact = raw.replace(/\s+/g, '').toLowerCase()
  const categoryAliases = [
    { category: '패션', aliases: ['패션', 'fashion', '인플루언서', '패션인플루언서', '스타일'] },
    { category: '뷰티', aliases: ['뷰티', 'beauty', '메이크업', '화장', '스킨케어'] },
    { category: 'AI', aliases: ['ai', 'it', '창업', '스타트업', '개발', '테크'] },
    { category: '육아', aliases: ['육아', '아기', '부모'] },
    { category: '반려동물', aliases: ['반려', '반려동물', '강아지', '고양이', '펫'] },
    { category: '자기계발', aliases: ['자기계발', '생산성', '습관'] },
    { category: '재테크', aliases: ['재테크', '투자', '자산'] },
    { category: '여행', aliases: ['여행', '트립'] },
    { category: '요리', aliases: ['요리', '레시피', '쿠킹'] },
    { category: '교육', aliases: ['교육', '학습', '강의'] },
    { category: '멘탈케어', aliases: ['멘탈', '심리', '감정'] },
    { category: '테크 가젯', aliases: ['가젯', '디바이스', '리뷰'] },
    { category: '살림', aliases: ['살림', '정리', '수납', '청소'] },
    { category: '전문직(회사홍보)', aliases: ['전문직', '회사홍보', '브랜드', '서비스'] },
  ]

  const matched = categoryAliases.find((item) =>
    item.aliases.some((alias) => compact.includes(alias.toLowerCase())),
  )

  return matched?.category || '기타'
}

function extractCategoryFromCharacterPrompt(characterSystemPrompt = '') {
  const source = String(characterSystemPrompt || '')
  if (!source) {
    return ''
  }

  const matched = source.match(/카테고리\s*:\s*([^\n]+)/)
  return matched?.[1]?.trim() || ''
}

function buildCategoryGuard({ accountSettings = {}, characterSystemPrompt = '' } = {}) {
  const rawCategory =
    String(accountSettings?.category || extractCategoryFromCharacterPrompt(characterSystemPrompt) || '').trim()
  const category = normalizeCategoryLabel(rawCategory)
  const anchors = CATEGORY_ANCHOR_TERMS[category] || []
  const instagramId = String(accountSettings?.instagramId || '')
    .trim()
    .replace(/^@/, '')
  const voiceTone = String(accountSettings?.voiceTone || '').trim()
  const strategyPreferences = Array.isArray(accountSettings?.strategyPreferences)
    ? accountSettings.strategyPreferences.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  const accountGoal = String(accountSettings?.accountGoal || '').trim()
  const settingCues = buildSettingCues(accountSettings)
  return {
    category,
    anchors,
    instagramId,
    voiceTone,
    strategyPreferences,
    accountGoal,
    settingCues: settingCues.all,
    hardSettingCues: settingCues.hard,
    rawCategory,
  }
}

function isItStartupDomainAllowed(guard = {}) {
  const normalizedCategory = String(guard?.category || '').trim()
  const rawCategory = String(guard?.rawCategory || '').toLowerCase()
  return normalizedCategory === 'AI' || /it|창업|스타트업|startup|saas|개발/.test(rawCategory)
}

function buildPromptGuardSummary(guard = {}) {
  const forbiddenTerms = buildForbiddenTermsForGuard(guard).slice(0, MAX_PROMPT_FORBIDDEN_TERMS)
  const settingCues = normalizeStringList(guard.settingCues || [], MAX_PROMPT_SETTING_CUES)
  return { forbiddenTerms, settingCues }
}

function buildForbiddenTermsForGuard(guard = {}) {
  const base = [...OFF_DOMAIN_FORBIDDEN_TERMS]

  if (!isItStartupDomainAllowed(guard)) {
    base.push(...IT_STARTUP_TERMS)
  }

  return normalizeStringList(base, 30)
}

function buildFallbackVariation(config, guard = {}, guides = {}) {
  const keyword1 = guard.anchors?.[0] || guard.category || '콘텐츠'
  const keyword2 = guard.anchors?.[1] || guard.anchors?.[0] || '핵심 포인트'
  const forbiddenTerms = buildForbiddenTermsForGuard(guard)
  const safeInsight1 =
    (guides.keyInsights || []).find((item) => !forbiddenTerms.some((term) => containsTerm(item, term))) || ''
  const safeInsight2 =
    (guides.checkpoints || []).find((item) => !forbiddenTerms.some((term) => containsTerm(item, term))) || ''
  const insight1 = safeInsight1 || '첫 문장에서 긴장감을 만듭니다.'
  const insight2 = safeInsight2 || '핵심 포인트를 짧게 압축합니다.'
  const cue = guard.settingCues?.[0] || guard.accountGoal || ''

  return {
    label: config.label,
    angle: config.angle,
    coreMessage: `${keyword1} 콘텐츠를 ${config.angle} 방식으로 전달`,
    hookIntent: '초반 후킹 강화',
    bodyLogic: '문제-해결 흐름',
    ctaReason: '즉시 행동 유도',
    hook: `${keyword1} 하시는 분들, 이 한 가지 놓치면 바로 티 납니다.`,
    body:
      `${keyword1}에서 가장 먼저 봐야 할 건 ${keyword2}입니다. ` +
      `${insight1} ` +
      `${cue ? `${cue} 목적이라면` : '실전이라면'} 지금부터 순서대로 적용해 보세요. ` +
      `${insight2}`,
    cta: `오늘 영상 저장해 두고 ${keyword1} 체크리스트부터 바로 실행해 보세요.`,
    usedInsights: normalizeStringList(guides.keyInsights, 2),
    usedCheckpoints: normalizeStringList(guides.checkpoints, 2),
    usedChunkIds: [],
    usedKnowledge: [],
    alignment: { ok: true, reason: 'fallback-generated' },
  }
}

function normalizeVariationForValidation(rawVariation, index = 0) {
  if (rawVariation && typeof rawVariation === 'object' && !Array.isArray(rawVariation)) {
    return {
      label: String(rawVariation.label || `안${index + 1}`),
      angle: String(rawVariation.angle || ''),
      hook: String(rawVariation.hook || '').trim(),
      body: String(rawVariation.body || '').trim(),
      cta: String(rawVariation.cta || '').trim(),
    }
  }

  const text = String(rawVariation || '').trim()
  if (!text) {
    return { label: `안${index + 1}`, angle: '', hook: '', body: '', cta: '' }
  }

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return {
    label: `안${index + 1}`,
    angle: '',
    hook: lines[0] || '',
    body: lines.slice(1, -1).join(' ') || lines[1] || '',
    cta: lines[lines.length - 1] || '',
  }
}

function validateVariationAlignment(variation, guard) {
  if (!guard?.category || guard.category === '기타') {
    return { ok: true, reason: '카테고리 가드 없음' }
  }

  const text = [variation?.hook, variation?.body, variation?.cta]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('\n')

  if (!text) {
    return { ok: false, reason: '본문이 비어 있음' }
  }

  const anchorHits = (guard.anchors || []).filter((term) => containsTerm(text, term))
  const minAnchorHits = guard.anchors?.length >= 4 ? 2 : 1
  if (guard.anchors?.length && anchorHits.length < minAnchorHits) {
    return {
      ok: false,
      reason: `카테고리(${guard.category}) 핵심 키워드 반영 부족(현재 ${anchorHits.length}개, 최소 ${minAnchorHits}개): ${guard.anchors.slice(0, 4).join(', ')}`,
    }
  }

  const hookText = String(variation?.hook || '').trim()
  const bodyText = String(variation?.body || '').trim()
  if (guard.anchors?.length) {
    const sectionAnchorHit = [hookText, bodyText].some((sectionText) =>
      guard.anchors.some((term) => containsTerm(sectionText, term)),
    )
    if (!sectionAnchorHit) {
      return {
        ok: false,
        reason: `카테고리(${guard.category}) 키워드가 HOOK/BODY 핵심 구간에 없음`,
      }
    }
  }

  const settingCues = Array.isArray(guard.settingCues) ? guard.settingCues : []
  if (settingCues.length) {
    const cueHit = settingCues.some((cue) => containsTerm(text, cue))
    if (!cueHit) {
      return {
        ok: false,
        reason: `계정 설정 신호(목표/전략/상품) 미반영: ${settingCues.slice(0, 3).join(', ')}`,
      }
    }
  }

  // 세팅값 최우선 모드: 카테고리가 정해진 경우 핵심 구간(HOOK/BODY)에도 세팅 신호가 드러나야 통과.
  if (guard.category !== '기타' && settingCues.length) {
    const coreCueHit = settingCues.some(
      (cue) => containsTerm(hookText, cue) || containsTerm(bodyText, cue),
    )
    if (!coreCueHit) {
      return {
        ok: false,
        reason: `세팅 신호가 HOOK/BODY 핵심 구간에 없음: ${settingCues.slice(0, 2).join(', ')}`,
      }
    }
  }

  const hardSettingCues = Array.isArray(guard.hardSettingCues) ? guard.hardSettingCues : []
  if (hardSettingCues.length) {
    const hardCueHit = hardSettingCues.some((cue) => containsTerm(text, cue))
    if (!hardCueHit) {
      return {
        ok: false,
        reason: `핵심 세팅 신호(캐릭터/AI추가정보) 미반영: ${hardSettingCues.slice(0, 2).join(', ')}`,
      }
    }
  }

  const forbiddenHit = OFF_DOMAIN_FORBIDDEN_TERMS.find((term) => containsTerm(text, term))
  if (forbiddenHit && !['전문직(회사홍보)', '기타'].includes(guard.category)) {
    return {
      ok: false,
      reason: `계정 카테고리(${guard.category})와 이질 도메인 키워드 감지: ${forbiddenHit}`,
    }
  }

  if (!isItStartupDomainAllowed(guard)) {
    const itStartupHit = IT_STARTUP_TERMS.find((term) => containsTerm(text, term))
    if (itStartupHit) {
      return {
        ok: false,
        reason: `계정 카테고리(${guard.category})와 충돌하는 IT/창업 키워드 감지: ${itStartupHit}`,
      }
    }
  }

  return { ok: true, reason: '카테고리 정합 통과' }
}

async function runStage(stage, context, task) {
  logStage('info', `${stage}:start`, context)

  try {
    const result = await task()
    logStage('info', `${stage}:success`, context)
    return result
  } catch (error) {
    const details = {
      stage,
      ...context,
      ...(error instanceof AppError && error.details && typeof error.details === 'object'
        ? error.details
        : {}),
    }

    logStage('error', `${stage}:failed`, {
      ...details,
      code: error.code || null,
      message: error.message,
      cause: error.cause?.message || null,
    })

    if (error instanceof AppError) {
      error.details = details
      throw error
    }

    throw new AppError(`Reference video analysis failed at ${stage}`, {
      code: 'REFERENCE_VIDEO_STAGE_FAILED',
      statusCode: 500,
      details,
      cause: error,
    })
  }
}

async function persistReusedReferenceVideo({
  supabaseAdmin,
  accountId,
  projectId,
  title,
  topic,
  originalFilename,
  mimeType,
  cachedAnalysis,
}) {
  const insertPayload = {
    account_id: accountId,
    project_id: projectId || null,
    title,
    topic,
    original_filename: originalFilename,
    mime_type: mimeType || 'video/mp4',
    duration_seconds: cachedAnalysis.duration_seconds ?? null,
    transcript: cachedAnalysis.transcript || '',
    transcript_segments: cachedAnalysis.transcript_segments || [],
    frame_timestamps: cachedAnalysis.frame_timestamps || [],
    frame_notes: cachedAnalysis.frame_notes || [],
    structure_analysis: cachedAnalysis.structure_analysis || '',
    hook_analysis: cachedAnalysis.hook_analysis || '',
    psychology_analysis: cachedAnalysis.psychology_analysis || '',
    variations: cachedAnalysis.variations || [],
    ai_feedback: cachedAnalysis.ai_feedback || '',
    processing_status: 'completed',
    document_id: cachedAnalysis.document_id || null,
  }

  let { data, error } = await supabaseAdmin
    .from('reference_videos')
    .insert(insertPayload)
    .select(selectReferenceVideoColumns({ includeProjectId: true, detail: true }))
    .single()

  if (isMissingProjectColumnError(error)) {
    delete insertPayload.project_id
    const fallback = await supabaseAdmin
      .from('reference_videos')
      .insert(insertPayload)
      .select(selectReferenceVideoColumns({ includeProjectId: false, detail: true }))
      .single()
    data = fallback.data
    error = fallback.error
    if (data) {
      data.project_id = null
    }
  }

  if (error) {
    throw new AppError('Failed to persist reused reference analysis', {
      code: 'REFERENCE_VIDEO_REUSE_PERSIST_FAILED',
      statusCode: 500,
      cause: error,
    })
  }

  return data
}

export async function analyzeReferenceVideo({
  file,
  topic,
  title,
  accountId,
  projectId = null,
  characterSystemPrompt = '',
  accountSettings = {},
}) {
  if (!file) {
    throw new AppError('video file is required', {
      code: 'VIDEO_FILE_REQUIRED',
      statusCode: 400,
    })
  }

  if (!hasSupabaseAdminConfig()) {
    throw new AppError('Supabase admin client is not configured', {
      code: 'SUPABASE_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  if (!hasOpenAIConfig()) {
    throw new AppError('OpenAI API key is not configured', {
      code: 'OPENAI_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  const normalizedOriginalName = normalizeUploadedText(file.originalname)
  const normalizedTitle = title?.trim() || normalizedOriginalName
  const normalizedTopic = topic?.trim() || normalizedTitle || '일반'
  const normalizedProjectId = normalizeOptionalProjectId(projectId) ?? null
  const supabaseAdmin = getSupabaseAdmin()
  const openai = getOpenAIClient()
  const { chatModel } = getOpenAIModels()
  const analysisReuseCacheKey = buildAnalysisReuseCacheKey({
    accountId,
    topic: normalizedTopic,
    title: normalizedTitle,
    originalFilename: normalizedOriginalName,
    fileBuffer: file.buffer,
    characterSystemPrompt,
  })

  if (cacheConfig.enableAnalysisResultReuse) {
    try {
      const cachedAnalysis = await getCacheJson(analysisReuseCacheKey)
      if (cachedAnalysis && typeof cachedAnalysis === 'object') {
        const categoryGuard = buildCategoryGuard({
          accountSettings,
          characterSystemPrompt,
        })
        const cachedVariations = Array.isArray(cachedAnalysis.variations)
          ? cachedAnalysis.variations
          : []
        const cachedValidation = cachedVariations.map((variation, index) =>
          validateVariationAlignment(normalizeVariationForValidation(variation, index), categoryGuard),
        )
        const cacheAlignmentOk =
          !cachedVariations.length || cachedValidation.every((item) => item?.ok === true)

        if (!cacheAlignmentOk) {
          cacheLog('invalidate-misaligned', {
            accountId,
            topic: normalizedTopic,
            title: normalizedTitle,
            reasons: cachedValidation.filter((item) => !item?.ok).map((item) => item.reason).slice(0, 3),
          })
        }

        if (!cacheAlignmentOk) {
          throw new Error('cached variations are misaligned with current category guard')
        }

        cacheLog('hit', {
          accountId,
          topic: normalizedTopic,
          title: normalizedTitle,
        })
        const reused = await persistReusedReferenceVideo({
          supabaseAdmin,
          accountId,
          projectId: normalizedProjectId,
          title: normalizedTitle,
          topic: normalizedTopic,
          originalFilename: normalizedOriginalName,
          mimeType: file.mimetype,
          cachedAnalysis,
        })

        return {
          ...reused,
          global_knowledge_debug: Array.isArray(cachedAnalysis.global_knowledge_debug)
            ? cachedAnalysis.global_knowledge_debug
            : [],
          global_knowledge_categories: Array.isArray(cachedAnalysis.global_knowledge_categories)
            ? cachedAnalysis.global_knowledge_categories
            : [],
        }
      }
    } catch (error) {
      cacheLog('reuse-fallback', {
        reason: error?.message || 'unknown',
      })
    }
    cacheLog('miss', {
      accountId,
      topic: normalizedTopic,
      title: normalizedTitle,
    })
  }

  let workspace

  try {
    const baseContext = {
      title: normalizedTitle,
      topic: normalizedTopic,
      filename: normalizedOriginalName,
      accountId,
    }

    const created = await runStage('workspace', baseContext, async () =>
      createVideoWorkspace(file),
    )
    workspace = created.workspace

    const durationSeconds = await runStage('probe-duration', baseContext, async () =>
      getVideoDuration(created.videoPath),
    )
    const hasAudio = await runStage('probe-audio-stream', baseContext, async () =>
      hasAudioStream(created.videoPath),
    )
    const audioPath = hasAudio
      ? await runStage('extract-audio', baseContext, async () =>
          extractAudioTrack(created.videoPath, workspace),
        )
      : null
    const transcript = hasAudio
      ? await runStage('transcription', baseContext, async () =>
          transcribeVideoAudio(audioPath, {
            title: normalizedTitle,
            topic: normalizedTopic,
          }),
        )
      : {
          text: '',
          segments: [],
          duration: null,
          model: null,
        }
    const frames = await runStage('extract-frames', { ...baseContext, durationSeconds }, async () =>
      extractFrames(created.videoPath, workspace, durationSeconds),
    )
    const frameAnalysis = await runStage('vision', { ...baseContext, frameCount: frames.length }, async () =>
      analyzeVideoFrames(frames, {
        title: normalizedTitle,
        topic: normalizedTopic,
      }),
    )
    const normalizedTranscript = transcript.text?.trim()
    const frameSummary = [
      frameAnalysis.summary?.trim(),
      buildFrameSummaryFromNotes(frameAnalysis.frames || []),
    ]
      .filter(Boolean)
      .join('\n')

    const transcriptDocumentContent =
      normalizedTranscript ||
      `전사 추출 없음\n\n시각 분석 요약:\n${frameSummary || '첫 3초 프레임에서 유효한 음성 전사를 얻지 못했습니다.'}`

    const ingestedDocument = await runStage(
      'ingest-document',
      { ...baseContext, transcriptEmpty: !normalizedTranscript },
      async () =>
        ingestDocument({
          accountId,
          title: normalizedTitle,
          source: 'reference-video-transcript',
          content: transcriptDocumentContent,
          metadata: {
            topic: normalizedTopic,
            originalFilename: normalizedOriginalName,
            transcriptEmpty: !normalizedTranscript,
            hasAudio,
            category: 'reference-video',
          },
        }),
    )

    const globalKnowledge = await runStage(
      'retrieve-global-knowledge',
      baseContext,
      async () =>
        retrieveGlobalKnowledgeContext({
          title: normalizedTitle,
          topic: normalizedTopic,
          transcript: normalizedTranscript || '',
          frameSummary,
          topK: 4,
        }),
    )

    const analysisResponse = await runStage('analysis-gpt', baseContext, async () =>
      openai.chat.completions.create({
        model: chatModel,
        temperature: 0.5,
        messages: [
          {
            role: 'system',
            content: [
              '당신은 숏폼 레퍼런스 영상을 분석하는 한국어 전략가다. 전사와 첫 3초 프레임 분석을 함께 보고 구조, 후킹 포인트, 심리기제, AI 피드백을 JSON으로만 반환한다.',
              '중요: structureAnalysis/hookAnalysis/psychologyAnalysis/aiFeedback은 전사(텍스트) 기준으로만 분석한다.',
              '프레임(시각) 정보는 구조 보조 참고용으로만 사용하고, 위 4개 텍스트 필드의 핵심 근거는 반드시 전사에 둔다.',
              '검색된 지식 자료가 주어지면 그 근거를 우선 사용하고, 부족한 연결만 합리적으로 보완한다.',
              characterSystemPrompt ? `캐릭터 고정 규칙:\n${characterSystemPrompt}` : null,
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
          {
            role: 'user',
            content:
              `검색된 글로벌 지식 자료 (우선 참고):\n${globalKnowledge.contextText || '검색된 글로벌 지식 자료 없음'}\n\n` +
              `전사:\n${normalizedTranscript || '전사 추출 없음'}\n\n` +
              `첫 3초 프레임 분석:\n${JSON.stringify(frameAnalysis, null, 2)}\n\n` +
              `검색된 지식 카테고리: ${globalKnowledge.categories.join(', ') || '없음'}\n` +
              '응답 포맷 규칙:\n' +
              '- JSON 구조는 절대 변경하지 마세요.\n' +
              '- 각 필드 텍스트는 사람이 읽기 좋게 자연스럽게 작성하세요.\n' +
              '- 줄바꿈을 적극적으로 사용하고, 한 문장을 과도하게 길게 쓰지 마세요.\n' +
              '- 기계적인 나열 문장보다 실제 설명하듯 작성하세요.\n' +
              '- structureAnalysis / hookAnalysis / psychologyAnalysis는 내부 설명을 구조적으로 나눠 작성하세요. 예: 도입, 전개, 결론.\n' +
              '- aiFeedback은 실제 사람이 주는 피드백처럼 구체적이고 개선 방향 중심으로 작성하세요.\n' +
              '다음 JSON 형식으로만 답하세요: ' +
              '{"structureAnalysis":"","hookAnalysis":"","psychologyAnalysis":"","aiFeedback":""}',
          },
        ],
      }),
    )

    const analysisResult = await runStage('parse-analysis-json', baseContext, async () =>
      parseModelJson(analysisResponse.choices[0]?.message?.content || ''),
    )
    const generationGuides = buildGenerationGuides({ analysisResult })

    const categoryGuard = buildCategoryGuard({
      accountSettings,
      characterSystemPrompt,
    })
    const guardPromptSummary = buildPromptGuardSummary(categoryGuard)
    const categoryGuardText = [
      `카테고리: ${categoryGuard.category}`,
      categoryGuard.anchors.length
        ? `필수 반영 키워드(최소 1개 이상): ${categoryGuard.anchors.join(', ')}`
        : null,
      guardPromptSummary.settingCues.length
        ? `설정 신호(최소 1개 이상 반드시 반영): ${guardPromptSummary.settingCues.join(', ')}`
        : null,
      Array.isArray(categoryGuard.hardSettingCues) && categoryGuard.hardSettingCues.length
        ? `핵심 세팅 신호(가급적 반영): ${categoryGuard.hardSettingCues.slice(0, 2).join(', ')}`
        : null,
      categoryGuard.voiceTone ? `브랜드 톤: ${categoryGuard.voiceTone}` : null,
      categoryGuard.strategyPreferences.length
        ? `전략 선호도: ${categoryGuard.strategyPreferences.join(', ')}`
        : null,
      categoryGuard.accountGoal ? `운영 목적: ${categoryGuard.accountGoal}` : null,
      categoryGuard.instagramId ? `인스타그램: @${categoryGuard.instagramId}` : null,
      '이질 도메인(건축/부동산/시공 등)으로 벗어나면 실패로 간주하고 다시 작성한다.',
      categoryGuard.category !== 'AI'
        ? 'IT/창업/스타트업/부트캠프 등 AI·창업 도메인 키워드가 나오면 실패로 간주한다.'
        : null,
      `금지어 목록: ${guardPromptSummary.forbiddenTerms.join(', ')}`,
    ]
      .filter(Boolean)
      .join('\n')

    const generatedVariations = await Promise.all(
      VARIATION_CONFIGS.map((config) =>
        runStage(`variation-${config.label}`, { ...baseContext, angle: config.angle }, async () => {
          const variationKnowledge = await retrieveGlobalKnowledgeContext({
            title: '',
            topic: `카테고리: ${categoryGuard.category}\n전략: ${config.angle}\n검색 힌트: ${config.retrievalHint}`,
            transcript: '',
            frameSummary: '',
            topK: 4,
          })
          const compactKnowledgeContext = clampText(
            variationKnowledge.contextText || '',
            VARIATION_CONTEXT_TEXT_MAX,
          )

          const systemContent = [
            '당신은 숏폼 콘텐츠 작가다. 지정된 전략에 맞는 1분 분량 스크립트를 작성한다. 출력은 JSON만 반환한다.',
            '우선순위 규칙(절대 준수): 캐릭터 고정 규칙 > 계정/타겟/상품 맥락 > 전략 라벨/전략 의도 > 레퍼런스 전사.',
            '레퍼런스 제목/파일명/원문 주제는 콘텐츠 도메인 결정에 사용하지 마라.',
            '레퍼런스 전사는 "내용 복사"가 아니라 구조/리듬/전개 방식 참고용이다.',
            '레퍼런스 원문의 업종/소재/고유명사를 그대로 가져오지 마라. 계정 카테고리와 충돌하면 반드시 계정 카테고리로 재해석하라.',
            '즉, 계정이 뷰티/패션이면 건축/부동산/공학 같은 이질 도메인으로 쓰지 말고 뷰티 도메인으로 전환해서 작성하라.',
            '계정 카테고리가 AI가 아닌데 IT/창업/스타트업/부트캠프/SaaS 소재를 쓰면 즉시 실패다.',
            'HOOK/BODY/CTA는 반드시 하나의 이야기 흐름으로 연결하라.',
            'HOOK에서 던진 긴장/문제를 BODY 첫 문장에서 이어받고, CTA는 BODY 결론을 행동으로 전환해야 한다.',
            '아래 인사이트/체크포인트를 최소 2개 이상 반영하고, usedInsights/usedCheckpoints에 반영 항목을 기록하라.',
            '촌스럽고 교과서적인 문장을 금지하고, 실제 사람이 말하듯 자연스럽게 쓴다.',
            '공통: 설명체보다 대화체. 문장은 짧게 끊고 리듬감 있게. 추상적 표현 금지.',
            'HOOK 금지: "~하시나요?" 같은 평범한 질문, 너무 일반적인 문제 제기.',
            'HOOK 규칙: 첫 문장에서 긴장감/반전/궁금증을 만들고 한 문장으로 강하게 시작.',
            'BODY 금지: "많은 사람들이 ~ 하지만" 같은 교과서 문장, 긴 한 문장 설명.',
            'BODY 규칙: 상황으로 시작하고 실제 경험/발견처럼 한 문장씩 끊어 전개.',
            'CTA 금지: "좋아요/팔로우 부탁" 같은 뻔한 마무리.',
            'CTA 규칙: 왜 지금 행동해야 하는지(손해/이득/궁금증)를 넣어 짧고 강하게.',
            characterSystemPrompt ? `캐릭터 고정 규칙:\n${characterSystemPrompt}` : null,
          ]
            .filter(Boolean)
            .join('\n\n')

          const baseUserContent =
            `전략 라벨: ${config.label}\n` +
            `전략 방향: ${config.angle}\n` +
            `전략 의도: ${config.retrievalHint}\n\n` +
            `카테고리 강제 가드(절대 준수):\n${categoryGuardText}\n\n` +
            `캐릭터 세팅 요약(절대 우선):\n${characterSystemPrompt || '설정 없음'}\n\n` +
            '작성 강제 조건:\n' +
            '- 계정 설정(카테고리/타겟/상품/톤)에 맞는 도메인으로 반드시 작성\n' +
            '- 레퍼런스 제목/파일명/원문 주제는 무시\n' +
            '- 레퍼런스 원문 주제와 계정 설정이 충돌하면 계정 설정을 우선\n' +
            '- 레퍼런스는 구조/후킹 패턴만 참고하고 소재는 계정 도메인으로 재작성\n\n' +
            `금지어(절대 사용 금지): ${guardPromptSummary.forbiddenTerms.join(', ')}\n\n` +
            `핵심 인사이트(최소 2개 반영):\n${
              generationGuides.keyInsights.length
                ? generationGuides.keyInsights.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
                : '- 없음'
            }\n\n` +
            `바로 써먹을 체크포인트(최소 2개 반영):\n${
              generationGuides.checkpoints.length
                ? generationGuides.checkpoints.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
                : '- 없음'
            }\n\n` +
            `세팅 신호(최소 1개 이상 직접 반영): ${
              guardPromptSummary.settingCues.join(', ') || '없음'
            }\n\n` +
            `공통 분석 요약:\n구조: ${analysisResult.structureAnalysis || '-'}\n후킹: ${analysisResult.hookAnalysis || '-'}\n심리: ${analysisResult.psychologyAnalysis || '-'}\n\n` +
            `참고 글로벌 지식(요약본):\n${compactKnowledgeContext || '검색된 지식 없음'}\n\n` +
            '분량 규칙(중요): 1분 릴스 기준으로 충분히 길게 작성하세요.\n' +
            '- 목표 길이: 약 50~70초\n' +
            '- hook: 약 8~12초 (45~90자)\n' +
            '- body: 약 35~45초 (220~320자)\n' +
            '- cta: 약 8~12초 (40~80자)\n' +
            '다음 JSON 형식으로만 답하세요: ' +
            '{"label":"","angle":"","coreMessage":"","hookIntent":"","bodyLogic":"","ctaReason":"","hook":"","body":"","cta":"","usedInsights":[],"usedCheckpoints":[]}'

          let normalized = null
          let alignment = { ok: false, reason: '초기 상태' }
          let retryHint = ''

          for (let attempt = 0; attempt < MAX_VARIATION_RETRIES; attempt += 1) {
            const variationResponse = await openai.chat.completions.create({
              model: chatModel,
              temperature: 0.6,
              messages: [
                {
                  role: 'system',
                  content: systemContent,
                },
                {
                  role: 'user',
                  content:
                    baseUserContent +
                    (retryHint
                      ? `\n\n[재작성 지시]\n직전 응답이 실패했습니다.\n실패 사유: ${retryHint}\n` +
                        '같은 전략을 유지하되, 계정 설정(카테고리/목표/상품/전략) 신호를 본문에 반드시 반영해 다시 작성하세요.\n' +
                        `금지어는 절대 쓰지 마세요: ${guardPromptSummary.forbiddenTerms.join(', ')}`
                      : ''),
                },
              ],
            })

            const parsed = parseModelJson(variationResponse.choices[0]?.message?.content || '')
            normalized = normalizeVariationDraft(parsed, config, generationGuides)
            alignment = validateVariationAlignment(normalized, categoryGuard)
            if (alignment.ok) {
              break
            }
            retryHint = alignment.reason
          }

          if (normalized && !alignment.ok && categoryGuard.category !== '기타') {
            const repairResponse = await openai.chat.completions.create({
              model: chatModel,
              temperature: 0.3,
              messages: [
                {
                  role: 'system',
                  content:
                    '당신은 카테고리 정합 복구기다. 주어진 스크립트의 구조(HOOK/BODY/CTA)는 유지하되, 지정 카테고리 키워드를 강제로 반영해 다시 작성한다. 출력은 JSON만 반환.',
                },
                {
                  role: 'user',
                  content:
                    `카테고리: ${categoryGuard.category}\n` +
                    `필수 키워드(최소 2개): ${categoryGuard.anchors.join(', ') || '없음'}\n` +
                    `설정 신호(최소 1개): ${guardPromptSummary.settingCues.join(', ') || '없음'}\n` +
                    `금지어: ${guardPromptSummary.forbiddenTerms.join(', ')}\n` +
                    `실패 사유: ${alignment.reason}\n\n` +
                    `현재 초안:\nHOOK: ${normalized.hook}\n\nBODY: ${normalized.body}\n\nCTA: ${normalized.cta}\n\n` +
                    '반드시 유지할 조건:\n' +
                    '- 문체/전략 라벨은 유지\n' +
                    '- 이질 도메인 단어는 제거\n' +
                    '- 설정 신호(목표/전략/상품)를 최소 1개 반영\n' +
                    '- 카테고리 키워드를 최소 2개 이상 자연스럽게 반영\n\n' +
                    '다음 JSON 형식으로만 답하세요: ' +
                    '{"hook":"","body":"","cta":""}',
                },
              ],
            })
            const repaired = parseModelJson(repairResponse.choices[0]?.message?.content || '')
            normalized = {
              ...normalized,
              hook: String(repaired?.hook || normalized.hook || '').trim(),
              body: String(repaired?.body || normalized.body || '').trim(),
              cta: String(repaired?.cta || normalized.cta || '').trim(),
            }
            alignment = validateVariationAlignment(normalized, categoryGuard)
          }

          if (normalized && !alignment.ok) {
            normalized = buildFallbackVariation(config, categoryGuard, generationGuides)
            alignment = validateVariationAlignment(normalized, categoryGuard)
          }

          if (!normalized) {
            normalized = buildFallbackVariation(config, categoryGuard, generationGuides)
          }

          const knowledgeItems = mapGlobalKnowledgeDebug(variationKnowledge.items || [])

          if (!alignment.ok) {
            normalized = buildFallbackVariation(config, categoryGuard, {})
            alignment = validateVariationAlignment(normalized, categoryGuard)
          }

          return {
            ...normalized,
            alignment,
            usedChunkIds: knowledgeItems.map((item) => item.id),
            usedKnowledge: knowledgeItems,
          }
        }),
      ),
    )

    const { data: row, error } = await runStage('save-reference-video', baseContext, async () => {
      const insertPayload = {
        account_id: accountId,
        project_id: normalizedProjectId,
        title: normalizedTitle,
        topic: normalizedTopic,
        original_filename: normalizedOriginalName,
        mime_type: file.mimetype,
        duration_seconds: durationSeconds,
        transcript: normalizedTranscript || '',
        transcript_segments: transcript.segments,
        frame_timestamps: frames.map((frame) => frame.timestamp),
        frame_notes: frameAnalysis.frames || [],
        structure_analysis: analysisResult.structureAnalysis || '',
        hook_analysis: analysisResult.hookAnalysis || frameAnalysis.summary || '',
        psychology_analysis: analysisResult.psychologyAnalysis || '',
        variations: generatedVariations,
        ai_feedback: analysisResult.aiFeedback || '',
        processing_status: 'completed',
        document_id: ingestedDocument.document.id,
      }

      let insertResult = await supabaseAdmin
        .from('reference_videos')
        .insert(insertPayload)
        .select(selectReferenceVideoColumns({ includeProjectId: true, detail: true }))
        .single()

      if (isMissingProjectColumnError(insertResult.error)) {
        delete insertPayload.project_id
        insertResult = await supabaseAdmin
          .from('reference_videos')
          .insert(insertPayload)
          .select(selectReferenceVideoColumns({ includeProjectId: false, detail: true }))
          .single()
        if (insertResult.data) {
          insertResult.data.project_id = null
        }
      }

      return insertResult
    })

    if (error) {
      logAIError('db', error, {
        title: normalizedTitle,
        topic: normalizedTopic,
        stage: 'insert-reference-video-analysis',
      })

      throw new AppError('Failed to save reference video analysis', {
        code: 'REFERENCE_VIDEO_SAVE_FAILED',
        statusCode: 500,
        cause: error,
      })
    }

    await runStage('sync-reference-analysis', baseContext, async () =>
      syncReferenceAnalysis({
        supabaseAdmin,
        accountId,
        legacyReferenceVideo: row,
        transcriptDocumentContent,
        topic: normalizedTopic,
        source: normalizedOriginalName,
      }),
    )

    const output = {
      ...row,
      global_knowledge_debug: mapGlobalKnowledgeDebug(globalKnowledge.items || []),
      global_knowledge_categories: globalKnowledge.categories || [],
    }

    if (cacheConfig.enableAnalysisResultReuse) {
      await setCacheJson(
        analysisReuseCacheKey,
        {
          ...output,
          transcript_segments: transcript.segments || [],
        },
        cacheConfig.analysisResultCacheTtlSeconds,
      )
    }

    return output
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }

    logAIError('analysis', error, {
      title: normalizedTitle,
      topic: normalizedTopic,
      filename: normalizedOriginalName,
      stage: error.details?.stage || 'unknown',
    })

    throw new AppError('Reference video analysis failed', {
      code: 'REFERENCE_VIDEO_ANALYSIS_FAILED',
      statusCode: 500,
      details: {
        stage: error.details?.stage || 'unknown',
        title: normalizedTitle,
        topic: normalizedTopic,
        filename: normalizedOriginalName,
        ...(error.details && typeof error.details === 'object' ? error.details : {}),
      },
      cause: error,
    })
  } finally {
    await cleanupVideoWorkspace(workspace)
  }
}

async function syncReferenceAnalysis({
  supabaseAdmin,
  accountId,
  legacyReferenceVideo,
  transcriptDocumentContent,
  topic,
  source,
}) {
  const chunkEntries = chunkText(transcriptDocumentContent)
  const embeddings = chunkEntries.length
    ? await createEmbeddings(
        chunkEntries.map((chunk) => chunk.content),
        {
          title: legacyReferenceVideo.title,
          source,
          chunkCount: chunkEntries.length,
          stage: 'reference-analysis-sync',
        },
      )
    : []

  const { data: analysis, error: analysisError } = await supabaseAdmin
    .from('reference_analyses')
    .insert({
      account_id: accountId,
      legacy_reference_video_id: legacyReferenceVideo.id,
      title: legacyReferenceVideo.title,
      source: 'reference_videos',
      category: 'reference-video',
      tone: null,
      summary: legacyReferenceVideo.hook_analysis,
      structure_analysis: legacyReferenceVideo.structure_analysis,
      hook_analysis: legacyReferenceVideo.hook_analysis,
      psychology_analysis: legacyReferenceVideo.psychology_analysis,
      score: null,
      status: 'processed',
      metadata: {
        topic,
        originalFilename: legacyReferenceVideo.original_filename,
        variations: legacyReferenceVideo.variations,
      },
    })
    .select('id')
    .single()

  if (analysisError) {
    throw new AppError('Failed to sync reference analysis', {
      code: 'REFERENCE_ANALYSIS_SYNC_FAILED',
      statusCode: 500,
      cause: analysisError,
    })
  }

  if (!chunkEntries.length) {
    return
  }

  const rows = chunkEntries.map((chunk, index) => ({
    account_id: accountId,
    reference_analysis_id: analysis.id,
    chunk_index: chunk.chunkIndex,
    content: chunk.content,
    type: 'reference',
    category: 'reference-video',
    tone: null,
    score: null,
    metadata: {
      legacyReferenceVideoId: legacyReferenceVideo.id,
      topic,
      originalFilename: legacyReferenceVideo.original_filename,
    },
    embedding: embeddings[index]?.vector || null,
  }))

  const { error: chunkError } = await supabaseAdmin
    .from('reference_analysis_chunks')
    .insert(rows)

  if (chunkError) {
    throw new AppError('Failed to sync reference analysis chunks', {
      code: 'REFERENCE_ANALYSIS_CHUNKS_SYNC_FAILED',
      statusCode: 500,
      cause: chunkError,
    })
  }
}

export async function listReferenceVideos(accountId) {
  if (!hasSupabaseAdminConfig()) {
    throw new AppError('Supabase admin client is not configured', {
      code: 'SUPABASE_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  const supabaseAdmin = getSupabaseAdmin()
  let { data, error } = await supabaseAdmin
    .from('reference_videos')
    .select(selectReferenceVideoColumns({ includeProjectId: true, detail: false }))
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })

  if (isMissingProjectColumnError(error)) {
    const fallback = await supabaseAdmin
      .from('reference_videos')
      .select(selectReferenceVideoColumns({ includeProjectId: false, detail: false }))
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
    data = (fallback.data || []).map((item) => ({ ...item, project_id: null }))
    error = fallback.error
  }

  if (error) {
    throw new AppError('Failed to load reference videos', {
      code: 'REFERENCE_VIDEO_LIST_FAILED',
      statusCode: 500,
      cause: error,
    })
  }

  return data
}

export async function getReferenceVideo(referenceVideoId, accountId) {
  if (!hasSupabaseAdminConfig()) {
    throw new AppError('Supabase admin client is not configured', {
      code: 'SUPABASE_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  const supabaseAdmin = getSupabaseAdmin()
  let { data, error } = await supabaseAdmin
    .from('reference_videos')
    .select(selectReferenceVideoColumns({ includeProjectId: true, detail: true }))
    .eq('id', referenceVideoId)
    .eq('account_id', accountId)
    .single()

  if (isMissingProjectColumnError(error)) {
    const fallback = await supabaseAdmin
      .from('reference_videos')
      .select(selectReferenceVideoColumns({ includeProjectId: false, detail: true }))
      .eq('id', referenceVideoId)
      .eq('account_id', accountId)
      .single()
    data = fallback.data ? { ...fallback.data, project_id: null } : fallback.data
    error = fallback.error
  }

  if (error) {
    const statusCode = error.code === 'PGRST116' ? 404 : 500

    throw new AppError(
      statusCode === 404
        ? 'Reference video analysis not found'
        : 'Failed to load reference video analysis',
      {
        code:
          statusCode === 404
            ? 'REFERENCE_VIDEO_NOT_FOUND'
            : 'REFERENCE_VIDEO_FETCH_FAILED',
        statusCode,
        cause: error,
      },
    )
  }

  const frameSummary = buildFrameSummaryFromNotes(data.frame_notes || [])
  let globalKnowledgeDebug = []
  let globalKnowledgeCategories = []
  let enrichedVariations = Array.isArray(data.variations) ? data.variations : []

  try {
    const globalKnowledge = await retrieveGlobalKnowledgeContext({
      title: data.title,
      topic: data.topic,
      transcript: data.transcript || '',
      frameSummary,
      topK: 4,
    })

    globalKnowledgeDebug = mapGlobalKnowledgeDebug(globalKnowledge.items || [])
    globalKnowledgeCategories = globalKnowledge.categories || []

    const needsPerVariationKnowledge = enrichedVariations.some(
      (variation) => !Array.isArray(variation?.usedKnowledge) || variation.usedKnowledge.length === 0,
    )

    if (needsPerVariationKnowledge && enrichedVariations.length) {
      const perVariationKnowledge = await Promise.all(
        enrichedVariations.map(async (variation, index) => {
          const config = VARIATION_CONFIGS[index] || VARIATION_CONFIGS[0]
          const angle = variation?.angle?.trim() || config.angle
          const hint = config.retrievalHint
          const result = await retrieveGlobalKnowledgeContext({
            title: data.title,
            topic: `${data.topic}\n전략: ${angle}\n검색 힌트: ${hint}`,
            transcript: data.transcript || '',
            frameSummary,
            topK: 4,
          })

          const knowledgeItems = mapGlobalKnowledgeDebug(result.items || [])

          return {
            ...variation,
            angle,
            usedChunkIds: knowledgeItems.map((item) => item.id),
            usedKnowledge: knowledgeItems,
          }
        }),
      )

      enrichedVariations = perVariationKnowledge
    }
  } catch (error) {
    logAIError('analysis', error, {
      stage: 'reference-detail-global-knowledge',
      referenceVideoId,
      accountId,
    })
  }

  return {
    ...data,
    variations: enrichedVariations,
    global_knowledge_debug: globalKnowledgeDebug,
    global_knowledge_categories: globalKnowledgeCategories,
  }
}

export async function deleteReferenceVideo(referenceVideoId, accountId) {
  if (!hasSupabaseAdminConfig()) {
    throw new AppError('Supabase admin client is not configured', {
      code: 'SUPABASE_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from('reference_videos')
    .delete()
    .eq('id', referenceVideoId)
    .eq('account_id', accountId)
    .select('id, title')
    .maybeSingle()

  if (error) {
    throw new AppError('Failed to delete reference video analysis', {
      code: 'REFERENCE_VIDEO_DELETE_FAILED',
      statusCode: 500,
      cause: error,
    })
  }

  if (!data) {
    throw new AppError('Reference video analysis not found', {
      code: 'REFERENCE_VIDEO_NOT_FOUND',
      statusCode: 404,
    })
  }

  return data
}

export async function updateReferenceVideo(referenceVideoId, accountId, { title, projectId } = {}) {
  if (!hasSupabaseAdminConfig()) {
    throw new AppError('Supabase admin client is not configured', {
      code: 'SUPABASE_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  const payload = {}
  if (title !== undefined) {
    const normalizedTitle = String(title || '').trim()
    if (!normalizedTitle) {
      throw new AppError('title is required', {
        code: 'INVALID_REFERENCE_VIDEO_TITLE',
        statusCode: 400,
      })
    }
    payload.title = normalizedTitle.slice(0, 200)
  }
  if (projectId !== undefined) {
    payload.project_id = normalizeOptionalProjectId(projectId)
  }
  if (!Object.keys(payload).length) {
    throw new AppError('No fields to update', {
      code: 'REFERENCE_VIDEO_UPDATE_EMPTY',
      statusCode: 400,
    })
  }

  const supabaseAdmin = getSupabaseAdmin()
  if (payload.project_id) {
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', payload.project_id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (projectError) {
      throw new AppError('Failed to validate project', {
        code: 'PROJECT_VALIDATE_FAILED',
        statusCode: 500,
        cause: projectError,
      })
    }

    if (!project) {
      throw new AppError('Project not found', {
        code: 'PROJECT_NOT_FOUND',
        statusCode: 404,
      })
    }
  }

  let { data, error } = await supabaseAdmin
    .from('reference_videos')
    .update(payload)
    .eq('id', referenceVideoId)
    .eq('account_id', accountId)
    .select('id, title, project_id')
    .maybeSingle()

  if (isMissingProjectColumnError(error)) {
    if (Object.prototype.hasOwnProperty.call(payload, 'project_id')) {
      throw new AppError('Projects schema is missing. Run latest migration first.', {
        code: 'PROJECT_SCHEMA_MISSING',
        statusCode: 400,
        exposeMessage: true,
        details: {
          action: 'update-reference-project',
          hint:
            'Apply migration: supabase/migrations/20260418224000_add_projects_and_reference_project_link.sql',
        },
        cause: error,
      })
    }

    const fallback = await supabaseAdmin
      .from('reference_videos')
      .update(payload)
      .eq('id', referenceVideoId)
      .eq('account_id', accountId)
      .select('id, title')
      .maybeSingle()
    data = fallback.data ? { ...fallback.data, project_id: null } : fallback.data
    error = fallback.error
  }

  if (error) {
    throw new AppError('Failed to update reference video analysis', {
      code: 'REFERENCE_VIDEO_UPDATE_FAILED',
      statusCode: 500,
      cause: error,
    })
  }

  if (!data) {
    throw new AppError('Reference video analysis not found', {
      code: 'REFERENCE_VIDEO_NOT_FOUND',
      statusCode: 404,
    })
  }

  return data
}
