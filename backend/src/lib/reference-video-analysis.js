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
const ENABLE_QUALITY_REGEN = String(process.env.FEATURE_ABC_QUALITY_REGEN || 'false') === 'true'
const ENABLE_ABC_POLISH = String(process.env.FEATURE_ABC_POLISH || 'false') === 'true'
const QUALITY_REGEN_AVERAGE_THRESHOLD = Number.parseFloat(
  String(process.env.QUALITY_REGEN_AVERAGE_THRESHOLD || '3.2'),
)
const DEFAULT_ANALYSIS_AUDIO_MAX_SECONDS = Number.parseInt(
  process.env.REFERENCE_ANALYSIS_AUDIO_MAX_SECONDS || '90',
  10,
)
const CURRENT_CONTENT_YEAR = String(process.env.CURRENT_CONTENT_YEAR || '2026').trim() || '2026'
const VARIATION_NATURAL_VOICE_RULES = [
  '말투 규칙(절대 준수): 실제 릴스에서 말하는 짧은 해요체/대화체로 쓴다.',
  '하십시오체/보고서체/강의안체를 금지한다. "~합니다", "~드립니다", "~제공합니다"로 문장을 끝내지 않는다.',
  '번역투와 어색한 조합을 금지한다. "개인용 환경", "특수한 고민 해결법", "압축 제공", "직접적으로 공유", "완전히 버리겠습니다" 같은 표현을 쓰지 않는다.',
  '추상 명사보다 실제 상황을 쓴다. "정보를 제공한다"가 아니라 "무엇을 어떻게 하면 달라지는지"로 쓴다.',
  '없는 지역명/상품명/원인/상황을 지어내지 않는다. 계정 설정이나 이번 릴스 주제에 있는 소재만 구체화한다.',
  'HOOK/BODY/CTA는 각각 읽었을 때 바로 이해되는 자연스러운 한국어여야 한다.',
].join('\n')

const AWKWARD_KOREAN_PATTERN =
  /(개인용\s*환경|특수한\s*[^\n]{0,12}고민|압축\s*제공|직접적으로\s*공유|완전히\s*버리겠습니다|반사되는\s*게\s*두려|대전\s*얼굴|난\s*때문에|다시\s*그늘|자료를\s*관리|이\s*자료로|수많은\s*제품과\s*방법|것이\s*아니라\s*스스로|관리하는\s*루틴을\s*더\s*이상\s*좋아하지)/i
const REPORT_STYLE_PATTERN = /(?:제공|공유|관리|적용|제시|유도|활용)(?:합니다|하세요|할\s*수\s*있습니다|된다)\.?$/i
const TRANSCRIPT_RELIABILITY_LOW_THRESHOLD = Number.parseInt(
  process.env.TRANSCRIPT_RELIABILITY_LOW_THRESHOLD || '45',
  10,
)
const DEFAULT_REFERENCE_TITLE = '레퍼런스 영상'
const MAX_VARIATION_ANGLE_LENGTH = 8
const MAX_SENTENCE_BLUEPRINT_ITEMS = 12
const STRUCTURE_MATCH_RETRY_THRESHOLD = 68
const STRICT_STRUCTURE_MATCH_RETRY_THRESHOLD = 74
const STRUCTURE_MATCH_HARD_RETRY_THRESHOLD = Number.parseInt(
  String(process.env.STRUCTURE_MATCH_HARD_RETRY_THRESHOLD || '45'),
  10,
)
const RECORDING_METADATA_PATTERN =
  /(screen\s*record(?:ing)?|screenrecording|screen\s*shot|screenshot|스크린\s*샷|스크린샷|화면\s*기록|화면기록|녹화|녹화본|recording)/gi
const DATE_TIME_METADATA_PATTERN =
  /(?:20\d{2}[-./년]\s*\d{1,2}[-./월]\s*\d{1,2}(?:일)?(?:\s*(?:오전|오후|am|pm|at)?\s*\d{1,2}[:.시]\s*\d{2}(?:[:.분]\s*\d{2})?(?:초)?)?|\d{1,2}[-._]\d{1,2}[-._]\d{1,4}|\d{1,2}\s*월\s*\d{1,2}\s*일(?:\s*(?:오전|오후)?\s*\d{1,2}\s*시\s*\d{1,2}\s*분?(?:\s*\d{1,2}\s*초)?)?|\b\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\b)/gi
const GENERATED_METADATA_LEAK_PATTERN =
  /(20\d{2}[-./년]\s*\d{1,2}[-./월]\s*\d{1,2}|\d{1,2}\s*월\s*\d{1,2}\s*일\s*(?:오전|오후)?\s*\d{1,2}\s*시|\d{1,2}[:.]\d{2}[:.]\d{2}|찍힌|촬영일|녹화일|업로드일|파일명|screen\s*record|screenrecording|화면\s*기록)/i

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

const ANALYSIS_PROMPT_VERSION = String(process.env.ANALYSIS_PROMPT_VERSION || 'v5').trim() || 'v5'
const ANALYZE_DEDUPE_WINDOW_MINUTES = Number.parseInt(
  String(process.env.ANALYZE_DEDUPE_WINDOW_MINUTES || '30'),
  10,
)
const PROCESSING_TIMEOUT_MINUTES = Number.parseInt(
  String(process.env.REFERENCE_PROCESSING_TIMEOUT_MINUTES || '15'),
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
        'analysis_stage_metrics',
        'transcript_quality',
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
        'analysis_stage_metrics',
        'transcript_quality',
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

async function expireStaleProcessingReferences({ supabaseAdmin, accountId, referenceId = null }) {
  if (!accountId || !Number.isFinite(PROCESSING_TIMEOUT_MINUTES) || PROCESSING_TIMEOUT_MINUTES <= 0) {
    return
  }

  const timeoutMs = PROCESSING_TIMEOUT_MINUTES * 60 * 1000
  const staleBefore = new Date(Date.now() - timeoutMs).toISOString()
  const timeoutMessage = '분석 시간이 초과되었습니다. 영상을 다시 업로드해주세요.'
  const basePatch = {
    processing_status: 'failed',
    current_stage: 'timeout',
    failure_stage: 'timeout',
    failure_code: 'REFERENCE_PROCESSING_TIMEOUT',
    failure_message: timeoutMessage,
    error_message: timeoutMessage,
    processing_completed_at: new Date().toISOString(),
    last_heartbeat_at: new Date().toISOString(),
  }
  const removableColumns = new Set([
    'current_stage',
    'failure_stage',
    'failure_code',
    'failure_message',
    'error_message',
    'processing_completed_at',
    'last_heartbeat_at',
  ])
  const buildQuery = (payload) => {
    let query = supabaseAdmin
      .from('reference_videos')
      .update(payload)
      .eq('account_id', accountId)
      .eq('processing_status', 'processing')
      .lt('created_at', staleBefore)

    if (referenceId) {
      query = query.eq('id', referenceId)
    }

    return query
  }

  let payload = { ...basePatch }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { error } = await buildQuery(payload)
    if (!error) {
      return
    }

    const missingColumn = extractMissingColumnName(error)
    if (!missingColumn || !removableColumns.has(missingColumn)) {
      console.warn('[reference-video-analysis] stale processing cleanup failed', {
        accountId,
        referenceId,
        code: error.code || null,
        message: error.message,
      })
      return
    }

    delete payload[missingColumn]
  }
}

