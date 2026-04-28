import { AppError } from './errors.js'
import { logAIError } from './ai-error-logger.js'
import { logAIUsage } from './ai-usage-logger.js'
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

const SECTION_KEYS = ['hook', 'body', 'cta']
const SECTION_LABELS = {
  hook: 'HOOK',
  body: 'BODY',
  cta: 'CTA',
}
const EDIT_TARGETS = new Set(['all', ...SECTION_KEYS])

function compactSummaryText(value = '', maxLength = 34) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text
}

function isGenericRefineMessage(message = '') {
  const text = String(message || '').trim()
  if (!text) return true

  const genericPatterns = [
    /요청을\s*반영/,
    /다시\s*정리/,
    /수정(?:을)?\s*적용/,
    /수정(?:했|하였)습니다/,
    /다듬(?:었|었습니다)/,
  ]
  const concretePatterns = [
    /HOOK|BODY|CTA/,
    /훅|본문|바디|행동|유도|흐름|전개|시작|문제|결론/,
    /식으로|방향으로|느낌으로/,
  ]

  return genericPatterns.some((pattern) => pattern.test(text)) && !concretePatterns.some((pattern) => pattern.test(text))
}

function buildFallbackRefineMessage(previousSections = {}, nextSections = {}) {
  const previous = normalizeSections(previousSections)
  const next = normalizeSections(nextSections)
  const changes = []

  if (next.hook && next.hook !== previous.hook) {
    const hookPreview = compactSummaryText(next.hook)
    changes.push(
      hookPreview
        ? `HOOK은 "${hookPreview}"처럼 바로 문제를 찌르는 식으로 바꿨습니다`
        : 'HOOK은 첫 문장에서 문제를 더 바로 찌르는 식으로 바꿨습니다',
    )
  }

  if (next.body && next.body !== previous.body) {
    changes.push('BODY는 상황에서 해결 흐름으로 자연스럽게 이어지게 풀었습니다')
  }

  if (next.cta && next.cta !== previous.cta) {
    const ctaPreview = compactSummaryText(next.cta)
    changes.push(
      ctaPreview
        ? `CTA는 "${ctaPreview}"처럼 다음 행동이 더 분명하게 보이게 정리했습니다`
        : 'CTA는 다음 행동이 더 분명하게 보이게 정리했습니다',
    )
  }

  if (!changes.length) {
    return '전체 구조는 유지하고 문장 리듬과 표현을 더 자연스럽게 다듬었습니다.'
  }

  return `${changes.slice(0, 2).join('. ')}.`
}

function inferRequestedSections(request = '') {
  const text = String(request || '').toLowerCase()
  const normalized = text.replace(/\s+/g, '')

  if (
    /전체|전부|모두|다\s*바꿔|다\s*수정|전체적으로|전반적으로/.test(request) ||
    /all|entire|whole/.test(text)
  ) {
    return SECTION_KEYS
  }

  const requested = new Set()
  if (/(hook|훅|후크|후킹|첫문장|첫 문장|도입|오프닝)/i.test(request)) {
    requested.add('hook')
  }
  if (/(body|바디|본문|중간|내용|전개|근거|설명|스토리)/i.test(request)) {
    requested.add('body')
  }
  if (/(cta|씨티에이|콜투액션|행동유도|행동 유도|마무리|끝문장|끝 문장|클로징|댓글|저장|팔로우)/i.test(request)) {
    requested.add('cta')
  }

  if (/hook만|훅만|후킹만|첫문장만|첫 문장만|도입만|오프닝만/i.test(request)) {
    return ['hook']
  }
  if (/body만|바디만|본문만|중간만|내용만|전개만/i.test(request)) {
    return ['body']
  }
  if (/cta만|씨티에이만|콜투액션만|행동유도만|행동 유도만|마무리만|끝문장만|끝 문장만|클로징만/i.test(request)) {
    return ['cta']
  }

  if (normalized.includes('hook/')) requested.add('hook')
  if (normalized.includes('body/')) requested.add('body')
  if (normalized.includes('/cta')) requested.add('cta')

  return requested.size ? SECTION_KEYS.filter((key) => requested.has(key)) : SECTION_KEYS
}

