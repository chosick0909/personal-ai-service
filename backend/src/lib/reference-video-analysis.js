import { AppError } from './errors.js'
import { buildCacheKey, cacheConfig, getCacheJson, hashText, setCacheJson } from './cache.js'
import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'
import {
  CATEGORY_ANCHOR_TERMS,
  CATEGORY_PLAYBOOKS,
  CREATOR_BUSINESS_PROOF_PATTERN,
  DOMAIN_EVIDENCE_PROFILES,
  VARIATION_CONFIGS,
} from '../config/reference-analysis-config.js'
import { ingestDocument } from './document-ingest.js'
import { chunkText } from './chunking.js'
import { createEmbeddings } from './embeddings.js'
import { getAccountProfile } from './account-profile.js'
import { logAIError } from './ai-error-logger.js'
import { logAIUsage, sumAIUsage } from './ai-usage-logger.js'
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

const VARIATION_CONTEXT_TEXT_MAX = 800
const MAX_PROMPT_SETTING_CUES = 3
const ENABLE_COST_GUARD = String(process.env.FEATURE_COST_GUARD || 'true') !== 'false'
const QUALITY_REGEN_AVERAGE_THRESHOLD = Number.parseFloat(
  String(process.env.QUALITY_REGEN_AVERAGE_THRESHOLD || '3.2'),
)
const DEFAULT_ANALYSIS_AUDIO_MAX_SECONDS = Number.parseInt(
  process.env.REFERENCE_ANALYSIS_AUDIO_MAX_SECONDS || '90',
  10,
)

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
const REFERENCE_SURFACE_STOPWORDS = new Set([
  '그리고',
  '그래서',
  '하지만',
  '지금',
  '정말',
  '진짜',
  '사람들',
  '콘텐츠',
  '영상',
  '문장',
  '구조',
  '방법',
  '기준',
  '문제',
  '해결',
  '설명',
  '사용',
  '적용',
  '이유',
])
const MAX_REFERENCE_SURFACE_TERMS = 16

