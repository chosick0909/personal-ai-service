import { AppError } from './errors.js'
import { logAIError } from './ai-error-logger.js'
import { parseModelJson } from './model-json.js'
import { getOpenAIClient, getOpenAIModels, hasOpenAIConfig } from './openai.js'
import { getSupabaseAdmin, hasSupabaseAdminConfig } from './supabase.js'

function requireClients() {
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

  return {
    supabaseAdmin: getSupabaseAdmin(),
    openai: getOpenAIClient(),
    models: getOpenAIModels(),
  }
}

function normalizeSections(sections = {}) {
  return {
    hook: sections.hook?.trim() || '',
    body: sections.body?.trim() || '',
    cta: sections.cta?.trim() || '',
  }
}

async function loadReferenceContext(supabaseAdmin, accountId, referenceId) {
  const { data, error } = await supabaseAdmin
    .from('reference_videos')
    .select(
      'id, title, topic, transcript, structure_analysis, hook_analysis, psychology_analysis, frame_notes, ai_feedback, variations',
    )
    .eq('id', referenceId)
    .eq('account_id', accountId)
    .single()

  if (error) {
    const statusCode = error.code === 'PGRST116' ? 404 : 500

    throw new AppError(
      statusCode === 404 ? 'Reference analysis not found' : 'Failed to load reference analysis',
      {
        code: statusCode === 404 ? 'REFERENCE_NOT_FOUND' : 'REFERENCE_FETCH_FAILED',
        statusCode,
        cause: error,
      },
    )
  }

  return data
}

function buildReferenceContext(reference) {
  const frameNotes = (reference.frame_notes || [])
    .slice(0, 3)
    .map((frame) =>
      [frame.timestamp != null ? `${frame.timestamp}초` : null, frame.observation, frame.hookReason]
        .filter(Boolean)
        .join(' · '),
    )
    .join('\n')

  return [
    `레퍼런스 제목: ${reference.title}`,
    `내 주제: ${reference.topic}`,
    `구조 분석: ${reference.structure_analysis || '-'}`,
    `후킹 분석: ${reference.hook_analysis || '-'}`,
    `심리 기제: ${reference.psychology_analysis || '-'}`,
    `프레임 인사이트: ${frameNotes || '-'}`,
    `기존 AI 피드백: ${reference.ai_feedback || '-'}`,
    `전사: ${reference.transcript || '-'}`,
  ].join('\n')
}

function buildReferenceGuides(reference) {
  const insights = [
    reference.hook_analysis,
    reference.psychology_analysis,
    ...(reference.frame_notes || []).map((frame) => frame?.hookReason || frame?.observation || ''),
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 4)

  const checkpoints = [reference.structure_analysis, reference.ai_feedback]
    .flatMap((value) =>
      String(value || '')
        .split(/\n+/)
        .map((line) => line.replace(/^[-*•\d.\s]+/, '').trim())
        .filter(Boolean),
    )
    .slice(0, 4)

  return { insights, checkpoints }
}

