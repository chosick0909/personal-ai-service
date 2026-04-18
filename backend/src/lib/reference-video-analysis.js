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

function buildGenerationGuides({ analysisResult, frameAnalysis }) {
  const insights = [
    ...toBulletCandidates(analysisResult?.hookAnalysis || ''),
    ...toBulletCandidates(analysisResult?.psychologyAnalysis || ''),
    ...(frameAnalysis?.frames || [])
      .map((frame) => String(frame?.hookReason || frame?.observation || '').trim())
      .filter(Boolean),
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
  title,
  topic,
  originalFilename,
  mimeType,
  cachedAnalysis,
}) {
  const { data, error } = await supabaseAdmin
    .from('reference_videos')
    .insert({
      account_id: accountId,
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
    })
    .select(
      'id, title, topic, original_filename, duration_seconds, transcript, frame_timestamps, frame_notes, structure_analysis, hook_analysis, psychology_analysis, variations, ai_feedback, document_id, created_at',
    )
    .single()

  if (error) {
    throw new AppError('Failed to persist reused reference analysis', {
      code: 'REFERENCE_VIDEO_REUSE_PERSIST_FAILED',
      statusCode: 500,
      cause: error,
    })
  }

  return data
}

export async function analyzeReferenceVideo({ file, topic, title, accountId, characterSystemPrompt = '' }) {
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
        cacheLog('hit', {
          accountId,
          topic: normalizedTopic,
          title: normalizedTitle,
        })
        const reused = await persistReusedReferenceVideo({
          supabaseAdmin,
          accountId,
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
    const generationGuides = buildGenerationGuides({ analysisResult, frameAnalysis })

    const generatedVariations = await Promise.all(
      VARIATION_CONFIGS.map((config) =>
        runStage(`variation-${config.label}`, { ...baseContext, angle: config.angle }, async () => {
          const variationKnowledge = await retrieveGlobalKnowledgeContext({
            title: '',
            topic: `전략: ${config.angle}\n검색 힌트: ${config.retrievalHint}`,
            transcript: normalizedTranscript || '',
            frameSummary,
            topK: 4,
          })

          const variationResponse = await openai.chat.completions.create({
            model: chatModel,
            temperature: 0.8,
            messages: [
              {
                role: 'system',
                content: [
                  '당신은 숏폼 콘텐츠 작가다. 지정된 전략에 맞는 1분 분량 스크립트를 작성한다. 출력은 JSON만 반환한다.',
                  '우선순위 규칙(절대 준수): 캐릭터 고정 규칙 > 계정/타겟/상품 맥락 > 전략 라벨/전략 의도 > 레퍼런스 전사.',
                  '레퍼런스 제목/파일명/원문 주제는 콘텐츠 도메인 결정에 사용하지 마라.',
                  '레퍼런스 전사는 "내용 복사"가 아니라 구조/리듬/전개 방식 참고용이다.',
                  '레퍼런스 원문의 업종/소재/고유명사를 그대로 가져오지 마라. 계정 카테고리와 충돌하면 반드시 계정 카테고리로 재해석하라.',
                  '즉, 계정이 뷰티/패션이면 건축/부동산/공학 같은 이질 도메인으로 쓰지 말고 뷰티 도메인으로 전환해서 작성하라.',
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
                  .join('\n\n'),
              },
              {
                role: 'user',
                content:
                  `전략 라벨: ${config.label}\n` +
                  `전략 방향: ${config.angle}\n` +
                  `전략 의도: ${config.retrievalHint}\n\n` +
                  `캐릭터 세팅 요약(절대 우선):\n${characterSystemPrompt || '설정 없음'}\n\n` +
                  '작성 강제 조건:\n' +
                  '- 계정 설정(카테고리/타겟/상품/톤)에 맞는 도메인으로 반드시 작성\n' +
                  '- 레퍼런스 제목/파일명/원문 주제는 무시\n' +
                  '- 레퍼런스 원문 주제와 계정 설정이 충돌하면 계정 설정을 우선\n' +
                  '- 레퍼런스는 구조/후킹 패턴만 참고하고 소재는 계정 도메인으로 재작성\n\n' +
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
                  `공통 분석 요약:\n구조: ${analysisResult.structureAnalysis || '-'}\n후킹: ${analysisResult.hookAnalysis || '-'}\n심리: ${analysisResult.psychologyAnalysis || '-'}\n\n` +
                  `레퍼런스 전사:\n${normalizedTranscript || '전사 추출 없음'}\n\n` +
                  `참고 글로벌 지식(이 안에서 우선 참고):\n${variationKnowledge.contextText || '검색된 지식 없음'}\n\n` +
                  '분량 규칙(중요): 1분 릴스 기준으로 충분히 길게 작성하세요.\n' +
                  '- 목표 길이: 약 50~70초\n' +
                  '- hook: 약 8~12초 (45~90자)\n' +
                  '- body: 약 35~45초 (220~320자)\n' +
                  '- cta: 약 8~12초 (40~80자)\n' +
                  '다음 JSON 형식으로만 답하세요: ' +
                  '{"label":"","angle":"","coreMessage":"","hookIntent":"","bodyLogic":"","ctaReason":"","hook":"","body":"","cta":"","usedInsights":[],"usedCheckpoints":[]}',
              },
            ],
          })

          const parsed = parseModelJson(variationResponse.choices[0]?.message?.content || '')
          const normalized = normalizeVariationDraft(parsed, config, generationGuides)
          const knowledgeItems = mapGlobalKnowledgeDebug(variationKnowledge.items || [])

          return {
            ...normalized,
            usedChunkIds: knowledgeItems.map((item) => item.id),
            usedKnowledge: knowledgeItems,
          }
        }),
      ),
    )

    const { data: row, error } = await runStage('save-reference-video', baseContext, async () =>
      supabaseAdmin
        .from('reference_videos')
        .insert({
          account_id: accountId,
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
        })
        .select(
          'id, title, topic, original_filename, duration_seconds, transcript, frame_timestamps, frame_notes, structure_analysis, hook_analysis, psychology_analysis, variations, ai_feedback, document_id, created_at',
        )
        .single(),
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
  const { data, error } = await supabaseAdmin
    .from('reference_videos')
    .select(
      'id, title, topic, original_filename, duration_seconds, structure_analysis, hook_analysis, psychology_analysis, variations, ai_feedback, created_at',
    )
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })

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
  const { data, error } = await supabaseAdmin
    .from('reference_videos')
    .select(
      'id, title, topic, original_filename, duration_seconds, transcript, transcript_segments, frame_timestamps, frame_notes, structure_analysis, hook_analysis, psychology_analysis, variations, ai_feedback, document_id, created_at',
    )
    .eq('id', referenceVideoId)
    .eq('account_id', accountId)
    .single()

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

export async function renameReferenceVideo(referenceVideoId, accountId, nextTitle) {
  if (!hasSupabaseAdminConfig()) {
    throw new AppError('Supabase admin client is not configured', {
      code: 'SUPABASE_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  const normalizedTitle = String(nextTitle || '').trim()
  if (!normalizedTitle) {
    throw new AppError('title is required', {
      code: 'INVALID_REFERENCE_VIDEO_TITLE',
      statusCode: 400,
    })
  }

  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from('reference_videos')
    .update({ title: normalizedTitle.slice(0, 200) })
    .eq('id', referenceVideoId)
    .eq('account_id', accountId)
    .select('id, title')
    .maybeSingle()

  if (error) {
    throw new AppError('Failed to rename reference video analysis', {
      code: 'REFERENCE_VIDEO_RENAME_FAILED',
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