const ANALYSIS_PROMPT_VERSION = String(process.env.ANALYSIS_PROMPT_VERSION || 'v2').trim() || 'v2'
const ANALYZE_DEDUPE_WINDOW_MINUTES = Number.parseInt(
  String(process.env.ANALYZE_DEDUPE_WINDOW_MINUTES || '30'),
  10,
)
const ANALYZE_IN_FLIGHT = new Map()

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
  fileFingerprint,
  characterSystemPrompt,
}) {
  const fileHash = String(fileFingerprint || '').trim() || hashText('')
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

function extractMissingColumnName(error) {
  const text = String(error?.message || '')
  const patterns = [
    /Could not find the ['"]([a-z0-9_]+)['"] column/i,
    /column ['"]?([a-z0-9_]+)['"]?/i,
    /['"]([a-z0-9_]+)['"] column/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      return match[1]
    }
  }

  return ''
}

function getReferenceVideoSelectColumnList({ includeProjectId = true, detail = false } = {}) {
  const base = detail
    ? [
        'id',
        'title',
        'topic',
        'original_filename',
        'duration_seconds',
        'transcript',
        'transcript_segments',
        'frame_timestamps',
        'frame_notes',
        'structure_analysis',
        'hook_analysis',
        'psychology_analysis',
        'variations',
        'ai_feedback',
        'document_id',
        'processing_status',
        'error_message',
        'created_at',
      ]
    : [
        'id',
        'title',
        'topic',
        'original_filename',
        'duration_seconds',
        'transcript',
        'structure_analysis',
        'hook_analysis',
        'psychology_analysis',
        'variations',
        'ai_feedback',
        'processing_status',
        'error_message',
        'created_at',
      ]

  return includeProjectId ? [...base, 'project_id'] : base
}

async function persistReferenceVideoRowWithFallback({
  supabaseAdmin,
  mode,
  accountId,
  referenceId = null,
  payload,
  removableColumns = [],
  detail = true,
}) {
  const workingPayload = { ...payload }
  const removable = new Set(removableColumns)
  const selectedColumns = getReferenceVideoSelectColumnList({
    includeProjectId: Object.prototype.hasOwnProperty.call(workingPayload, 'project_id'),
    detail,
  })

  for (let attempt = 0; attempt < removable.size + selectedColumns.length + 2; attempt += 1) {
    const includeProjectId = selectedColumns.includes('project_id')
    const baseQuery =
      mode === 'insert'
        ? supabaseAdmin.from('reference_videos').insert({
            ...workingPayload,
            account_id: accountId,
          })
        : supabaseAdmin
            .from('reference_videos')
            .update(workingPayload)
            .eq('id', referenceId)
            .eq('account_id', accountId)

    const result = await baseQuery
      .select(selectedColumns.join(', '))
      .single()

    if (!result.error) {
      if (!includeProjectId && result.data) {
        result.data.project_id = null
      }
      return result
    }

    const missingColumn = extractMissingColumnName(result.error)
    if (!missingColumn) {
      return result
    }

    if (removable.has(missingColumn) && missingColumn in workingPayload) {
      delete workingPayload[missingColumn]
      continue
    }

    const selectIndex = selectedColumns.indexOf(missingColumn)
    if (selectIndex !== -1) {
      selectedColumns.splice(selectIndex, 1)
      continue
    }

    return result
  }

  return {
    data: null,
    error: new AppError('Failed to persist reference video row', {
      code: 'REFERENCE_VIDEO_PERSIST_FAILED',
      statusCode: 500,
    }),
  }
}

async function computeUploadedFileFingerprint(file) {
  if (Buffer.isBuffer(file?.buffer) && file.buffer.length > 0) {
    return hashText(file.buffer)
  }

  const filePath = String(file?.path || '').trim()
  if (!filePath) {
    return hashText(
      JSON.stringify({
        originalname: file?.originalname || '',
        mimetype: file?.mimetype || '',
        size: Number(file?.size || 0),
      }),
    )
  }

  const fileStat = await stat(filePath)
  const totalSize = Number(fileStat?.size || 0)
  const handle = await open(filePath, 'r')

  try {
    const headSize = Math.min(256 * 1024, Math.max(0, totalSize))
    const headBuffer = Buffer.alloc(headSize)
    const headRead = headSize > 0 ? await handle.read(headBuffer, 0, headSize, 0) : { bytesRead: 0 }

    const tailSize = Math.min(256 * 1024, Math.max(0, totalSize - headRead.bytesRead))
    const tailBuffer = Buffer.alloc(tailSize)
    const tailPosition = Math.max(0, totalSize - tailSize)
    const tailRead =
      tailSize > 0 ? await handle.read(tailBuffer, 0, tailSize, tailPosition) : { bytesRead: 0 }

    const digest = createHash('sha256')
    digest.update(Buffer.from(String(totalSize)))
    digest.update(headBuffer.subarray(0, headRead.bytesRead))
    digest.update(tailBuffer.subarray(0, tailRead.bytesRead))
    return digest.digest('hex')
  } finally {
    await handle.close()
  }
}

function normalizeIdempotencyKey(value) {
  const text = String(value || '').trim()
  if (!text) {
    return ''
  }

  return text.slice(0, 128)
}

async function findRecentDuplicateReference({
  supabaseAdmin,
  accountId,
  idempotencyKey,
  analysisFingerprint,
  dedupeWindowMinutes = ANALYZE_DEDUPE_WINDOW_MINUTES,
}) {
  const normalizedWindow = Number.isFinite(dedupeWindowMinutes) && dedupeWindowMinutes > 0
    ? dedupeWindowMinutes
    : 30
  const since = new Date(Date.now() - normalizedWindow * 60 * 1000).toISOString()
  const columns = 'id, processing_status, created_at'
  const fetchDuplicateByColumn = async (columnName, value) => {
    if (!value) {
      return null
    }

    const { data, error } = await supabaseAdmin
      .from('reference_videos')
      .select(columns)
      .eq('account_id', accountId)
      .eq(columnName, value)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)

    const missingColumn = extractMissingColumnName(error)
    if (missingColumn && missingColumn === columnName) {
      return null
    }

    if (error) {
      throw error
    }

    if (Array.isArray(data) && data.length) {
      return data[0]
    }

    return null
  }

  const duplicateChecks = [
    { key: 'idempotency_key', value: idempotencyKey, warning: 'duplicate idempotency lookup failed' },
    {
      key: 'analysis_fingerprint',
      value: analysisFingerprint,
      warning: 'duplicate fingerprint lookup failed',
    },
  ].filter((item) => item.value)

  if (!duplicateChecks.length) {
    return null
  }

  const settledResults = await Promise.allSettled(
    duplicateChecks.map((item) => fetchDuplicateByColumn(item.key, item.value)),
  )

  for (const [index, result] of settledResults.entries()) {
    const check = duplicateChecks[index]
    if (result.status === 'rejected') {
      console.warn(`[reference-video-analysis] ${check.warning}`, {
        accountId,
        message: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
      continue
    }

    if (result.value) {
      return result.value
    }
  }

  return null
}

async function createProcessingReferenceVideo({
  supabaseAdmin,
  accountId,
  projectId,
  title,
  topic,
  originalFilename,
  mimeType,
  idempotencyKey,
  analysisFingerprint,
}) {
  const basePayload = {
    project_id: projectId || null,
    title,
    topic,
    original_filename: originalFilename,
    mime_type: mimeType || 'video/mp4',
    processing_status: 'processing',
    current_stage: 'queued',
    processing_started_at: new Date().toISOString(),
    last_heartbeat_at: new Date().toISOString(),
    idempotency_key: idempotencyKey || null,
    analysis_fingerprint: analysisFingerprint || null,
  }

  const { data, error } = await persistReferenceVideoRowWithFallback({
    supabaseAdmin,
    mode: 'insert',
    accountId,
    payload: basePayload,
    removableColumns: [
      'project_id',
      'current_stage',
      'processing_started_at',
      'last_heartbeat_at',
      'idempotency_key',
      'analysis_fingerprint',
    ],
    detail: true,
  })

  if (error) {
    throw error
  }

  return data
}

async function updateReferenceLifecycleState({
  supabaseAdmin,
  referenceId,
  accountId,
  patch = {},
}) {
  if (!referenceId || !accountId) {
    return
  }

  const payload = {
    ...patch,
    last_heartbeat_at: new Date().toISOString(),
  }
  const fallback = {}
  if (payload.processing_status !== undefined) {
    fallback.processing_status = payload.processing_status
  }
  if (payload.failure_message !== undefined) {
    fallback.error_message = payload.failure_message
  }
  if (payload.failure_message === null) {
    fallback.error_message = null
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { error } = await supabaseAdmin
      .from('reference_videos')
      .update(payload)
      .eq('id', referenceId)
      .eq('account_id', accountId)

    if (!error) {
      return
    }

    const missingColumn = extractMissingColumnName(error)
    if (!missingColumn) {
      console.warn('[reference-video-analysis] lifecycle update failed', {
        referenceId,
        accountId,
        code: error.code || null,
        message: error.message,
      })
      return
    }

    if (!(missingColumn in payload)) {
      console.warn('[reference-video-analysis] lifecycle update missing column fallback exhausted', {
        referenceId,
        accountId,
        missingColumn,
      })
      return
    }

    delete payload[missingColumn]

    if (!Object.keys(payload).length && Object.keys(fallback).length) {
      payload.processing_status = fallback.processing_status
      payload.error_message = fallback.error_message
    }

    if (!Object.keys(payload).length) {
      return
    }
  }
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
  return getReferenceVideoSelectColumnList({ includeProjectId, detail }).join(', ')
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
    keyInsights: normalizeStringList(
      insights.filter((line) => isUsableScriptGuideLine(line)),
      4,
    ),
    checkpoints: normalizeStringList(
      checkpoints.filter((line) => isUsableScriptGuideLine(line)),
      4,
    ),
  }
}

function isUsableScriptGuideLine(line = '') {
  const text = String(line || '').trim()
  if (!text) return false
  // Script generation guides should avoid visual/meta-analysis jargon.
  const bannedMetaPattern =
    /(첫\s*\d+초|클로즈업|화면|자막|컷\s*전환|프레임|장면|시선\s*집중|문구|도입부에서는|전개에서는|결론에서는|영상|편집|연출)/i
  return !bannedMetaPattern.test(text)
}

function extractReferenceSurfaceTerms({ title = '', topic = '', transcript = '' } = {}) {
  const corpus = `${title}\n${topic}\n${transcript}`
  const tokens = String(corpus || '')
    .toLowerCase()
    .split(/[\s,./!?|()[\]{}:;"'`~<>+=_*&^%$#@\-–—→\n\r\t]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length >= 2 && token.length <= 20)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !REFERENCE_SURFACE_STOPWORDS.has(token))

  const counts = new Map()
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1)
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([token]) => token)
    .slice(0, MAX_REFERENCE_SURFACE_TERMS)
}

function findReferenceSurfaceLeakage(text = '', referenceSurfaceTerms = []) {
  const normalized = String(text || '').toLowerCase()
  if (!normalized) return null
  return (referenceSurfaceTerms || []).find((term) => containsTerm(normalized, term)) || null
}

async function buildStructureBlueprint({
  openai,
  chatModel,
  analysisResult,
  transcript,
}) {
  const response = await openai.chat.completions.create({
    model: chatModel,
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content:
          '너는 레퍼런스에서 논리 구조만 추출하는 분석기다. 주제/업종/키워드는 제거하고 추상 구조만 JSON으로 반환한다. 특히 hookSentencePattern에는 훅의 시작 방식, 문장 리듬, 긴장 형성 순서만 추상적으로 적고 원문 단어는 넣지 마라. hookAdvantagePattern에는 레퍼런스 훅의 강점(주의 환기 방식, 갈등 제시 방식, 감정 트리거)을 일반화해서 적어라.',
      },
      {
        role: 'user',
        content:
          `레퍼런스 전사:\n${transcript || '-'}\n\n` +
          `구조 분석:\n${analysisResult?.structureAnalysis || '-'}\n\n` +
          `후킹 분석:\n${analysisResult?.hookAnalysis || '-'}\n\n` +
          `심리 분석:\n${analysisResult?.psychologyAnalysis || '-'}\n\n` +
          '다음 JSON 형식으로만 답하세요: {"logicFlow":[],"persuasionPattern":[],"messageStructure":[],"hookSentencePattern":[],"hookAdvantagePattern":[]}',
      },
    ],
  })

  const parsed = parseModelJson(response.choices[0]?.message?.content || '')
  const logicFlow = normalizeStringList(parsed?.logicFlow, 4)
  const persuasionPattern = normalizeStringList(parsed?.persuasionPattern, 4)
  const messageStructure = normalizeStringList(parsed?.messageStructure, 4)
  const hookSentencePattern = normalizeStringList(parsed?.hookSentencePattern, 4)
  const hookAdvantagePattern = normalizeStringList(parsed?.hookAdvantagePattern, 4)
  return { logicFlow, persuasionPattern, messageStructure, hookSentencePattern, hookAdvantagePattern }
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

function buildCategoryPlaybookPayload(category, playbook) {
  if (!category || !playbook) {
    return null
  }

  return {
    category,
    label: category,
    insight: playbook.uiCopy?.insight || '',
    hookai_rule: playbook.uiCopy?.hookAiRule || '',
  }
}

function buildPromptGuardSummary(guard = {}) {
  const settingCues = normalizeStringList(guard.settingCues || [], MAX_PROMPT_SETTING_CUES)
  return { settingCues }
}

function inferEvidenceProfile(guard = {}) {
  const source = [
    guard.rawCategory,
    guard.category,
    ...(Array.isArray(guard.settingCues) ? guard.settingCues : []),
    ...(Array.isArray(guard.hardSettingCues) ? guard.hardSettingCues : []),
  ]
    .filter(Boolean)
    .join(' ')

  if (/(운동|헬스|피트니스|체형|자세|근력|다이어트|영양|건강|루틴)/i.test(source)) {
    return 'health_fitness'
  }

  return DOMAIN_EVIDENCE_PROFILES[guard.category] ? guard.category : '기타'
}

function buildEvidenceTranslationGuide(guard = {}) {
  const profileKey = inferEvidenceProfile(guard)
  const profile = DOMAIN_EVIDENCE_PROFILES[profileKey] || DOMAIN_EVIDENCE_PROFILES.기타
  const settingHints = normalizeStringList(
    [...(Array.isArray(guard.hardSettingCues) ? guard.hardSettingCues : []), ...(Array.isArray(guard.settingCues) ? guard.settingCues : [])],
    3,
  )

  return (
    '도메인별 근거 변환 규칙(반드시 준수):\n' +
    `- 현재 계정의 실제 도메인은 "${guard.rawCategory || guard.category || '기타'}" 입니다.\n` +
    `- 반드시 이 도메인에서 자연스러운 근거만 사용하세요: ${profile.preferred}\n` +
    `- 특히 이런 근거는 현재 도메인에 그대로 들고 오면 안 됩니다: ${profile.avoid}\n` +
    '- 레퍼런스의 성과 숫자, 수강생 사례, 팔로워/노출 구조, 강의/신청/AI 자동화 같은 요소는 "사실"이 아니라 참고용 설득 방식입니다.\n' +
    '- 따라서 레퍼런스의 사업형 증거를 복사하지 말고, 현재 계정 도메인에 맞는 사용 경험/변화 과정/문제 해결 근거로 번역하세요.\n' +
    `- 자연스럽게 반영할 세팅 힌트: ${settingHints.join(', ') || '없음'}`
  )
}

function pickSettingCue(guard = {}, offset = 0) {
  const cues = Array.isArray(guard.settingCues) ? guard.settingCues : []
  if (!cues.length) return ''
  return cues[Math.abs(offset) % cues.length] || cues[0]
}

function getCategoryPlaybook(category = '') {
  const normalized = String(category || '').trim()
  if (!normalized || normalized === '기타') {
    return null
  }
  return CATEGORY_PLAYBOOKS[normalized] || null
}

function buildPlaybookPrompt(playbook) {
  if (!playbook) {
    return ''
  }

  const hardRules = Array.isArray(playbook.promptRules?.hard) ? playbook.promptRules.hard.slice(0, 3) : []
  const softRules = Array.isArray(playbook.promptRules?.soft) ? playbook.promptRules.soft.slice(0, 3) : []
  const hookTypes = Array.isArray(playbook.generationHints?.hookTypes)
    ? playbook.generationHints.hookTypes.slice(0, 3)
    : []
  const ctaTypes = Array.isArray(playbook.generationHints?.ctaTypes)
    ? playbook.generationHints.ctaTypes.slice(0, 4)
    : []
  const tones = Array.isArray(playbook.generationHints?.tones)
    ? playbook.generationHints.tones.slice(0, 3)
    : []

  return [
    '카테고리 실행 참고 규칙(설정과 충돌하면 계정 설정을 우선하고, 아래는 보조 참고로만 사용):',
    playbook.uiCopy?.insight ? `- 업종 인사이트: ${playbook.uiCopy.insight}` : '',
    hardRules.length ? `- 반드시 피할 것: ${hardRules.join(', ')}` : '',
    softRules.length ? `- 우선 반영할 것: ${softRules.join(', ')}` : '',
    hookTypes.length ? `- 잘 먹히는 훅 유형 참고: ${hookTypes.join(', ')}` : '',
    ctaTypes.length ? `- 자연스러운 CTA 방향 참고: ${ctaTypes.join(', ')}` : '',
    tones.length ? `- 톤 참고: ${tones.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildTopicFocusPrompt(topic = '', title = '') {
  const normalizedTopic = String(topic || '').trim()
  const normalizedTitle = String(title || '').trim()
  const topicOnly = normalizedTopic && normalizedTopic !== normalizedTitle ? normalizedTopic : ''

  if (!normalizedTopic) {
    return ''
  }

  return [
    `이번 릴스 주제(반드시 반영): ${normalizedTopic}`,
    topicOnly
      ? `중요: 계정의 큰 카테고리는 유지하되, 이번 결과물의 실제 소재/상품/상황은 "${topicOnly}" 기준으로 구체화하세요.`
      : '중요: 계정의 큰 카테고리는 유지하되, 이번 결과물의 실제 소재/상품/상황은 위 주제를 기준으로 구체화하세요.',
    '이번 릴스 주제는 분위기 참고용이 아니라 실제 주장, 예시, 표현, CTA가 모여야 하는 중심 소재입니다.',
  ].join('\n')
}

async function regenerateVariationWithGPT({
  openai,
  chatModel,
  config,
  categoryGuard,
  guardPromptSummary,
  characterSystemPrompt,
  generationGuides,
  structureBlueprint,
  referenceSurfaceTerms,
  focusTopic = '',
  referenceTitle = '',
  retryReason = '',
  usageContext = {},
}) {
  const topicFocusPrompt = buildTopicFocusPrompt(focusTopic, referenceTitle)
  const response = await openai.chat.completions.create({
    model: chatModel,
    temperature: 0.35,
    messages: [
      {
        role: 'system',
        content:
          '당신은 숏폼 스크립트 재생성 편집자다. 계정 세팅을 최우선으로 자연스러운 HOOK/BODY/CTA를 새로 작성한다. 출력은 JSON만 반환한다.',
      },
      {
        role: 'user',
        content:
          `전략 라벨: ${config.label}\n전략 방향: ${config.angle}\n` +
          `카테고리: ${categoryGuard.category}\n` +
          `${topicFocusPrompt ? `${topicFocusPrompt}\n` : ''}` +
          `세팅 신호(우선 반영): ${guardPromptSummary.settingCues.join(', ') || '없음'}\n` +
          `레퍼런스 금지 표면 단어(절대 사용 금지): ${(referenceSurfaceTerms || []).join(', ') || '없음'}\n` +
          `${buildEvidenceTranslationGuide(categoryGuard)}\n\n` +
          `${retryReason ? `재생성 사유: ${retryReason}\n` : ''}\n` +
          `논리 구조 청사진:\n${
            structureBlueprint?.logicFlow?.length
              ? structureBlueprint.logicFlow.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
              : '- 없음'
          }\n\n` +
          `설득 패턴:\n${
            structureBlueprint?.persuasionPattern?.length
              ? structureBlueprint.persuasionPattern.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
              : '- 없음'
          }\n\n` +
          `메시지 구조:\n${
            structureBlueprint?.messageStructure?.length
              ? structureBlueprint.messageStructure.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
              : '- 없음'
          }\n\n` +
          `HOOK 문장 구조 참고:\n${
            structureBlueprint?.hookSentencePattern?.length
              ? structureBlueprint.hookSentencePattern.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
              : '- 없음'
          }\n\n` +
          `레퍼런스 HOOK 장점(강하게 반영):\n${
            structureBlueprint?.hookAdvantagePattern?.length
              ? structureBlueprint.hookAdvantagePattern.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
              : '- 없음'
          }\n\n` +
          `핵심 인사이트:\n${
            generationGuides.keyInsights.length
              ? generationGuides.keyInsights.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
              : '- 없음'
          }\n\n` +
          `실행 포인트:\n${
            generationGuides.checkpoints.length
              ? generationGuides.checkpoints.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
              : '- 없음'
          }\n\n` +
          `캐릭터 세팅:\n${characterSystemPrompt || '없음'}\n\n` +
          '작성 조건:\n' +
          '- 이번 릴스 주제가 주어졌다면 hook/body/cta 모두 그 주제를 직접 다뤄야 함\n' +
          '- 레퍼런스 표면 주제/키워드/문장 변형 사용 금지(패러프레이즈 포함)\n' +
          '- 레퍼런스는 논리 구조만 참고하고 내용은 현재 계정 도메인으로 완전 재창조\n' +
          '- HOOK만 레퍼런스의 시작 방식, 문장 호흡, 긴장 형성 순서를 참고해 비슷한 구조로 작성 가능\n' +
          '- HOOK은 위 장점 항목 중 최소 2개를 문장에 드러나게 반영\n' +
          '- 단, HOOK에서도 레퍼런스 원문 단어/주제/상황/고유명사 복사 금지\n' +
          '- BODY/CTA는 HOOK 이후 흐름만 자연스럽게 이어가고, 문장 구조는 현재 계정 도메인에 맞게 새로 작성\n' +
          '- 분석 메타 표현(첫 3초, 프레임, 클로즈업, 화면, 자막, 연출) 금지\n' +
          '- 사람 말투로 자연스럽게 작성\n' +
          '- HOOK/BODY/CTA 흐름을 분명히 연결\n' +
          '- 세팅 신호와 키워드는 억지 삽입보다 자연스러운 반영을 우선\n\n' +
          '다음 JSON 형식으로만 답하세요: {"hook":"","body":"","cta":""}',
      },
    ],
  })
  const usage = logAIUsage('abc-regenerate', response, {
    model: chatModel,
    ...usageContext,
    retryReason,
  })

  const parsed = parseModelJson(response.choices[0]?.message?.content || '')
  return {
    label: config.label,
    angle: config.angle,
    hook: String(parsed?.hook || '').trim(),
    body: String(parsed?.body || '').trim(),
    cta: String(parsed?.cta || '').trim(),
    usedInsights: normalizeStringList(generationGuides.keyInsights, 2),
    usedCheckpoints: normalizeStringList(generationGuides.checkpoints, 2),
    usedChunkIds: [],
    usedKnowledge: [],
    alignment: { ok: true, reason: 'fallback-regenerated' },
    usage,
  }
}

function enforceVariationDiversity(variations = [], guard = {}) {
  const seen = new Map()
  return variations.map((item, index) => {
    const normalized = {
      ...item,
      hook: String(item?.hook || '').trim(),
      body: String(item?.body || '').trim(),
      cta: String(item?.cta || '').trim(),
    }
    const fingerprint = [normalized.hook, normalized.body, normalized.cta]
      .join('|')
      .replace(/\s+/g, ' ')
      .trim()

    const seenCount = seen.get(fingerprint) || 0
    seen.set(fingerprint, seenCount + 1)
    if (seenCount === 0) {
      return normalized
    }

    const keyword = guard.anchors?.[index % Math.max(guard.anchors?.length || 1, 1)] || guard.category || '콘텐츠'
    const cue = pickSettingCue(guard, index)
    const label = String(normalized.label || '')

    if (label === 'A안') {
      normalized.hook = `${keyword}에서 가장 많이 망가지는 포인트, 지금 바로 짚어드릴게요.`
      normalized.cta = `${keyword} 실수 방지 포인트 저장하고 오늘 바로 한 번 적용해 보세요.`
    } else if (label === 'B안') {
      normalized.hook = `${keyword}, 헷갈리지 않게 순서만 딱 정리해드릴게요.`
      normalized.cta = `${cue ? `${cue} 기준으로` : ''} 체크리스트 저장해 두고 그대로 실행해 보세요.`
    } else {
      normalized.hook = `${keyword} 하면서 답답했던 분들, 여기서부터 흐름을 바꿔봅시다.`
      normalized.cta = '공감되셨다면 저장하고 오늘 한 가지부터 가볍게 시작해 보세요.'
    }
    return normalized
  })
}

function needsFlowPolish(variation = {}) {
  const text = [variation?.hook, variation?.body, variation?.cta]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('\n')
  if (!text) return false

  const awkwardPattern =
    /(첫\s*\d+초|클로즈업|화면|자막|문구|프레임|장면|시선\s*집중|도입부에서는|전개에서는|결론에서는|영상|편집|연출|저\s*원래부터|즉각\s*사로잡)/i
  return awkwardPattern.test(text)
}

function isVariationStructureBroken(variation = {}, alignment = {}, guard = {}) {
  const hook = String(variation?.hook || '').trim()
  const body = String(variation?.body || '').trim()
  const cta = String(variation?.cta || '').trim()

  if (!hook || !body || !cta) {
    return { broken: true, reason: 'HOOK/BODY/CTA 비어 있음' }
  }
  if (!alignment?.ok) {
    return { broken: true, reason: alignment?.reason || '정합성 실패' }
  }

  const coreText = `${hook}\n${body}`
  if (guard?.category && guard.category !== '기타' && Array.isArray(guard.anchors) && guard.anchors.length) {
    const anchorHit = guard.anchors.some((term) => containsTerm(coreText, term))
    if (!anchorHit) {
      return { broken: true, reason: '주제 완전 이탈(핵심 구간 카테고리 미반영)' }
    }
  }

  return { broken: false, reason: '구조 통과' }
}

function scoreVariationQuality(variation = {}, config = {}, guard = {}) {
  const hook = String(variation?.hook || '').trim()
  const body = String(variation?.body || '').trim()
  const cta = String(variation?.cta || '').trim()
  const fullText = [hook, body, cta].filter(Boolean).join('\n')

  const sentenceSplit = (text) =>
    String(text || '')
      .split(/[.!?。！？\n]+/)
      .map((line) => line.trim())
      .filter(Boolean)

  const hookSentences = sentenceSplit(hook)
  const bodySentences = sentenceSplit(body)
  const ctaSentences = sentenceSplit(cta)
  const words = fullText.split(/\s+/).filter(Boolean)
  const averageSentenceLength = (() => {
    const all = [...hookSentences, ...bodySentences, ...ctaSentences]
    if (!all.length) return 999
    return all.reduce((sum, sentence) => sum + sentence.length, 0) / all.length
  })()

  let hookStrength = 3
  if (hook.length < 18 || hook.length > 120) hookStrength -= 1
  if (/(무너|손해|실수|놓치|바로|지금|절대|반전|왜)/.test(hook)) hookStrength += 1
  if (/하시나요\?/.test(hook)) hookStrength -= 1
  hookStrength = Math.max(1, Math.min(5, hookStrength))

  let clarity = 3
  if (averageSentenceLength > 55) clarity -= 1
  if (averageSentenceLength > 75) clarity -= 1
  if (bodySentences.length >= 2) clarity += 1
  if (words.length < 25) clarity -= 1
  clarity = Math.max(1, Math.min(5, clarity))

  let flow = 3
  if (hook && body && cta) flow += 1
  if (/(그래서|결국|이제|바로|먼저|다음)/.test(body)) flow += 1
  if (/(또한|한편|한편으로|그리고|그리고요)\s*(그리고|또한)/.test(body)) flow -= 1
  flow = Math.max(1, Math.min(5, flow))

  let ctaPower = 3
  if (/(지금|오늘|바로|저장|적용|실행|시작)/.test(cta)) ctaPower += 1
  if (cta.length < 18) ctaPower -= 1
  if (/(좋아요|팔로우)/.test(cta)) ctaPower -= 1
  ctaPower = Math.max(1, Math.min(5, ctaPower))

  let toneMatch = 3
  const angle = String(config?.angle || '')
  if (angle.includes('문제 제기') && /(문제|손해|실수|위험|무너)/.test(fullText)) toneMatch += 1
  if (angle.includes('정보 압축') && /(단계|기준|정리|체크|순서)/.test(fullText)) toneMatch += 1
  if (angle.includes('공감 유도') && /(저도|나도|공감|답답|겪어|이랬)/.test(fullText)) toneMatch += 1
  if (Array.isArray(guard?.settingCues) && guard.settingCues.length) {
    const cueHit = guard.settingCues.some((cue) => containsTerm(fullText, cue))
    if (!cueHit) toneMatch -= 1
  }
  toneMatch = Math.max(1, Math.min(5, toneMatch))

  const average = (hookStrength + clarity + flow + ctaPower + toneMatch) / 5
  return {
    hook_strength: hookStrength,
    clarity,
    flow,
    cta_power: ctaPower,
    tone_match: toneMatch,
    average,
  }
}

function shouldRegenerateByQuality(score = {}) {
  const averageThreshold = Number.isFinite(QUALITY_REGEN_AVERAGE_THRESHOLD)
    ? QUALITY_REGEN_AVERAGE_THRESHOLD
    : 3.2

  if ((score.average || 0) < averageThreshold) return true
  if ((score.hook_strength || 0) <= 2) return true
  if ((score.clarity || 0) <= 2) return true
  if ((score.tone_match || 0) <= 2) return true
  if ((score.cta_power || 0) <= 2) return true
  return false
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

function validateVariationAlignment(variation, guard, referenceGuard = {}) {
  if (!guard?.category || guard.category === '기타') {
    return { ok: true, reason: '카테고리 가드 없음', warnings: [] }
  }

  const text = [variation?.hook, variation?.body, variation?.cta]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('\n')

  if (!text) {
    return { ok: false, reason: '본문이 비어 있음', warnings: ['본문이 비어 있음'] }
  }

  const leakedTerm = findReferenceSurfaceLeakage(text, referenceGuard?.surfaceTerms || [])
  if (leakedTerm) {
    return { ok: false, reason: `레퍼런스 표면 단어 누출: ${leakedTerm}`, warnings: [] }
  }

  const metaLeakPattern = /(첫\s*\d+초|프레임|장면|클로즈업|화면|자막|영상|편집|연출|컷\s*전환)/i
  if (metaLeakPattern.test(text)) {
    return { ok: false, reason: '분석 메타 표현 누출', warnings: [] }
  }

  const evidenceProfile = inferEvidenceProfile(guard)
  const allowCreatorBusinessProof = ['AI', '전문직(회사홍보)', '교육', '재테크'].includes(evidenceProfile)
  if (!allowCreatorBusinessProof) {
    const mismatchedProof = text.match(CREATOR_BUSINESS_PROOF_PATTERN)?.[0]
    if (mismatchedProof) {
      return {
        ok: false,
        reason: `현재 도메인과 맞지 않는 사업형 근거 누출: ${mismatchedProof}`,
        warnings: [],
      }
    }
  }

  const warnings = []
  const anchorHits = (guard.anchors || []).filter((term) => containsTerm(text, term))
  if (guard.anchors?.length && anchorHits.length < 1) {
    warnings.push(`카테고리 키워드 반영이 약함: ${guard.anchors.slice(0, 4).join(', ')}`)
  }

  const hookText = String(variation?.hook || '').trim()
  const bodyText = String(variation?.body || '').trim()
  if (guard.anchors?.length) {
    const sectionAnchorHit = [hookText, bodyText].some((sectionText) =>
      guard.anchors.some((term) => containsTerm(sectionText, term)),
    )
    if (!sectionAnchorHit) {
      warnings.push(`카테고리 키워드가 HOOK/BODY 핵심 구간에 없음`)
    }
  }

  const settingCues = Array.isArray(guard.settingCues) ? guard.settingCues : []
  if (settingCues.length) {
    const cueHit = settingCues.some((cue) => containsTerm(text, cue))
    if (!cueHit) {
      warnings.push(`계정 설정 신호 반영이 약함: ${settingCues.slice(0, 3).join(', ')}`)
    }
  }

  // 세팅값 최우선 모드: 카테고리가 정해진 경우 핵심 구간(HOOK/BODY)에도 세팅 신호가 드러나야 통과.
  if (guard.category !== '기타' && settingCues.length) {
    const coreCueHit = settingCues.some(
      (cue) => containsTerm(hookText, cue) || containsTerm(bodyText, cue),
    )
    if (!coreCueHit) {
      warnings.push(`세팅 신호가 HOOK/BODY 핵심 구간에 없음: ${settingCues.slice(0, 2).join(', ')}`)
    }
  }

  const hardSettingCues = Array.isArray(guard.hardSettingCues) ? guard.hardSettingCues : []
  if (hardSettingCues.length) {
    const hardCueHit = hardSettingCues.some((cue) => containsTerm(text, cue))
    if (!hardCueHit) {
      warnings.push(`핵심 세팅 신호 미반영: ${hardSettingCues.slice(0, 2).join(', ')}`)
    }
  }

  return { ok: true, reason: '카테고리 정합 통과', warnings }
}

async function runStage(stage, context, task, hooks = {}) {
  const startedAt = Date.now()
  logStage('info', `${stage}:start`, context)
  if (typeof hooks.onStart === 'function') {
    await hooks.onStart(stage, context)
  }

  try {
    const result = await task()
    const elapsedMs = Date.now() - startedAt
    logStage('info', `${stage}:success`, { ...context, elapsedMs })
    if (typeof hooks.onSuccess === 'function') {
      await hooks.onSuccess(stage, { ...context, elapsedMs })
    }
    return result
  } catch (error) {
    const elapsedMs = Date.now() - startedAt
    const details = {
      stage,
      elapsedMs,
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
    if (typeof hooks.onFailed === 'function') {
      await hooks.onFailed(stage, {
        ...details,
        code: error.code || null,
        message: error.message,
      })
    }

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
  referenceId = null,
  projectId,
  title,
  topic,
  originalFilename,
  mimeType,
  cachedAnalysis,
}) {
  const payload = {
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
    current_stage: 'cache-reuse',
    failure_stage: null,
    failure_code: null,
    failure_message: null,
    processing_completed_at: new Date().toISOString(),
    document_id: cachedAnalysis.document_id || null,
  }
  const { data, error } = await persistReferenceVideoRowWithFallback({
    supabaseAdmin,
    mode: referenceId ? 'update' : 'insert',
    accountId,
    referenceId,
    payload,
    removableColumns: [
      'project_id',
      'current_stage',
      'failure_stage',
      'failure_code',
      'failure_message',
      'processing_completed_at',
    ],
    detail: true,
  })

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
  idempotencyKey = '',
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
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey)
  const analysisFingerprint = await computeUploadedFileFingerprint(file)
  const topicFocusPrompt = buildTopicFocusPrompt(normalizedTopic, normalizedTitle)
  const analysisReuseCacheKey = buildAnalysisReuseCacheKey({
    accountId,
    topic: normalizedTopic,
    title: normalizedTitle,
    originalFilename: normalizedOriginalName,
    fileFingerprint: analysisFingerprint,
    characterSystemPrompt,
  })
  const inFlightKey = [accountId, normalizedIdempotencyKey || analysisFingerprint].join(':')
  if (ANALYZE_IN_FLIGHT.has(inFlightKey)) {
    const inFlightReferenceId = ANALYZE_IN_FLIGHT.get(inFlightKey)
    if (inFlightReferenceId) {
      const inFlightReference = await getReferenceVideo(inFlightReferenceId, accountId)
      return inFlightReference
    }
  }

  const duplicateReference = await findRecentDuplicateReference({
    supabaseAdmin,
    accountId,
    idempotencyKey: normalizedIdempotencyKey,
    analysisFingerprint,
  })
  if (duplicateReference?.id) {
    if (duplicateReference.processing_status === 'processing') {
      let { data: inProgress, error: inProgressError } = await supabaseAdmin
        .from('reference_videos')
        .select(selectReferenceVideoColumns({ includeProjectId: true, detail: true }))
        .eq('id', duplicateReference.id)
        .eq('account_id', accountId)
        .maybeSingle()
      if (isMissingProjectColumnError(inProgressError)) {
        const fallback = await supabaseAdmin
          .from('reference_videos')
          .select(selectReferenceVideoColumns({ includeProjectId: false, detail: true }))
          .eq('id', duplicateReference.id)
          .eq('account_id', accountId)
          .maybeSingle()
        inProgress = fallback.data ? { ...fallback.data, project_id: null } : fallback.data
        inProgressError = fallback.error
      }
      if (inProgress) {
        return {
          ...inProgress,
          global_knowledge_debug: [],
          global_knowledge_categories: [],
        }
      }
      if (inProgressError) {
        console.warn('[reference-video-analysis] duplicate in-progress fetch failed', {
          accountId,
          referenceId: duplicateReference.id,
          message: inProgressError.message,
        })
      }
    }
    return getReferenceVideo(duplicateReference.id, accountId)
  }

  const processingReference = await createProcessingReferenceVideo({
    supabaseAdmin,
    accountId,
    projectId: normalizedProjectId,
    title: normalizedTitle,
    topic: normalizedTopic,
    originalFilename: normalizedOriginalName,
    mimeType: file.mimetype,
    idempotencyKey: normalizedIdempotencyKey,
    analysisFingerprint,
  })
  ANALYZE_IN_FLIGHT.set(inFlightKey, processingReference.id)

  if (cacheConfig.enableAnalysisResultReuse) {
    try {
      const cachedAnalysis = await getCacheJson(analysisReuseCacheKey)
      if (cachedAnalysis && typeof cachedAnalysis === 'object') {
        const categoryGuard = buildCategoryGuard({
          accountSettings,
          characterSystemPrompt,
        })
        const cachedReferenceGuard = {
          surfaceTerms: extractReferenceSurfaceTerms({
            title: cachedAnalysis.title || normalizedTitle,
            topic: cachedAnalysis.topic || normalizedTopic,
            transcript: cachedAnalysis.transcript || '',
          }),
        }
        const cachedVariations = Array.isArray(cachedAnalysis.variations)
          ? cachedAnalysis.variations
          : []
        const cachedValidation = cachedVariations.map((variation, index) =>
          validateVariationAlignment(
            normalizeVariationForValidation(variation, index),
            categoryGuard,
            cachedReferenceGuard,
          ),
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
          referenceId: processingReference.id,
          projectId: normalizedProjectId,
          title: normalizedTitle,
          topic: normalizedTopic,
          originalFilename: normalizedOriginalName,
          mimeType: file.mimetype,
          cachedAnalysis,
        })

        ANALYZE_IN_FLIGHT.delete(inFlightKey)
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
      referenceId: processingReference.id,
    }
    const stageMetrics = {}
    const stageHooks = {
      onStart: async (stage) => {
        await updateReferenceLifecycleState({
          supabaseAdmin,
          referenceId: processingReference.id,
          accountId,
          patch: {
            processing_status: 'processing',
            current_stage: stage,
            failure_stage: null,
            failure_code: null,
            failure_message: null,
          },
        })
      },
      onSuccess: async (stage, meta = {}) => {
        stageMetrics[stage] = Number(meta.elapsedMs || 0)
        await updateReferenceLifecycleState({
          supabaseAdmin,
          referenceId: processingReference.id,
          accountId,
          patch: {
            current_stage: stage,
          },
        })
      },
      onFailed: async (stage, meta = {}) => {
        await updateReferenceLifecycleState({
          supabaseAdmin,
          referenceId: processingReference.id,
          accountId,
          patch: {
            processing_status: 'failed',
            current_stage: stage,
            failure_stage: stage,
            failure_code: meta.code || 'ANALYSIS_STAGE_FAILED',
            failure_message: meta.message || '분석 단계 실패',
          },
        })
      },
    }

    const created = await runStage('workspace', baseContext, async () => createVideoWorkspace(file), stageHooks)
    workspace = created.workspace

    const durationSeconds = await runStage(
      'probe-duration',
      baseContext,
      async () => getVideoDuration(created.videoPath),
      stageHooks,
    )
    const cappedAudioSeconds =
      Number.isFinite(DEFAULT_ANALYSIS_AUDIO_MAX_SECONDS) && DEFAULT_ANALYSIS_AUDIO_MAX_SECONDS > 0
        ? Math.max(30, Math.min(180, DEFAULT_ANALYSIS_AUDIO_MAX_SECONDS))
        : 90
    const transcriptCapped = durationSeconds > cappedAudioSeconds
    const hasAudio = await runStage(
      'probe-audio-stream',
      baseContext,
      async () => hasAudioStream(created.videoPath),
      stageHooks,
    )
    const audioPath = hasAudio
      ? await runStage(
          'extract-audio',
          baseContext,
          async () =>
            extractAudioTrack(created.videoPath, workspace, {
              maxDurationSeconds: cappedAudioSeconds,
            }),
          stageHooks,
        )
      : null
    const transcript = hasAudio
      ? await runStage(
          'transcription',
          baseContext,
          async () =>
            transcribeVideoAudio(audioPath, {
              title: normalizedTitle,
              topic: normalizedTopic,
            }),
          stageHooks,
        )
      : {
          text: '',
          segments: [],
          duration: null,
          model: null,
        }
    const frames = await runStage(
      'extract-frames',
      { ...baseContext, durationSeconds },
      async () => extractFrames(created.videoPath, workspace, durationSeconds),
      stageHooks,
    )
    const frameAnalysis = await runStage(
      'vision',
      { ...baseContext, frameCount: frames.length },
      async () =>
        analyzeVideoFrames(frames, {
          title: normalizedTitle,
          topic: normalizedTopic,
        }),
      stageHooks,
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
            transcriptCapped,
            transcriptCapSeconds: cappedAudioSeconds,
            category: 'reference-video',
          },
        }),
      stageHooks,
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
      stageHooks,
    )

    const analysisResponse = await runStage(
      'analysis-gpt',
      baseContext,
      async () =>
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
      stageHooks,
    )

    const analysisResult = await runStage(
      'parse-analysis-json',
      baseContext,
      async () => parseModelJson(analysisResponse.choices[0]?.message?.content || ''),
      stageHooks,
    )
    const generationGuides = buildGenerationGuides({ analysisResult })
    const referenceGuard = {
      surfaceTerms: extractReferenceSurfaceTerms({
        title: normalizedTitle,
        topic: normalizedTopic,
        transcript: normalizedTranscript || '',
      }),
    }
    const structureBlueprint = await runStage(
      'extract-structure-blueprint',
      baseContext,
      async () =>
        buildStructureBlueprint({
          openai,
          chatModel,
          analysisResult,
          transcript: normalizedTranscript || '',
        }),
      stageHooks,
    )

    const categoryGuard = buildCategoryGuard({
      accountSettings,
      characterSystemPrompt,
    })
    const categoryPlaybook = getCategoryPlaybook(categoryGuard.category)
    const playbookPrompt = buildPlaybookPrompt(categoryPlaybook)
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
      '계정 카테고리/세팅 신호는 강하게 참고하되, 억지 키워드 삽입보다 자연스러운 문장을 우선한다.',
    ]
      .filter(Boolean)
      .join('\n')

    const generatedVariationsRaw = await Promise.all(
      VARIATION_CONFIGS.map((config) =>
        runStage(`variation-${config.label}`, { ...baseContext, angle: config.angle }, async () => {
          const variationKnowledge = await retrieveGlobalKnowledgeContext({
            title: '',
            topic: `${topicFocusPrompt ? `${topicFocusPrompt}\n` : ''}카테고리: ${categoryGuard.category}\n전략: ${config.angle}\n검색 힌트: ${config.retrievalHint}`,
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
            '우선순위 규칙(절대 준수): 캐릭터 고정 규칙 > 이번 릴스 주제 > 계정/타겟/상품 맥락 > 전략 라벨/전략 의도 > 레퍼런스 전사.',
            '레퍼런스 제목/파일명/원문 주제는 콘텐츠 도메인 결정에 사용하지 마라.',
            '레퍼런스 전사는 "내용 복사"가 아니라 구조/리듬/전개 방식 참고용이다.',
            '레퍼런스 원문의 업종/소재/고유명사를 그대로 가져오지 마라. 계정 카테고리와 충돌하면 반드시 계정 카테고리로 재해석하라.',
            '즉, 계정이 뷰티/패션이면 건축/부동산/공학 같은 이질 도메인으로 쓰지 말고 뷰티 도메인으로 전환해서 작성하라.',
            'HOOK/BODY/CTA는 반드시 하나의 이야기 흐름으로 연결하라.',
            'HOOK은 레퍼런스의 문장 구조와 리듬을 가장 강하게 참고하되, BODY/CTA는 계정 도메인 기준으로 새로 전개하라.',
            'HOOK에서 던진 긴장/문제를 BODY 첫 문장에서 이어받고, CTA는 BODY 결론을 행동으로 전환해야 한다.',
            '아래 인사이트/체크포인트는 필요한 만큼 자연스럽게 반영하고, usedInsights/usedCheckpoints에는 실제로 참고한 항목만 기록하라.',
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
            `${topicFocusPrompt ? `${topicFocusPrompt}\n\n` : ''}` +
            `${playbookPrompt ? `${playbookPrompt}\n\n` : ''}` +
            `카테고리 강제 가드(절대 준수):\n${categoryGuardText}\n\n` +
            `캐릭터 세팅 요약(절대 우선):\n${characterSystemPrompt || '설정 없음'}\n\n` +
            `레퍼런스 금지 표면 단어(절대 사용 금지): ${referenceGuard.surfaceTerms.join(', ') || '없음'}\n\n` +
            `${buildEvidenceTranslationGuide(categoryGuard)}\n\n` +
            `논리 구조 청사진:\n${
              structureBlueprint.logicFlow.length
                ? structureBlueprint.logicFlow.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
                : '- 없음'
            }\n\n` +
            `설득 패턴:\n${
              structureBlueprint.persuasionPattern.length
                ? structureBlueprint.persuasionPattern.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
                : '- 없음'
            }\n\n` +
            `메시지 구조:\n${
              structureBlueprint.messageStructure.length
                ? structureBlueprint.messageStructure.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
                : '- 없음'
            }\n\n` +
            `HOOK 문장 구조 참고(가장 중요):\n${
              structureBlueprint.hookSentencePattern.length
                ? structureBlueprint.hookSentencePattern.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
                : '- 없음'
            }\n\n` +
            `레퍼런스 HOOK 장점(강하게 반영):\n${
              structureBlueprint.hookAdvantagePattern.length
                ? structureBlueprint.hookAdvantagePattern.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
                : '- 없음'
            }\n\n` +
            '작성 강제 조건:\n' +
            '- 이번 릴스 주제가 주어졌다면 hook/body/cta 모두 그 주제를 직접 다뤄야 한다\n' +
            '- 계정 카테고리는 큰 방향이고, 이번 릴스 주제는 실제 소재/상품/상황을 결정하는 우선값이다\n' +
            '- 1단계: 논리 구조만 사용\n' +
            '- 2단계: 현재 계정 도메인으로 완전 변환\n' +
            '- 2.5단계: 이번 릴스 주제에 맞게 구체 소재를 좁힌다\n' +
            '- 3단계: 완전히 새로운 주장(thesis) 생성\n' +
            '- 4단계: thesis 기반으로 HOOK/BODY/CTA 작성\n' +
            '- 레퍼런스 표면 단어/문장 변형/원문 주제 복사 금지\n' +
            '- HOOK은 위의 HOOK 문장 구조 참고를 따라 시작 방식과 문장 호흡을 최대한 비슷하게 맞춘다\n' +
            '- HOOK은 레퍼런스 HOOK 장점 항목 중 최소 2개를 명확히 반영한다\n' +
            '- 단, HOOK도 원문 단어/원문 상황/고유명사는 절대 사용 금지\n' +
            '- BODY/CTA는 레퍼런스 문장 구조를 따라 쓰지 말고 현재 계정 맥락으로 자연스럽게 새로 쓴다\n' +
            '- 계정 설정(카테고리/타겟/상품/톤)에 맞는 도메인으로 작성\n' +
            '- 키워드를 억지로 끼워 넣지 말고, 자연스러운 주장과 흐름을 우선\n\n' +
            `핵심 인사이트(우선 참고):\n${
              generationGuides.keyInsights.length
                ? generationGuides.keyInsights.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
                : '- 없음'
            }\n\n` +
            `바로 써먹을 체크포인트(우선 참고):\n${
              generationGuides.checkpoints.length
                ? generationGuides.checkpoints.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
                : '- 없음'
            }\n\n` +
            `세팅 신호(직접적이고 자연스럽게 반영): ${
              guardPromptSummary.settingCues.join(', ') || '없음'
            }\n\n` +
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
          let didRegenerate = false
          let variationUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

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
                content: baseUserContent,
              },
            ],
          })
          variationUsage = sumAIUsage(
            variationUsage,
            logAIUsage('abc-generate', variationResponse, {
              model: chatModel,
              accountId,
              referenceId: processingReference.id,
              label: config.label,
              angle: config.angle,
            }),
          )

          const parsed = parseModelJson(variationResponse.choices[0]?.message?.content || '')
          normalized = normalizeVariationDraft(parsed, config, generationGuides)
          alignment = validateVariationAlignment(normalized, categoryGuard, referenceGuard)

          const structureState = isVariationStructureBroken(normalized, alignment, categoryGuard)

          if (ENABLE_COST_GUARD && structureState.broken) {
            normalized = await regenerateVariationWithGPT({
              openai,
              chatModel,
              config,
              categoryGuard,
                guardPromptSummary,
                characterSystemPrompt,
                generationGuides,
                structureBlueprint,
                referenceSurfaceTerms: referenceGuard.surfaceTerms,
                focusTopic: normalizedTopic,
                referenceTitle: normalizedTitle,
                retryReason: structureState.reason,
                usageContext: {
                  accountId,
                  referenceId: processingReference.id,
                  label: config.label,
                  angle: config.angle,
                },
              })
            variationUsage = sumAIUsage(variationUsage, normalized?.usage)
            if (normalized?.usage) {
              delete normalized.usage
            }
            alignment = validateVariationAlignment(normalized, categoryGuard, referenceGuard)
            didRegenerate = true
          } else if (ENABLE_COST_GUARD) {
            const qualityScore = scoreVariationQuality(normalized, config, categoryGuard)
            if (shouldRegenerateByQuality(qualityScore)) {
              normalized = await regenerateVariationWithGPT({
                openai,
                chatModel,
                config,
                categoryGuard,
                guardPromptSummary,
                characterSystemPrompt,
                generationGuides,
                structureBlueprint,
                referenceSurfaceTerms: referenceGuard.surfaceTerms,
                focusTopic: normalizedTopic,
                referenceTitle: normalizedTitle,
                retryReason: `품질 점수 기준 미달: avg=${qualityScore.average.toFixed(2)}`,
                usageContext: {
                  accountId,
                  referenceId: processingReference.id,
                  label: config.label,
                  angle: config.angle,
                },
              })
              variationUsage = sumAIUsage(variationUsage, normalized?.usage)
              if (normalized?.usage) {
                delete normalized.usage
              }
              alignment = validateVariationAlignment(normalized, categoryGuard, referenceGuard)
              didRegenerate = true
            }
          } else {
            // Legacy path: if cost guard is off, keep a single fallback regenerate for hard misalignment only.
            if (normalized && !alignment.ok) {
              normalized = await regenerateVariationWithGPT({
                openai,
                chatModel,
                config,
                categoryGuard,
                guardPromptSummary,
                characterSystemPrompt,
                generationGuides,
                structureBlueprint,
                referenceSurfaceTerms: referenceGuard.surfaceTerms,
                focusTopic: normalizedTopic,
                referenceTitle: normalizedTitle,
                retryReason: alignment.reason,
                usageContext: {
                  accountId,
                  referenceId: processingReference.id,
                  label: config.label,
                  angle: config.angle,
                },
              })
              variationUsage = sumAIUsage(variationUsage, normalized?.usage)
              if (normalized?.usage) {
                delete normalized.usage
              }
              alignment = validateVariationAlignment(normalized, categoryGuard, referenceGuard)
              didRegenerate = true
            }
          }

          if (!normalized) {
            normalized = await regenerateVariationWithGPT({
              openai,
              chatModel,
              config,
              categoryGuard,
              guardPromptSummary,
              characterSystemPrompt,
              generationGuides,
              structureBlueprint,
              referenceSurfaceTerms: referenceGuard.surfaceTerms,
              focusTopic: normalizedTopic,
              referenceTitle: normalizedTitle,
              retryReason: '초안 생성 결과가 비어 있음',
              usageContext: {
                accountId,
                referenceId: processingReference.id,
                label: config.label,
                angle: config.angle,
              },
            })
            variationUsage = sumAIUsage(variationUsage, normalized?.usage)
            if (normalized?.usage) {
              delete normalized.usage
            }
            alignment = validateVariationAlignment(normalized, categoryGuard, referenceGuard)
            didRegenerate = true
          }

          // Guard mode: regenerate와 polish를 동시 실행하지 않는다.
          if (normalized && alignment.ok && !didRegenerate && needsFlowPolish(normalized)) {
            try {
              const polishResponse = await openai.chat.completions.create({
                model: chatModel,
                temperature: 0.2,
                messages: [
                  {
                    role: 'system',
                    content:
                      '당신은 숏폼 스크립트 문장 다듬기 편집자다. 의미는 유지하고 문장만 더 자연스럽게 고친다. ' +
                      '영상 분석 메타 표현(예: 첫 3초, 자막, 클로즈업, 화면, 장면, 문구)을 절대 쓰지 마라. ' +
                      '출력은 JSON만 반환한다.',
                  },
                  {
                    role: 'user',
                    content:
                      `전략 라벨: ${config.label}\n전략 방향: ${config.angle}\n` +
                      `카테고리: ${categoryGuard.category}\n` +
                      `${topicFocusPrompt ? `${topicFocusPrompt}\n` : ''}` +
                      `세팅 신호(최소 1개 유지): ${guardPromptSummary.settingCues.join(', ') || '없음'}\n\n` +
                      `현재 초안:\nHOOK: ${normalized.hook}\n\nBODY: ${normalized.body}\n\nCTA: ${normalized.cta}\n\n` +
                      '수정 조건:\n' +
                      '- 이번 릴스 주제는 유지하고 더 또렷하게\n' +
                      '- 훅/바디/CTA 연결 흐름 유지\n' +
                      '- 의미는 유지하고 문장만 자연스럽게\n' +
                      '- 설명문 말투보다 실제 말하는 톤으로\n' +
                      '- 전략 라벨 톤은 유지\n\n' +
                      '다음 JSON 형식으로만 답하세요: {"hook":"","body":"","cta":""}',
                  },
                ],
              })
              variationUsage = sumAIUsage(
                variationUsage,
                logAIUsage('abc-polish', polishResponse, {
                  model: chatModel,
                  accountId,
                  referenceId: processingReference.id,
                  label: config.label,
                  angle: config.angle,
                }),
              )
              const polished = parseModelJson(polishResponse.choices[0]?.message?.content || '')
              normalized = {
                ...normalized,
                hook: String(polished?.hook || normalized.hook || '').trim(),
                body: String(polished?.body || normalized.body || '').trim(),
                cta: String(polished?.cta || normalized.cta || '').trim(),
              }
              alignment = validateVariationAlignment(normalized, categoryGuard, referenceGuard)
            } catch (_error) {
              // Keep original draft when polish step fails.
            }
          }

          const knowledgeItems = mapGlobalKnowledgeDebug(variationKnowledge.items || [])
          logAIUsage('abc-total', variationUsage, {
            model: chatModel,
            accountId,
            referenceId: processingReference.id,
            label: config.label,
            angle: config.angle,
          })

          return {
            ...normalized,
            alignment,
            usedChunkIds: knowledgeItems.map((item) => item.id),
            usedKnowledge: knowledgeItems,
          }
        }, stageHooks),
      ),
    )
    const generatedVariations = enforceVariationDiversity(generatedVariationsRaw, categoryGuard)

    const { data: row, error } = await runStage(
      'save-reference-video',
      baseContext,
      async () => {
        const updatePayload = {
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
          current_stage: 'save-reference-video',
          failure_stage: null,
          failure_code: null,
          failure_message: null,
          processing_completed_at: new Date().toISOString(),
          document_id: ingestedDocument.document.id,
        }

        return persistReferenceVideoRowWithFallback({
          supabaseAdmin,
          mode: 'update',
          accountId,
          referenceId: processingReference.id,
          payload: updatePayload,
          removableColumns: [
            'project_id',
            'current_stage',
            'failure_stage',
            'failure_code',
            'failure_message',
            'processing_completed_at',
          ],
          detail: true,
        })
      },
      stageHooks,
    )

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

    await runStage(
      'sync-reference-analysis',
      baseContext,
      async () =>
        syncReferenceAnalysis({
          supabaseAdmin,
          accountId,
          legacyReferenceVideo: row,
          transcriptDocumentContent,
          topic: normalizedTopic,
          source: normalizedOriginalName,
        }),
      stageHooks,
    )

    const output = {
      ...row,
      global_knowledge_debug: mapGlobalKnowledgeDebug(globalKnowledge.items || []),
      global_knowledge_categories: globalKnowledge.categories || [],
      category_playbook: buildCategoryPlaybookPayload(categoryGuard.category, categoryPlaybook),
      analysis_stage_metrics: stageMetrics,
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
    await updateReferenceLifecycleState({
      supabaseAdmin,
      referenceId: processingReference.id,
      accountId,
      patch: {
        processing_status: 'failed',
        current_stage: error?.details?.stage || 'unknown',
        failure_stage: error?.details?.stage || 'unknown',
        failure_code: error?.code || 'REFERENCE_VIDEO_ANALYSIS_FAILED',
        failure_message: error?.message || 'Reference video analysis failed',
      },
    })

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
    ANALYZE_IN_FLIGHT.delete(inFlightKey)
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
  let resolvedCategory = ''
  let categoryPlaybook = null

  try {
    const profile = await getAccountProfile(accountId)
    const settings =
      profile?.settings && typeof profile.settings === 'object'
        ? profile.settings
        : {}
    resolvedCategory = normalizeCategoryLabel(settings.category || '')
    categoryPlaybook = getCategoryPlaybook(resolvedCategory)
  } catch (error) {
    logAIError('analysis', error, {
      stage: 'reference-detail-account-profile',
      referenceVideoId,
      accountId,
    })
  }

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
    category_playbook: buildCategoryPlaybookPayload(resolvedCategory, categoryPlaybook),
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
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('reference_videos')
    .select('id, title, document_id')
    .eq('id', referenceVideoId)
    .eq('account_id', accountId)
    .maybeSingle()

  if (existingError) {
    throw new AppError('Failed to load reference video analysis', {
      code: 'REFERENCE_VIDEO_FETCH_FAILED',
      statusCode: 500,
      cause: existingError,
    })
  }

  if (!existing) {
    throw new AppError('Reference video analysis not found', {
      code: 'REFERENCE_VIDEO_NOT_FOUND',
      statusCode: 404,
    })
  }

  try {
    const { data: analyses } = await supabaseAdmin
      .from('reference_analyses')
      .select('id')
      .eq('account_id', accountId)
      .eq('legacy_reference_video_id', referenceVideoId)

    const analysisIds = Array.isArray(analyses) ? analyses.map((item) => item.id).filter(Boolean) : []
    if (analysisIds.length) {
      await supabaseAdmin
        .from('reference_analysis_chunks')
        .delete()
        .eq('account_id', accountId)
        .in('reference_analysis_id', analysisIds)

      await supabaseAdmin
        .from('reference_analyses')
        .delete()
        .eq('account_id', accountId)
        .in('id', analysisIds)
    }

    if (existing.document_id) {
      await supabaseAdmin
        .from('chunks')
        .delete()
        .eq('account_id', accountId)
        .eq('document_id', existing.document_id)

      await supabaseAdmin
        .from('documents')
        .delete()
        .eq('account_id', accountId)
        .eq('id', existing.document_id)
    }
  } catch (cleanupError) {
    console.warn('[reference-video-analysis] delete cleanup warning', {
      referenceVideoId,
      accountId,
      message: cleanupError?.message || 'unknown',
    })
  }

  const { data: deleted, error } = await supabaseAdmin
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

  if (!deleted) {
    throw new AppError('Reference video analysis not found', {
      code: 'REFERENCE_VIDEO_NOT_FOUND',
      statusCode: 404,
    })
  }

  return deleted
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