function normalizeEditTarget(editTarget = '', request = '') {
  const normalized = String(editTarget || '').trim().toLowerCase()
  const inferred = inferRequestedSections(request)
  if (normalized === 'all') {
    return inferred.length === 1 ? inferred[0] : 'all'
  }
  if (EDIT_TARGETS.has(normalized)) {
    return normalized
  }
  return inferred.length === 1 ? inferred[0] : 'all'
}

function getTargetSections(editTarget = 'all') {
  return SECTION_KEYS.includes(editTarget) ? [editTarget] : SECTION_KEYS
}

function buildEditScopeInstruction(targetSections = SECTION_KEYS) {
  const targetSet = new Set(targetSections)
  const editable = SECTION_KEYS.filter((key) => targetSet.has(key))
  const locked = SECTION_KEYS.filter((key) => !targetSet.has(key))

  return [
    `수정 범위: ${editable.map((key) => SECTION_LABELS[key]).join(', ')}`,
    locked.length
      ? `잠금 섹션: ${locked.map((key) => SECTION_LABELS[key]).join(', ')}는 원문 그대로 반환한다. 단어, 문장부호, 줄바꿈도 바꾸지 않는다.`
      : '잠금 섹션: 없음. 단, 사용자 요청 범위를 벗어난 불필요한 재작성은 하지 않는다.',
  ].join('\n')
}

function buildEditOutputInstruction(targetSections = SECTION_KEYS) {
  if (targetSections.length === 1) {
    const target = targetSections[0]
    return [
      `생성 대상: ${SECTION_LABELS[target]} 하나만 생성한다.`,
      '출력 JSON 형식: {"message":"","section":""}',
      `${SECTION_LABELS[target]} 이외의 HOOK/BODY/CTA 필드는 출력하지 않는다.`,
    ].join('\n')
  }

  return [
    '생성 대상: HOOK, BODY, CTA 전체',
    '출력 JSON 형식: {"message":"","sections":{"hook":"","body":"","cta":""}}',
  ].join('\n')
}

function applyEditScope(previousSections = {}, proposedSections = {}, targetSections = SECTION_KEYS) {
  const previous = normalizeSections(previousSections)
  const proposed = normalizeSections(proposedSections)
  const targetSet = new Set(targetSections)

  return SECTION_KEYS.reduce((next, key) => {
    next[key] = targetSet.has(key) ? proposed[key] || previous[key] : previous[key]
    return next
  }, {})
}

function extractProposedSections(parsed = {}, targetSections = SECTION_KEYS) {
  if (targetSections.length === 1) {
    const target = targetSections[0]
    return {
      [target]: String(parsed.section || parsed.sections?.[target] || '').trim(),
    }
  }

  return normalizeSections(parsed.sections)
}

function createSectionDiff(previousSections = {}, nextSections = {}) {
  const previous = normalizeSections(previousSections)
  const next = normalizeSections(nextSections)

  return SECTION_KEYS.reduce((diff, key) => {
    if (previous[key] !== next[key]) {
      diff[key] = {
        before: previous[key],
        after: next[key],
      }
    }
    return diff
  }, {})
}

function validateScriptFlow(sections = {}) {
  const normalized = normalizeSections(sections)
  const issues = []

  if (!normalized.hook) issues.push('HOOK이 비어 있습니다.')
  if (!normalized.body) issues.push('BODY가 비어 있습니다.')
  if (!normalized.cta) issues.push('CTA가 비어 있습니다.')
  if (normalized.hook && normalized.body && normalized.hook === normalized.body) {
    issues.push('HOOK과 BODY가 동일합니다.')
  }
  if (normalized.body && normalized.cta && normalized.body === normalized.cta) {
    issues.push('BODY와 CTA가 동일합니다.')
  }
  if (normalized.cta && normalized.body && normalized.cta.length > normalized.body.length) {
    issues.push('CTA가 BODY보다 길어 흐름이 CTA로 과도하게 쏠릴 수 있습니다.')
  }

  return {
    ok: issues.length === 0,
    issues,
  }
}