function logStage(level, stage, context = {}) {
  const debugEnabled = String(process.env.DEBUG_REFERENCE_ANALYSIS || '').trim() === '1'
  if (level !== 'error' && process.env.NODE_ENV === 'production' && !debugEnabled) {
    return
  }

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

function normalizeComparableGuideText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[“”"'\[\]{}()<>.,!?;:·•\-–—_~`|/\\]/g, ' ')
    .replace(/\b(hook|body|cta|ai|a\/b\/c)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isSimilarGuideText(a = '', b = '') {
  const left = normalizeComparableGuideText(a)
  const right = normalizeComparableGuideText(b)
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

function normalizeStringList(values = [], max = 3) {
  if (!Array.isArray(values)) {
    return []
  }

  const deduped = []
  for (const value of values) {
    const normalized = String(value || '').trim()
    if (!normalized) continue
    if (deduped.some((item) => isSimilarGuideText(item, normalized))) continue
    deduped.push(normalized)
    if (deduped.length >= max) break
  }
  return deduped
}

function removeOverlappingGuideItems(primary = [], secondary = [], max = 4) {
  const normalizedPrimary = normalizeStringList(primary, max)
  const filteredSecondary = []

  for (const value of Array.isArray(secondary) ? secondary : []) {
    const normalized = String(value || '').trim()
    if (!normalized) continue
    if (normalizedPrimary.some((item) => isSimilarGuideText(item, normalized))) continue
    if (filteredSecondary.some((item) => isSimilarGuideText(item, normalized))) continue
    filteredSecondary.push(normalized)
    if (filteredSecondary.length >= max) break
  }

  return {
    primary: normalizedPrimary,
    secondary: filteredSecondary,
  }
}

function clampText(text = '', maxLength = 800) {
  const normalized = String(text || '').trim()
  if (!normalized) return ''
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

function normalizeGeneratedYearReferences(text = '') {
  return String(text || '').replace(/\b2024년/g, `${CURRENT_CONTENT_YEAR}년`)
}

function normalizeAnalysisYearReferences(analysisResult = {}) {
  if (!analysisResult || typeof analysisResult !== 'object') {
    return analysisResult
  }

  return {
    ...analysisResult,
    structureAnalysis: normalizeGeneratedYearReferences(analysisResult.structureAnalysis || ''),
    hookAnalysis: normalizeGeneratedYearReferences(analysisResult.hookAnalysis || ''),
    psychologyAnalysis: normalizeGeneratedYearReferences(analysisResult.psychologyAnalysis || ''),
    aiFeedback: normalizeGeneratedYearReferences(analysisResult.aiFeedback || ''),
  }
}

function normalizeVariationYearReferences(variation = {}) {
  if (!variation || typeof variation !== 'object') {
    return variation
  }

  return {
    ...variation,
    hook: normalizeGeneratedYearReferences(variation.hook || ''),
    body: normalizeGeneratedYearReferences(variation.body || ''),
    cta: normalizeGeneratedYearReferences(variation.cta || ''),
  }
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

function resolveVoiceToneLabels(accountSettings = {}) {
  const rawValues = Array.isArray(accountSettings?.voiceTones)
    ? accountSettings.voiceTones
    : [accountSettings?.voiceTone]

  return rawValues
    .map((item) => String(item || '').trim())
    .filter((item, index, array) => item && array.indexOf(item) === index)
    .slice(0, 2)
    .map((item) => normalizeSettingCue(VOICE_TONE_LABELS[item] || item))
    .filter(Boolean)
}

function buildSettingCues(accountSettings = {}) {
  const persona = accountSettings?.persona && typeof accountSettings.persona === 'object'
    ? accountSettings.persona
    : {}
  const characterPrompt = normalizeSettingCue(accountSettings?.characterPrompt)
  const aiAdditionalInfo = normalizeSettingCue(accountSettings?.aiAdditionalInfo)
  const voiceToneLabels = resolveVoiceToneLabels(accountSettings)
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

  for (const label of voiceToneLabels) {
    cues.push(label)
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

  const deduped = removeOverlappingGuideItems(
    insights.filter((line) => isUsableScriptGuideLine(line)),
    checkpoints.filter((line) => isUsableScriptGuideLine(line)),
    4,
  )

  return {
    keyInsights: deduped.primary,
    checkpoints: deduped.secondary,
  }
}

function isUsableScriptGuideLine(line = '') {
  const text = String(line || '').trim()
  if (!text) return false
  // Script generation guides should avoid visual/meta-analysis jargon.
  const bannedMetaPattern =
    /(첫\s*\d+초|클로즈업|화면|자막|컷\s*전환|프레임|장면|시선\s*집중|문구|도입부에서는|전개에서는|결론에서는|영상|편집|연출)/i
  return !bannedMetaPattern.test(text) && !GENERATED_METADATA_LEAK_PATTERN.test(text)
}

function removeFileExtension(value = '') {
  return String(value || '').replace(/\.[a-z0-9]{1,8}$/i, '')
}

function stripReferenceMetadataText(value = '') {
  return removeFileExtension(value)
    .replace(RECORDING_METADATA_PATTERN, ' ')
    .replace(DATE_TIME_METADATA_PATTERN, ' ')
    .replace(/\b(?:am|pm|at)\b/gi, ' ')
    .replace(/\b(?:mov|mp4|m4v|webm|avi|mkv)\b/gi, ' ')
    .replace(/[()[\]{}_,]+/g, ' ')
    .replace(/\s*[-–—]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isMeaningfulReferenceTitle(value = '') {
  const text = String(value || '').trim()
  if (!text) return false
  if (!/[a-zA-Z가-힣]/.test(text)) return false
  if (text.length <= 2 && !/[가-힣]{2,}|[a-zA-Z]{3,}/.test(text)) return false
  return true
}

function normalizeReferenceTitle({ title = '', originalFilename = '' } = {}) {
  const explicitTitle = String(title || '').trim()
  const sanitizedExplicitTitle = stripReferenceMetadataText(explicitTitle)
  if (isMeaningfulReferenceTitle(sanitizedExplicitTitle)) {
    return sanitizedExplicitTitle.slice(0, 200)
  }

  const sanitizedFilenameTitle = stripReferenceMetadataText(originalFilename)
  if (isMeaningfulReferenceTitle(sanitizedFilenameTitle)) {
    return sanitizedFilenameTitle.slice(0, 200)
  }

  return DEFAULT_REFERENCE_TITLE
}

function tokenizeReferenceSurfaceText(value = '') {
  return String(value || '')
    .toLowerCase()
    .split(/[\s,./!?|()[\]{}:;"'`~<>+=_*&^%$#@\-–—→\n\r\t]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length >= 2 && token.length <= 20)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !REFERENCE_SURFACE_STOPWORDS.has(token))
}

function extractReferenceTitleSurfaceTerms(title = '') {
  const rawTitle = removeFileExtension(title)
    .replace(/[()[\]{}_,]+/g, ' ')
    .replace(/\s*[-–—]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const cleanedTitle = stripReferenceMetadataText(title)
  const candidates = [cleanedTitle, rawTitle]
    .map((item) => String(item || '').toLowerCase().trim())
    .filter(Boolean)
    .filter((item) => item !== DEFAULT_REFERENCE_TITLE.toLowerCase())
    .filter((item) => item.length >= 2 && item.length <= 40)
    .filter((item) => !GENERATED_METADATA_LEAK_PATTERN.test(item))

  const terms = []
  for (const candidate of candidates) {
    terms.push(candidate)
    terms.push(...tokenizeReferenceSurfaceText(candidate))
  }

  return Array.from(new Set(terms)).slice(0, 8)
}

function extractReferenceSurfaceTerms({ title = '', topic = '', transcript = '' } = {}) {
  const explicitTitleTerms = extractReferenceTitleSurfaceTerms(title)
  const corpus = stripReferenceMetadataText(`${topic}\n${transcript}`)
  const tokens = tokenizeReferenceSurfaceText(corpus)

  const counts = new Map()
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1)
  }

  const frequentTerms = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([token]) => token)

  const deduped = []
  for (const term of [...explicitTitleTerms, ...frequentTerms]) {
    if (deduped.includes(term)) continue
    deduped.push(term)
    if (deduped.length >= MAX_REFERENCE_SURFACE_TERMS) break
  }

  return deduped
}

function findReferenceSurfaceLeakage(text = '', referenceSurfaceTerms = []) {
  const normalized = String(text || '').toLowerCase()
  if (!normalized) return null
  const compact = normalized.replace(/\s+/g, '')
  return (
    (referenceSurfaceTerms || []).find((term) => {
      const normalizedTerm = String(term || '').toLowerCase().trim()
      if (!normalizedTerm) return false
      if (containsTerm(normalized, normalizedTerm)) return true
      const compactTerm = normalizedTerm.replace(/\s+/g, '')
      return compactTerm.length >= 3 && compact.includes(compactTerm)
    }) || null
  )
}

function normalizeGenerationTopic(topic = '', normalizedReferenceTitle = DEFAULT_REFERENCE_TITLE) {
  const explicitTopic = stripReferenceMetadataText(topic).slice(0, 200)
  if (!explicitTopic) return '일반'

  const referenceTitle = String(normalizedReferenceTitle || '').trim()
  if (
    referenceTitle &&
    referenceTitle !== DEFAULT_REFERENCE_TITLE &&
    explicitTopic.toLowerCase() === referenceTitle.toLowerCase()
  ) {
    return '일반'
  }

  return explicitTopic
}

function scoreTranscriptReliability({ text = '', segments = [], durationSeconds = null, hasAudio = false } = {}) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  const chars = normalized.length
  const hangulChars = (normalized.match(/[가-힣]/g) || []).length
  const alphaNumericChars = (normalized.match(/[a-zA-Z0-9가-힣]/g) || []).length
  const sentences = normalized
    .split(/[.!?。！？\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  const tokens = normalized
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
  const uniqueTokens = new Set(tokens.map((item) => item.toLowerCase()))
  const uniqueRatio = tokens.length ? uniqueTokens.size / tokens.length : 0
  const repeatedShortTokenCount = tokens.filter((token, index, array) => {
    if (token.length > 4) return false
    return array.indexOf(token) !== index
  }).length
  const meaninglessPattern =
    /(^(?:ㅋ|ㅎ|아|어|음|응|네|예|오|우|라|나|다|마|바|사|자|하|\s)+$|(?:ㅋㅋ|ㅎㅎ|음악|노래|박수|소리|구독|좋아요)\s*(?:음악|노래|박수|소리|구독|좋아요))/i
  const longRepeatedPattern = /(.{1,6})\1{4,}/
  const segmentCount = Array.isArray(segments) ? segments.length : 0
  const duration = Number(durationSeconds || 0)
  const density = duration > 0 ? chars / Math.max(duration, 1) : null
  const reasons = []
  let score = hasAudio ? 55 : 15

  if (!hasAudio) reasons.push('오디오 스트림 없음')
  if (!chars) {
    reasons.push('전사 없음')
    score -= 45
  } else if (chars < 30) {
    reasons.push('전사가 너무 짧음')
    score -= 30
  } else if (chars < 80) {
    reasons.push('전사가 짧음')
    score -= 12
  } else {
    score += 15
  }

  if (sentences.length >= 3) score += 10
  if (sentences.length <= 1 && chars < 140) {
    reasons.push('문장 구조 부족')
    score -= 10
  }
  if (segmentCount >= 3) score += 8
  if (segmentCount === 0 && chars > 0) {
    reasons.push('STT 세그먼트 없음')
    score -= 5
  }
  if (alphaNumericChars > 0 && hangulChars / alphaNumericChars < 0.25) {
    reasons.push('한국어 발화 비중 낮음')
    score -= 12
  }
  if (tokens.length >= 8 && uniqueRatio < 0.45) {
    reasons.push('반복 단어 비율 높음')
    score -= 18
  }
  if (repeatedShortTokenCount >= 4) {
    reasons.push('짧은 단어 반복 많음')
    score -= 12
  }
  if (meaninglessPattern.test(normalized) || longRepeatedPattern.test(normalized)) {
    reasons.push('무의미/반복 발화 의심')
    score -= 25
  }
  if (density !== null && duration >= 20 && density < 0.8) {
    reasons.push('영상 길이 대비 전사 밀도 낮음')
    score -= 10
  }

  score = Math.max(0, Math.min(100, Math.round(score)))
  const threshold = Number.isFinite(TRANSCRIPT_RELIABILITY_LOW_THRESHOLD)
    ? TRANSCRIPT_RELIABILITY_LOW_THRESHOLD
    : 45
  const level = score < threshold ? 'low' : score < 70 ? 'medium' : 'high'
  return {
    score,
    level,
    reliable: score >= threshold,
    reasons,
    stats: {
      chars,
      sentences: sentences.length,
      tokens: tokens.length,
      uniqueRatio: Number(uniqueRatio.toFixed(2)),
      segmentCount,
      density: density === null ? null : Number(density.toFixed(2)),
    },
  }
}

function buildTranscriptReliabilityPrompt(transcriptQuality = {}) {
  const level = transcriptQuality?.level || 'unknown'
  const score = Number.isFinite(transcriptQuality?.score) ? transcriptQuality.score : null
  const reasons = Array.isArray(transcriptQuality?.reasons) ? transcriptQuality.reasons : []
  if (transcriptQuality?.reliable) {
    return [
      `전사 신뢰도: ${level}${score === null ? '' : ` (${score}/100)`}`,
      '전사가 충분히 읽히므로 구조/후킹/심리 분석의 핵심 근거로 사용해도 된다.',
    ].join('\n')
  }

  return [
    `전사 신뢰도: 낮음${score === null ? '' : ` (${score}/100)`}`,
    reasons.length ? `낮게 판단한 이유: ${reasons.join(', ')}` : null,
    '중요: BGM/효과음/작은 음성 때문에 전사가 깨졌을 가능성이 있다.',
    '전사를 사실처럼 단정하지 말고, 알아들을 수 있는 문장만 제한적으로 참고하라.',
    '전사가 짧거나 무의미하면 structureAnalysis/hookAnalysis/psychologyAnalysis에서 “전사 근거 부족”을 명시하고, 첫 3초 프레임 분석/사용자 입력 주제/자막 단서를 더 우선하라.',
    '전사에 없는 구체 단어, 상품명, 원인, 상황은 새로 만들지 마라.',
  ]
    .filter(Boolean)
    .join('\n')
}

function splitScriptSentences(value = '', maxItems = 30) {
  const normalized = String(value || '')
    .replace(/\r/g, '\n')
    .replace(/([.!?。！？])\s*/g, '$1\n')
    .replace(/\n{2,}/g, '\n')
    .trim()

  if (!normalized) return []

  const pieces = normalized
    .split(/\n+/)
    .flatMap((line) => {
      const compact = line.trim()
      if (!compact) return []
      if (compact.length <= 110) return [compact]
      return compact
        .split(/(?<=고|며|서|데|요|다)[,\s]+/u)
        .map((item) => item.trim())
        .filter(Boolean)
    })
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  return pieces.slice(0, maxItems)
}

function inferBlueprintSection(order, total, rawSection = '') {
  const section = String(rawSection || '').trim().toLowerCase()
  if (section === 'hook' || section === 'body' || section === 'cta') return section
  if (order <= Math.max(1, Math.ceil(total * 0.18))) return 'hook'
  if (order > Math.max(1, Math.floor(total * 0.82))) return 'cta'
  return 'body'
}

function normalizeLengthBand(value = '', fallbackText = '') {
  const raw = String(value || '').trim().toLowerCase()
  if (['short', 'medium', 'long'].includes(raw)) return raw
  const length = String(fallbackText || '').trim().length
  if (length <= 35) return 'short'
  if (length >= 90) return 'long'
  return 'medium'
}

function inferSentenceShape(value = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  if (/[?？]$/.test(text)) return '질문형'
  if (/(하지만|그런데|근데|반면|오히려|문제는)/.test(text)) return '반전형'
  if (/(하세요|해보세요|보세요|확인|저장|눌러|남겨)/.test(text)) return '행동유도형'
  if (/(이유|때문|그래서|결국|핵심은)/.test(text)) return '이유제시형'
  if (text.length <= 35) return '짧은 단정형'
  if (text.length >= 90) return '긴 설명형'
  return '균형 설명형'
}

function inferClauseProfile(value = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  const clauseCount = text
    .split(/[,，、]|(?:\s+(?:그리고|근데|그런데|하지만|그래서|그러면|그러니까|또|특히|결국)\s+)/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .length
  if (clauseCount <= 1) return '단일 절'
  if (clauseCount === 2) return '2절 연결'
  if (clauseCount === 3) return '3절 연결'
  return '여러 절로 길게 연결'
}

function inferEndingStyle(value = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  if (/[?？]$/.test(text)) return '질문으로 끝남'
  if (/[!！]$/.test(text)) return '강조로 끝남'
  if (/(하세요|해보세요|보세요|남겨주세요|저장해두세요|확인해보세요)[.!。！？]?$/u.test(text)) {
    return '행동 유도로 끝남'
  }
  if (/(거예요|겁니다|입니다|합니다|돼요|해요|있어요|없어요|죠|요)[.!。]?$/u.test(text)) {
    return '대화체 단정으로 끝남'
  }
  if (/(다)[.!。]?$/u.test(text)) return '단정 서술로 끝남'
  return '자연스럽게 이어지는 끝맺음'
}

function inferPunctuationProfile(value = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  const marks = []
  if (text.includes(',')) marks.push('쉼표 호흡')
  if (/[?？]/.test(text)) marks.push('질문 부호')
  if (/[!！]/.test(text)) marks.push('강조 부호')
  if (/["“”'‘’]/.test(text)) marks.push('인용/강조 따옴표')
  if (/[()]/.test(text)) marks.push('괄호 보충')
  return marks.length ? marks.join(', ') : '구두점 적음'
}

function inferSentenceFeeling(value = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  if (/(왜|문제|실수|안\s*되는|못하는|망가|놓치|손해|위험|불안)/.test(text)) {
    return '문제를 찌르며 긴장감을 만드는 느낌'
  }
  if (/(사실|결론|핵심|진짜|중요한|기준)/.test(text)) {
    return '단호하게 핵심을 정리하는 느낌'
  }
  if (/(저도|나도|그럴|답답|고민|힘들|괜찮)/.test(text)) {
    return '공감하면서 편하게 말을 거는 느낌'
  }
  if (/(지금|오늘|바로|먼저|확인|체크|저장|남겨|보세요|하세요)/.test(text)) {
    return '다음 행동으로 밀어주는 느낌'
  }
  if (/(편해|쉬워|달라|바뀌|해결|좋아|줄어)/.test(text)) {
    return '변화와 이득을 기대하게 하는 느낌'
  }
  if (text.length <= 35) return '짧고 툭 던지는 느낌'
  return '차분히 설명을 이어가는 느낌'
}

function buildTargetCharRange(referenceCharCount = 0) {
  const count = Number(referenceCharCount)
  if (!Number.isFinite(count) || count <= 0) {
    return ''
  }

  const min = Math.max(12, Math.round(count * 0.8))
  const max = Math.max(min + 6, Math.round(count * 1.2))
  return `${min}-${max}자`
}

function normalizeBlueprintSourceSentence(value = '') {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized
}

function normalizeBlueprintItem(item = {}, index = 0, total = 0, sourceSentence = '') {
  const order = Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1
  const section = inferBlueprintSection(order, total || 1, item.section)
  const normalizedSourceSentence = normalizeBlueprintSourceSentence(sourceSentence)
  const role = String(item.role || '').trim()
  const keywordSlot = String(item.keywordSlot || item.keyword_slot || '').trim()
  const topicSlots = normalizeStringList(
    item.topicSlots || item.topic_slots || item.topicExpressions || item.topic_expressions,
    5,
  )
  const replaceTargets = normalizeStringList(
    item.replaceTargets ||
      item.replace_targets ||
      item.topicReplaceTargets ||
      item.topic_replace_targets,
    5,
  )
  const desireTrigger = String(item.desireTrigger || item.desire_trigger || '').trim()
  const tone = String(item.tone || '').trim()
  const feeling = String(item.feeling || item.originalFeel || item.original_feel || item.emotionalTone || item.emotional_tone || '').trim() ||
    inferSentenceFeeling(sourceSentence)
  const rhythm = String(item.rhythm || '').trim()
  const length = normalizeLengthBand(item.length, role)
  const referenceCharCount = Math.max(
    0,
    Math.round(
      Number(item.referenceCharCount || item.reference_char_count || item.charCount || item.char_count || 0) ||
        normalizedSourceSentence.length,
    ),
  )
  const targetCharRange = String(item.targetCharRange || item.target_char_range || '').trim() ||
    buildTargetCharRange(referenceCharCount)
  const sentenceShape = String(item.sentenceShape || item.sentence_shape || '').trim() ||
    inferSentenceShape(sourceSentence)
  const clauseProfile = String(item.clauseProfile || item.clause_profile || '').trim() ||
    inferClauseProfile(sourceSentence)
  const endingStyle = String(item.endingStyle || item.ending_style || '').trim() ||
    inferEndingStyle(sourceSentence)
  const punctuationProfile = String(item.punctuationProfile || item.punctuation_profile || '').trim() ||
    inferPunctuationProfile(sourceSentence)
  const mustKeep = normalizeStringList(item.mustKeep || item.must_keep, 4)
  const mustReplace = normalizeStringList(item.mustReplace || item.must_replace, 4)

  return {
    order,
    section,
    sourceSentence: normalizedSourceSentence,
    role: role || `${section.toUpperCase()} ${order}번 문장 역할`,
    length,
    referenceCharCount,
    targetCharRange,
    sentenceShape,
    clauseProfile,
    endingStyle,
    punctuationProfile,
    tone,
    feeling,
    rhythm,
    desireTrigger,
    keywordSlot,
    topicSlots,
    replaceTargets,
    mustKeep,
    mustReplace,
  }
}

function normalizeSentenceBlueprint(rawBlueprint, transcript = '', transcriptQuality = {}) {
  const sourceSentences = transcriptQuality?.reliable
    ? splitScriptSentences(transcript, MAX_SENTENCE_BLUEPRINT_ITEMS)
    : []
  const sourceTotalChars = sourceSentences.join(' ').length
  const rawItems = Array.isArray(rawBlueprint) ? rawBlueprint : []
  const normalized = rawItems
    .slice(0, MAX_SENTENCE_BLUEPRINT_ITEMS)
    .map((item, index) =>
      normalizeBlueprintItem(item, index, rawItems.length, sourceSentences[index] || ''),
    )
    .filter((item) => item.role || item.keywordSlot || item.desireTrigger)

  if (normalized.length) {
    return {
      mode: transcriptQuality?.reliable ? 'sentence' : 'section',
      items: normalized,
      referenceStats: {
        sentenceCount: sourceSentences.length || normalized.length,
        totalChars: sourceTotalChars || null,
        transcriptQuality: transcriptQuality?.level || 'unknown',
      },
    }
  }

  if (sourceSentences.length >= 4) {
    const fallbackItems = sourceSentences.map((sentence, index) => {
      const order = index + 1
      return normalizeBlueprintItem(
        {
          order,
          section: inferBlueprintSection(order, sourceSentences.length),
          role:
            index === 0
              ? '문제를 찌르는 첫 문장'
              : index === sourceSentences.length - 1
                ? '다음 행동을 유도하는 마무리'
                : '앞 문장의 긴장을 이어 구체화하는 문장',
          length: normalizeLengthBand('', sentence),
        },
        index,
        sourceSentences.length,
        sentence,
      )
    })

    return {
      mode: 'sentence',
      items: fallbackItems,
      referenceStats: {
        sentenceCount: sourceSentences.length,
        totalChars: sourceTotalChars || null,
        transcriptQuality: transcriptQuality?.level || 'unknown',
      },
    }
  }

  return {
    mode: 'section',
    items: [],
    referenceStats: {
      sentenceCount: sourceSentences.length,
      totalChars: sourceTotalChars || null,
      transcriptQuality: transcriptQuality?.level || 'unknown',
    },
  }
}

function normalizeSubstitutionMap(rawMap) {
  if (!Array.isArray(rawMap)) return []
  return rawMap
    .map((item) => ({
      slot: String(item?.slot || item?.sourceSlot || item?.source_slot || '').trim(),
      preserve: String(item?.preserve || item?.keep || '').trim(),
      replaceWith: String(item?.replaceWith || item?.replace_with || item?.replacement || '').trim(),
    }))
    .filter((item) => item.slot || item.preserve || item.replaceWith)
      .slice(0, 8)
}

function createEmptyStructureBlueprint(transcriptQuality = {}) {
  return {
    logicFlow: [],
    persuasionPattern: [],
    messageStructure: [],
    hookSentencePattern: [],
    hookAdvantagePattern: [],
    keywordSlots: [],
    desireTriggers: [],
    sectionRhythm: [],
    lengthProfile: [],
    substitutionRules: [],
    sentenceBlueprint: [],
    substitutionMap: [],
    blueprintMode: 'none',
    referenceStats: {
      sentenceCount: 0,
      totalChars: null,
      transcriptQuality: transcriptQuality?.level || 'missing',
    },
  }
}

function formatSentenceBlueprintPrompt(structureBlueprint = {}) {
  const items = structureBlueprint?.sentenceBlueprint || []
  if (!items.length) {
    return '- 문장 단위 blueprint 없음. 섹션 리듬/길이감만 참고.'
  }

  return items
    .map((item) => {
      const extras = [
        item.length ? `길이=${item.length}` : null,
        item.targetCharRange ? `목표분량=${item.targetCharRange}` : null,
        item.sentenceShape ? `문장형태=${item.sentenceShape}` : null,
        item.clauseProfile ? `절구조=${item.clauseProfile}` : null,
        item.endingStyle ? `끝맺음=${item.endingStyle}` : null,
        item.punctuationProfile ? `구두점=${item.punctuationProfile}` : null,
        item.rhythm ? `리듬=${item.rhythm}` : null,
        item.tone ? `톤=${item.tone}` : null,
        item.feeling ? `느낌=${item.feeling}` : null,
        item.desireTrigger ? `욕구=${item.desireTrigger}` : null,
        item.keywordSlot ? `키워드슬롯=${item.keywordSlot}` : null,
        item.topicSlots?.length ? `주제표현자리=${item.topicSlots.join(', ')}` : null,
        item.replaceTargets?.length ? `치환대상=${item.replaceTargets.join(', ')}` : null,
        item.mustKeep?.length ? `유지=${item.mustKeep.join(', ')}` : null,
        item.mustReplace?.length ? `치환=${item.mustReplace.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join(' / ')

      return `${item.order}. [${item.section.toUpperCase()}] ${item.role}${extras ? ` (${extras})` : ''}`
    })
    .join('\n')
}

function formatSentenceSubstitutionPrompt(structureBlueprint = {}) {
  const items = structureBlueprint?.sentenceBlueprint || []
  if (!items.length) {
    return '- 문장별 치환표 없음. 단, 섹션별 전개 순서와 길이감은 유지.'
  }

  return items
    .map((item) => {
      const pieces = [
        `${item.order}번 문장`,
        `[${String(item.section || '').toUpperCase()}]`,
        item.sourceSentence ? `원문 골격 참고(복사 금지): "${item.sourceSentence}"` : null,
        `역할 유지: ${item.role || '-'}`,
        item.keywordSlot ? `키워드 자리: ${item.keywordSlot}` : null,
        item.topicSlots?.length ? `주제 표현 자리: ${item.topicSlots.join(', ')}` : null,
        item.replaceTargets?.length ? `치환할 표현: ${item.replaceTargets.join(', ')}` : null,
        item.desireTrigger ? `욕구 자리: ${item.desireTrigger}` : null,
        item.feeling ? `원본 느낌: ${item.feeling}` : null,
        item.sentenceShape ? `문장 형태: ${item.sentenceShape}` : null,
        item.clauseProfile ? `절 구조: ${item.clauseProfile}` : null,
        item.endingStyle ? `끝맺음: ${item.endingStyle}` : null,
        item.punctuationProfile ? `구두점 호흡: ${item.punctuationProfile}` : null,
        item.targetCharRange ? `분량: ${item.targetCharRange}` : null,
      ].filter(Boolean)

      return `- ${pieces.join(' / ')}`
    })
    .join('\n')
}

function formatSubstitutionMapPrompt(structureBlueprint = {}) {
  const items = structureBlueprint?.substitutionMap || []
  if (!items.length) {
    return '- 원문 표면 소재/상황/상품명은 현재 주제로 치환'
  }

  return items
    .map((item, index) => {
      const pieces = [
        item.slot ? `슬롯: ${item.slot}` : null,
        item.preserve ? `유지할 역할: ${item.preserve}` : null,
        item.replaceWith ? `치환 방향: ${item.replaceWith}` : null,
      ].filter(Boolean)
      return `${index + 1}. ${pieces.join(' / ')}`
    })
    .join('\n')
}

async function buildStructureBlueprint({
  openai,
  chatModel,
  analysisResult,
  transcript,
  transcriptQuality = {},
  frameSummary = '',
}) {
  const transcriptReliabilityPrompt = buildTranscriptReliabilityPrompt(transcriptQuality)
  const reliableTranscript = transcriptQuality?.reliable ? transcript : ''
  const response = await openai.chat.completions.create({
    model: chatModel,
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content:
          '너는 레퍼런스에서 성과를 만든 대본 구조를 추출하는 분석기다. 원문 상품명/고유명사/상황은 제거하되, 전개 순서, 문장 기능, 길이감, 심리/욕구 트리거, 핵심 키워드 역할은 반드시 보존한다. ' +
          'keywordSlots에는 원문 단어가 아니라 "문제 키워드 자리", "욕구 키워드 자리", "결과 키워드 자리"처럼 새 주제로 치환해야 할 슬롯을 적어라. ' +
          'desireTriggers에는 시간 절약, 실패 회피, 손해 회피, 편해짐, 자신감, 불안 해소처럼 보편적으로 재사용 가능한 심리/욕구 트리거를 적어라. ' +
          'hookSentencePattern에는 훅의 시작 방식, 문장 리듬, 긴장 형성 순서를 적되 원문 단어는 넣지 마라. ' +
          'sectionRhythm에는 HOOK/BODY/CTA의 문장 수, 줄바꿈, 짧고 긴 문장 배치, 반복 리듬을 적어라. ' +
          'lengthProfile에는 각 섹션이 짧은지/중간인지/긴지와 원문 대비 생성 시 유지해야 할 분량감을 적어라. ' +
          'sentenceBlueprint에는 레퍼런스를 문장별로 쪼개 각 문장의 역할/길이/문장 형태/절 구조/끝맺음/구두점 호흡/리듬/느낌/욕구 트리거/키워드 슬롯을 적어라. 원문 문장은 절대 넣지 말고 역할만 적어라. ' +
          'topicSlots에는 그 문장에서 원문 주제/상품/상황/업종이 들어가는 자리만 적어라. replaceTargets에는 생성 시 현재 계정 세팅과 이번 주제로 바꿔야 하는 표현의 역할만 적어라. ' +
          '중요: 레퍼런스의 문장 골격, 절 배치, 쉼표 호흡, 질문/단정/명령 같은 끝맺음, 강조 순서, 감정 흐름은 유지하고 topicSlots/replaceTargets에 해당하는 소재 자리만 바꾸는 설계로 뽑아라. ' +
          'feeling에는 그 문장이 주는 체감만 적어라. 예: 단호한 결론, 불안 자극, 공감, 반전, 안심, 행동 압박, 실용적 정리. 원문 표현은 넣지 마라. ' +
          'referenceCharCount에는 원문 해당 문장 글자 수를 대략 적고, targetCharRange에는 생성 시 유지할 80~120% 분량 범위를 적어라. ' +
          'substitutionMap에는 원문 소재 자리를 현재 계정/영상 주제로 치환하기 위한 슬롯을 적어라. ' +
          'substitutionRules에는 무엇을 유지하고 무엇을 바꿔야 하는지 명확히 적어라. 전사 신뢰도가 낮으면 전사 문장 구조를 억지로 추출하지 말고 분석 결과와 프레임 단서에서 확인되는 구조만 사용하라.',
      },
      {
        role: 'user',
        content:
          `${transcriptReliabilityPrompt}\n\n` +
          `레퍼런스 전사(신뢰도 낮으면 제한 참고):\n${reliableTranscript || '신뢰 가능한 전사 없음'}\n\n` +
          `시각 분석 요약:\n${frameSummary || '-'}\n\n` +
          `구조 분석:\n${analysisResult?.structureAnalysis || '-'}\n\n` +
          `후킹 분석:\n${analysisResult?.hookAnalysis || '-'}\n\n` +
          `심리 분석:\n${analysisResult?.psychologyAnalysis || '-'}\n\n` +
          '다음 JSON 형식으로만 답하세요: {"logicFlow":[],"persuasionPattern":[],"messageStructure":[],"hookSentencePattern":[],"hookAdvantagePattern":[],"keywordSlots":[],"desireTriggers":[],"sectionRhythm":[],"lengthProfile":[],"substitutionRules":[],"sentenceBlueprint":[{"section":"hook","order":1,"role":"","length":"short","referenceCharCount":0,"targetCharRange":"","sentenceShape":"","clauseProfile":"","endingStyle":"","punctuationProfile":"","tone":"","feeling":"","rhythm":"","desireTrigger":"","keywordSlot":"","topicSlots":[],"replaceTargets":[],"mustKeep":[],"mustReplace":[]}],"substitutionMap":[{"slot":"","preserve":"","replaceWith":""}]}',
      },
    ],
  })

  const parsed = parseModelJson(response.choices[0]?.message?.content || '')
  const logicFlow = normalizeStringList(parsed?.logicFlow, 4)
  const persuasionPattern = normalizeStringList(parsed?.persuasionPattern, 4)
  const messageStructure = normalizeStringList(parsed?.messageStructure, 4)
  const hookSentencePattern = normalizeStringList(parsed?.hookSentencePattern, 4)
  const hookAdvantagePattern = normalizeStringList(parsed?.hookAdvantagePattern, 4)
  const keywordSlots = normalizeStringList(parsed?.keywordSlots, 5)
  const desireTriggers = normalizeStringList(parsed?.desireTriggers, 5)
  const sectionRhythm = normalizeStringList(parsed?.sectionRhythm, 5)
  const lengthProfile = normalizeStringList(parsed?.lengthProfile, 5)
  const substitutionRules = normalizeStringList(parsed?.substitutionRules, 5)
  const normalizedSentenceBlueprint = normalizeSentenceBlueprint(
    parsed?.sentenceBlueprint,
    reliableTranscript || transcript || '',
    transcriptQuality,
  )
  const substitutionMap = normalizeSubstitutionMap(parsed?.substitutionMap)
  return {
    logicFlow,
    persuasionPattern,
    messageStructure,
    hookSentencePattern,
    hookAdvantagePattern,
    keywordSlots,
    desireTriggers,
    sectionRhythm,
    lengthProfile,
    substitutionRules,
    sentenceBlueprint: normalizedSentenceBlueprint.items,
    blueprintMode: normalizedSentenceBlueprint.mode,
    referenceStats: normalizedSentenceBlueprint.referenceStats,
    substitutionMap,
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
    angle: normalizeVariationAngle(parsed?.angle, fallback.angle),
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

function normalizeVariationAngle(rawAngle, fallbackAngle = '') {
  const fallback = String(fallbackAngle || '').trim()
  const angle = String(rawAngle || '').trim().replace(/\s+/g, ' ')
  const legacyAngleLabels = {
    구조밀착: '원본형',
    '구조 밀착': '원본형',
    자연화: '대화형',
    자연형: '대화형',
    전환강화: '후킹형',
    '전환 강화': '후킹형',
  }

  if (!angle) return fallback
  if (legacyAngleLabels[angle]) return legacyAngleLabels[angle]
  if (angle.length > MAX_VARIATION_ANGLE_LENGTH) return fallback
  if (AWKWARD_KOREAN_PATTERN.test(angle)) return fallback
  if (/[.?!。！？]$/.test(angle)) return fallback
  if (/(이유|방법|정리|전달|알게|실패하는|해결법).{3,}/.test(angle)) return fallback
  if (/(초보|사람|루틴|헬스장|운동|피부|캡션|콘텐츠).{3,}/.test(angle)) return fallback

  return angle
}

function getVariationSectionSentenceCounts(variation = {}) {
  return {
    hook: splitScriptSentences(variation.hook || '', 8).length,
    body: splitScriptSentences(variation.body || '', 20).length,
    cta: splitScriptSentences(variation.cta || '', 8).length,
  }
}

function getBlueprintSectionCounts(sentenceBlueprint = []) {
  return sentenceBlueprint.reduce(
    (acc, item) => {
      const section = inferBlueprintSection(item.order || 1, sentenceBlueprint.length, item.section)
      acc[section] = (acc[section] || 0) + 1
      return acc
    },
    { hook: 0, body: 0, cta: 0 },
  )
}

function validateSentenceBlueprintMatch(variation = {}, structureBlueprint = {}, config = {}) {
  const sentenceBlueprint = Array.isArray(structureBlueprint?.sentenceBlueprint)
    ? structureBlueprint.sentenceBlueprint
    : []
  const referenceStats = structureBlueprint?.referenceStats || {}
  const hasSentenceBlueprint = sentenceBlueprint.length >= 4 && structureBlueprint?.blueprintMode === 'sentence'
  const sectionCounts = getVariationSectionSentenceCounts(variation)
  const generatedTotalSentences = sectionCounts.hook + sectionCounts.body + sectionCounts.cta
  const generatedChars = [variation.hook, variation.body, variation.cta]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join(' ')
    .length
  const warnings = []
  let score = 100

  if (hasSentenceBlueprint) {
    const blueprintCounts = getBlueprintSectionCounts(sentenceBlueprint)
    const expectedTotal = sentenceBlueprint.length
    const sentenceDelta = Math.abs(generatedTotalSentences - expectedTotal)
    if (sentenceDelta === 1) {
      warnings.push(`문장 수 약간 다름: 기준 ${expectedTotal}, 생성 ${generatedTotalSentences}`)
      score -= 4
    }
    if (sentenceDelta > 1) {
      warnings.push(`문장 수 차이 큼: 기준 ${expectedTotal}, 생성 ${generatedTotalSentences}`)
      score -= Math.min(28, sentenceDelta * 7)
    }

    for (const section of ['hook', 'body', 'cta']) {
      const expected = blueprintCounts[section] || 0
      if (!expected) continue
      const actual = sectionCounts[section] || 0
      const delta = Math.abs(actual - expected)
      if (delta === 1) {
        score -= 3
      }
      if (delta > 1) {
        warnings.push(`${section.toUpperCase()} 문장 수 불일치: 기준 ${expected}, 생성 ${actual}`)
        score -= Math.min(18, delta * 6)
      }
    }
  } else {
    if (!variation.hook || !variation.body || !variation.cta) {
      warnings.push('HOOK/BODY/CTA 중 비어 있는 섹션 있음')
      score -= 35
    }
  }

  const referenceChars = Number(referenceStats?.totalChars)
  if (Number.isFinite(referenceChars) && referenceChars >= 120 && generatedChars > 0) {
    const ratio = generatedChars / referenceChars
    if (ratio < 0.85) {
      warnings.push(`레퍼런스보다 짧음: ${Math.round(ratio * 100)}%`)
      score -= Math.min(28, Math.round((0.85 - ratio) * 90))
    } else if (ratio > 1.2) {
      warnings.push(`레퍼런스보다 김: ${Math.round(ratio * 100)}%`)
      score -= Math.min(14, Math.round((ratio - 1.2) * 35))
    }
  }

  const text = [variation.hook, variation.body, variation.cta].filter(Boolean).join('\n')
  const desireTriggers = normalizeStringList(structureBlueprint?.desireTriggers, 6)
  if (desireTriggers.length) {
    const hitCount = desireTriggers.filter((trigger) => {
      const compact = trigger.replace(/\s+/g, '')
      return compact.length >= 2 && text.replace(/\s+/g, '').includes(compact.slice(0, Math.min(6, compact.length)))
    }).length
    if (hitCount === 0) {
      warnings.push('심리/욕구 트리거 반영 약함')
      score -= 12
    }
  }

  if (config?.label === 'A안' && hasSentenceBlueprint && generatedTotalSentences !== sentenceBlueprint.length) {
    warnings.push('A안은 원본형이라 문장 수를 더 맞춰야 함')
    score -= 8
  }

  score = Math.max(0, Math.min(100, Math.round(score)))
  return {
    ok: score >= (config?.label === 'A안' ? STRICT_STRUCTURE_MATCH_RETRY_THRESHOLD : STRUCTURE_MATCH_RETRY_THRESHOLD),
    score,
    mode: hasSentenceBlueprint ? 'sentence' : 'section',
    warnings,
    referenceSentenceCount: hasSentenceBlueprint ? sentenceBlueprint.length : referenceStats?.sentenceCount || null,
    generatedSentenceCount: generatedTotalSentences,
    referenceChars: Number.isFinite(referenceChars) ? referenceChars : null,
    generatedChars,
  }
}

function attachStructureMetadata(variation = {}, structureBlueprint = {}, structureMatch = null) {
  const blueprintPayload = {
    mode: structureBlueprint?.blueprintMode || 'section',
    sentenceBlueprint: Array.isArray(structureBlueprint?.sentenceBlueprint)
      ? structureBlueprint.sentenceBlueprint.slice(0, MAX_SENTENCE_BLUEPRINT_ITEMS).map((item) => {
          const { sourceSentence: _sourceSentence, ...safeItem } = item || {}
          return safeItem
        })
      : [],
    substitutionMap: Array.isArray(structureBlueprint?.substitutionMap)
      ? structureBlueprint.substitutionMap.slice(0, 8)
      : [],
    referenceStats: structureBlueprint?.referenceStats || {},
  }

  return {
    ...variation,
    structureBlueprint: blueprintPayload,
    structureMatch: structureMatch || validateSentenceBlueprintMatch(variation, structureBlueprint),
  }
}

function normalizeCategoryLabel(value) {
  const raw = String(value || '').trim()
  if (!raw) return '기타'

  if (CATEGORY_ANCHOR_TERMS[raw]) {
    return raw
  }

  const compact = raw.replace(/\s+/g, '').toLowerCase()
  const playbookAliases = Object.values(CATEGORY_PLAYBOOKS).map((playbook) => ({
    category: playbook?.meta?.label || '',
    aliases: Array.isArray(playbook?.meta?.aliases) ? playbook.meta.aliases : [],
  }))
  const categoryAliases = [
    ...playbookAliases,
    { category: '패션', aliases: ['패션', 'fashion', '인플루언서', '패션인플루언서', '스타일'] },
    { category: '뷰티', aliases: ['뷰티', 'beauty', '메이크업', '화장', '스킨케어'] },
    { category: 'AI', aliases: ['ai', 'it', '창업', '스타트업', '개발', '테크'] },
    { category: '여행', aliases: ['여행', '트립'] },
    { category: '요리', aliases: ['요리', '레시피', '쿠킹'] },
    { category: '교육', aliases: ['교육', '학습', '강의'] },
    { category: '멘탈케어', aliases: ['멘탈', '심리', '감정'] },
    { category: '테크 가젯', aliases: ['가젯', '디바이스', '리뷰'] },
  ].filter((item) => item.category)

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
  const voiceTone = resolveVoiceToneLabels(accountSettings).join(' + ')
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

function buildCategoryPlaybookPayload(category, playbook, mode = '') {
  if (!category || !playbook) {
    return null
  }

  return {
    category,
    label: playbook.meta?.label || category,
    insight: playbook.uiCopy?.insight || '',
    hookai_rule: playbook.uiCopy?.hookAiRule || '',
    mode: mode || '',
  }
}

function buildPromptGuardSummary(guard = {}) {
  const settingCues = normalizeStringList(guard.settingCues || [], MAX_PROMPT_SETTING_CUES)
  return { settingCues }
}

function resolvePlaybookMode(accountGoal = '') {
  const normalized = String(accountGoal || '').trim()
  if (normalized === 'brand-marketing' || normalized === 'consulting-lead') {
    return 'conversion'
  }
  return 'awareness'
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

function buildAccountPlaybookContext({
  accountSettings = {},
  characterSystemPrompt = '',
  categoryGuard = null,
} = {}) {
  const guard =
    categoryGuard ||
    buildCategoryGuard({
      accountSettings,
      characterSystemPrompt,
    })
  const mode = resolvePlaybookMode(guard.accountGoal)
  const playbook = getCategoryPlaybook(guard.category)

  return {
    guard,
    mode,
    playbook,
    prompt: buildPlaybookPrompt(playbook, mode),
    payload: buildCategoryPlaybookPayload(guard.category, playbook, mode),
  }
}

function buildPlaybookPrompt(playbook, mode = '') {
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
  const modeHints = Array.isArray(playbook.modes?.[mode]?.emphasis)
    ? playbook.modes[mode].emphasis.slice(0, 3)
    : []

  return [
    '카테고리 실행 참고 규칙(설정과 충돌하면 계정 설정을 우선하고, 아래는 보조 참고로만 사용):',
    playbook.uiCopy?.insight ? `- 업종 인사이트: ${playbook.uiCopy.insight}` : '',
    hardRules.length ? `- 반드시 피할 것: ${hardRules.join(', ')}` : '',
    softRules.length ? `- 우선 반영할 것: ${softRules.join(', ')}` : '',
    hookTypes.length ? `- 잘 먹히는 훅 유형 참고: ${hookTypes.join(', ')}` : '',
    ctaTypes.length ? `- 자연스러운 CTA 방향 참고: ${ctaTypes.join(', ')}` : '',
    tones.length ? `- 톤 참고: ${tones.join(', ')}` : '',
    modeHints.length ? `- 이번 생성 모드 핵심: ${modeHints.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildTopicFocusPrompt(topic = '', _title = '') {
  const normalizedTopic = stripReferenceMetadataText(topic).trim()

  if (!normalizedTopic || normalizedTopic === '일반' || normalizedTopic === DEFAULT_REFERENCE_TITLE) {
    return ''
  }

  return [
    `이번 릴스 주제(반드시 반영): ${normalizedTopic}`,
    `중요: 계정의 큰 카테고리는 유지하되, 이번 결과물의 실제 소재/상품/상황은 "${normalizedTopic}" 기준으로 구체화하세요.`,
    '이번 릴스 주제는 분위기 참고용이 아니라 실제 주장, 예시, 표현, CTA가 모여야 하는 중심 소재입니다.',
  ].join('\n')
}

async function regenerateVariationWithGPT({
  openai,
  variationModel,
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
    model: variationModel,
    temperature: 0.35,
    messages: [
      {
        role: 'system',
        content:
          `당신은 숏폼 스크립트 재생성 편집자다. 새 대본을 자유롭게 창작하지 말고, 레퍼런스 문장 구조에 현재 주제 소재를 끼워 넣어 HOOK/BODY/CTA를 작성한다. 현재 기준 연도는 ${CURRENT_CONTENT_YEAR}년이며 2024년은 쓰지 않는다. 파일명/녹화일/촬영일/업로드일/스크린레코딩 날짜와 시간은 절대 대본 소재로 쓰지 않는다. 출력은 JSON만 반환한다.`,
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
          `핵심 키워드 슬롯(원문 단어가 아니라 역할을 유지):\n${
            structureBlueprint?.keywordSlots?.length
              ? structureBlueprint.keywordSlots.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
              : '- 없음'
          }\n\n` +
          `심리/욕구 트리거(강하게 유지):\n${
            structureBlueprint?.desireTriggers?.length
              ? structureBlueprint.desireTriggers.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
              : '- 없음'
          }\n\n` +
          `섹션 리듬/길이감(유지):\n${
            [
              ...(structureBlueprint?.sectionRhythm || []),
              ...(structureBlueprint?.lengthProfile || []),
            ].length
              ? [...(structureBlueprint?.sectionRhythm || []), ...(structureBlueprint?.lengthProfile || [])]
                  .map((item, idx) => `${idx + 1}. ${item}`)
                  .join('\n')
              : '- 없음'
          }\n\n` +
          `치환 규칙(반드시 준수):\n${
            structureBlueprint?.substitutionRules?.length
              ? structureBlueprint.substitutionRules.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
              : '- 없음'
          }\n\n` +
          `문장 단위 구조 설계도(최우선 잠금):\n${formatSentenceBlueprintPrompt(structureBlueprint)}\n\n` +
          `문장별 소재 치환 작업표(실제 작성 기준):\n${formatSentenceSubstitutionPrompt(structureBlueprint)}\n\n` +
          `소재 치환표(원문 내용 대신 현재 주제로 채울 것):\n${formatSubstitutionMapPrompt(structureBlueprint)}\n\n` +
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
          `- 새 연도 표현이 필요하면 ${CURRENT_CONTENT_YEAR}년만 쓰고 2024년은 쓰지 않음\n` +
          '- 레퍼런스 표면 주제/키워드/문장 변형 사용 금지(패러프레이즈 포함)\n' +
          '- 파일명/녹화일/촬영일/업로드일/스크린레코딩 날짜와 시간은 절대 쓰지 않음\n' +
          '- 레퍼런스의 구조, 전개 순서, 문장 기능, 길이감, 심리/욕구 트리거는 강하게 유지\n' +
          '- 바꾸는 것은 상품명/상황/업종/고유명사/구체 사례이고, 구조 자체를 새로 만들면 실패\n' +
          '- 문장 단위 구조 설계도가 있으면 각 번호를 결과 문장 1개로 치환한다. 문장 역할을 합치거나 생략하지 않는다\n' +
          '- 각 문장의 목표분량/문장형태/리듬/원본 느낌을 최대한 유지하고, 문장 안 소재만 현재 주제로 바꾼다\n' +
          '- 변경 범위는 topicSlots/replaceTargets/mustReplace에 해당하는 주제 표현으로 제한한다. 문장 골격, 절 순서, 강조 순서, 감정 흐름은 유지한다\n' +
          '- 새 아이디어를 만들지 말고, 원본 문장별 슬롯에 현재 계정 세팅과 이번 주제를 끼워 넣는다\n' +
          '- 원본 느낌이 단호함이면 단호하게, 공감이면 공감으로, 불안 자극이면 같은 심리 압박으로 치환한다\n' +
          '- 원문 대비 길이는 80~120% 범위에 가깝게 유지하고 요약하지 않음\n' +
          '- HOOK/BODY/CTA 모두 레퍼런스의 섹션 역할과 리듬을 따라가되 현재 계정 도메인과 이번 주제로 치환\n' +
          '- 핵심 키워드 슬롯은 이번 릴스 주제의 키워드로 채우고, 욕구 트리거는 가능한 한 유지\n' +
          '- 원문보다 눈에 띄게 짧아지지 않게 섹션 리듬/길이감을 유지\n' +
          '- HOOK은 위 장점 항목 중 최소 2개를 문장에 드러나게 반영\n' +
          '- 단, HOOK에서도 레퍼런스 원문 단어/주제/상황/고유명사 복사 금지\n' +
          '- BODY/CTA도 레퍼런스의 역할 순서와 설득 흐름을 유지하고, 소재만 현재 계정 도메인으로 치환\n' +
          '- 분석 메타 표현(첫 3초, 프레임, 클로즈업, 화면, 자막, 연출) 금지\n' +
          `${VARIATION_NATURAL_VOICE_RULES}\n` +
          '- HOOK/BODY/CTA 흐름을 분명히 연결\n' +
          '- 세팅 신호와 키워드는 억지 삽입보다 자연스러운 반영을 우선\n\n' +
          '다음 JSON 형식으로만 답하세요: {"hook":"","body":"","cta":""}',
      },
    ],
  })
  const usage = logAIUsage('abc-regenerate', response, {
    model: variationModel,
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
      angle: normalizeVariationAngle(item?.angle, VARIATION_CONFIGS[index]?.angle || ''),
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

function normalizeHookForSimilarity(value = '') {
  return String(value || '')
    .replace(/[“”‘’"'`~!@#$%^&*()[\]{}<>+=_|\\/:;,.?。！？…·]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getHookLeadSentence(value = '') {
  const normalized = normalizeHookForSimilarity(value)
  return normalized.split(/(?:요|다|죠|네)\s+/)[0]?.trim() || normalized.slice(0, 80)
}

function tokenizeHook(value = '') {
  return Array.from(
    new Set(
      normalizeHookForSimilarity(value)
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2),
    ),
  )
}

function getTokenOverlapRatio(a = '', b = '') {
  const aTokens = tokenizeHook(a)
  const bTokens = tokenizeHook(b)
  if (!aTokens.length || !bTokens.length) {
    return 0
  }

  const bSet = new Set(bTokens)
  const intersection = aTokens.filter((token) => bSet.has(token)).length
  return intersection / Math.min(aTokens.length, bTokens.length)
}

function areHooksTooSimilar(a = '', b = '') {
  const first = normalizeHookForSimilarity(a)
  const second = normalizeHookForSimilarity(b)
  if (!first || !second) {
    return false
  }

  const firstLead = getHookLeadSentence(first)
  const secondLead = getHookLeadSentence(second)
  const sameOpening =
    firstLead.slice(0, 10) &&
    secondLead.slice(0, 10) &&
    firstLead.slice(0, 10) === secondLead.slice(0, 10)
  const sameLeadPhrase =
    firstLead.slice(0, 16) &&
    secondLead.slice(0, 16) &&
    firstLead.slice(0, 16) === secondLead.slice(0, 16)
  const overlapRatio = getTokenOverlapRatio(firstLead, secondLead)

  return sameOpening || sameLeadPhrase || overlapRatio >= 0.7
}

function getVariationHookStyleInstruction(config = {}) {
  const label = String(config?.label || '')
  const angle = String(config?.angle || '')

  if (label === 'A안' || angle.includes('원본형')) {
    return '원본형: 레퍼런스의 시작 방식과 문장 수를 가장 보수적으로 유지하되 현재 주제로 치환한다.'
  }

  if (label === 'B안' || angle.includes('대화형')) {
    return '대화형: 레퍼런스 문장 골격은 유지하고, 같은 슬롯 치환 안에서 말투만 더 대화체로 둔다. A안과 같은 시작어만 피한다.'
  }

  if (label === 'C안' || angle.includes('후킹형')) {
    return '후킹형: 레퍼런스 문장 골격은 유지하고, 같은 슬롯 치환 안에서 긴장감만 조금 더 강하게 둔다. A/B안과 같은 시작어만 피한다.'
  }

  return '같은 구조는 유지하되 다른 안과 첫 문장 시작어를 겹치지 않는다.'
}

async function regenerateHookForDiversity({
  openai,
  variationModel,
  variation,
  config,
  categoryGuard,
  guardPromptSummary,
  characterSystemPrompt,
  structureBlueprint,
  previousHooks = [],
  focusTopic = '',
  usageContext = {},
}) {
  const response = await openai.chat.completions.create({
    model: variationModel,
    temperature: 0.7,
    messages: [
      {
        role: 'system',
        content:
          '당신은 숏폼 스크립트 HOOK만 다시 쓰는 편집자다. BODY/CTA는 바꾸지 않고 HOOK만 JSON으로 반환한다. ' +
          '레퍼런스 문장 골격과 현재 주제는 유지하되, 다른 초안들과 첫 문장 시작어만 겹치지 않게 만든다. ' +
          '완전히 새 훅을 만들지 말고 같은 문장 역할/분량/느낌 안에서 소재 표현만 조정한다. ' +
          '출력은 JSON만 반환한다.',
      },
      {
        role: 'user',
        content:
          `전략 라벨: ${config.label}\n` +
          `전략 방향: ${config.angle}\n` +
          `훅 차별화 지시: ${getVariationHookStyleInstruction(config)}\n` +
          `${focusTopic ? `이번 릴스 주제: ${focusTopic}\n` : ''}` +
          `카테고리: ${categoryGuard.category || '기타'}\n` +
          `세팅 신호: ${guardPromptSummary.settingCues.join(', ') || '없음'}\n\n` +
          `캐릭터 고정 규칙:\n${characterSystemPrompt || '설정 없음'}\n\n` +
          `HOOK 문장 구조 참고:\n${
            structureBlueprint.hookSentencePattern.length
              ? structureBlueprint.hookSentencePattern.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
              : '- 없음'
          }\n\n` +
          `문장 단위 구조 설계도:\n${formatSentenceBlueprintPrompt(structureBlueprint)}\n\n` +
          `겹치면 안 되는 기존 HOOK:\n${
            previousHooks.length ? previousHooks.map((hook, idx) => `${idx + 1}. ${hook}`).join('\n') : '- 없음'
          }\n\n` +
          `현재 HOOK:\n${variation.hook || ''}\n\n` +
          `현재 BODY:\n${variation.body || ''}\n\n` +
          `현재 CTA:\n${variation.cta || ''}\n\n` +
          '수정 조건:\n' +
          '- HOOK만 다시 쓴다\n' +
          '- BODY/CTA와 자연스럽게 이어져야 한다\n' +
          '- 레퍼런스의 문장 역할/길이감은 유지한다\n' +
          '- 기존 HOOK들과 같은 시작어, 같은 첫 절, 같은 핵심 문장 구조를 쓰지 않는다\n' +
          '- 그래도 완전히 새 구조로 튀지 말고 현재 주제에 맞게 소재만 치환한다\n\n' +
          '다음 JSON 형식으로만 답하세요: {"hook":""}',
      },
    ],
  })

  logAIUsage('abc-hook-diversify', response, {
    model: variationModel,
    ...usageContext,
    label: config.label,
    angle: config.angle,
  })

  const parsed = parseModelJson(response.choices[0]?.message?.content || '')
  return String(parsed?.hook || '').trim()
}

async function diversifySimilarHooks({
  variations = [],
  openai,
  variationModel,
  categoryGuard,
  guardPromptSummary,
  characterSystemPrompt,
  structureBlueprint,
  focusTopic,
  referenceGuard,
  usageContext = {},
}) {
  const nextVariations = [...variations]
  const acceptedHooks = []

  for (let index = 0; index < nextVariations.length; index += 1) {
    const config = VARIATION_CONFIGS[index] || {}
    const current = nextVariations[index]
    const currentHook = String(current?.hook || '').trim()
    const isSimilar = acceptedHooks.some((hook) => areHooksTooSimilar(currentHook, hook))

    if (!isSimilar || index === 0) {
      acceptedHooks.push(currentHook)
      continue
    }

    try {
      const regeneratedHook = await regenerateHookForDiversity({
        openai,
        variationModel,
        variation: current,
        config,
        categoryGuard,
        guardPromptSummary,
        characterSystemPrompt,
        structureBlueprint,
        previousHooks: acceptedHooks,
        focusTopic,
        usageContext,
      })

      const normalizedHook = normalizeGeneratedYearReferences(regeneratedHook)
      const revised = {
        ...current,
        hook: normalizedHook || currentHook,
      }
      const alignment = validateVariationAlignment(revised, categoryGuard, referenceGuard)
      const structureMatch = validateSentenceBlueprintMatch(revised, structureBlueprint, config)
      nextVariations[index] = {
        ...attachStructureMetadata(revised, structureBlueprint, structureMatch),
        alignment,
      }
      acceptedHooks.push(nextVariations[index].hook)
    } catch (_error) {
      acceptedHooks.push(currentHook)
    }
  }

  return nextVariations
}

function needsFlowPolish(variation = {}) {
  const text = [variation?.hook, variation?.body, variation?.cta]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('\n')
  if (!text) return false

  const awkwardPattern =
    /(첫\s*\d+초|클로즈업|화면|자막|문구|프레임|장면|시선\s*집중|도입부에서는|전개에서는|결론에서는|영상|편집|연출|저\s*원래부터|즉각\s*사로잡)/i
  return (
    awkwardPattern.test(text) ||
    GENERATED_METADATA_LEAK_PATTERN.test(text) ||
    AWKWARD_KOREAN_PATTERN.test(text) ||
    REPORT_STYLE_PATTERN.test(text)
  )
}

function isVariationStructureBroken(variation = {}, alignment = {}, guard = {}, structureMatch = null) {
  const hook = String(variation?.hook || '').trim()
  const body = String(variation?.body || '').trim()
  const cta = String(variation?.cta || '').trim()

  if (!hook || !body || !cta) {
    return { broken: true, reason: 'HOOK/BODY/CTA 비어 있음' }
  }
  if (!alignment?.ok) {
    return { broken: true, reason: alignment?.reason || '정합성 실패' }
  }
  if (
    structureMatch &&
    !structureMatch.ok &&
    Number(structureMatch.score || 0) < STRUCTURE_MATCH_HARD_RETRY_THRESHOLD
  ) {
    return {
      broken: true,
      reason: `레퍼런스 문장 구조 유사도 낮음(${structureMatch.score}/100): ${
        structureMatch.warnings?.[0] || '문장 역할/길이감 불일치'
      }`,
    }
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
  if (angle.includes('원본형') && /(문제|손해|실수|위험|기준|저장|지금|오늘)/.test(fullText)) toneMatch += 1
  if (angle.includes('대화형') && /(저도|나도|그럴|답답|해보|바꿔)/.test(fullText)) toneMatch += 1
  if (angle.includes('후킹형') && /(지금|오늘|바로|저장|신청|상담|구매|확인|시작)/.test(fullText)) toneMatch += 1
  if (Array.isArray(guard?.settingCues) && guard.settingCues.length) {
    const cueHit = guard.settingCues.some((cue) => containsTerm(fullText, cue))
    if (!cueHit) toneMatch -= 1
  }
  toneMatch = Math.max(1, Math.min(5, toneMatch))

  let naturalness = 4
  if (AWKWARD_KOREAN_PATTERN.test(fullText)) naturalness -= 2
  if (REPORT_STYLE_PATTERN.test(hook) || REPORT_STYLE_PATTERN.test(body) || REPORT_STYLE_PATTERN.test(cta)) {
    naturalness -= 1
  }
  if (/(합니다|드립니다|제공합니다|공유합니다|유도합니다)/.test(fullText)) naturalness -= 1
  if (/(개인용|특수한|직접적으로|자료|환경)/.test(fullText)) naturalness -= 1
  naturalness = Math.max(1, Math.min(5, naturalness))

  return {
    hook_strength: hookStrength,
    clarity,
    flow,
    cta_power: ctaPower,
    tone_match: toneMatch,
    naturalness,
    average: (hookStrength + clarity + flow + ctaPower + toneMatch + naturalness) / 6,
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
  if ((score.naturalness || 0) <= 2) return true
  return false
}

function normalizeVariationForValidation(rawVariation, index = 0) {
  if (rawVariation && typeof rawVariation === 'object' && !Array.isArray(rawVariation)) {
    return {
      label: String(rawVariation.label || `안${index + 1}`),
      angle: normalizeVariationAngle(rawVariation.angle, VARIATION_CONFIGS[index]?.angle || ''),
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
    angle: VARIATION_CONFIGS[index]?.angle || '',
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
  if (GENERATED_METADATA_LEAK_PATTERN.test(text)) {
    return { ok: false, reason: '파일명/녹화일 메타데이터 누출', warnings: [] }
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
    analysis_stage_metrics: cachedAnalysis.analysis_stage_metrics || {},
    transcript_quality: cachedAnalysis.transcript_quality || {},
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
      'analysis_stage_metrics',
      'transcript_quality',
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
  onProcessingCreated = null,
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
  const normalizedTitle = normalizeReferenceTitle({
    title,
    originalFilename: normalizedOriginalName,
  })
  const normalizedTopic = normalizeGenerationTopic(topic, normalizedTitle)
  const normalizedProjectId = normalizeOptionalProjectId(projectId) ?? null
  const supabaseAdmin = getSupabaseAdmin()
  const openai = getOpenAIClient()
  const { chatModel, variationModel } = getOpenAIModels()
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey)
  const fileFingerprint = await computeUploadedFileFingerprint(file)
  const analysisFingerprint = hashText(`${fileFingerprint}:${ANALYSIS_PROMPT_VERSION}`)
  const topicFocusPrompt = buildTopicFocusPrompt(normalizedTopic, normalizedTitle)
  const analysisReuseCacheKey = buildAnalysisReuseCacheKey({
    accountId,
    topic: normalizedTopic,
    title: normalizedTitle,
    originalFilename: normalizedOriginalName,
    fileFingerprint,
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
        if (typeof onProcessingCreated === 'function') {
          await onProcessingCreated(inProgress)
        }
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
  if (typeof onProcessingCreated === 'function') {
    await onProcessingCreated(processingReference)
  }

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

        const playbookContext = buildAccountPlaybookContext({
          accountSettings,
          characterSystemPrompt,
          categoryGuard,
        })

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
          category_playbook: playbookContext.payload,
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
    const transcriptPromise = hasAudio
      ? (async () => {
          const audioPath = await runStage(
            'extract-audio',
            baseContext,
            async () =>
              extractAudioTrack(created.videoPath, workspace, {
                maxDurationSeconds: cappedAudioSeconds,
              }),
            stageHooks,
          )

          return runStage(
            'transcription',
            baseContext,
            async () =>
              transcribeVideoAudio(audioPath, {
                title: normalizedTitle,
                topic: normalizedTopic,
              }),
            stageHooks,
          )
        })()
      : Promise.resolve({
          text: '',
          segments: [],
          duration: null,
          model: null,
        })

    const frameAnalysisPromise = (async () => {
      const extractedFrames = await runStage(
        'extract-frames',
        { ...baseContext, durationSeconds },
        async () => extractFrames(created.videoPath, workspace, durationSeconds),
        stageHooks,
      )
      const analyzedFrames = await runStage(
        'vision',
        { ...baseContext, frameCount: extractedFrames.length },
        async () =>
          analyzeVideoFrames(extractedFrames, {
            title: normalizedTitle,
            topic: normalizedTopic,
          }),
        stageHooks,
      )

      return {
        frames: extractedFrames,
        frameAnalysis: analyzedFrames,
      }
    })()

    const [transcript, frameAnalysisBundle] = await Promise.all([
      transcriptPromise,
      frameAnalysisPromise,
    ])
    const { frames, frameAnalysis } = frameAnalysisBundle
    const normalizedTranscript = transcript.text?.trim()
    const frameSummary = [
      frameAnalysis.summary?.trim(),
      buildFrameSummaryFromNotes(frameAnalysis.frames || []),
    ]
      .filter(Boolean)
      .join('\n')
    const transcriptQuality = scoreTranscriptReliability({
      text: normalizedTranscript || '',
      segments: transcript.segments || [],
      durationSeconds: transcript.duration || durationSeconds,
      hasAudio,
    })
    const transcriptReliabilityPrompt = buildTranscriptReliabilityPrompt(transcriptQuality)
    const transcriptForAnalysis = transcriptQuality.reliable ? normalizedTranscript : ''

    const transcriptDocumentContent = transcriptQuality.reliable
      ? normalizedTranscript
      : [
          '전사 품질 낮음',
          transcriptReliabilityPrompt,
          normalizedTranscript ? `불안정 전사(제한 참고):\n${normalizedTranscript}` : '전사 추출 없음',
          `시각 분석 요약:\n${frameSummary || '첫 3초 프레임에서 유효한 음성 전사를 얻지 못했습니다.'}`,
        ].join('\n\n')

    const ingestedDocument = await runStage(
      'ingest-document',
      { ...baseContext, transcriptEmpty: !normalizedTranscript, transcriptQuality: transcriptQuality.level },
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
            transcriptQuality: transcriptQuality.level,
            transcriptQualityScore: transcriptQuality.score,
            transcriptQualityReasons: transcriptQuality.reasons,
            hasAudio,
            transcriptCapped,
            transcriptCapSeconds: cappedAudioSeconds,
            category: 'reference-video',
          },
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
              `현재 기준 연도는 ${CURRENT_CONTENT_YEAR}년이다.`,
              transcriptQuality.reliable
                ? '중요: structureAnalysis/hookAnalysis/psychologyAnalysis/aiFeedback은 전사(텍스트) 기준으로 분석한다.'
                : '중요: 전사 신뢰도가 낮다. structureAnalysis/hookAnalysis/psychologyAnalysis/aiFeedback에서 전사를 핵심 근거로 과신하지 말고, 첫 3초 프레임/사용자 입력 주제/확인 가능한 자막 단서를 우선한다.',
              transcriptQuality.reliable
                ? '프레임(시각) 정보는 구조 보조 참고용으로만 사용하고, 위 4개 텍스트 필드의 핵심 근거는 반드시 전사에 둔다.'
                : '전사에서 알아들을 수 있는 문장만 제한적으로 참고하고, 불명확한 부분은 “전사 근거 부족”으로 표현한다.',
              '분석 단계에서는 외부 지식/일반 템플릿을 사용하지 않는다.',
              '레퍼런스에 명시되지 않은 연도, 통계, 기능명, 인스타그램 설정, 알림, 팔로워/완주율 같은 소재를 추론해서 쓰지 마라.',
              '파일명/녹화일/촬영일/업로드일/스크린레코딩 시간은 콘텐츠 내용이 아니다. structureAnalysis/hookAnalysis/psychologyAnalysis/aiFeedback에 소재처럼 쓰지 마라.',
              `연도를 새로 제시해야 하는 경우에는 ${CURRENT_CONTENT_YEAR}년만 사용하고, 2024년을 쓰지 마라.`,
              '전사가 짧거나 불명확하면 부족하다고 말하고, 없는 내용을 채워서 분석하지 마라.',
              characterSystemPrompt ? `캐릭터 고정 규칙:\n${characterSystemPrompt}` : null,
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
          {
            role: 'user',
            content:
              `${transcriptReliabilityPrompt}\n\n` +
              `전사${transcriptQuality.reliable ? '' : '(불안정, 제한 참고)'}:\n${
                transcriptForAnalysis || normalizedTranscript || '전사 추출 없음'
              }\n\n` +
              `첫 3초 프레임 분석:\n${JSON.stringify(frameAnalysis, null, 2)}\n\n` +
              '응답 포맷 규칙:\n' +
              '- JSON 구조는 절대 변경하지 마세요.\n' +
              '- 각 필드 텍스트는 사람이 읽기 좋게 자연스럽게 작성하세요.\n' +
              '- 줄바꿈을 적극적으로 사용하고, 한 문장을 과도하게 길게 쓰지 마세요.\n' +
              '- 기계적인 나열 문장보다 실제 설명하듯 작성하세요.\n' +
              '- structureAnalysis / hookAnalysis / psychologyAnalysis는 내부 설명을 구조적으로 나눠 작성하세요. 예: 도입, 전개, 결론.\n' +
              '- aiFeedback은 실제 사람이 주는 피드백처럼 구체적이고 개선 방향 중심으로 작성하세요.\n' +
              '- 금지: 전사/프레임에 없는 소재나 숫자를 예시처럼 추가하지 마세요.\n' +
              '- 금지: 외부 지식/일반 예시의 문장/사례를 레퍼런스 내용처럼 쓰지 마세요.\n' +
              `- 연도 규칙: 새 연도 표현이 필요하면 ${CURRENT_CONTENT_YEAR}년만 쓰고 2024년은 쓰지 마세요.\n` +
              (transcriptQuality.reliable
                ? '- 전사와 프레임이 서로 충돌하면 전사를 우선하고, 충돌 가능성을 aiFeedback에 짧게 언급하세요.\n'
                : '- 전사와 프레임이 서로 충돌하거나 전사가 불명확하면 프레임/사용자 입력 주제를 우선하고, 전사 근거가 약하다고 aiFeedback에 짧게 언급하세요.\n') +
              '다음 JSON 형식으로만 답하세요: ' +
              '{"structureAnalysis":"","hookAnalysis":"","psychologyAnalysis":"","aiFeedback":""}',
          },
        ],
        }),
      stageHooks,
    )

    const parsedAnalysisResult = await runStage(
      'parse-analysis-json',
      baseContext,
      async () => parseModelJson(analysisResponse.choices[0]?.message?.content || ''),
      stageHooks,
    )
    const analysisResult = normalizeAnalysisYearReferences(parsedAnalysisResult)
    const generationGuides = buildGenerationGuides({ analysisResult })
    const referenceGuard = {
      surfaceTerms: extractReferenceSurfaceTerms({
        title: normalizedTitle,
        topic: normalizedTopic,
        transcript: transcriptForAnalysis || '',
      }),
    }
    const shouldGenerateDrafts = Boolean(normalizedTranscript)
    let structureBlueprint = createEmptyStructureBlueprint(transcriptQuality)
    if (shouldGenerateDrafts) {
      structureBlueprint = await runStage(
        'extract-structure-blueprint',
        baseContext,
        async () =>
          buildStructureBlueprint({
            openai,
            chatModel,
            analysisResult,
            transcript: normalizedTranscript || '',
            transcriptQuality,
            frameSummary,
          }),
        stageHooks,
      )
    } else {
      await runStage(
        'skip-draft-generation',
        { ...baseContext, reason: 'missing-transcript' },
        async () => ({ skipped: true }),
        stageHooks,
      )
    }

    const categoryGuard = buildCategoryGuard({
      accountSettings,
      characterSystemPrompt,
    })
    const playbookContext = buildAccountPlaybookContext({
      accountSettings,
      characterSystemPrompt,
      categoryGuard,
    })
    const categoryPlaybook = playbookContext.playbook
    const playbookMode = playbookContext.mode
    const playbookPrompt = playbookContext.prompt
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

    let generatedVariations = []

    if (shouldGenerateDrafts) {
      const variationKnowledge = await runStage(
        'retrieve-global-knowledge',
        baseContext,
        async () =>
          retrieveGlobalKnowledgeContext({
            title: '',
            topic: [
              topicFocusPrompt || null,
              `카테고리: ${categoryGuard.category}`,
              `전략: ${VARIATION_CONFIGS.map((config) => config.angle).join(', ')}`,
              `검색 힌트: ${VARIATION_CONFIGS.map((config) => config.retrievalHint).join(' / ')}`,
            ]
              .filter(Boolean)
              .join('\n'),
            transcript: '',
            frameSummary: '',
            topK: 5,
          }),
        stageHooks,
      )
      const compactKnowledgeContext = clampText(
        variationKnowledge.contextText || '',
        VARIATION_CONTEXT_TEXT_MAX,
      )
      const sharedKnowledgeItems = mapGlobalKnowledgeDebug(variationKnowledge.items || [])

      const generatedVariationsRaw = await Promise.all(
        VARIATION_CONFIGS.map((config) =>
          runStage(`variation-${config.label}`, { ...baseContext, angle: config.angle }, async () => {
          const systemContent = [
            '당신은 숏폼 콘텐츠 작가다. 새 대본을 자유롭게 창작하지 말고, 잘 만든 레퍼런스 문장 구조에 현재 주제 소재를 끼워 넣어 1분 분량 스크립트를 작성한다. 출력은 JSON만 반환한다.',
            `현재 기준 연도는 ${CURRENT_CONTENT_YEAR}년이다. 새 연도 표현이 필요하면 ${CURRENT_CONTENT_YEAR}년만 쓰고 2024년은 쓰지 마라.`,
            '우선순위 규칙(절대 준수): 캐릭터 고정 규칙 > 이번 릴스 주제 > 계정/타겟/상품 맥락 > 레퍼런스 구조 잠금 > 전략 라벨/전략 의도.',
            '레퍼런스 제목/파일명/원문 주제는 콘텐츠 도메인 결정에 사용하지 마라.',
            '파일명, 녹화일, 촬영일, 업로드일, 스크린레코딩 날짜/시간은 절대 대본 소재로 사용하지 마라.',
            '레퍼런스 전사는 "내용 복사"가 아니라 구조/리듬/전개 방식/심리 트리거/길이감 참고용이다.',
            '문장별 소재 치환 작업표에 원문 골격 참고 문장이 있으면, 그 문장을 그대로 베끼지 말고 같은 문장 위치에서 같은 말맛/호흡/압박감으로 현재 주제 문장 1개로 바꾼다.',
            '레퍼런스 원문의 업종/소재/고유명사를 그대로 가져오지 마라. 계정 카테고리와 충돌하면 반드시 계정 카테고리로 재해석하라.',
            '즉, 계정이 뷰티/패션이면 건축/부동산/공학 같은 이질 도메인으로 쓰지 말고 뷰티 도메인으로 전환해서 작성하라.',
            'HOOK/BODY/CTA는 반드시 하나의 이야기 흐름으로 연결하라.',
            'HOOK/BODY/CTA 모두 레퍼런스의 문장 기능, 전개 순서, 리듬, 길이감을 강하게 참고하라.',
            '문장 단위 구조 설계도가 있으면 각 번호를 결과 문장 1개로 치환한다. 문장 역할을 합치거나 생략하지 않는다.',
            '사용자가 원하는 것은 완전 재창조가 아니라 레퍼런스와 비슷한 흐름/분량/리듬에 소재만 바뀐 결과다.',
            '핵심 키워드 역할과 욕구 키워드는 유지하고, 상품명/상황/업종/고유명사/구체 사례만 현재 주제로 치환하라.',
            '단, A/B/C 초안의 HOOK 첫 문장 시작어와 표현은 서로 달라야 한다. 구조는 같아도 사용자가 보기엔 다른 선택지처럼 보여야 한다.',
            'HOOK에서 던진 긴장/문제를 BODY 첫 문장에서 이어받고, CTA는 BODY 결론을 행동으로 전환해야 한다.',
            '아래 인사이트/체크포인트는 필요한 만큼 자연스럽게 반영하고, usedInsights/usedCheckpoints에는 실제로 참고한 항목만 기록하라.',
            '촌스럽고 교과서적인 문장을 금지하고, 실제 사람이 말하듯 자연스럽게 쓴다.',
            '공통: 설명체보다 대화체. 문장은 짧게 끊고 리듬감 있게. 추상적 표현 금지.',
            VARIATION_NATURAL_VOICE_RULES,
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
            `핵심 키워드 슬롯(반드시 현재 주제로 치환해서 유지):\n${
              structureBlueprint.keywordSlots.length
                ? structureBlueprint.keywordSlots.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
                : '- 없음'
            }\n\n` +
            `심리/욕구 트리거(가장 중요, 가능한 한 유지):\n${
              structureBlueprint.desireTriggers.length
                ? structureBlueprint.desireTriggers.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
                : '- 없음'
            }\n\n` +
            `섹션 리듬/길이감(원문보다 짧아지지 않게 유지):\n${
              [...structureBlueprint.sectionRhythm, ...structureBlueprint.lengthProfile].length
                ? [...structureBlueprint.sectionRhythm, ...structureBlueprint.lengthProfile]
                    .map((item, idx) => `${idx + 1}. ${item}`)
                    .join('\n')
                : '- 없음'
            }\n\n` +
            `치환 규칙(반드시 준수):\n${
              structureBlueprint.substitutionRules.length
                ? structureBlueprint.substitutionRules.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
                : '- 없음'
            }\n\n` +
            `문장 단위 구조 설계도(최우선 잠금):\n${formatSentenceBlueprintPrompt(structureBlueprint)}\n\n` +
            `문장별 소재 치환 작업표(실제 작성 기준):\n${formatSentenceSubstitutionPrompt(structureBlueprint)}\n\n` +
            `소재 치환표(원문 내용 대신 현재 주제로 채울 것):\n${formatSubstitutionMapPrompt(structureBlueprint)}\n\n` +
            '작성 강제 조건:\n' +
            '- 최우선 목표: 사용자가 “레퍼런스랑 거의 같은 흐름인데 내 주제로 바뀌었다”고 느껴야 한다\n' +
            '- 이번 릴스 주제가 주어졌다면 hook/body/cta 모두 그 주제를 직접 다뤄야 한다\n' +
            '- 계정 카테고리는 큰 방향이고, 이번 릴스 주제는 실제 소재/상품/상황을 결정하는 우선값이다\n' +
            '- 1단계: 레퍼런스의 전개 순서/문장 기능/길이감/욕구 트리거를 잠근다\n' +
            '- 2단계: 원문 상품명/상황/고유명사/구체 사례만 제거한다\n' +
            '- 3단계: 비어 있는 키워드 슬롯을 이번 릴스 주제와 계정 세팅으로 채운다\n' +
            '- 4단계: 잠근 구조 그대로 HOOK/BODY/CTA를 작성한다\n' +
            '- 문장 단위 구조 설계도가 있으면 각 번호를 결과 문장 1개로 치환한다. 문장 수를 마음대로 줄이거나 합치지 않는다\n' +
            '- 문장별 소재 치환 작업표의 “원문 골격 참고”는 반드시 같은 번호 결과 문장으로 대응시킨다. 예: 1번 원문 질문형이면 1번 결과도 현재 주제 질문형으로 시작한다\n' +
            '- 원문 문장의 단어를 그대로 쓰지 말고, 같은 위치의 문제/상황/욕구/반전/증거/CTA 기능을 현재 계정 주제로 바꾼다\n' +
            '- 각 문장은 목표분량/문장형태/절 구조/끝맺음/구두점 호흡/리듬/원본 느낌을 유지하고, 문장 안 소재/상황/상품명만 현재 주제로 치환한다\n' +
            '- 변경 범위는 topicSlots/replaceTargets/mustReplace에 해당하는 주제 표현으로 제한한다. 문장 골격, 절 순서, 쉼표 호흡, 강조 순서, 감정 흐름은 유지한다\n' +
            '- 레퍼런스가 질문으로 압박하면 결과도 같은 위치에서 질문으로 압박한다. 레퍼런스가 단호한 결론이면 결과도 같은 위치에서 단호하게 끝낸다\n' +
            '- 레퍼런스가 짧게 툭 던지는 문장은 결과도 짧게 툭 던지고, 길게 누적 설명하는 문장은 결과도 비슷한 길이로 누적한다\n' +
            '- A/B/C는 서로 다른 새 아이디어 3개가 아니다. 같은 레퍼런스 blueprint를 타는 주제 치환 버전 3개다\n' +
            '- 원본 느낌이 단호함이면 단호하게, 공감이면 공감으로, 불안 자극이면 같은 심리 압박으로 치환한다\n' +
            '- A안 원본형은 문장 수/길이/절 구조/끝맺음/순서를 가장 엄격하게 맞춘다. B안 대화형은 구조를 유지하고 말투만 더 말하듯 자연스럽게 만든다. C안 후킹형은 구조를 유지하고 후킹/CTA만 강하게 만든다. 세 안 모두 구조 자체를 새로 만들지 않는다\n' +
            `- 이 안의 훅 차별화 지시: ${getVariationHookStyleInstruction(config)}\n` +
            '- A/B/C 모두 같은 첫 문장 시작어를 쓰면 실패다. 예: 세 안 모두 "결론부터 말해요"로 시작 금지\n' +
            '- 세 안은 같은 blueprint를 타되, A는 원본 흐름, B는 말하듯 부드러운 진입, C는 더 강한 긴장/반전 진입으로 구분한다\n' +
            '- 레퍼런스 표면 단어/문장 변형/원문 주제 복사 금지\n' +
            '- 파일명/녹화일/촬영일/업로드일/스크린레코딩 날짜와 시간은 절대 쓰지 않는다\n' +
            '- 구조를 완전히 새로 만들지 마라. 표절 방지는 소재 치환으로 해결하고, 뼈대는 유지한다\n' +
            '- HOOK은 위의 HOOK 문장 구조 참고를 따라 시작 방식과 문장 호흡을 최대한 비슷하게 맞춘다\n' +
            '- HOOK은 레퍼런스 HOOK 장점 항목 중 최소 2개를 명확히 반영한다\n' +
            '- 단, HOOK도 원문 단어/원문 상황/고유명사는 절대 사용 금지\n' +
            '- BODY/CTA도 레퍼런스의 문장 기능과 설득 순서를 따라가고, 소재만 현재 계정 맥락으로 치환한다\n' +
            '- 핵심 키워드 슬롯과 심리/욕구 트리거가 결과물에서 사라지면 실패다\n' +
            '- 원문보다 25% 이상 짧아지지 않게 한다. 길이를 줄여 요약하지 마라\n' +
            '- 계정 설정(카테고리/타겟/상품/톤)에 맞는 도메인으로 작성\n' +
            '- 키워드를 억지로 끼워 넣지 말고, 자연스러운 주장과 흐름을 우선\n\n' +
            '- angle은 카드 상단에 보이는 짧은 이름이다. 8자 이하 명사형으로만 쓴다\n' +
            '- angle 예시: 원본형, 대화형, 후킹형\n' +
            '- angle에 영상 주제, 긴 문장, 설명문, "1분 만에" 같은 문구를 넣지 않는다\n' +
            '- angle이 애매하면 전략 방향의 짧은 이름만 사용한다\n\n' +
            `- 연도 규칙: 새 연도 표현이 필요하면 ${CURRENT_CONTENT_YEAR}년만 쓰고 2024년은 쓰지 않는다\n\n` +
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
            '분량 규칙(중요): 레퍼런스 문장 blueprint의 길이감을 1순위로 맞추세요.\n' +
            '- 목표 길이: 레퍼런스 대비 80~120% 안쪽\n' +
            '- 문장 단위 blueprint가 있으면 문장 수를 임의로 줄이지 않음\n' +
            '- blueprint가 약한 경우에만 1분 릴스 기준 hook 45~90자, body 220~320자, cta 40~80자를 참고\n' +
            '다음 JSON 형식으로만 답하세요: ' +
            '{"label":"","angle":"","coreMessage":"","hookIntent":"","bodyLogic":"","ctaReason":"","hook":"","body":"","cta":"","usedInsights":[],"usedCheckpoints":[]}'

          let normalized = null
          let alignment = { ok: false, reason: '초기 상태' }
          let structureMatch = null
          let variationUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

          const variationResponse = await openai.chat.completions.create({
            model: variationModel,
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
              model: variationModel,
              accountId,
              referenceId: processingReference.id,
              label: config.label,
              angle: config.angle,
            }),
          )

          const parsed = parseModelJson(variationResponse.choices[0]?.message?.content || '')
          normalized = normalizeVariationYearReferences(normalizeVariationDraft(parsed, config, generationGuides))
          alignment = validateVariationAlignment(normalized, categoryGuard, referenceGuard)
          structureMatch = validateSentenceBlueprintMatch(normalized, structureBlueprint, config)

          const structureState = isVariationStructureBroken(normalized, alignment, categoryGuard, structureMatch)

          if (ENABLE_COST_GUARD && structureState.broken) {
            normalized = normalizeVariationYearReferences(await regenerateVariationWithGPT({
              openai,
              variationModel,
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
            }))
            variationUsage = sumAIUsage(variationUsage, normalized?.usage)
            if (normalized?.usage) {
              delete normalized.usage
            }
            alignment = validateVariationAlignment(normalized, categoryGuard, referenceGuard)
            structureMatch = validateSentenceBlueprintMatch(normalized, structureBlueprint, config)
          } else if (ENABLE_COST_GUARD && ENABLE_QUALITY_REGEN) {
            const qualityScore = scoreVariationQuality(normalized, config, categoryGuard)
            if (shouldRegenerateByQuality(qualityScore)) {
              normalized = normalizeVariationYearReferences(await regenerateVariationWithGPT({
                openai,
                variationModel,
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
              }))
              variationUsage = sumAIUsage(variationUsage, normalized?.usage)
              if (normalized?.usage) {
                delete normalized.usage
              }
              alignment = validateVariationAlignment(normalized, categoryGuard, referenceGuard)
              structureMatch = validateSentenceBlueprintMatch(normalized, structureBlueprint, config)
            }
          } else {
            // Legacy path: if cost guard is off, keep a single fallback regenerate for hard misalignment only.
            if (normalized && !alignment.ok) {
              normalized = normalizeVariationYearReferences(await regenerateVariationWithGPT({
                openai,
                variationModel,
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
              }))
              variationUsage = sumAIUsage(variationUsage, normalized?.usage)
              if (normalized?.usage) {
                delete normalized.usage
              }
              alignment = validateVariationAlignment(normalized, categoryGuard, referenceGuard)
              structureMatch = validateSentenceBlueprintMatch(normalized, structureBlueprint, config)
            }
          }

          if (!normalized) {
            normalized = normalizeVariationYearReferences(await regenerateVariationWithGPT({
              openai,
              variationModel,
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
            }))
            variationUsage = sumAIUsage(variationUsage, normalized?.usage)
            if (normalized?.usage) {
              delete normalized.usage
            }
            alignment = validateVariationAlignment(normalized, categoryGuard, referenceGuard)
            structureMatch = validateSentenceBlueprintMatch(normalized, structureBlueprint, config)
          }

          // 문장 말투가 깨진 초안은 재생성 이후라도 한 번 더 다듬어 사용자에게 노출되는 번역투를 줄인다.
          if (ENABLE_ABC_POLISH && normalized && alignment.ok && needsFlowPolish(normalized)) {
            try {
              const polishResponse = await openai.chat.completions.create({
                model: variationModel,
                temperature: 0.2,
                messages: [
                  {
                    role: 'system',
                    content:
                      '당신은 숏폼 스크립트 문장 다듬기 편집자다. 의미는 유지하고 문장만 더 자연스럽게 고친다. ' +
                      '영상 분석 메타 표현(예: 첫 3초, 자막, 클로즈업, 화면, 장면, 문구)을 절대 쓰지 마라. ' +
                      '파일명/녹화일/촬영일/업로드일/스크린레코딩 날짜와 시간도 절대 쓰지 마라. ' +
                      `${VARIATION_NATURAL_VOICE_RULES} ` +
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
                      '- 어색한 번역투, 보고서체, "~합니다/~드립니다" 말투는 짧은 해요체로 바꾸기\n' +
                      '- 전략 라벨 톤은 유지\n\n' +
                      '다음 JSON 형식으로만 답하세요: {"hook":"","body":"","cta":""}',
                  },
                ],
              })
              variationUsage = sumAIUsage(
                variationUsage,
                logAIUsage('abc-polish', polishResponse, {
                  model: variationModel,
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
              normalized = normalizeVariationYearReferences(normalized)
              alignment = validateVariationAlignment(normalized, categoryGuard, referenceGuard)
              structureMatch = validateSentenceBlueprintMatch(normalized, structureBlueprint, config)
            } catch (_error) {
              // Keep original draft when polish step fails.
            }
          }

          logAIUsage('abc-total', variationUsage, {
            model: variationModel,
            accountId,
            referenceId: processingReference.id,
            label: config.label,
            angle: config.angle,
          })
          const structuredNormalized = attachStructureMetadata(
            normalized,
            structureBlueprint,
            structureMatch || validateSentenceBlueprintMatch(normalized, structureBlueprint, config),
          )

          return {
            ...structuredNormalized,
            alignment,
            usedChunkIds: sharedKnowledgeItems.map((item) => item.id),
            usedKnowledge: sharedKnowledgeItems,
          }
        }, stageHooks),
      ),
    )
      const hookDiversifiedVariations = await diversifySimilarHooks({
        variations: generatedVariationsRaw,
        openai,
        variationModel,
        categoryGuard,
        guardPromptSummary,
        characterSystemPrompt,
        structureBlueprint,
        focusTopic: normalizedTopic,
        referenceGuard,
        usageContext: {
          accountId,
          referenceId: processingReference.id,
        },
      })
      generatedVariations = enforceVariationDiversity(hookDiversifiedVariations, categoryGuard)
    }

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
          analysis_stage_metrics: stageMetrics,
          transcript_quality: transcriptQuality,
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
            'analysis_stage_metrics',
            'transcript_quality',
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
      global_knowledge_debug: [],
      global_knowledge_categories: [],
      category_playbook: playbookContext.payload,
      analysis_stage_metrics: stageMetrics,
      transcript_quality: transcriptQuality,
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
        analysisStageMetrics: legacyReferenceVideo.analysis_stage_metrics || {},
        transcriptQuality: legacyReferenceVideo.transcript_quality || {},
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
  await expireStaleProcessingReferences({ supabaseAdmin, accountId })
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
  await expireStaleProcessingReferences({ supabaseAdmin, accountId, referenceId: referenceVideoId })
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
  let categoryPlaybookPayload = null

  try {
    const profile = await getAccountProfile(accountId)
    const settings =
      profile?.settings && typeof profile.settings === 'object'
        ? profile.settings
        : {}
    const playbookContext = buildAccountPlaybookContext({
      accountSettings: settings,
      characterSystemPrompt: '',
    })
    categoryPlaybookPayload = playbookContext.payload
  } catch (error) {
    logAIError('analysis', error, {
      stage: 'reference-detail-account-profile',
      referenceVideoId,
      accountId,
    })
  }

  if (data.processing_status && data.processing_status !== 'completed') {
    return {
      ...data,
      variations: Array.isArray(data.variations) ? data.variations : [],
      global_knowledge_debug: [],
      global_knowledge_categories: [],
      category_playbook: categoryPlaybookPayload,
    }
  }

  try {
    const existingKnowledgeItems = enrichedVariations
      .flatMap((variation) => (Array.isArray(variation?.usedKnowledge) ? variation.usedKnowledge : []))
      .filter(Boolean)
    const existingKnowledgeMap = new Map()
    for (const item of existingKnowledgeItems) {
      if (!item?.id || existingKnowledgeMap.has(item.id)) continue
      existingKnowledgeMap.set(item.id, item)
    }

    if (existingKnowledgeMap.size) {
      globalKnowledgeDebug = Array.from(existingKnowledgeMap.values())
      globalKnowledgeCategories = Array.from(
        new Set(globalKnowledgeDebug.map((item) => item.category).filter(Boolean)),
      )
    } else {
      const globalKnowledge = await retrieveGlobalKnowledgeContext({
        title: data.title,
        topic: data.topic,
        transcript: data.transcript || '',
        frameSummary,
        topK: 4,
      })

      globalKnowledgeDebug = mapGlobalKnowledgeDebug(globalKnowledge.items || [])
      globalKnowledgeCategories = globalKnowledge.categories || []
    }

    const needsVariationKnowledge = enrichedVariations.some(
      (variation) => !Array.isArray(variation?.usedKnowledge) || variation.usedKnowledge.length === 0,
    )

    if (needsVariationKnowledge && enrichedVariations.length && globalKnowledgeDebug.length) {
      enrichedVariations = enrichedVariations.map((variation) => ({
        ...variation,
        usedChunkIds: globalKnowledgeDebug.map((item) => item.id),
        usedKnowledge: globalKnowledgeDebug,
      }))
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
    category_playbook: categoryPlaybookPayload,
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
    const normalizedTitle = normalizeReferenceTitle({ title })
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

export const __referenceVideoAnalysisTest = {
  buildTopicFocusPrompt,
  extractReferenceSurfaceTerms,
  findReferenceSurfaceLeakage,
  normalizeGenerationTopic,
  normalizeReferenceTitle,
}