export async function refineScriptWithAI({
  accountId,
  referenceId,
  selectedLabel,
  request,
  sections,
  characterSystemPrompt = '',
  personalizationContext = '',
}) {
  const normalizedRequest = request?.trim()
  const normalizedSections = normalizeSections(sections)

  if (!normalizedRequest) {
    throw new AppError('request is required', {
      code: 'INVALID_REFINE_REQUEST',
      statusCode: 400,
    })
  }

  const { supabaseAdmin, openai, models } = requireClients()
  const reference = await loadReferenceContext(supabaseAdmin, accountId, referenceId)
  const referenceContext = buildReferenceContext(reference)
  const guides = buildReferenceGuides(reference)

  try {
    const response = await openai.chat.completions.create({
      model: models.chatModel,
      temperature: 0.5,
      messages: [
        {
          role: 'system',
          content: [
            '당신은 숏폼 콘텐츠 편집 코파일럿이다. 사용자의 수정 요청을 반영해 HOOK/BODY/CTA를 한국어로 다듬는다. 반드시 제공된 레퍼런스 분석을 최대한 참고하고, 출력은 JSON만 반환한다.',
            '문체 규칙: 설명형/교과서형 문장을 피하고 실제 사람이 말하듯 자연스럽게 쓴다. 문장은 짧게 끊고 리듬감을 만든다.',
            'HOOK 규칙: 첫 문장에서 긴장감, 반전, 궁금증을 만든다. "~하시나요?" 같은 평범한 질문은 금지한다.',
            'BODY 규칙: 상황으로 시작하고 한 문장씩 끊어 전개한다. "많은 사람들이 ~ 하지만" 같은 문장을 금지한다.',
            'CTA 규칙: 행동 이유(손해/이득/궁금증)를 포함해 짧고 강하게 마무리한다. "좋아요/팔로우 부탁" 문구는 금지한다.',
            '연결성 규칙: HOOK에서 던진 문제를 BODY 첫 문장에서 이어받고, CTA는 BODY 결론을 행동으로 전환한다.',
            '아래 핵심 인사이트/체크포인트를 가능한 한 유지해서 수정한다.',
            '말투 규칙: 항상 존댓말(하십시오체/해요체)만 사용한다. 반말, 친구 말투, 명령형 반말 어미는 금지한다.',
            characterSystemPrompt ? `캐릭터 고정 규칙:\n${characterSystemPrompt}` : null,
            personalizationContext
              ? `개인화 메모리 컨텍스트(반드시 반영):\n${personalizationContext}`
              : null,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
        {
          role: 'user',
          content:
            `${referenceContext}\n\n` +
            `핵심 인사이트:\n${
              guides.insights.length
                ? guides.insights.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
                : '- 없음'
            }\n\n` +
            `바로 써먹을 체크포인트:\n${
              guides.checkpoints.length
                ? guides.checkpoints.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
                : '- 없음'
            }\n\n` +
            `선택한 안: ${selectedLabel || '-'}\n` +
            `사용자 요청: ${normalizedRequest}\n\n` +
            `현재 초안:\nHOOK: ${normalizedSections.hook}\nBODY: ${normalizedSections.body}\nCTA: ${normalizedSections.cta}\n\n` +
            '톤 개선 지침:\n' +
            '- 공통: 대화체, 짧은 문장, 추상 표현 금지\n' +
            '- HOOK: 평범한 질문형 금지, 첫 문장 긴장감\n' +
            '- BODY: 교과서 문장 금지, 상황/경험형 전개\n' +
            '- CTA: 이유가 있는 행동 유도, 뻔한 부탁형 금지\n\n' +
            '다음 JSON 형식으로만 답하세요: ' +
            '{"message":"","sections":{"hook":"","body":"","cta":""}}',
        },
      ],
    })

    const parsed = parseModelJson(response.choices[0]?.message?.content || '')
    const nextSections = normalizeSections(parsed.sections)

    return {
      message:
        parsed.message?.trim() ||
        '요청을 반영해 HOOK, BODY, CTA를 다시 정리했습니다.',
      sections: nextSections,
    }
  } catch (error) {
    logAIError('gpt', error, {
      referenceId,
      request: normalizedRequest,
      stage: 'script-refine',
      model: models.chatModel,
    })

    throw new AppError('Script refinement failed', {
      code: 'SCRIPT_REFINE_FAILED',
      statusCode: 502,
      cause: error,
    })
  }
}

export async function generateScriptFeedback({
  accountId,
  referenceId,
  selectedLabel,
  sections,
  characterSystemPrompt = '',
  personalizationContext = '',
}) {
  const normalizedSections = normalizeSections(sections)
  const { supabaseAdmin, openai, models } = requireClients()
  const reference = await loadReferenceContext(supabaseAdmin, accountId, referenceId)
  const referenceContext = buildReferenceContext(reference)
  const guides = buildReferenceGuides(reference)

  try {
    const response = await openai.chat.completions.create({
      model: models.chatModel,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content: [
            '당신은 숏폼 콘텐츠 평가자다. 제공된 초안을 100점 만점으로 평가하고, 개선 포인트를 짧고 명확하게 제안한다. 출력은 JSON만 반환한다.',
            'suggestedSections를 작성할 때는 설명형/교과서형 문장을 피하고, 실제 사람이 말하는 톤으로 다시 써라.',
            'HOOK은 긴장감 있게, BODY는 상황/경험형으로, CTA는 행동 이유를 담아 짧고 강하게 제안하라.',
            '평가 시 HOOK/BODY/CTA 연결성과 핵심 인사이트 반영 여부를 반드시 본다.',
            '말투 규칙: 항상 존댓말(하십시오체/해요체)만 사용한다. 반말, 친구 말투, 명령형 반말 어미는 금지한다.',
            characterSystemPrompt ? `캐릭터 고정 규칙:\n${characterSystemPrompt}` : null,
            personalizationContext
              ? `개인화 메모리 컨텍스트(반드시 반영):\n${personalizationContext}`
              : null,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
        {
          role: 'user',
          content:
            `${referenceContext}\n\n` +
            `핵심 인사이트:\n${
              guides.insights.length
                ? guides.insights.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
                : '- 없음'
            }\n\n` +
            `바로 써먹을 체크포인트:\n${
              guides.checkpoints.length
                ? guides.checkpoints.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
                : '- 없음'
            }\n\n` +
            `선택한 안: ${selectedLabel || '-'}\n` +
            `현재 초안:\nHOOK: ${normalizedSections.hook}\nBODY: ${normalizedSections.body}\nCTA: ${normalizedSections.cta}\n\n` +
            '다음 JSON 형식으로만 답하세요: ' +
            '{"score":82,"summary":"","detail":"","suggestedSections":{"hook":"","body":"","cta":""}}',
        },
      ],
    })

    const parsed = parseModelJson(response.choices[0]?.message?.content || '')

    return {
      score: Number(parsed.score) || 0,
      summary: parsed.summary?.trim() || '전체 구조는 괜찮지만 더 압축할 여지가 있습니다.',
      detail: parsed.detail?.trim() || 'HOOK, BODY, CTA의 역할을 더 또렷하게 나누면 성능이 좋아질 수 있습니다.',
      suggestedSections: normalizeSections(parsed.suggestedSections),
    }
  } catch (error) {
    logAIError('gpt', error, {
      referenceId,
      stage: 'script-feedback',
      model: models.chatModel,
    })

    throw new AppError('Script feedback generation failed', {
      code: 'SCRIPT_FEEDBACK_FAILED',
      statusCode: 502,
      cause: error,
    })
  }
}