function messageMentionsLockedSections(message = '', targetSections = SECTION_KEYS) {
  const targetSet = new Set(targetSections)
  const locked = SECTION_KEYS.filter((key) => !targetSet.has(key))
  const patterns = {
    hook: /HOOK|훅|후킹|첫문장|첫 문장|도입|오프닝/i,
    body: /BODY|바디|본문|중간|내용|전개/i,
    cta: /CTA|씨티에이|콜투액션|행동유도|행동 유도|마무리|끝문장|끝 문장|클로징/i,
  }

  return locked.some((key) => patterns[key].test(message))
}

async function loadReferenceContext(supabaseAdmin, accountId, referenceId) {
  const { data, error } = await supabaseAdmin
    .from('reference_videos')
    .select(
      'id, title, topic, structure_analysis, hook_analysis, psychology_analysis, frame_notes, ai_feedback, variations',
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

function compactReferenceSignal(value = '', maxLength = 500) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text
}

function buildReferenceStructureContext(reference) {
  const frameNotes = (reference.frame_notes || [])
    .slice(0, 3)
    .map((frame) =>
      [frame.timestamp != null ? `${frame.timestamp}초` : null, frame.observation, frame.hookReason]
        .filter(Boolean)
        .join(' · '),
    )
    .join('\n')

  return [
    '레퍼런스 구조 참고(원문 내용/주제 복사 금지):',
    `- 현재 작업 주제: ${reference.topic || '-'}`,
    `- 구조 신호: ${compactReferenceSignal(reference.structure_analysis) || '-'}`,
    `- 후킹/리듬 신호: ${compactReferenceSignal(reference.hook_analysis) || '-'}`,
    `- 심리 기제 신호: ${compactReferenceSignal(reference.psychology_analysis) || '-'}`,
    `프레임 인사이트: ${frameNotes || '-'}`,
    `기존 AI 피드백: ${compactReferenceSignal(reference.ai_feedback) || '-'}`,
    '레퍼런스 전사: 제외됨(refine/feedback 단계에서는 reference transcript 전체를 포함하지 않음)',
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

function buildCharacterBoundary(accountId) {
  return [
    `현재 선택된 캐릭터 계정 ID: ${accountId}`,
    '이 응답은 반드시 현재 캐릭터 계정 전용으로 작성한다.',
    '다른 캐릭터/다른 계정의 업종, 상품, 타겟, 말투, 메모리를 절대 섞지 않는다.',
    '캐릭터 고정 규칙과 개인화 메모리가 충돌하면 캐릭터 고정 규칙과 현재 계정 설정을 우선한다.',
  ].join('\n')
}

function buildContextPriority() {
  return [
    '컨텍스트 우선순위(절대 준수):',
    '1. 현재 초안',
    '2. 사용자 요청',
    '3. 계정/캐릭터 설정',
    '4. 기존 피드백',
    '5. 레퍼런스 구조 인사이트',
    '6. 레퍼런스',
  ].join('\n')
}

function buildReferenceContaminationGuard() {
  return [
    '레퍼런스 오염 방지 규칙(절대 준수):',
    '- 편집 대상은 오직 현재 초안이다. 레퍼런스는 구조/리듬/전개 방식 참고용일 뿐이다.',
    '- 레퍼런스의 주제, 업종, 상품명, 상황, 고유명사, 표면 단어, 문장 구조를 그대로 가져오지 않는다.',
    '- 레퍼런스 내용을 패러프레이즈하지 않는다.',
    '- 현재 계정의 주제/타깃/상품/톤을 절대 변경하지 않는다.',
    '- 현재 초안에 없는 레퍼런스 소재를 새 핵심 소재로 추가하지 않는다.',
  ].join('\n')
}

function logPromptAssembly({
  stage,
  referenceId,
  currentDraftId,
  currentVersionId,
  editTarget = 'all',
  changedSections = [],
  sectionDiff = {},
  flowValidation = null,
  memoryIncluded,
  includedTranscript = false,
}) {
  const promptContextOrder = [
    'currentDraft',
    'userRequest',
    'accountCharacterSettings',
    'existingFeedback',
    'referenceStructureInsights',
    'reference',
  ]
  const payload = {
    stage,
    includedTranscript,
    currentDraftId: currentDraftId || null,
    currentVersionId: currentVersionId || null,
    referenceVideoId: referenceId || null,
    editTarget,
    changedSections,
    sectionDiff,
    flowValidation,
    promptContextOrder,
    memoryIncluded: Boolean(memoryIncluded),
  }

  if (includedTranscript) {
    console.warn('[script-assistant] transcript included in refine/feedback prompt', payload)
  } else {
    console.info('[script-assistant] prompt assembly', payload)
  }

  return payload
}

function buildDraftBlock(sections = {}) {
  const normalized = normalizeSections(sections)
  return `현재 초안(source of truth - 이 텍스트만 편집 대상):\nHOOK: ${normalized.hook}\nBODY: ${normalized.body}\nCTA: ${normalized.cta}`
}

function formatGuideList(items = []) {
  return items.length ? items.map((item, idx) => `${idx + 1}. ${item}`).join('\n') : '- 없음'
}

function buildRefineUserPrompt({
  sections,
  request,
  selectedLabel,
  referenceContext,
  guides,
  targetSections = SECTION_KEYS,
}) {
  const normalizedSections = normalizeSections(sections)
  const normalizedRequest = String(request || '').trim()

  return (
    `${buildDraftBlock(normalizedSections)}\n\n` +
    `${buildEditScopeInstruction(targetSections)}\n\n` +
    `${buildEditOutputInstruction(targetSections)}\n\n` +
    `사용자 요청: ${normalizedRequest}\n\n` +
    `선택한 안: ${selectedLabel || '-'}\n\n` +
    `${referenceContext}\n\n` +
    `핵심 인사이트:\n${formatGuideList(guides?.insights || [])}\n\n` +
    `바로 써먹을 체크포인트:\n${formatGuideList(guides?.checkpoints || [])}\n\n` +
    '톤 개선 지침:\n' +
    '- 공통: 대화체, 짧은 문장, 추상 표현 금지\n' +
    '- HOOK: 평범한 질문형 금지, 첫 문장 긴장감\n' +
    '- BODY: 교과서 문장 금지, 상황/경험형 전개\n' +
    '- CTA: 이유가 있는 행동 유도, 뻔한 부탁형 금지\n\n' +
    'message 작성 지침:\n' +
    '- "요청을 반영해 정리했습니다" 같은 일반 요약 금지\n' +
    '- 어떤 섹션을 어떤 식으로 바꿨는지 1~2문장으로 구체적으로 작성\n' +
    '- 예: "HOOK은 불편 상황을 바로 찌르는 식으로 바꾸고, CTA는 댓글 행동 유도로 정리했습니다."\n\n' +
    '위 출력 JSON 형식으로만 답하세요.'
  )
}

function buildFeedbackUserPrompt({
  sections,
  selectedLabel,
  referenceContext,
  guides,
}) {
  const normalizedSections = normalizeSections(sections)

  return (
    `${buildDraftBlock(normalizedSections)}\n\n` +
    `선택한 안: ${selectedLabel || '-'}\n\n` +
    `${referenceContext}\n\n` +
    `핵심 인사이트:\n${formatGuideList(guides?.insights || [])}\n\n` +
    `바로 써먹을 체크포인트:\n${formatGuideList(guides?.checkpoints || [])}\n\n` +
    '다음 JSON 형식으로만 답하세요: ' +
    '{"score":82,"summary":"","detail":"","suggestedSections":{"hook":"","body":"","cta":""}}'
  )
}

export async function refineScriptWithAI({
  accountId,
  referenceId,
  selectedLabel,
  request,
  sections,
  editTarget = '',
  currentDraftId = '',
  currentVersionId = '',
  characterSystemPrompt = '',
  personalizationContext = '',
}) {
  const normalizedRequest = request?.trim()
  const normalizedSections = normalizeSections(sections)
  const normalizedEditTarget = normalizeEditTarget(editTarget, normalizedRequest)
  const targetSections = getTargetSections(normalizedEditTarget)

  if (!normalizedRequest) {
    throw new AppError('request is required', {
      code: 'INVALID_REFINE_REQUEST',
      statusCode: 400,
    })
  }

  const { supabaseAdmin, openai, models } = requireClients()
  const reference = await loadReferenceContext(supabaseAdmin, accountId, referenceId)
  const referenceContext = buildReferenceStructureContext(reference)
  const guides = buildReferenceGuides(reference)
  logPromptAssembly({
    stage: 'script-refine',
    referenceId,
    currentDraftId,
    currentVersionId,
    editTarget: normalizedEditTarget,
    memoryIncluded: Boolean(personalizationContext),
    includedTranscript: false,
  })

  try {
    const response = await openai.chat.completions.create({
      model: models.chatModel,
      temperature: 0.5,
      messages: [
        {
          role: 'system',
          content: [
            '당신은 숏폼 콘텐츠 편집 코파일럿이다. 사용자의 수정 요청을 반영해 현재 초안의 HOOK/BODY/CTA만 한국어로 다듬는다. 출력은 JSON만 반환한다.',
            buildContextPriority(),
            buildReferenceContaminationGuard(),
            buildEditOutputInstruction(targetSections),
            '부분 수정 규칙: 사용자가 특정 섹션만 요청하면 그 섹션만 수정한다. 요청받지 않은 섹션은 원문 그대로 반환한다.',
            '부분 수정 규칙: BODY만 요청하면 HOOK과 CTA는 절대 바꾸지 않는다. HOOK만 요청하면 BODY와 CTA는 절대 바꾸지 않는다. CTA만 요청하면 HOOK과 BODY는 절대 바꾸지 않는다.',
            '문체 규칙: 설명형/교과서형 문장을 피하고 실제 사람이 말하듯 자연스럽게 쓴다. 문장은 짧게 끊고 리듬감을 만든다.',
            'HOOK 규칙: 첫 문장에서 긴장감, 반전, 궁금증을 만든다. "~하시나요?" 같은 평범한 질문은 금지한다.',
            'BODY 규칙: 상황으로 시작하고 한 문장씩 끊어 전개한다. "많은 사람들이 ~ 하지만" 같은 문장을 금지한다.',
            'CTA 규칙: 행동 이유(손해/이득/궁금증)를 포함해 짧고 강하게 마무리한다. "좋아요/팔로우 부탁" 문구는 금지한다.',
            '연결성 규칙: HOOK에서 던진 문제를 BODY 첫 문장에서 이어받고, CTA는 BODY 결론을 행동으로 전환한다.',
            '아래 핵심 인사이트/체크포인트는 현재 초안의 주제와 충돌하지 않는 경우에만 구조 참고로 사용한다.',
            '말투 규칙: 항상 존댓말(하십시오체/해요체)만 사용한다. 반말, 친구 말투, 명령형 반말 어미는 금지한다.',
            'message 규칙: "요청을 반영했습니다", "다시 정리했습니다"처럼 뭉뚱그린 말은 금지한다. 무엇을 어떤 식으로 바꿨는지 구체적으로 말한다.',
            'message 예시: "HOOK은 문제를 바로 찌르는 식으로 바꾸고, BODY는 전후 변화가 보이게 풀었습니다." 실제로 바꾼 섹션만 언급한다.',
            buildCharacterBoundary(accountId),
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
          content: buildRefineUserPrompt({
            sections: normalizedSections,
            request: normalizedRequest,
            selectedLabel,
            referenceContext,
            guides,
            targetSections,
          }),
        },
      ],
    })
    logAIUsage('copilot-refine', response, {
      model: models.chatModel,
      accountId,
      referenceId,
      selectedLabel: selectedLabel || '',
    })

    const parsed = parseModelJson(response.choices[0]?.message?.content || '')
    const proposedSections = extractProposedSections(parsed, targetSections)
    const nextSections = applyEditScope(normalizedSections, proposedSections, targetSections)
    const sectionDiff = createSectionDiff(normalizedSections, nextSections)
    const changedSections = SECTION_KEYS.filter((key) => sectionDiff[key])
    const flowValidation = validateScriptFlow(nextSections)
    logPromptAssembly({
      stage: 'script-refine-result',
      referenceId,
      currentDraftId,
      currentVersionId,
      editTarget: normalizedEditTarget,
      changedSections,
      sectionDiff,
      flowValidation,
      memoryIncluded: Boolean(personalizationContext),
      includedTranscript: false,
    })
    const parsedMessage = parsed.message?.trim() || ''

    return {
      message:
        parsedMessage &&
        !isGenericRefineMessage(parsedMessage) &&
        !messageMentionsLockedSections(parsedMessage, targetSections)
          ? parsedMessage
          : buildFallbackRefineMessage(normalizedSections, nextSections),
      sections: nextSections,
      editTarget: normalizedEditTarget,
      changedSections,
      flowValidation,
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
  currentDraftId = '',
  currentVersionId = '',
  characterSystemPrompt = '',
  personalizationContext = '',
}) {
  const normalizedSections = normalizeSections(sections)
  const { supabaseAdmin, openai, models } = requireClients()
  const reference = await loadReferenceContext(supabaseAdmin, accountId, referenceId)
  const referenceContext = buildReferenceStructureContext(reference)
  const guides = buildReferenceGuides(reference)
  logPromptAssembly({
    stage: 'script-feedback',
    referenceId,
    currentDraftId,
    currentVersionId,
    memoryIncluded: Boolean(personalizationContext),
    includedTranscript: false,
  })

  try {
    const response = await openai.chat.completions.create({
      model: models.chatModel,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content: [
            '당신은 숏폼 콘텐츠 평가자다. 제공된 초안을 100점 만점으로 평가하고, 개선 포인트를 짧고 명확하게 제안한다. 출력은 JSON만 반환한다.',
            buildContextPriority(),
            buildReferenceContaminationGuard(),
            'suggestedSections는 반드시 현재 초안을 개선한 결과여야 한다. 레퍼런스 전사/원문 내용을 기준으로 재생성하지 않는다.',
            'suggestedSections를 작성할 때는 설명형/교과서형 문장을 피하고, 실제 사람이 말하는 톤으로 다시 써라.',
            'HOOK은 긴장감 있게, BODY는 상황/경험형으로, CTA는 행동 이유를 담아 짧고 강하게 제안하라.',
            '평가 시 HOOK/BODY/CTA 연결성과 핵심 인사이트 반영 여부를 반드시 본다.',
            '말투 규칙: 항상 존댓말(하십시오체/해요체)만 사용한다. 반말, 친구 말투, 명령형 반말 어미는 금지한다.',
            buildCharacterBoundary(accountId),
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
          content: buildFeedbackUserPrompt({
            sections: normalizedSections,
            selectedLabel,
            referenceContext,
            guides,
          }),
        },
      ],
    })
    logAIUsage('copilot-feedback', response, {
      model: models.chatModel,
      accountId,
      referenceId,
      selectedLabel: selectedLabel || '',
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

export const __scriptAssistantTest = {
  buildContextPriority,
  buildDraftBlock,
  buildFeedbackUserPrompt,
  buildRefineUserPrompt,
  buildReferenceContaminationGuard,
  buildReferenceStructureContext,
  compactReferenceSignal,
  normalizeEditTarget,
  getTargetSections,
  inferRequestedSections,
  applyEditScope,
  buildEditOutputInstruction,
  extractProposedSections,
  createSectionDiff,
  validateScriptFlow,
  buildEditScopeInstruction,
  messageMentionsLockedSections,
  logPromptAssembly,
}
