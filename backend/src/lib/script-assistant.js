import { AppError } from './errors.js'
import { logAIError } from './ai-error-logger.js'
import { logAIUsage } from './ai-usage-logger.js'
import { parseModelJson } from './model-json.js'
import { getOpenAIClient, getOpenAIModels, hasOpenAIConfig } from './openai.js'
import { getSupabaseAdmin, hasSupabaseAdminConfig } from './supabase.js'
import { formatHookTemplatesForPrompt, retrieveHookTemplates } from './hook-templates.js'
import { formatNarrativePatternsForPrompt, retrieveNarrativePatterns } from './narrative-patterns.js'

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

const SECTION_SURFACE_LABEL_PATTERNS = {
  hook: /^(?:hook|훅|후킹)\s*[:：]\s*/i,
  body: /^(?:body|바디|본문)\s*[:：]\s*/i,
  cta: /^(?:cta|씨티에이|마무리|콜투액션)\s*[:：]\s*/i,
}

function stripSectionSurfaceLabel(value = '', section = '') {
  let text = String(value || '').trim()
  const pattern = SECTION_SURFACE_LABEL_PATTERNS[section]
  if (!pattern) {
    return text
  }
  for (let index = 0; index < 3 && pattern.test(text); index += 1) {
    text = text.replace(pattern, '').trim()
  }
  return text
}

function normalizeSections(sections = {}) {
  return {
    hook: stripSectionSurfaceLabel(sections.hook, 'hook'),
    body: stripSectionSurfaceLabel(sections.body, 'body'),
    cta: stripSectionSurfaceLabel(sections.cta, 'cta'),
  }
}

function normalizePreviousAdvice(value = null) {
  if (!value || typeof value !== 'object') {
    return null
  }

  const createdAt = value.createdAt || value.created_at || null
  const createdAtMs = createdAt ? Date.parse(createdAt) : Date.now()
  const messageTurnsSinceCreated = Number(value.messageTurnsSinceCreated ?? value.message_turns_since_created ?? 0)
  const editTarget = String(value.editTarget || value.edit_target || 'all').trim().toLowerCase()
  const normalizedTarget = ['hook', 'body', 'cta', 'body_cta', 'full', 'all'].includes(editTarget)
    ? editTarget
    : 'all'
  const instructions = uniqueCompactList(
    Array.isArray(value.instructions) ? value.instructions.map((item) => String(item || '').trim()) : [],
    8,
  )
  const preserveSections = uniqueCompactList(
    Array.isArray(value.preserveSections || value.preserve_sections)
      ? (value.preserveSections || value.preserve_sections).filter((key) => SECTION_KEYS.includes(key))
      : [],
    3,
  )
  const diagnosis = String(value.diagnosis || '').trim()
  const expectedOutcome = String(value.expectedOutcome || value.expected_outcome || '').trim()
  const operations = Array.isArray(value.operations)
    ? value.operations
        .map((operation) => {
          if (!operation || typeof operation !== 'object') {
            return null
          }
          const target = String(operation.target || operation.section || '').trim().toLowerCase()
          return {
            type: String(operation.type || 'partial_rewrite').trim() || 'partial_rewrite',
            target: SECTION_KEYS.includes(target) ? target : 'all',
            problem: String(operation.problem || '').trim(),
            instruction: String(operation.instruction || operation.action || '').trim(),
            preserve: uniqueCompactList(operation.preserve || [], 5),
            avoid: uniqueCompactList(operation.avoid || [], 5),
            priority: String(operation.priority || value.priority || 'medium').trim() || 'medium',
          }
        })
        .filter((operation) => operation && (operation.instruction || operation.problem))
        .slice(0, 8)
    : []

  if (!diagnosis && !instructions.length && !expectedOutcome && !operations.length) {
    return null
  }

  return {
    sourceType: String(value.sourceType || value.source_type || '').trim(),
    sourceMessageId: String(value.sourceMessageId || value.source_message_id || '').trim(),
    sourceUserMessage: String(value.sourceUserMessage || value.source_user_message || '').trim(),
    priority: String(value.priority || '').trim(),
    diagnosis,
    editTarget: normalizedTarget,
    instructions,
    operations,
    preserveSections,
    expectedOutcome,
    createdAt: Number.isFinite(createdAtMs) ? new Date(createdAtMs).toISOString() : new Date().toISOString(),
    messageTurnsSinceCreated: Number.isFinite(messageTurnsSinceCreated) ? Math.max(0, messageTurnsSinceCreated) : 0,
  }
}

function isPreviousAdviceFresh(previousAdvice = null) {
  const normalized = normalizePreviousAdvice(previousAdvice)
  if (!normalized) {
    return false
  }
  const createdAtMs = Date.parse(normalized.createdAt)
  if (Number.isFinite(createdAtMs) && Date.now() - createdAtMs > PREVIOUS_ADVICE_MAX_AGE_MS) {
    return false
  }
  return normalized.messageTurnsSinceCreated <= PREVIOUS_ADVICE_MAX_TURNS
}

function isApplyPreviousAdviceRequest(request = '') {
  const compact = String(request || '').replace(/\s+/g, '')
  if (!compact) {
    return false
  }
  return [
    /이대로(수정|고쳐|바꿔|반영|적용|해줘|해주세요)/i,
    /피드백대로(수정|고쳐|바꿔|반영|적용|해줘|해주세요)/i,
    /조언대로(수정|고쳐|바꿔|반영|적용|해줘|해주세요)/i,
    /그렇게(수정|고쳐|바꿔|반영|해줘|해주세요)/i,
    /그방향(으로)?(수정|고쳐|바꿔|반영|해줘|해주세요)/i,
    /방금(말한|얘기한)(대로|방향으로)?(수정|고쳐|반영|해줘|해주세요)/i,
    /위에(말한|얘기한)(대로|방향으로)?(수정|고쳐|반영|해줘|해주세요)/i,
    /그걸로(수정|고쳐|반영|적용|해줘|해주세요)/i,
    /ㅇㅇ그렇게/i,
    /그대로(수정|반영|적용)해줘/i,
  ].some((pattern) => pattern.test(compact))
}

function previousAdviceTargetToEditTarget(previousAdvice = null, fallback = 'all') {
  const target = normalizePreviousAdvice(previousAdvice)?.editTarget || ''
  if (target === 'body_cta') {
    return 'all'
  }
  if (target === 'full') {
    return 'all'
  }
  if (['hook', 'body', 'cta', 'all'].includes(target)) {
    return target
  }
  return normalizeEditTarget(fallback)
}

function previousAdviceTargetSections(previousAdvice = null, fallbackTarget = 'all') {
  const normalized = normalizePreviousAdvice(previousAdvice)
  if (!normalized) {
    return getTargetSections(fallbackTarget)
  }
  if (normalized.editTarget === 'body_cta') {
    return ['body', 'cta']
  }
  return getTargetSections(previousAdviceTargetToEditTarget(normalized, fallbackTarget))
}

function previousAdviceOperationTargetSections(previousAdvice = null) {
  const normalized = normalizePreviousAdvice(previousAdvice)
  if (!normalized?.operations?.length) {
    return []
  }

  const targets = new Set()
  for (const operation of normalized.operations) {
    if (operation.target === 'all') {
      SECTION_KEYS.forEach((section) => targets.add(section))
      continue
    }
    if (SECTION_KEYS.includes(operation.target)) {
      targets.add(operation.target)
    }
  }

  return [...targets]
}

const SECTION_KEYS = ['hook', 'body', 'cta']
const SECTION_LABELS = {
  hook: 'HOOK',
  body: 'BODY',
  cta: 'CTA',
}
const EDIT_TARGETS = new Set(['all', ...SECTION_KEYS])
const COPILOT_INTENTS = {
  ADVISE: 'advise_script',
  EDIT: 'edit_script',
  GENERAL: 'general_chat',
  EXPLAIN: 'explain_script',
  COMPARE: 'compare_versions',
  BRAINSTORM: 'brainstorm_options',
  APPLY_PREVIOUS_ADVICE: 'apply_previous_advice',
}
const COPILOT_OPERATION_TYPES = {
  EDIT_PARTIAL: 'edit_partial',
  TOPIC_REFRAME: 'topic_reframe',
  INSERT_MATERIAL: 'insert_material',
  DURATION_COMPRESS: 'duration_compress',
  TONE_ADJUST: 'tone_adjust',
  FRAMING_REWRITE: 'framing_rewrite',
  PARTIAL_REWRITE: 'partial_rewrite',
  UNKNOWN: 'unknown',
}
const COPILOT_QA_MODES = {
  PRESERVE_TOPIC: 'preserve_topic',
  REFRAME_TOPIC: 'reframe_topic',
  INSERT_MATERIAL: 'insert_material',
  DURATION_COMPRESS: 'duration_compress',
}
const MIN_DURATION_COMPRESS_SECONDS = 10
const DURATION_CHAR_RATE_MIN = 5
const DURATION_CHAR_RATE_MAX = 6.5
const PREVIOUS_ADVICE_MAX_AGE_MS = 1000 * 60 * 10
const PREVIOUS_ADVICE_MAX_TURNS = 5
const COPILOT_MEMORY_ARRAY_KEYS = [
  'preferredTone',
  'dislikedTone',
  'preferredHookStyle',
  'dislikedExpressions',
  'recentUserCorrections',
]
const COPILOT_MEMORY_TEXT_KEYS = ['lengthPreference', 'ctaPreference', 'lastAcceptedVersionSummary']
const COPILOT_EVALUATION_RUBRIC = [
  {
    key: 'hook',
    title: 'HOOK 흡입력',
    points: 25,
    criteria: [
      '첫 1초 안에 타겟의 문제, 손해, 궁금증, 반전 중 하나가 바로 보이는가',
      '설명문이나 평범한 질문처럼 시작하지 않는가',
      '현재 주제와 상품/상황을 벗어나지 않는가',
    ],
  },
  {
    key: 'body',
    title: 'BODY 이해도',
    points: 25,
    criteria: [
      'HOOK에서 던진 문제를 BODY 첫 문장에서 자연스럽게 이어받는가',
      '정보 순서가 헷갈리지 않고 한 문장씩 따라가기 쉬운가',
      '추상적인 조언보다 구체적인 상황, 기준, 행동이 있는가',
    ],
  },
  {
    key: 'cta',
    title: 'CTA 설득력',
    points: 20,
    criteria: [
      '시청자가 지금 무엇을 해야 하는지 분명한가',
      '저장, 댓글, 구매, 신청 같은 행동의 이유가 자연스럽게 보이는가',
      '억지 판매나 뻔한 부탁처럼 들리지 않는가',
    ],
  },
  {
    key: 'reference_fit',
    title: '레퍼런스 구조 반영도',
    points: 15,
    criteria: [
      '선택한 A/B/C 초안의 역할, 리듬, 길이감, CTA 위치를 유지하는가',
      '레퍼런스 원문 소재를 복사하지 않고 구조만 참고하는가',
    ],
  },
  {
    key: 'trust',
    title: '신뢰도/과장 위험',
    points: 15,
    criteria: [
      '허위 수치, 허위 권위, 허위 경험담을 만들지 않는가',
      '건강, 돈, 지원금, 성과를 확정적으로 보장하지 않는가',
      '계정명, 카테고리명, 내부 설정값을 대본 표면에 그대로 노출하지 않는가',
    ],
  },
]
const COPILOT_EDIT_PLAYBOOK = {
  hook: {
    title: 'HOOK 수정 원칙',
    rules: [
      '첫 1초 안에 타겟의 문제, 손해, 궁금증, 반전 중 하나가 바로 보이게 만든다.',
      '평범한 질문형, 자기소개형, 카테고리 설명형으로 시작하지 않는다.',
      '현재 BODY/CTA의 핵심 약속과 연결되는 첫 문장으로 고친다.',
      '사용자가 HOOK만 요청했다면 BODY와 CTA는 단어, 문장부호, 줄바꿈까지 그대로 유지한다.',
    ],
  },
  body: {
    title: 'BODY 수정 원칙',
    rules: [
      'HOOK에서 던진 문제나 궁금증을 BODY 첫 문장에서 바로 이어받는다.',
      '정보 순서를 원인, 기준, 해결 또는 상황, 전환, 방법 흐름으로 정리한다.',
      '추상적인 조언보다 타겟이 바로 이해할 수 있는 구체적인 상황, 기준, 행동을 넣는다.',
      '사용자가 BODY만 요청했다면 HOOK과 CTA는 단어, 문장부호, 줄바꿈까지 그대로 유지한다.',
    ],
  },
  cta: {
    title: 'CTA 수정 원칙',
    rules: [
      '시청자가 지금 해야 할 행동을 한 문장으로 분명하게 만든다.',
      '저장, 댓글, 구매, 신청, 확인 같은 행동에 이유를 붙인다.',
      'BODY 결론에서 자연스럽게 이어지게 만들고, 뻔한 좋아요/팔로우 부탁으로 끝내지 않는다.',
      '사용자가 CTA만 요청했다면 HOOK과 BODY는 단어, 문장부호, 줄바꿈까지 그대로 유지한다.',
    ],
  },
  all: {
    title: '전체 수정 원칙',
    rules: [
      '전체 수정은 새 대본 생성이 아니다.',
      '기존 초안의 주제, 상품, 타겟, 레퍼런스 구조, A/B/C 전략을 유지한다.',
      'HOOK→BODY→CTA 연결성과 표현만 개선한다.',
      '사용자 사실 정보와 레퍼런스 구조를 바꾸지 않는다.',
      '레퍼런스 원문 소재, 업종, 상품명, 고유명사, 문장을 새 핵심 소재로 가져오지 않는다.',
    ],
  },
}

function buildCopilotEvaluationRubric() {
  return [
    '코파일럿 평가 기준표(100점 기준):',
    ...COPILOT_EVALUATION_RUBRIC.map((item, index) =>
      [
        `${index + 1}. ${item.title} ${item.points}점`,
        ...item.criteria.map((criterion) => `- ${criterion}`),
      ].join('\n'),
    ),
    '',
    '판단 원칙:',
    '- 좋은 점은 좋다고 말하되 근거 없이 칭찬하지 않는다.',
    '- 약한 점은 약하다고 말하고, 왜 약한지 기준표에 맞춰 설명한다.',
    '- 조언 요청이면 대본을 수정하지 않는다.',
    '- 수정 요청이면 먼저 짧게 진단하고, 요청받은 섹션만 수정한다.',
  ].join('\n')
}

function buildCopilotMentorToneGuide() {
  return [
    '코파일럿 대화 톤 가이드:',
    '- 친절하지만 날카로운 대본 멘토처럼 답한다.',
    '- 사용자의 애매한 느낌을 먼저 받아준다. 예: "맞아요.", "그 느낌 이해돼요.", "지금 애매한 이유는..."',
    '- 너무 딱딱한 심사위원처럼 말하지 않는다.',
    '- 너무 가벼운 친구 말투, 장난, 반말은 쓰지 않는다.',
    '- 억지 칭찬은 하지 않는다. 약한 부분은 약하다고 말하되 바로 개선 방향을 붙인다.',
    '- "요청을 반영했습니다", "다시 정리했습니다", "수정했습니다" 같은 기계적인 말로 끝내지 않는다.',
    '- intent, rubric, hook_template, narrative_pattern, referenceFormat 같은 내부 용어를 사용자에게 노출하지 않는다.',
    '- 카테고리명, 전략명, 시스템 라벨을 대본 문장에 직접 넣지 않는다.',
    '- 점수는 사용자가 명시적으로 점수/몇 점인지 물었을 때만 말한다.',
  ].join('\n')
}

function buildCopilotResponseModeRule(responseMode = 'edit_only') {
  if (responseMode === 'advice_then_edit') {
    return [
      '응답 모드: 공감/확인 + 진단 + 수정',
      '- 사용자가 문제점 확인과 수정을 함께 요청했다.',
      '- message는 사용자 느낌 수용 → 핵심 문제 1개 진단 → 수정 방향 설명 → 왜 좋아졌는지 한 줄 흐름으로 쓴다.',
      '- 예: "그 느낌 이해돼요. 지금은 CTA가 갑자기 판매로 튀어서 흐름이 어색해 보여요. 본문 흐름은 유지하고 CTA만 더 자연스럽게 이어지도록 바꿔볼게요."',
    ].join('\n')
  }

  return [
    '응답 모드: 공감/확인 + 진단 + 수정',
    '- 사용자가 수정을 요청했으므로 대본은 수정한다.',
    '- message는 사용자 요청 해석 → 짧은 진단 → 수정 방향 → 수정 이유 한 줄 흐름으로 쓴다.',
    '- 단, 사용자가 요청하지 않은 섹션은 진단에서도 과하게 언급하지 않는다.',
    '- 예: "좋아요. 여기서 자연스럽게는 힘을 빼자는 뜻보다 광고처럼 보이는 표현을 줄이는 쪽이 맞아 보여요. BODY는 정보는 유지하고 실제 말하듯 읽히게 정리할게요."',
  ].join('\n')
}

function buildCopilotEditPlaybook(targetSections = SECTION_KEYS) {
  const normalizedTargets = Array.isArray(targetSections) && targetSections.length
    ? targetSections.filter((key) => SECTION_KEYS.includes(key))
    : SECTION_KEYS
  const isAll = normalizedTargets.length === SECTION_KEYS.length
  const playbookKeys = isAll ? ['all', ...SECTION_KEYS] : normalizedTargets

  return [
    'COPILOT_EDIT_PLAYBOOK(고정 수정 행동 규칙):',
    '- hook_templates와 역할이 다르다. hook_templates는 HOOK 수정 시 참고하는 후킹 구조 자료이고, COPILOT_EDIT_PLAYBOOK은 수정 범위별로 항상 지켜야 하는 규칙이다.',
    '- 요청받지 않은 섹션은 잠금 상태로 취급한다.',
    '- all 요청이어도 사용자 사실 정보, 주제, 상품, 타겟, 레퍼런스 구조, A/B/C 전략은 바꾸지 않는다.',
    ...playbookKeys.map((key) => {
      const playbook = COPILOT_EDIT_PLAYBOOK[key]
      return [
        '',
        `[${playbook.title}]`,
        ...playbook.rules.map((rule) => `- ${rule}`),
      ].join('\n')
    }),
  ].join('\n')
}

function uniqueCompactList(value = [], maxItems = 10) {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set()
  const output = []
  for (const item of value) {
    const text = String(item || '').replace(/\s+/g, ' ').trim()
    if (!text || seen.has(text)) {
      continue
    }
    seen.add(text)
    output.push(text)
    if (output.length >= maxItems) {
      break
    }
  }
  return output
}

function normalizeFeedbackList(value = [], maxItems = 8) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, maxItems)
}

const FEEDBACK_VERDICT_CONFIG = {
  ready: {
    label: '바로 사용 가능',
    recommendedAction: '그대로 사용하기',
  },
  minor_edit: {
    label: '가볍게 다듬으면 사용 가능',
    recommendedAction: '가볍게 다듬고 사용하기',
  },
  needs_edit: {
    label: '수정 후 사용 권장',
    recommendedAction: '수정해서 사용 가능하게 만들기',
  },
  rewrite_recommended: {
    label: '새 방향 권장',
    recommendedAction: '새 방향으로 다시 잡기',
  },
}

function getBaseFeedbackVerdictStatus(score = 0) {
  const numericScore = Number(score) || 0
  if (numericScore >= 85) return 'ready'
  if (numericScore >= 75) return 'minor_edit'
  if (numericScore >= 60) return 'needs_edit'
  return 'rewrite_recommended'
}

function clampFeedbackVerdictStatus(status = 'needs_edit', maxStatus = 'needs_edit') {
  const order = ['rewrite_recommended', 'needs_edit', 'minor_edit', 'ready']
  const statusIndex = order.indexOf(status)
  const maxIndex = order.indexOf(maxStatus)
  if (statusIndex < 0) return maxStatus
  if (maxIndex < 0) return status
  return order[Math.min(statusIndex, maxIndex)]
}

function detectFeedbackCriticalIssue({ sections = {}, issues = [], recommendations = [] } = {}) {
  const normalizedSections = normalizeSections(sections)
  const feedbackText = [...normalizeFeedbackList(issues, 12), ...normalizeFeedbackList(recommendations, 12)].join(' ')
  const compactText = feedbackText.replace(/\s+/g, ' ')
  const missingSections = SECTION_KEYS.filter((key) => !normalizedSections[key])

  if (missingSections.length) {
    return {
      maxStatus: 'needs_edit',
      reason: `${missingSections.map((key) => SECTION_LABELS[key]).join('/')}가 비어 있어 바로 사용하기에는 보완이 필요합니다.`,
    }
  }

  if (/(?:CTA|씨티에이|마무리).{0,18}(?:없|비어|빠져|약함|부족)/i.test(compactText)) {
    return {
      maxStatus: 'needs_edit',
      reason: 'CTA가 충분히 작동하지 않아 행동 유도 문장을 보완한 뒤 사용하는 편이 좋습니다.',
    }
  }

  if (/(?:허위|근거\s*없는|과장|보장|후기|권위|전문가|수치|효과)/i.test(compactText)) {
    return {
      maxStatus: 'needs_edit',
      reason: '신뢰를 해칠 수 있는 표현이 있어 근거와 표현을 정리한 뒤 사용하는 편이 좋습니다.',
    }
  }

  if (/(?:주제\s*이탈|타겟\s*불일치|레퍼런스.{0,12}오염|사용자\s*지시문|지시문\s*누수|연결.{0,12}붕괴|흐름.{0,12}붕괴)/i.test(compactText)) {
    return {
      maxStatus: 'rewrite_recommended',
      reason: '대본의 핵심 흐름이나 주제 정합성이 흔들려 방향을 다시 잡는 편이 안전합니다.',
    }
  }

  return null
}

function buildFeedbackVerdict({ score = 0, sections = {}, issues = [], recommendations = [] } = {}) {
  const normalizedIssues = normalizeFeedbackList(issues, 8)
  const normalizedRecommendations = normalizeFeedbackList(recommendations, 8)
  const criticalIssue = detectFeedbackCriticalIssue({
    sections,
    issues: normalizedIssues,
    recommendations: normalizedRecommendations,
  })
  const status = criticalIssue
    ? clampFeedbackVerdictStatus(getBaseFeedbackVerdictStatus(score), criticalIssue.maxStatus)
    : getBaseFeedbackVerdictStatus(score)
  const config = FEEDBACK_VERDICT_CONFIG[status] || FEEDBACK_VERDICT_CONFIG.needs_edit
  const firstIssue = normalizedIssues[0] || ''
  const firstRecommendation = normalizedRecommendations[0] || ''

  let reason = criticalIssue?.reason || ''
  if (!reason) {
    if (status === 'ready') {
      reason = firstIssue
        ? `전체적으로 바로 사용 가능한 수준이고, 굳이 다듬는다면 ${firstIssue.replace(/^(HOOK|BODY|CTA)\s*[:：]\s*/i, '')} 정도만 확인하면 됩니다.`
        : 'HOOK, BODY, CTA 흐름이 안정적이라 지금 바로 사용해도 괜찮습니다.'
    } else if (status === 'minor_edit') {
      reason = firstRecommendation
        ? `큰 방향은 괜찮고, ${firstRecommendation.replace(/^(HOOK|BODY|CTA)\s*[:：]\s*/i, '')} 정도만 다듬으면 더 자연스럽습니다.`
        : '전체 흐름은 괜찮고 한두 문장만 다듬으면 바로 사용하기 좋습니다.'
    } else if (status === 'needs_edit') {
      reason = firstIssue
        ? `${firstIssue.replace(/^(HOOK|BODY|CTA)\s*[:：]\s*/i, '')} 부분을 보완한 뒤 사용하는 것을 권장합니다.`
        : '지금 바로 쓰기에는 설득 흐름이 약해 문제 섹션을 정리한 뒤 사용하는 편이 좋습니다.'
    } else {
      reason = firstIssue
        ? `${firstIssue.replace(/^(HOOK|BODY|CTA)\s*[:：]\s*/i, '')} 문제가 커서 부분 수정이나 새 방향 재정리가 필요합니다.`
        : '부분 수정만으로는 애매해 새 방향으로 다시 잡는 편이 좋습니다.'
    }
  }

  return {
    status,
    label: config.label,
    reason,
    recommendedAction: config.recommendedAction,
  }
}

function detectFeedbackSection(text = '') {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (/(?:^|\b)(?:HOOK|훅|후킹)(?:\b|[:：])/i.test(value)) return 'hook'
  if (/(?:^|\b)(?:BODY|바디|본문)(?:\b|[:：])/i.test(value)) return 'body'
  if (/(?:^|\b)(?:CTA|씨티에이|마무리|콜투액션)(?:\b|[:：])/i.test(value)) return 'cta'
  if (/첫\s*문장|도입|시작|후킹|스크롤|멈추/i.test(value)) return 'hook'
  if (/본문|흐름|연결|근거|예시|설명|상황|공감/i.test(value)) return 'body'
  if (/댓글|저장|구매|신청|상담|링크|행동|마무리/i.test(value)) return 'cta'
  return 'all'
}

function inferFeedbackOperationType(text = '', section = 'all') {
  const value = String(text || '').replace(/\s+/g, ' ')
  if (/(?:행동\s*이유|왜\s*지금|댓글|저장|구매|신청|상담|링크|CTA|씨티에이)/i.test(value)) {
    return 'strengthen_action_reason'
  }
  if (/(?:연결|이어|받아|흐름|앞\s*문장|첫\s*문장)/i.test(value)) {
    return section === 'body' ? 'connect_hook_to_body' : 'partial_rewrite'
  }
  if (/(?:공감|상황|타겟|고민)/i.test(value)) {
    return 'empathy_rewrite'
  }
  if (/(?:광고|판매|구매\s*압박|상업)/i.test(value)) {
    return section === 'cta' ? 'cta_reframe' : 'partial_rewrite'
  }
  if (/(?:존댓말|반말|말투|어미|해요체|구어체|자연스럽)/i.test(value)) {
    return 'tone_adjust'
  }
  return section === 'cta' ? 'strengthen_action_reason' : 'partial_rewrite'
}

function feedbackSectionTargetToEditTarget(sections = []) {
  const uniqueSections = uniqueCompactList(sections.filter((section) => SECTION_KEYS.includes(section)), 3)
  if (uniqueSections.length === 1) return uniqueSections[0]
  if (uniqueSections.length === 2 && uniqueSections.includes('body') && uniqueSections.includes('cta')) {
    return 'body_cta'
  }
  return uniqueSections.length ? 'full' : 'all'
}

export function feedbackToEditInstructions({
  feedback = {},
  sourceMessageId = '',
  editTarget = 'all',
} = {}) {
  const issues = normalizeFeedbackList(feedback?.issues, 8)
  const recommendations = normalizeFeedbackList(feedback?.recommendations, 8)
  const verdict = feedback?.verdict && typeof feedback.verdict === 'object' ? feedback.verdict : {}
  const sourceTexts = [
    ...issues.map((text) => ({ kind: 'issue', text })),
    ...recommendations.map((text) => ({ kind: 'recommendation', text })),
  ]
  const operations = []

  for (const item of sourceTexts) {
    const section = detectFeedbackSection(item.text)
    const target = SECTION_KEYS.includes(section) ? section : normalizeEditTarget(editTarget || 'all')
    const normalizedTarget = SECTION_KEYS.includes(target) ? target : section
    const operationTarget = SECTION_KEYS.includes(normalizedTarget) ? normalizedTarget : 'all'
    const type = inferFeedbackOperationType(item.text, operationTarget)
    const isIssue = item.kind === 'issue'
    const relatedRecommendation =
      recommendations.find((recommendation) => {
        const recommendationSection = detectFeedbackSection(recommendation)
        return recommendationSection === operationTarget || recommendationSection === 'all'
      }) || ''
    const instruction = isIssue
      ? relatedRecommendation ||
        `${SECTION_LABELS[operationTarget] || '대본'}에서 피드백이 지적한 문제를 실제 문장 수정으로 해결한다.`
      : item.text

    operations.push({
      type,
      target: operationTarget,
      problem: isIssue ? item.text : '',
      instruction,
      preserve: ['기존 주제', '사용자 사실 정보', '기존 CTA 의도'].filter((value) =>
        operationTarget === 'cta' ? true : value !== '기존 CTA 의도',
      ),
      avoid: ['새 소재 생성', '허위 수치', '없는 혜택', '과장 후기'],
      priority: isIssue ? 'high' : 'medium',
    })
  }

  if (!operations.length && verdict.recommendedAction) {
    operations.push({
      type: 'partial_rewrite',
      target: normalizeEditTarget(editTarget || 'all'),
      problem: verdict.reason || feedback?.summary || '',
      instruction: verdict.recommendedAction,
      preserve: ['기존 주제', '사용자 사실 정보'],
      avoid: ['새 소재 생성', '허위 수치', '없는 혜택'],
      priority: 'medium',
    })
  }

  const operationTargets = operations.map((operation) => operation.target).filter((target) => SECTION_KEYS.includes(target))
  const feedbackEditTarget = feedbackSectionTargetToEditTarget(operationTargets)
  const effectiveEditTarget =
    editTarget && editTarget !== 'all' ? normalizeEditTarget(editTarget) : feedbackEditTarget
  const targetSections =
    effectiveEditTarget === 'body_cta'
      ? ['body', 'cta']
      : effectiveEditTarget === 'full'
        ? SECTION_KEYS
        : getTargetSections(normalizeEditTarget(effectiveEditTarget, ''))
  const preserveSections = SECTION_KEYS.filter((section) => !targetSections.includes(section))
  const diagnosis = [
    verdict.reason,
    feedback?.summary,
    feedback?.detail,
  ]
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ')

  return normalizePreviousAdvice({
    sourceType: 'feedback',
    sourceMessageId,
    priority: 'high',
    diagnosis: diagnosis || '직전 피드백에서 지적한 문제를 반영',
    editTarget: effectiveEditTarget,
    operations,
    instructions: uniqueCompactList(
      operations.map((operation) => operation.instruction || operation.problem),
      8,
    ),
    preserveSections,
    expectedOutcome:
      verdict.expectedOutcome ||
      '피드백에서 지적한 문제가 실제 대본에서 완화되고, 바로 사용할 수 있는 방향에 가까워진 수정본',
  })
}

function detectFeedbackRecheckRegression({ summary = '', detail = '', issues = [], recommendations = [] } = {}) {
  const feedbackText = [
    summary,
    detail,
    ...normalizeFeedbackList(issues, 12),
    ...normalizeFeedbackList(recommendations, 12),
  ]
    .join(' ')
    .replace(/\s+/g, ' ')

  return /(?:새로\s*생|오히려|퇴행|악화|사라졌|없어졌|누락|빠졌|주제\s*이탈|타겟\s*불일치|레퍼런스.{0,12}오염|사용자\s*지시문|지시문\s*누수|연결.{0,12}붕괴|흐름.{0,12}붕괴|허위|근거\s*없는|보장|과장|CTA.{0,16}(?:없|비어|빠졌)|HOOK.{0,16}(?:없|비어|빠졌)|BODY.{0,16}(?:없|비어|빠졌))/i.test(
    feedbackText,
  )
}

function normalizeFeedbackScore(value) {
  const score = Number(value)
  if (!Number.isFinite(score)) {
    return 0
  }
  return Math.max(0, Math.min(100, Math.round(score)))
}

function stabilizeFeedbackScoreAfterApply({
  previousFeedback = null,
  parsedScore = 0,
  summary = '',
  detail = '',
  issues = [],
  recommendations = [],
} = {}) {
  const rawScore = normalizeFeedbackScore(parsedScore)
  const previousScore = Number(previousFeedback?.score)
  const hasPreviousFeedback = previousFeedback && typeof previousFeedback === 'object'

  if (!hasPreviousFeedback || !Number.isFinite(previousScore)) {
    return {
      score: rawScore,
      recheck: null,
    }
  }

  const normalizedPreviousScore = normalizeFeedbackScore(previousScore)
  const scoreDrop = normalizedPreviousScore - rawScore
  const hasRegressionReason = detectFeedbackRecheckRegression({
    summary,
    detail,
    issues,
    recommendations,
  })

  if (scoreDrop >= 4 && !hasRegressionReason) {
    const stabilizedScore =
      normalizedPreviousScore < 85
        ? Math.min(100, normalizedPreviousScore + 1)
        : normalizedPreviousScore

    return {
      score: Math.max(rawScore, stabilizedScore),
      recheck: {
        basedOnPreviousFeedback: true,
        previousScore: normalizedPreviousScore,
        rawScore,
        stabilizedScore: Math.max(rawScore, stabilizedScore),
        scoreAdjusted: true,
        reason:
          '이전 피드백 반영 후 새 치명 문제가 명확하지 않아 점수 하락을 보정했습니다.',
      },
    }
  }

  return {
    score: rawScore,
    recheck: {
      basedOnPreviousFeedback: true,
      previousScore: normalizedPreviousScore,
      rawScore,
      stabilizedScore: rawScore,
      scoreAdjusted: false,
      reason: hasRegressionReason
        ? '새 퇴행 또는 치명 문제가 감지되어 모델 점수를 유지했습니다.'
        : '이전 피드백 반영 후 재평가 기준으로 모델 점수를 유지했습니다.',
    },
  }
}

function cleanRequestedPhrase(value = '') {
  return String(value || '')
    .replace(/^[\s"'“”‘’.,:;·\-–—]+|[\s"'“”‘’.,:;·\-–—]+$/g, '')
    .replace(/^(?:HOOK|훅|후크|후킹|첫\s*문장|BODY|바디|본문|내용|CTA|씨티에이|마무리)(?:은|는|을|를|만)?\s*(?:유지|그대로|고정|잠그|살리고|남기고|두고|냅두고|냅둬|놔두고|놔둬)\s*(?:하고|한\s*채|,)?\s*/i, '')
    .replace(/^(?:HOOK|훅|후크|후킹|첫\s*문장|BODY|바디|본문|내용|CTA|씨티에이|마무리)(?:은|는|을|를|만)?\s*/i, '')
    .replace(/^(주제|소재|내용|방향)(?:를|은|는)?\s*/i, '')
    .replace(/(?:으로|로)?\s*(?:바꿔줘|바꿔|바꾸어줘|바꾸|변경해줘|변경|수정해줘|수정|가자|다시\s*(?:만들어줘|만들|써줘|써|작성해줘|작성))\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripTrailingKoreanParticle(value = '') {
  return String(value || '').replace(/\s*(?:은|는|을|를|이|가)$/u, '').trim()
}

function normalizeComparableText(value = '') {
  return String(value || '').replace(/\s+/g, '').toLowerCase()
}

function parseSubjectList(value = '') {
  return uniqueCompactList(
    String(value || '')
      .replace(/^(?:주제|소재|내용|방향)(?:를|은|는)?\s*/i, '')
      .split(/\s*(?:,|\/|·|그리고|및|랑|하고|와|과)\s*/g)
      .map((item) => stripTrailingKoreanParticle(cleanRequestedPhrase(item)))
      .filter((item) => item && item.length <= 60),
    8,
  )
}

function normalizeOperationType(value = '') {
  const normalized = String(value || '').trim()
  return Object.values(COPILOT_OPERATION_TYPES).includes(normalized)
    ? normalized
    : COPILOT_OPERATION_TYPES.UNKNOWN
}

function normalizeSemanticEditInstruction(raw = {}, request = '') {
  const source = raw && typeof raw === 'object' ? raw : {}
  let operationType = normalizeOperationType(source.operationType)
  let newSubject = stripTrailingKoreanParticle(cleanRequestedPhrase(source.newSubject || ''))
  if (operationType === COPILOT_OPERATION_TYPES.TOPIC_REFRAME && isInvalidNewSubjectCandidate(newSubject)) {
    operationType = STYLE_KEYWORD_PATTERN.test(newSubject)
      ? COPILOT_OPERATION_TYPES.TONE_ADJUST
      : COPILOT_OPERATION_TYPES.FRAMING_REWRITE
    newSubject = ''
  }
  const oldSubjectToRemove = parseSubjectList(
    Array.isArray(source.oldSubjectToRemove) ? source.oldSubjectToRemove.join(',') : source.oldSubjectToRemove,
  )
  const forbiddenSurfacePhrases = uniqueCompactList(
    [
      ...(Array.isArray(source.forbiddenSurfacePhrases) ? source.forbiddenSurfacePhrases : []),
      ...buildForbiddenSurfacePhrases(oldSubjectToRemove),
    ].map((item) => cleanRequestedPhrase(item)),
    24,
  )
  const requestedMaterials = uniqueCompactList(
    Array.isArray(source.requestedMaterials)
      ? source.requestedMaterials.map((item) => cleanRequestedPhrase(item)).filter(Boolean)
      : splitRequestedMaterials(source.requestedMaterials || ''),
    8,
  )
  const explicitKeep = uniqueCompactList(
    Array.isArray(source.explicitKeep)
      ? source.explicitKeep.map((item) => cleanRequestedPhrase(item)).filter(Boolean)
      : [],
    8,
  )
  const explicitRemove = uniqueCompactList(
    [
      ...(Array.isArray(source.explicitRemove)
        ? source.explicitRemove.map((item) => cleanRequestedPhrase(item)).filter(Boolean)
        : []),
      ...oldSubjectToRemove,
    ],
    8,
  )

  return {
    operationType,
    newSubject,
    oldSubjectToRemove,
    forbiddenSurfacePhrases,
    requestedMaterials,
    salesContext: cleanRequestedPhrase(source.salesContext || extractSalesContext(request)),
    toneHint: cleanRequestedPhrase(source.toneHint || extractToneHint(request)),
    explicitKeep,
    explicitRemove,
    allowComparisonWithOldSubject: Boolean(source.allowComparisonWithOldSubject),
    confidence: Math.max(0, Math.min(1, Number(source.confidence || 0))),
    reason: String(source.reason || '').replace(/\s+/g, ' ').trim(),
  }
}

const FRAMING_REWRITE_PATTERN =
  /(불편|불편함|고민|문제|답답|귀찮|부담|걱정|불안).{0,24}(해소|해결|덜어|사라지|편해|안심|시원|가벼워|좋아지|풀리|벗어나)|(?:해소|해결|안심|편해|공감|설득|혜택|장점|만족|전환|흐름|관점|프레이밍|감정선).{0,12}(느낌|흐름|관점|방향|톤|전개)|(?:느낌|흐름|관점|방향|톤|전개)(?:으로|로)\s*(?:다시\s*)?(?:짜|써|작성|정리|다듬|바꿔|수정)/i

function isFramingRewriteRequest(text = '') {
  const source = String(text || '').trim()
  if (!source) {
    return false
  }
  if (!/(다시\s*)?(짜|써|작성|정리|다듬|바꿔|수정|리라이트|rewrite|revise|edit)/i.test(source)) {
    return false
  }
  return FRAMING_REWRITE_PATTERN.test(source)
}

function extractFramingRewriteHint(text = '') {
  const source = String(text || '').trim()
  if (!source) {
    return ''
  }
  if (/(불편|불편함|고민|문제|답답|귀찮|부담|걱정|불안).{0,24}(해소|해결|덜어|사라지|편해|안심|시원|가벼워|좋아지|풀리|벗어나)/i.test(source)) {
    return '기존 불편함이 해소되는 흐름'
  }
  if (/(공감|설득|혜택|장점|만족|전환|감정선).{0,12}(느낌|흐름|관점|방향|톤|전개)/i.test(source)) {
    return cleanRequestedPhrase(source.match(/(?:공감|설득|혜택|장점|만족|전환|감정선).{0,18}(?:느낌|흐름|관점|방향|톤|전개)/i)?.[0] || '')
  }
  return '전개 관점 조정'
}

function isInvalidNewSubjectCandidate(value = '') {
  const subject = cleanRequestedPhrase(value)
  if (!subject) {
    return false
  }
  return STYLE_KEYWORD_PATTERN.test(subject) || FRAMING_REWRITE_PATTERN.test(subject)
}

function buildForbiddenSurfacePhrases(oldSubjects = []) {
  const phrases = []
  for (const subject of uniqueCompactList(oldSubjects, 8)) {
    phrases.push(
      `${subject}말고`,
      `${subject} 말고`,
      `${subject}대신`,
      `${subject} 대신`,
      `${subject}빼고`,
      `${subject} 빼고`,
      `${subject}는 빼고`,
      `${subject}은 빼고`,
      `${subject} 버리고`,
      `기존 ${subject}`,
    )
  }
  return uniqueCompactList(phrases, 24)
}

function parseTopicReframeInstruction(text = '') {
  const source = String(text || '').trim()
  if (!source) {
    return null
  }
  if (isFramingRewriteRequest(source)) {
    return null
  }

  const patterns = [
    /^(.+?)\s*(?:으로|로)\s*주제(?:를|은|는)?\s*(?:바꿔|바꾸|변경|수정)/i,
    /^(.+?)\s*주제(?:로|으로)\s*(?:바꿔|바꾸|변경|수정)/i,
    /(?:주제(?:를|은|는)?\s*)?(.+?)\s*(?:말고|대신|빼고)\s*(.+?)\s*(?:으로|로)(?:\s|$)/i,
    /(?:주제(?:를|은|는)?\s*)?(.+?)\s*(?:는|은)?\s*빼고\s*(.+?)\s*(?:으로|로)(?:\s|$)/i,
    /(?:기존\s*)?(.+?)\s*(?:버리고|버려|제외하고)\s*(.+?)\s*(?:으로|로)(?:\s|$)/i,
    /(?:주제(?:를|은|는)?\s*)?(.+?)\s*에서\s*(.+?)\s*(?:으로|로)(?:\s|$)/i,
    /(?:주제(?:를|은|는)?\s*)?(.+?)\s*(?:을|를)\s*(.+?)\s*(?:으로|로)\s*(?:바꿔|바꾸|변경|수정)/i,
  ]

  for (const pattern of patterns) {
    const match = source.match(pattern)
    if (!match) {
      continue
    }
    if (match.length === 2) {
      const newSubject = stripTrailingKoreanParticle(cleanRequestedPhrase(match[1]))
      if (newSubject && newSubject.length <= 80 && !isInvalidNewSubjectCandidate(newSubject)) {
        return {
          newSubject,
          oldSubjectToRemove: [],
          forbiddenSurfacePhrases: [],
        }
      }
      continue
    }
    const oldSubjectToRemove = parseSubjectList(match[1])
    const newSubject = stripTrailingKoreanParticle(cleanRequestedPhrase(match[2]))
    if (oldSubjectToRemove.length && newSubject && newSubject.length <= 80 && !isInvalidNewSubjectCandidate(newSubject)) {
      return {
        newSubject,
        oldSubjectToRemove,
        forbiddenSurfacePhrases: buildForbiddenSurfacePhrases(oldSubjectToRemove),
      }
    }
  }

  return null
}

function parseSectionSwapInstruction(text = '') {
  const source = String(text || '').trim()
  const match = source.match(
    /(?:HOOK|훅|후크|후킹|첫\s*문장|BODY|바디|본문|내용|CTA|씨티에이|마무리|끝\s*문장)(?:은|는|을|를|만)?\s*(.+?)\s*(?:말고|대신|빼고)\s*(.+?)(?:으로|로)?\s*(?:바꿔|바꾸|수정|정리|가자|$)/i,
  )
  if (!match) {
    return null
  }

  const oldSubjectToRemove = parseSubjectList(match[1])
  const requestedMaterials = splitRequestedMaterials(match[2])
  if (!oldSubjectToRemove.length || !requestedMaterials.length) {
    return null
  }

  return {
    oldSubjectToRemove,
    requestedMaterials,
    forbiddenSurfacePhrases: buildForbiddenSurfacePhrases(oldSubjectToRemove),
  }
}

const STYLE_KEYWORD_PATTERN =
  /(존댓말|존대|반말|해요체|하십시오체|합니다체|말투|어미|문체|톤|친근하게|공손하게|부드럽게|딱딱하게|자연스럽게|말하듯|구어체|광고\s*같지\s*않게|판매\s*같지\s*않게|구매\s*압박|세일즈)/i

function isStyleAdjustmentRequest(text = '') {
  const source = String(text || '').trim()
  if (!source) {
    return false
  }
  return STYLE_KEYWORD_PATTERN.test(source) && /(수정|바꿔|바꾸|변경|고쳐|다듬|맞춰|해줘|해주세요|정리)/i.test(source)
}

function extractStyleTarget(request = '') {
  const text = String(request || '')
  const targets = []
  if (/존댓말|존대|해요체|하십시오체|합니다체|공손/i.test(text)) {
    targets.push('존댓말')
  }
  if (/반말/i.test(text)) {
    targets.push('반말')
  }
  if (/자연스럽게|말하듯|구어체/i.test(text)) {
    targets.push('자연스러운 구어체')
  }
  if (/광고\s*같지\s*않게|판매\s*같지\s*않게|구매\s*압박|세일즈/i.test(text)) {
    targets.push('덜 광고 같은 말투')
  }
  if (/친근하게/i.test(text)) {
    targets.push('친근한 말투')
  }
  if (/부드럽게/i.test(text)) {
    targets.push('부드러운 말투')
  }
  if (/딱딱하게/i.test(text)) {
    targets.push('정돈된 말투')
  }
  return uniqueCompactList(targets, 4).join(', ')
}

function extractSalesContext(request = '') {
  const text = String(request || '').trim()
  if (!text) {
    return ''
  }

  if (/공동\s*구매|공동구매|공구/i.test(text)) {
    return '음식 공구'
  }
  if (/홍보\s*모집|모집|광고\s*대행|상담\s*유도|구매\s*링크|판매/i.test(text)) {
    return cleanRequestedPhrase(text.match(/(?:홍보\s*모집|모집|광고\s*대행|상담\s*유도|구매\s*링크|판매)/i)?.[0] || '')
  }

  return ''
}

function extractToneHint(request = '') {
  const text = String(request || '').trim()
  const hints = []
  if (/공동\s*구매|공동구매|공구\s*느낌|공구/i.test(text)) hints.push('공구 느낌')
  if (/생활형|일상형|일상\s*공감|생활\s*공감/i.test(text)) hints.push('생활 공감형')
  if (/엄마|육아맘|아이|남편|가족/i.test(text)) hints.push('가족 생활 공감형')
  if (/담백|자연스럽|말하듯|구어체/i.test(text)) hints.push('자연스럽고 말하듯이')

  return uniqueCompactList(hints, 4).join(', ')
}

function extractTopicReframeMaterials(request = '', newSubject = '') {
  const text = String(request || '').trim()
  if (!text || !newSubject) {
    return []
  }

  let materialSource = text
    .replace(newSubject, '')
    .replace(/^.*?(?:주제(?:를|은|는)?\s*)?(?:으로|로)?\s*(?:바꿔|바꾸|변경|수정).*?(?:[?.!。]|$)/i, '')
    .replace(/(?:공동\s*구매|공동구매|공구)\s*느낌(?:으로)?/gi, '')
    .replace(/(?:공동\s*구매|공동구매|공구)(?:으로|로|느낌)?/gi, '')
    .replace(/(?:느낌|톤|스타일)(?:으로|로)?/gi, '')
    .trim()

  if (!materialSource) {
    return []
  }

  const chunks = materialSource
    .split(/\s*(?:[?.!。\n]+|,\s*)\s*/g)
    .map((item) => cleanRequestedPhrase(item))
    .filter((item) => item && item.length >= 4 && item.length <= 90)
    .filter((item) => !/(바꿔|바꾸|변경|수정|느낌|공구|공동구매|공동\s*구매)$/i.test(item))

  return uniqueCompactList(chunks, 6)
}

export function parseEditInstruction(request = '', intentResult = {}) {
  const text = String(request || '').trim()
  const targetDurationSeconds =
    normalizeTargetDurationSeconds(intentResult.targetDurationSeconds) || extractTargetDurationSeconds(text)
  const allowComparisonWithOldSubject = /(비교|대비|차이|vs|VS|비교해|비교하는|비교해서)/i.test(text)
  const semanticInstruction = normalizeSemanticEditInstruction(intentResult.structuredEditInstruction || intentResult, text)
  const hasSemanticInstructionSource = Boolean(intentResult.structuredEditInstruction)

  const instruction = {
    operationType: COPILOT_OPERATION_TYPES.UNKNOWN,
    reframeScope: '',
    newSubject: '',
    oldSubjectToRemove: [],
    forbiddenSurfacePhrases: [],
    requestedMaterials: [],
    salesContext: '',
    toneHint: '',
    explicitKeep: detectExplicitPreserveSections(text),
    explicitRemove: [],
    allowComparisonWithOldSubject,
  }

  if (targetDurationSeconds) {
    return {
      ...instruction,
      operationType: COPILOT_OPERATION_TYPES.DURATION_COMPRESS,
    }
  }

  if (isStyleAdjustmentRequest(text)) {
    return {
      ...instruction,
      operationType: COPILOT_OPERATION_TYPES.TONE_ADJUST,
      toneHint: extractStyleTarget(text) || extractToneHint(text),
    }
  }

  if (
    isFramingRewriteRequest(text) &&
    !(
      hasSemanticInstructionSource &&
      semanticInstruction.operationType === COPILOT_OPERATION_TYPES.TOPIC_REFRAME &&
      semanticInstruction.newSubject
    )
  ) {
    return {
      ...instruction,
      operationType: COPILOT_OPERATION_TYPES.FRAMING_REWRITE,
      toneHint: extractFramingRewriteHint(text),
    }
  }

  if (
    hasSemanticInstructionSource &&
    semanticInstruction.operationType === COPILOT_OPERATION_TYPES.FRAMING_REWRITE
  ) {
    return {
      ...instruction,
      operationType: COPILOT_OPERATION_TYPES.FRAMING_REWRITE,
      requestedMaterials: semanticInstruction.requestedMaterials,
      salesContext: semanticInstruction.salesContext,
      toneHint: semanticInstruction.toneHint || extractFramingRewriteHint(text),
      explicitKeep: uniqueCompactList([...instruction.explicitKeep, ...semanticInstruction.explicitKeep], 8),
      explicitRemove: uniqueCompactList(semanticInstruction.explicitRemove, 8),
    }
  }

  if (
    hasSemanticInstructionSource &&
    semanticInstruction.operationType === COPILOT_OPERATION_TYPES.TOPIC_REFRAME &&
    semanticInstruction.newSubject
  ) {
    return {
      ...instruction,
      operationType: COPILOT_OPERATION_TYPES.TOPIC_REFRAME,
      reframeScope: 'full',
      newSubject: semanticInstruction.newSubject,
      oldSubjectToRemove: semanticInstruction.oldSubjectToRemove,
      forbiddenSurfacePhrases: semanticInstruction.forbiddenSurfacePhrases,
      requestedMaterials: semanticInstruction.requestedMaterials.length
        ? semanticInstruction.requestedMaterials
        : extractTopicReframeMaterials(text, semanticInstruction.newSubject),
      salesContext: semanticInstruction.salesContext,
      toneHint: semanticInstruction.toneHint,
      explicitKeep: uniqueCompactList([...instruction.explicitKeep, ...semanticInstruction.explicitKeep], 8),
      explicitRemove: uniqueCompactList(semanticInstruction.explicitRemove, 8),
      allowComparisonWithOldSubject: semanticInstruction.allowComparisonWithOldSubject || allowComparisonWithOldSubject,
    }
  }

  if (
    hasSemanticInstructionSource &&
    semanticInstruction.operationType === COPILOT_OPERATION_TYPES.INSERT_MATERIAL &&
    semanticInstruction.requestedMaterials.length
  ) {
    return {
      ...instruction,
      operationType: COPILOT_OPERATION_TYPES.INSERT_MATERIAL,
      oldSubjectToRemove: semanticInstruction.oldSubjectToRemove,
      forbiddenSurfacePhrases: semanticInstruction.forbiddenSurfacePhrases,
      requestedMaterials: semanticInstruction.requestedMaterials,
      salesContext: semanticInstruction.salesContext,
      toneHint: semanticInstruction.toneHint,
      explicitKeep: uniqueCompactList([...instruction.explicitKeep, ...semanticInstruction.explicitKeep], 8),
      explicitRemove: uniqueCompactList(semanticInstruction.explicitRemove, 8),
    }
  }

  const topicReframe = parseTopicReframeInstruction(text)
  const sectionSwap = parseSectionSwapInstruction(text)
  if (sectionSwap) {
    return {
      ...instruction,
      operationType: COPILOT_OPERATION_TYPES.INSERT_MATERIAL,
      oldSubjectToRemove: sectionSwap.oldSubjectToRemove,
      forbiddenSurfacePhrases: sectionSwap.forbiddenSurfacePhrases,
      requestedMaterials: sectionSwap.requestedMaterials,
      explicitRemove: sectionSwap.oldSubjectToRemove,
    }
  }

  if (topicReframe && !allowComparisonWithOldSubject) {
    const requestedMaterials =
      extractRequestedMaterials(text, topicReframe.newSubject).length
        ? extractRequestedMaterials(text, topicReframe.newSubject)
        : extractTopicReframeMaterials(text, topicReframe.newSubject)
    return {
      ...instruction,
      operationType: COPILOT_OPERATION_TYPES.TOPIC_REFRAME,
      reframeScope: 'full',
      newSubject: topicReframe.newSubject,
      oldSubjectToRemove: topicReframe.oldSubjectToRemove,
      forbiddenSurfacePhrases: topicReframe.forbiddenSurfacePhrases,
      requestedMaterials,
      salesContext: extractSalesContext(text),
      toneHint: extractToneHint(text),
      explicitRemove: topicReframe.oldSubjectToRemove,
    }
  }

  if (topicReframe && allowComparisonWithOldSubject) {
    return {
      ...instruction,
      operationType: COPILOT_OPERATION_TYPES.PARTIAL_REWRITE,
      reframeScope: 'partial',
      newSubject: topicReframe.newSubject,
      oldSubjectToRemove: topicReframe.oldSubjectToRemove,
      forbiddenSurfacePhrases: [],
      requestedMaterials: extractRequestedMaterials(text, topicReframe.newSubject),
      salesContext: extractSalesContext(text),
      toneHint: extractToneHint(text),
      explicitRemove: [],
    }
  }

  const detectedNewSubject = cleanRequestedPhrase(intentResult.newSubject || extractRequestedNewSubject(text))
  const requestedMaterials = uniqueCompactList(
    Array.isArray(intentResult.requestedMaterials) && intentResult.requestedMaterials.length
      ? intentResult.requestedMaterials.map((item) => cleanRequestedPhrase(item))
      : extractRequestedMaterials(text, detectedNewSubject),
    8,
  )

  if (detectedNewSubject) {
    return {
      ...instruction,
      operationType: COPILOT_OPERATION_TYPES.TOPIC_REFRAME,
      reframeScope: 'full',
      newSubject: detectedNewSubject,
      requestedMaterials,
      salesContext: extractSalesContext(text),
      toneHint: extractToneHint(text),
    }
  }

  if (requestedMaterials.length) {
    return {
      ...instruction,
      operationType: COPILOT_OPERATION_TYPES.INSERT_MATERIAL,
      requestedMaterials,
    }
  }

  if (/자연스럽게|말\s*되게|말되게|사람\s*말|말하듯|구어체|부자연|어색|번역체|광고\s*같지\s*않게|광고\s*같|판매\s*같|상업적|구매\s*압박|세일즈/i.test(text)) {
    return {
      ...instruction,
      operationType: COPILOT_OPERATION_TYPES.TONE_ADJUST,
    }
  }

  if (/고쳐|수정|바꿔|바꾸|다듬|개선|보완|리라이트|rewrite|edit|revise|fix/i.test(text)) {
    return {
      ...instruction,
      operationType: COPILOT_OPERATION_TYPES.PARTIAL_REWRITE,
    }
  }

  return instruction
}

function extractRequestedNewSubject(request = '') {
  const text = String(request || '').trim()
  if (isStyleAdjustmentRequest(text) || isFramingRewriteRequest(text)) {
    return ''
  }
  const patterns = [
    /주제(?:를|은|는)?\s*(.+?)\s*(?:으로|로)\s*(?:바꿔|바꾸|변경|수정|다시\s*(?:만들|써|작성))/i,
    /^(.+?)\s*(?:으로|로)\s*주제(?:를|은|는)?\s*(?:바꿔|바꾸|변경|수정)/i,
    /^(.+?)\s*주제(?:로|으로)\s*(?:바꿔|바꾸|변경|수정)/i,
    /주제(?:를|은|는)?\s*(.+?)\s*(?:으로|로)\s+.+?(?:넣어|추가|포함|반영)/i,
    /^(.+?)\s*(?:으로|로)\s+.+?(?:넣어|추가|포함|반영)/i,
    /(?:^|[\s,])(.+?)\s*(?:으로|로)\s*(?:주제\s*)?(?:바꿔|바꾸|변경|다시\s*(?:만들|써|작성))/i,
    /(.+?)\s*소재(?:로|으로)\s*(?:다시\s*)?(?:만들|써|작성|바꿔|바꾸)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    const subject = cleanRequestedPhrase(match?.[1] || '')
    if (subject && subject.length <= 80 && !STYLE_KEYWORD_PATTERN.test(subject) && !/말\s*되게|세게|강하게|짧게|길게/i.test(subject)) {
      return subject
    }
  }

  return ''
}

function splitRequestedMaterials(value = '') {
  return uniqueCompactList(
    String(value || '')
      .split(/\s*(?:,|\/|·|그리고|및|랑|하고|와|과)\s*/g)
      .map((item) => cleanRequestedPhrase(item))
      .filter((item) => item && item.length <= 60),
    8,
  )
}

function tokenizeForRequestMatch(value = '') {
  return uniqueCompactList(
    String(value || '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/g)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2),
    8,
  )
}

function findIncompleteCompressedSentences(sections = {}) {
  const normalized = normalizeSections(sections)
  const issues = []
  const fragmentPattern =
    /(?:부터요|다음에|톡톡|순서만\s*딱|오해부터|꺼내서|올리고|넣고|두고|하고|해서|라서|니까|하면|때)$/u
  const weakStandalonePattern = /^(?:오해|간|순서|톡톡|잠깐|바로|그다음|다음|먼저)(?:부터요|부터|만|에)?[.!?。]?$/u
  const completeEndingPattern =
    /(?:다|요|죠|니다|습니다|해요|돼요|세요|게요|예요|이에요|까요|세요|보세요|주세요|됩니다|합니다)[.!?。]?$/u

  for (const section of SECTION_KEYS) {
    const text = normalized[section]
    const chunks = text
      .split(/[\n]+|(?<=[.!?。])\s+/g)
      .map((item) => item.trim().replace(/[.!?。]+$/u, ''))
      .filter(Boolean)

    for (const chunk of chunks) {
      const compact = chunk.replace(/\s+/g, '')
      if (!compact) continue
      const tooFragmented =
        weakStandalonePattern.test(chunk) ||
        fragmentPattern.test(chunk) ||
        (compact.length <= 8 && !completeEndingPattern.test(chunk))
      if (tooFragmented) {
        issues.push({ section, text: chunk })
      }
    }
  }

  return issues.slice(0, 5)
}

export function normalizeTargetDurationSeconds(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return null
  }

  const seconds = Math.floor(numeric)
  return seconds >= MIN_DURATION_COMPRESS_SECONDS ? seconds : null
}

export function extractTargetDurationSeconds(request = '') {
  const text = String(request || '').trim()
  if (!text) {
    return null
  }

  const patterns = [
    /(\d{1,3})\s*초\s*(?:안에|이내|로|까지)?\s*(?:말하게|압축|줄여|줄이|맞춰|정리|만들)/i,
    /(?:압축|줄여|줄이|맞춰|정리|말하게).{0,16}?(\d{1,3})\s*초/i,
    /(\d{1,3})\s*초\s*(?:분량|짜리)/i,
  ]

  for (const pattern of patterns) {
    const seconds = normalizeTargetDurationSeconds(text.match(pattern)?.[1])
    if (seconds) {
      return seconds
    }
  }

  return null
}

export function buildDurationCharRange(targetDurationSeconds) {
  const seconds = normalizeTargetDurationSeconds(targetDurationSeconds)
  if (!seconds) {
    return null
  }

  return {
    min: Math.round(seconds * DURATION_CHAR_RATE_MIN),
    max: Math.round(seconds * DURATION_CHAR_RATE_MAX),
  }
}

function countSpeechCharacters(value = '') {
  return String(value || '').replace(/\s+/g, '').length
}

function countSectionSpeechCharacters(sections = {}) {
  const normalized = normalizeSections(sections)
  return countSpeechCharacters(`${normalized.hook}\n${normalized.body}\n${normalized.cta}`)
}

function estimateSpeechSecondsFromSections(sections = {}) {
  const count = countSectionSpeechCharacters(sections)
  if (!count) {
    return 0
  }
  return Math.max(1, Math.round(count / DURATION_CHAR_RATE_MIN))
}

function extractRequestedMaterials(request = '', newSubject = '') {
  const text = String(request || '').trim()
  if (!/(넣어|넣어줘|추가|포함|반영)/i.test(text)) {
    return []
  }

  let materialSource = text
  if (newSubject) {
    materialSource = materialSource.replace(newSubject, '')
    materialSource = materialSource.replace(/^\s*(?:으로|로)\s*/, '')
  }
  materialSource = materialSource
    .replace(/(?:HOOK|훅|후크|후킹|첫\s*문장|BODY|바디|본문|중간|내용|CTA|씨티에이|마무리|끝\s*문장)\s*(?:에|에는|에다가|쪽에)?/gi, '')
    .replace(/(?:넣어줘|넣어|추가해줘|추가|포함해줘|포함|반영해줘|반영).*/i, '')
    .replace(/(?:주제(?:를|은|는)?\s*)?.+?\s*(?:으로|로)\s*$/i, '')

  return splitRequestedMaterials(materialSource)
}

function normalizeCopilotMemory(memory = {}) {
  const source = memory && typeof memory === 'object' ? memory : {}
  return {
    preferredTone: uniqueCompactList(source.preferredTone, 8),
    dislikedTone: uniqueCompactList(source.dislikedTone, 8),
    preferredHookStyle: uniqueCompactList(source.preferredHookStyle, 8),
    dislikedExpressions: uniqueCompactList(source.dislikedExpressions, 8),
    lengthPreference: String(source.lengthPreference || '').replace(/\s+/g, ' ').trim(),
    ctaPreference: String(source.ctaPreference || '').replace(/\s+/g, ' ').trim(),
    recentUserCorrections: uniqueCompactList(source.recentUserCorrections, 10),
    lastAcceptedVersionSummary: String(source.lastAcceptedVersionSummary || '').replace(/\s+/g, ' ').trim(),
    memoryEvents: normalizeCopilotMemoryEvents(source.memoryEvents),
  }
}

function normalizeCopilotMemoryEvents(events = []) {
  if (!Array.isArray(events)) {
    return []
  }
  const allowedTypes = new Set(['preference', 'dislike', 'constraint', 'topic_reframe'])
  const seen = new Set()
  const output = []
  for (const event of events) {
    if (!event || typeof event !== 'object') {
      continue
    }
    const type = allowedTypes.has(event.type) ? event.type : ''
    const value = String(event.value || '').replace(/\s+/g, ' ').trim()
    if (!type || !value) {
      continue
    }
    const confidence = Math.max(0, Math.min(1, Number(event.confidence || 0.7)))
    const source = String(event.source || '').replace(/\s+/g, ' ').trim()
    const oldSubjectToRemove = uniqueCompactList(event.oldSubjectToRemove, 5)
    const newSubject = String(event.newSubject || '').replace(/\s+/g, ' ').trim()
    const key = JSON.stringify({ type, value, oldSubjectToRemove, newSubject })
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    output.push({
      type,
      value,
      confidence,
      source,
      scope: 'session',
      ...(oldSubjectToRemove.length ? { oldSubjectToRemove } : {}),
      ...(newSubject ? { newSubject } : {}),
    })
    if (output.length >= 12) {
      break
    }
  }
  return output
}

function formatCopilotMemoryForPrompt(memory = {}) {
  const normalized = normalizeCopilotMemory(memory)
  const lines = []
  const addList = (label, values = []) => {
    if (values.length) {
      lines.push(`- ${label}: ${values.join(', ')}`)
    }
  }
  const addText = (label, value = '') => {
    if (value) {
      lines.push(`- ${label}: ${value}`)
    }
  }

  addList('선호 톤', normalized.preferredTone)
  addList('피해야 할 톤', normalized.dislikedTone)
  addList('선호 HOOK 방향', normalized.preferredHookStyle)
  addList('피해야 할 표현', normalized.dislikedExpressions)
  addText('길이 선호', normalized.lengthPreference)
  addText('CTA 선호', normalized.ctaPreference)
  addList('최근 사용자 교정', normalized.recentUserCorrections)
  addText('최근 선호 버전 요약', normalized.lastAcceptedVersionSummary)
  const strongEvents = normalized.memoryEvents.filter((event) => event.confidence >= 0.85)
  const weakEvents = normalized.memoryEvents.filter((event) => event.confidence < 0.85)
  if (strongEvents.length) {
    lines.push(
      `- 강한 세션 제약/선호: ${strongEvents
        .map((event) => `${event.value} (confidence ${event.confidence.toFixed(2)})`)
        .join(' / ')}`,
    )
  }
  if (weakEvents.length) {
    lines.push(
      `- 약한 참고 신호: ${weakEvents
        .map((event) => `${event.value} (confidence ${event.confidence.toFixed(2)})`)
        .join(' / ')}`,
    )
  }

  if (!lines.length) {
    return ''
  }

  return [
    '[현재 코파일럿 세션에서 학습한 사용자 선호]',
    ...lines,
    '',
    'copilotMemory 적용 규칙:',
    '- 현재 대본 세션 안에서만 사용하는 취향 보조 정보다.',
    '- 사용자 상품/타겟/사실 정보, 레퍼런스 구조, A/B/C 전략보다 우선하지 않는다.',
    '- 섹션 잠금 규칙보다 우선하지 않는다. BODY만 수정 요청이면 HOOK/CTA는 절대 바꾸지 않는다.',
    '- confidence가 높은 constraint만 강하게 참고한다. 낮은 confidence 신호는 취향 참고로만 사용한다.',
    '- 메모리에 있는 과거 주제 변경 신호보다 현재 사용자 요청을 우선한다.',
    '- 오래된 취향보다 현재 사용자 요청과 현재 초안의 맥락을 우선한다.',
  ].join('\n')
}

export function buildEditPlan({
  userRequest = '',
  currentSections,
  intentResult = {},
  editTarget = '',
  copilotMemory = {},
  targetDurationSeconds = null,
  previousAdvice = null,
} = {}) {
  const request = String(userRequest || '').trim()
  const sections = normalizeSections(currentSections)
  const normalizedPreviousAdvice = normalizePreviousAdvice(previousAdvice || intentResult.previousAdvice)
  const isApplyingPreviousAdvice =
    intentResult.intent === COPILOT_INTENTS.APPLY_PREVIOUS_ADVICE && isPreviousAdviceFresh(normalizedPreviousAdvice)
  const durationTarget =
    normalizeTargetDurationSeconds(targetDurationSeconds) ||
    normalizeTargetDurationSeconds(intentResult.targetDurationSeconds) ||
    extractTargetDurationSeconds(request)
  const structuredEditInstruction = parseEditInstruction(request, intentResult)
  const isDurationCompress =
    Boolean(durationTarget) ||
    intentResult.operationType === COPILOT_OPERATION_TYPES.DURATION_COMPRESS ||
    structuredEditInstruction.operationType === COPILOT_OPERATION_TYPES.DURATION_COMPRESS
  const previousAdviceTarget = isApplyingPreviousAdvice
    ? previousAdviceTargetToEditTarget(normalizedPreviousAdvice, intentResult.editTarget || editTarget || 'all')
    : ''
  const normalizedTarget = isDurationCompress
    ? 'all'
    : normalizeEditTarget(intentResult.editTarget || previousAdviceTarget || editTarget, request)
  const explicitPreserveSections = detectExplicitPreserveSections(request)
  const explicitPreserveSet = new Set(explicitPreserveSections)
  let targetSections = isApplyingPreviousAdvice
    ? previousAdviceOperationTargetSections(normalizedPreviousAdvice).length
      ? previousAdviceOperationTargetSections(normalizedPreviousAdvice)
      : previousAdviceTargetSections(normalizedPreviousAdvice, normalizedTarget)
    : getTargetSections(normalizedTarget)
  if (explicitPreserveSet.size) {
    const filteredTargets = targetSections.filter((key) => !explicitPreserveSet.has(key))
    targetSections = filteredTargets.length ? filteredTargets : SECTION_KEYS.filter((key) => !explicitPreserveSet.has(key))
  }
  let targetSet = new Set(targetSections)
  let preserveSections = SECTION_KEYS.filter((key) => !targetSet.has(key))
  const memory = normalizeCopilotMemory(copilotMemory)
  const semanticInstruction = normalizeSemanticEditInstruction(intentResult.structuredEditInstruction || intentResult, request)
  const rawNewSubjectCandidate = cleanRequestedPhrase(
    structuredEditInstruction.newSubject || semanticInstruction.newSubject || intentResult.newSubject || extractRequestedNewSubject(request),
  )
  const detectedNewSubject = isInvalidNewSubjectCandidate(rawNewSubjectCandidate) ? '' : rawNewSubjectCandidate
  const requestedMaterials = uniqueCompactList(
    Array.isArray(intentResult.requestedMaterials) && intentResult.requestedMaterials.length
      ? intentResult.requestedMaterials.map((item) => cleanRequestedPhrase(item))
      : structuredEditInstruction.requestedMaterials?.length
        ? structuredEditInstruction.requestedMaterials
        : extractRequestedMaterials(request, detectedNewSubject),
    8,
  )
  const salesContext = cleanRequestedPhrase(
    structuredEditInstruction.salesContext || intentResult.salesContext || extractSalesContext(request),
  )
  const toneHint = cleanRequestedPhrase(
    structuredEditInstruction.toneHint || intentResult.toneHint || extractToneHint(request),
  )
  const structuredOperationType =
    structuredEditInstruction.operationType && structuredEditInstruction.operationType !== COPILOT_OPERATION_TYPES.UNKNOWN
      ? structuredEditInstruction.operationType
      : ''
  const oldSubjectToRemove = uniqueCompactList(
    [
      ...(structuredEditInstruction.oldSubjectToRemove || []),
      ...(semanticInstruction.oldSubjectToRemove || []),
    ],
    8,
  )
  const forbiddenSurfacePhrases = uniqueCompactList(
    [
      ...(structuredEditInstruction.forbiddenSurfacePhrases || []),
      ...(semanticInstruction.forbiddenSurfacePhrases || []),
      ...buildForbiddenSurfacePhrases(oldSubjectToRemove),
    ],
    24,
  )
  const allowComparisonWithOldSubject = Boolean(
    structuredEditInstruction.allowComparisonWithOldSubject || semanticInstruction.allowComparisonWithOldSubject,
  )
  const applicablePreviousOperations =
    isApplyingPreviousAdvice && normalizedPreviousAdvice?.operations?.length
      ? normalizedPreviousAdvice.operations.filter(
          (operation) => !(SECTION_KEYS.includes(operation.target) && explicitPreserveSet.has(operation.target)),
        )
      : []
  const operationType = isDurationCompress
    ? COPILOT_OPERATION_TYPES.DURATION_COMPRESS
    : isApplyingPreviousAdvice && !structuredOperationType && !detectedNewSubject && !requestedMaterials.length
      ? COPILOT_OPERATION_TYPES.PARTIAL_REWRITE
    : structuredOperationType ||
    intentResult.operationType ||
    (detectedNewSubject
      ? COPILOT_OPERATION_TYPES.TOPIC_REFRAME
      : requestedMaterials.length
        ? COPILOT_OPERATION_TYPES.INSERT_MATERIAL
        : COPILOT_OPERATION_TYPES.EDIT_PARTIAL)
  if (
    isApplyingPreviousAdvice &&
    structuredOperationType &&
    structuredOperationType !== COPILOT_OPERATION_TYPES.PARTIAL_REWRITE &&
    structuredOperationType !== COPILOT_OPERATION_TYPES.UNKNOWN
  ) {
    targetSections = isDurationCompress
      ? SECTION_KEYS
      : getTargetSections(normalizeEditTarget(editTarget || intentResult.editTarget || '', request))
    if (explicitPreserveSet.size) {
      const filteredTargets = targetSections.filter((key) => !explicitPreserveSet.has(key))
      targetSections = filteredTargets.length ? filteredTargets : SECTION_KEYS.filter((key) => !explicitPreserveSet.has(key))
    }
    targetSet = new Set(targetSections)
    preserveSections = SECTION_KEYS.filter((key) => !targetSet.has(key))
  }
  const reframeScope =
    operationType === COPILOT_OPERATION_TYPES.TOPIC_REFRAME
      ? targetSections.length === SECTION_KEYS.length && !explicitPreserveSet.size
        ? 'full'
        : 'partial'
      : ''
  const qaMode =
    operationType === COPILOT_OPERATION_TYPES.DURATION_COMPRESS
      ? COPILOT_QA_MODES.DURATION_COMPRESS
      : operationType === COPILOT_OPERATION_TYPES.TOPIC_REFRAME
      ? COPILOT_QA_MODES.REFRAME_TOPIC
      : operationType === COPILOT_OPERATION_TYPES.INSERT_MATERIAL
        ? COPILOT_QA_MODES.INSERT_MATERIAL
        : COPILOT_QA_MODES.PRESERVE_TOPIC
  const targetCharRange = durationTarget ? buildDurationCharRange(durationTarget) : null
  const strategy = []
  const preserveFromOriginal =
    operationType === COPILOT_OPERATION_TYPES.TOPIC_REFRAME
      ? ['레퍼런스 구조', '문장 리듬', '톤', 'CTA 스타일']
      : []
  const discardFromOriginal =
    operationType === COPILOT_OPERATION_TYPES.TOPIC_REFRAME
      ? ['기존 상품', '기존 소재', '기존 상황', '기존 구체 예시', '기존 고객 pain point']
      : []
  const preserve = [
    operationType === COPILOT_OPERATION_TYPES.TOPIC_REFRAME
      ? `${preserveFromOriginal.join(', ')}만 참고`
      : '현재 초안의 주제와 상품/서비스 정보',
    '사용자 입력에 있는 사실 정보',
    '선택된 A/B/C 초안의 기본 역할과 흐름',
  ]
  const change = []
  const avoid = [
    '레퍼런스 원문 소재, 상품명, 고유명사, 비유 복사',
    '없는 수치, 후기, 고객 사례, 전문가 권위 생성',
    '요청받지 않은 섹션 변경',
  ]

  if (isApplyingPreviousAdvice && normalizedPreviousAdvice) {
    strategy.push('직전 조언 실행 + 현재 사용자 명시 조건 우선')
    if (normalizedPreviousAdvice.diagnosis) {
      change.push(`직전 진단 해결: ${normalizedPreviousAdvice.diagnosis}`)
    }
    if (normalizedPreviousAdvice.instructions.length) {
      change.push(...normalizedPreviousAdvice.instructions)
    }
    if (normalizedPreviousAdvice.operations?.length) {
      for (const operation of normalizedPreviousAdvice.operations) {
        if (SECTION_KEYS.includes(operation.target) && explicitPreserveSet.has(operation.target)) {
          avoid.push(`${SECTION_LABELS[operation.target]} 관련 직전 조언은 현재 사용자 잠금 지시 때문에 적용하지 않기`)
        }
      }
      for (const operation of applicablePreviousOperations) {
        const sectionLabel = SECTION_LABELS[operation.target] || '전체'
        const operationInstruction = operation.instruction || operation.problem
        if (operationInstruction) {
          change.push(`${sectionLabel}: ${operationInstruction}`)
        }
        if (operation.problem) {
          change.push(`${sectionLabel} 문제 해결: ${operation.problem}`)
        }
        if (operation.preserve?.length) {
          preserve.push(...operation.preserve.map((item) => `${sectionLabel} 기준 유지: ${item}`))
        }
        if (operation.avoid?.length) {
          avoid.push(...operation.avoid.map((item) => `${sectionLabel} 금지: ${item}`))
        }
      }
    }
    if (normalizedPreviousAdvice.expectedOutcome) {
      change.push(`기대 결과: ${normalizedPreviousAdvice.expectedOutcome}`)
    }
    if (normalizedPreviousAdvice.preserveSections.length) {
      preserve.push(
        ...normalizedPreviousAdvice.preserveSections.map((key) => `${SECTION_LABELS[key]} 원문 유지`),
      )
    }
    avoid.push('직전 조언의 문장을 대본에 그대로 복사하기')
  }

  if (operationType === COPILOT_OPERATION_TYPES.TOPIC_REFRAME) {
    strategy.push(
      reframeScope === 'full'
        ? '새 주제 기준 전체 재구성 + 구조/리듬/톤만 참고'
        : `${targetSections.map((key) => SECTION_LABELS[key]).join('/')}만 새 주제 기준으로 부분 재구성 + 잠금 섹션 유지`,
    )
    change.push(
      reframeScope === 'full'
        ? `기존 내용을 보존하지 말고 새 주제 "${detectedNewSubject || '사용자가 명시한 새 주제'}" 중심으로 HOOK/BODY/CTA를 다시 맞춘다`
        : `수정 대상 섹션만 새 주제 "${detectedNewSubject || '사용자가 명시한 새 주제'}" 중심으로 바꾸고 잠금 섹션은 원문 유지한다`,
    )
    if (salesContext) {
      change.push(`판매 맥락을 자연스럽게 반영한다: ${salesContext}`)
    }
    if (toneHint) {
      preserve.push(`톤 힌트: ${toneHint}`)
    }
    avoid.push('기존 주제의 상품/상황/고객 pain point를 어중간하게 섞기')
    avoid.push(`기존 대본 내용 보존 대상으로 착각하기: ${discardFromOriginal.join(', ')}`)
    avoid.push('requestedMaterials, salesContext, toneHint를 대본 문장에 그대로 복사하기')
    if (oldSubjectToRemove.length && !allowComparisonWithOldSubject) {
      avoid.push(...oldSubjectToRemove.map((subject) => `기존 소재 "${subject}"를 비교/대비 표현으로도 남기지 않기`))
    }
    if (forbiddenSurfacePhrases.length) {
      avoid.push(...forbiddenSurfacePhrases)
    }
  }
  if (operationType === COPILOT_OPERATION_TYPES.INSERT_MATERIAL) {
    strategy.push(`${targetSections.map((key) => SECTION_LABELS[key]).join('/')}에 요청 소재 삽입 + 잠금 섹션 유지`)
    change.push(`요청 소재를 자연스럽게 포함한다: ${requestedMaterials.join(', ') || '사용자 지정 소재'}`)
    avoid.push('소재 추가를 이유로 요청하지 않은 섹션까지 다시 쓰기')
  }
  if (operationType === COPILOT_OPERATION_TYPES.TONE_ADJUST) {
    strategy.push(`${targetSections.map((key) => SECTION_LABELS[key]).join('/')} 말투만 조정 + 주제/상품/소재 유지`)
    change.push(`요청한 말투로 바꾼다: ${toneHint || '사용자가 지정한 말투'}`)
    preserve.push('현재 주제, 상품/서비스, 소재, CTA 의도')
    avoid.push('말투 요청을 새 주제나 새 상품으로 해석하기')
  }
  if (operationType === COPILOT_OPERATION_TYPES.DURATION_COMPRESS) {
    strategy.push(`${durationTarget || '목표'}초 기준 완결 문장 압축 + HOOK/BODY/CTA 구조 유지`)
    preserve.push('현재 주제, 상품/서비스, 타겟, 핵심 메시지, CTA 의도')
    change.push(
      `목표 분량 ${durationTarget || '-'}초${
        targetCharRange ? `, 공백 제외 약 ${targetCharRange.min}-${targetCharRange.max}자` : ''
      }에 맞게 중복 설명과 부연 설명을 줄이되 각 문장은 자연스럽게 완결한다`,
    )
    avoid.push(
      '새 내용 추가',
      '없는 수치/후기/사례/효과/권위 생성',
      '핵심 메시지를 과도하게 삭제하기',
      'CTA를 없애거나 행동 유도 의도를 바꾸기',
      '조사/접속어/서술어가 빠진 파편 문장',
      '"오해부터요", "톡톡", "다음에"처럼 맥락 없이 끊긴 문장',
    )
  }

  if (/자연스럽게|말\s*되게|말되게|사람\s*말|말하듯|구어체|부자연|어색|번역체/i.test(request)) {
    strategy.push('구어체화 + 번역체 제거 + 문장 호흡 정리')
    change.push('어색하거나 기계적인 문장을 실제 사람이 말하듯 자연스럽게 바꾼다')
    avoid.push('설명문처럼 길게 이어지는 문장')
  }
  if (/광고\s*같지\s*않게|광고\s*같|판매\s*같|상업적|구매\s*압박|세일즈/i.test(request)) {
    strategy.push('판매 압박 제거 + 상황/정보 중심 전환')
    change.push('구매를 밀기보다 저장/확인/이해할 이유를 먼저 준다')
    avoid.push('과한 구매 압박과 흔한 광고성 표현')
  }
  if (operationType === COPILOT_OPERATION_TYPES.FRAMING_REWRITE || isFramingRewriteRequest(request)) {
    strategy.push('문제 제기에서 해소감으로 이어지는 전개 정리')
    change.push(`${toneHint || extractFramingRewriteHint(request)}이 느껴지도록 문제 상황과 해결 결과를 자연스럽게 연결한다`)
    avoid.push('전개 방향 요청을 새 상품/새 주제로 해석하기')
  }
  if (/짧게|압축|간결|줄여|너무\s*길/i.test(request)) {
    strategy.push('핵심만 남기고 문장 압축')
    change.push('중복 설명과 장황한 연결어를 줄인다')
  }
  if (/강하게|세게|후킹감|첫\s*문장|훅/i.test(request) && targetSections.includes('hook')) {
    strategy.push('첫 문장 긴장감 강화 + BODY/CTA 연결 유지')
    change.push('타겟의 문제, 손해, 궁금증이 첫 문장에 더 빨리 보이게 한다')
  }
  if (/cta|씨티에이|마무리|구매|댓글|저장|신청|상담/i.test(request) && targetSections.includes('cta')) {
    strategy.push('행동 이유가 보이는 CTA로 정리')
    change.push('시청자가 왜 지금 행동해야 하는지 자연스럽게 붙인다')
  }
  if (memory.dislikedTone.length) {
    avoid.push(...memory.dislikedTone)
  }
  if (memory.dislikedExpressions.length) {
    avoid.push(...memory.dislikedExpressions)
  }
  if (memory.preferredTone.length) {
    preserve.push(...memory.preferredTone)
  }
  if (memory.ctaPreference && targetSections.includes('cta')) {
    preserve.push(memory.ctaPreference)
  }
  if (memory.recentUserCorrections.length) {
    avoid.push(...memory.recentUserCorrections)
  }

  if (!strategy.length) {
    strategy.push(
      targetSections.length === SECTION_KEYS.length
        ? '기존 구조를 유지한 전체 표현 개선'
        : `${targetSections.map((key) => SECTION_LABELS[key]).join('/')} 범위 안에서 요청 표현만 개선`,
    )
  }
  if (!change.length) {
    change.push('요청받은 섹션의 표현, 연결성, 읽히는 리듬을 개선한다')
  }
  const primaryGoal = resolvePrimaryGoal({
    operationType,
    request,
    newSubject: detectedNewSubject,
    requestedMaterials,
    targetDurationSeconds: durationTarget,
  })
  const revisionStyle = resolveRevisionStyle({ operationType, request })
  const sectionInstructions = buildSectionInstructions({
    operationType,
    targetSections,
    preserveSections,
    request,
  })
  const guardrails = buildPlanGuardrails({
    operationType,
    reframeScope,
    request,
    targetSections,
    preserveSections,
    newSubject: detectedNewSubject,
    requestedMaterials,
    oldSubjectToRemove,
    forbiddenSurfacePhrases,
    allowComparisonWithOldSubject,
    targetDurationSeconds: durationTarget,
    salesContext,
    toneHint,
  })

  return {
    editTarget: normalizedTarget,
    targetSections,
    preserveSections,
    operationType,
    reframeScope,
    qaMode,
    primaryGoal,
    revisionStyle,
    sectionInstructions,
    targetDurationSeconds: durationTarget,
    targetCharRange,
    newSubject: detectedNewSubject,
    oldSubjectToRemove,
    forbiddenSurfacePhrases,
    requestedMaterials,
    salesContext,
    toneHint,
    explicitKeep: structuredEditInstruction.explicitKeep || [],
    explicitRemove: structuredEditInstruction.explicitRemove || [],
    allowComparisonWithOldSubject,
    previousAdvice: normalizedPreviousAdvice,
    previousAdviceApplied: isApplyingPreviousAdvice,
    structuredEditInstruction,
    carryOverStrategy: {
      preserveReferenceStructure: true,
      preserveTone: true,
      preserveCtaStyle: true,
      preserveSectionLength: operationType !== COPILOT_OPERATION_TYPES.TOPIC_REFRAME,
    },
    preserveFromOriginal,
    discardFromOriginal,
    strategy: uniqueCompactList(strategy, 5).join(' + '),
    preserve: uniqueCompactList(preserve, 10),
    change: uniqueCompactList(change, 8),
    avoid: uniqueCompactList(avoid, 12),
    mustKeep: guardrails.mustKeep,
    mustChange: uniqueCompactList(
      [
        ...(guardrails.mustChange || []),
        ...(isApplyingPreviousAdvice && normalizedPreviousAdvice
          ? [
              ...normalizedPreviousAdvice.instructions,
              ...applicablePreviousOperations.map(
                (operation) => operation.instruction || operation.problem,
              ),
              normalizedPreviousAdvice.expectedOutcome,
            ]
          : []),
      ],
      10,
    ),
    mustAvoid: guardrails.mustAvoid,
    reason: `사용자 요청 "${request.slice(0, 80)}"을 ${targetSections.map((key) => SECTION_LABELS[key]).join('/')} 범위에서 반영하기 위한 내부 편집 계획`,
    currentSectionLengths: {
      hook: sections.hook.length,
      body: sections.body.length,
      cta: sections.cta.length,
    },
    currentSpeech: {
      characters: countSectionSpeechCharacters(sections),
      estimatedSeconds: estimateSpeechSecondsFromSections(sections),
    },
  }
}

function formatEditPlanForPrompt(editPlan = null) {
  if (!editPlan || typeof editPlan !== 'object') {
    return ''
  }
  return [
    '[내부 편집 계획]',
    `- 수정 범위: ${editPlan.editTarget || 'all'}`,
    `- 작업 유형: ${editPlan.operationType || COPILOT_OPERATION_TYPES.EDIT_PARTIAL}`,
    editPlan.reframeScope ? `- 주제 변경 범위: ${editPlan.reframeScope}` : '',
    `- QA 기준: ${editPlan.qaMode || COPILOT_QA_MODES.PRESERVE_TOPIC}`,
    editPlan.primaryGoal ? `- 핵심 목표: ${editPlan.primaryGoal}` : '',
    editPlan.revisionStyle ? `- 수정 방식: ${editPlan.revisionStyle}` : '',
    editPlan.sectionInstructions ? `- 섹션별 지시: ${JSON.stringify(editPlan.sectionInstructions)}` : '',
    editPlan.targetDurationSeconds
      ? `- 목표 압축 시간: ${editPlan.targetDurationSeconds}초${
          editPlan.targetCharRange ? ` (공백 제외 약 ${editPlan.targetCharRange.min}-${editPlan.targetCharRange.max}자)` : ''
        }`
      : '',
    editPlan.newSubject ? `- 새 주제: ${editPlan.newSubject}` : '',
    editPlan.oldSubjectToRemove?.length ? `- 제거할 기존 소재: ${editPlan.oldSubjectToRemove.join(', ')}` : '',
    editPlan.forbiddenSurfacePhrases?.length ? `- 대본 금지 표현: ${editPlan.forbiddenSurfacePhrases.join(', ')}` : '',
    editPlan.oldSubjectToRemove?.length
      ? `- 기존 소재 비교 허용: ${editPlan.allowComparisonWithOldSubject ? '예' : '아니오'}`
      : '',
    editPlan.requestedMaterials?.length ? `- 요청 소재: ${editPlan.requestedMaterials.join(', ')}` : '',
    editPlan.salesContext ? `- 판매 맥락: ${editPlan.salesContext}` : '',
    editPlan.toneHint ? `- 톤 힌트: ${editPlan.toneHint}` : '',
    editPlan.preserveFromOriginal?.length
      ? `- 기존 대본에서 참고할 것: ${editPlan.preserveFromOriginal.join(', ')}`
      : '',
    editPlan.discardFromOriginal?.length
      ? `- 기존 대본에서 버릴 것: ${editPlan.discardFromOriginal.join(', ')}`
      : '',
    editPlan.previousAdviceApplied && editPlan.previousAdvice
      ? `- 직전 조언 실행: 예`
      : '',
    editPlan.previousAdvice?.diagnosis ? `- 직전 진단: ${editPlan.previousAdvice.diagnosis}` : '',
    editPlan.previousAdvice?.instructions?.length
      ? `- 직전 조언의 실행 지시: ${editPlan.previousAdvice.instructions.join(' / ')}`
      : '',
    editPlan.previousAdvice?.operations?.length
      ? `- 직전 조언의 작업 목록: ${JSON.stringify(editPlan.previousAdvice.operations)}`
      : '',
    editPlan.previousAdvice?.expectedOutcome ? `- 직전 조언의 기대 결과: ${editPlan.previousAdvice.expectedOutcome}` : '',
    editPlan.previousAdvice?.preserveSections?.length
      ? `- 직전 조언 기준 유지 섹션: ${editPlan.previousAdvice.preserveSections.map((key) => SECTION_LABELS[key]).join(', ')}`
      : '',
    editPlan.preserveSections?.length ? `- 유지 섹션: ${editPlan.preserveSections.map((key) => SECTION_LABELS[key]).join(', ')}` : '',
    `- 전략: ${editPlan.strategy || '-'}`,
    editPlan.preserve?.length ? `- 유지: ${editPlan.preserve.join(', ')}` : '',
    editPlan.change?.length ? `- 변경: ${editPlan.change.join(', ')}` : '',
    editPlan.avoid?.length ? `- 회피: ${editPlan.avoid.join(', ')}` : '',
    editPlan.mustKeep?.length ? `- 반드시 유지: ${editPlan.mustKeep.join(', ')}` : '',
    editPlan.mustChange?.length ? `- 반드시 변경: ${editPlan.mustChange.join(', ')}` : '',
    editPlan.mustAvoid?.length ? `- 절대 금지: ${editPlan.mustAvoid.join(', ')}` : '',
    `- 이유: ${editPlan.reason || '-'}`,
    '',
    '편집 계획 적용 규칙:',
    '- 우선순위: structured edit plan > editTarget/section lock > account/character tone > current script > reference structure > raw user request.',
    '- previousAdviceApplied=true이면 이번 작업은 독립적인 새 수정 요청이 아니라 직전 코파일럿 조언을 실제 대본에 반영하는 작업이다.',
    '- previousAdviceApplied=true이면 "그렇게", "그 방향" 같은 사용자 표현 자체를 해석하지 말고 previousAdvice.instructions를 실행한다.',
    '- previousAdvice.operations가 있으면 instructions보다 더 구체적인 실행 목록으로 본다. 각 operation의 target/problem/instruction/preserve/avoid를 실제 수정 기준으로 따른다.',
    '- 단, 이번 사용자 메시지에서 "HOOK은 그대로", "CTA만"처럼 명시한 조건은 previousAdvice보다 우선한다.',
    '- 사용자 원문은 의도 해석용 보조 정보다. 실제 대본 작성은 structured edit plan을 최우선으로 따른다.',
    '- raw user request의 표현을 대본 문장에 그대로 복사하지 않는다.',
    '- requestedMaterials, salesContext, toneHint는 그대로 복사할 문장이 아니라 반영할 상황/판매 맥락/톤 힌트다.',
    '- 이 계획은 내부 보조 정보이며 섹션 잠금보다 우선하지 않는다.',
    '- sectionInstructions에서 action=keep인 섹션은 원문 그대로 유지한다.',
    '- mustKeep은 정말 깨지면 안 되는 핵심만 담은 목록이다. mustKeep을 핑계로 mustChange를 무시하지 않는다.',
    '- mustChange는 이번 요청의 핵심 변경점이다. 수정본에서 실제로 반영한다.',
    '- mustAvoid는 대본에 절대 나오면 안 되는 표현/위험 요소다.',
    '- 단, 사용자가 새 주제/새 소재를 명시한 경우 그 요청은 기존 대본 주제 유지 규칙보다 우선한다.',
    '- topic_reframe은 기존 내용을 보존하는 작업이 아니다. 기존 대본에서는 구조/리듬/톤/CTA 방식만 참고한다.',
    '- topic_reframe이면 기존 상품/소재/상황/pain point/구체 예시는 새 주제와 충돌할 때 반드시 버린다.',
    '- topic_reframe full이면 HOOK/BODY/CTA 전체를 새 주제 기준으로 다시 맞춘다.',
    '- topic_reframe partial이면 targetSections만 새 주제 기준으로 바꾸고 preserveSections는 원문 그대로 유지한다.',
    '- forbiddenSurfacePhrases가 있으면 대본에 절대 사용하지 않는다.',
    '- allowComparisonWithOldSubject=false이면 oldSubjectToRemove는 대본에 남기지 않는다. 비교/대비 표현으로도 쓰지 않는다.',
    '- insert_material이면 targetSections에만 요청 소재를 넣고 preserveSections는 원문 그대로 유지한다.',
    '- tone_adjust이면 주제/상품/소재를 바꾸지 말고 요청한 말투/어미만 조정한다. "존댓말", "반말", "해요체" 같은 말은 상품명이나 주제가 아니다.',
    '- framing_rewrite이면 주제/상품/소재를 바꾸지 말고 문제 제기, 공감, 해소감, 해결 흐름 같은 전개 방식만 조정한다. "해소되는 느낌", "공감되는 관점" 같은 말은 상품명이나 주제가 아니다.',
    '- duration_compress이면 새 대본 생성이 아니라 압축이다. 새 내용/수치/후기/사례/효과/권위를 만들지 않고 HOOK/BODY/CTA와 CTA 의도를 유지한다.',
    '- duration_compress에서는 목표 글자 수를 참고하되, 정확한 글자 수보다 자연스러운 문장과 핵심 메시지 보존을 우선한다.',
    '- duration_compress에서는 문맥 연결에 필요한 최소한의 조사/서술어/이유는 남긴다. "오해부터요", "톡톡", "다음에"처럼 잘린 파편 문장으로 만들지 않는다.',
    '- 계획에 없는 새 소재나 수치를 만들지 않는다.',
  ]
    .filter(Boolean)
    .join('\n')
}

export function shouldUseHeavyQualityGateForCopilot({
  request = '',
  editTarget = '',
  targetSections,
  operationType = COPILOT_OPERATION_TYPES.EDIT_PARTIAL,
} = {}) {
  const text = String(request || '')
  const targets = Array.isArray(targetSections) && targetSections.length
    ? targetSections
    : getTargetSections(normalizeEditTarget(editTarget, text))
  if (
    operationType === COPILOT_OPERATION_TYPES.DURATION_COMPRESS ||
    operationType === COPILOT_OPERATION_TYPES.TOPIC_REFRAME ||
    operationType === COPILOT_OPERATION_TYPES.INSERT_MATERIAL
  ) {
    return true
  }
  if (targets.length === SECTION_KEYS.length || targets.includes('body')) {
    return true
  }
  return /(자연스럽게|말\s*되게|말되게|부자연|어색|번역체|광고\s*같|판매\s*같|상업적|구매\s*압박|레퍼런스|참고|톤|캐릭터|계정|전체|전반|다\s*바꿔|더\s*좋게|살려)/i.test(text)
}

function compactSummaryText(value = '', maxLength = 34) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text
}

function formatSectionListForUser(sections = SECTION_KEYS) {
  const normalized = Array.isArray(sections) && sections.length
    ? sections.filter((key) => SECTION_KEYS.includes(key))
    : SECTION_KEYS

  if (normalized.length === SECTION_KEYS.length) {
    return '전체 흐름'
  }

  return normalized.map((key) => SECTION_LABELS[key]).join('/')
}

function detectExplicitPreserveSections(request = '') {
  const text = String(request || '')
  const compact = text.replace(/\s+/g, '').toLowerCase()
  const preserved = new Set()
  const preserveSignal = '(?:유지|그대로|건드리지|건들지|냅둬|냅두|놔둬|놔두|두고|살리고|남기고|고정|잠그)'

  if (new RegExp(`(?:hook|훅|후킹|첫문장|첫 문장|도입|오프닝)(?:은|는|을|를|만)?\\s*${preserveSignal}`, 'i').test(text)) {
    preserved.add('hook')
  }
  if (new RegExp(`(?:body|바디|본문|내용|전개)(?:은|는|을|를|만)?\\s*${preserveSignal}`, 'i').test(text)) {
    preserved.add('body')
  }
  if (new RegExp(`(?:cta|씨티에이|마무리|행동유도|행동 유도|클로징)(?:은|는|을|를|만)?\\s*${preserveSignal}`, 'i').test(text)) {
    preserved.add('cta')
  }

  if (/(hook|훅|후킹|첫문장|첫 문장|도입|오프닝).*?(유지|그대로|고정|잠그|냅두|냅둬|놔두|놔둬)/i.test(text) || /hook(?:은|는)?유지|훅(?:은|는)?유지/.test(compact)) {
    preserved.add('hook')
  }
  if (/(body|바디|본문|내용|전개).*?(유지|그대로|고정|잠그|냅두|냅둬|놔두|놔둬)/i.test(text) || /body(?:은|는)?유지|본문(?:은|는)?유지/.test(compact)) {
    preserved.add('body')
  }
  if (/(cta|씨티에이|마무리|행동유도|행동 유도|클로징).*?(유지|그대로|고정|잠그|냅두|냅둬|놔두|놔둬)/i.test(text) || /cta(?:은|는)?유지|마무리(?:은|는)?유지/.test(compact)) {
    preserved.add('cta')
  }

  return SECTION_KEYS.filter((key) => preserved.has(key))
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

function classifyCopilotIntentByRule(request = '', editTarget = '', options = {}) {
  const text = String(request || '').trim()
  const normalizedEditTarget = String(editTarget || '').trim().toLowerCase()
  const hasExplicitSectionTarget = SECTION_KEYS.includes(normalizedEditTarget)
  const targetDurationSeconds =
    normalizeTargetDurationSeconds(options.targetDurationSeconds) || extractTargetDurationSeconds(text)
  if (targetDurationSeconds) {
    return {
      intent: COPILOT_INTENTS.EDIT,
      shouldEdit: true,
      responseMode: 'edit_only',
      editTarget: 'all',
      confidence: 0.92,
      reason: '사용자가 목표 초수에 맞춘 대본 압축을 요청함',
      operationType: COPILOT_OPERATION_TYPES.DURATION_COMPRESS,
      targetDurationSeconds,
      newSubject: '',
      requestedMaterials: [],
      salesContext: '',
      toneHint: '',
    }
  }
  const parsedInstruction = parseEditInstruction(text, {
    targetDurationSeconds,
  })
  const newSubject = parsedInstruction.newSubject || extractRequestedNewSubject(text)
  const requestedMaterials = parsedInstruction.requestedMaterials?.length
    ? parsedInstruction.requestedMaterials
    : extractRequestedMaterials(text, newSubject)
  const operationType =
    parsedInstruction.operationType && parsedInstruction.operationType !== COPILOT_OPERATION_TYPES.UNKNOWN
      ? parsedInstruction.operationType
      : newSubject
        ? COPILOT_OPERATION_TYPES.TOPIC_REFRAME
        : requestedMaterials.length
          ? COPILOT_OPERATION_TYPES.INSERT_MATERIAL
          : COPILOT_OPERATION_TYPES.EDIT_PARTIAL
  const editPattern =
    /(고쳐|수정|바꿔|바꾸|다듬|고도화|개선|보완|줄여|늘려|짧게|길게|강하게|세게|약하게|자연스럽게|세련되게|정리해|압축|추가해|넣어|넣어줘|빼줘|삭제|교체|짜줘|짜줄래|다시\s*짜|리라이트|rewrite|edit|revise|fix|광고\s*같지\s*않게|판매\s*같지\s*않게|후킹감\s*있게)/i
  const advicePattern =
    /(어때|어떤가|괜찮|약한가|약해|별로|문제|피드백|조언|평가|점수|올려도|업로드해도|이대로|봐줘|검토|진단|판단|반응\s*올|반응\s*나|안\s*끌리|왜\s*안|광고\s*같|판매\s*같|상업적|부담스러|아까\s*버전|이전\s*버전|이\s*느낌\s*좋|좋아\?|나아\?|괜찮아\?)/i
  const vagueImprovePattern =
    /(살려|살려줘|더\s*좋게|좋게\s*바꿔|별로.*고쳐|별로.*수정|문제.*고쳐|문제.*수정|조언.*고쳐|조언.*수정)/i

  const wantsEdit = editPattern.test(text)
  const wantsAdvice = advicePattern.test(text)
  const wantsVagueImprove = vagueImprovePattern.test(text)
  const hasStructuredEditInstruction =
    operationType === COPILOT_OPERATION_TYPES.TOPIC_REFRAME ||
    operationType === COPILOT_OPERATION_TYPES.INSERT_MATERIAL ||
    operationType === COPILOT_OPERATION_TYPES.DURATION_COMPRESS

  if (hasStructuredEditInstruction) {
    return {
      intent: COPILOT_INTENTS.EDIT,
      shouldEdit: true,
      responseMode: wantsAdvice || wantsVagueImprove ? 'advice_then_edit' : 'edit_only',
      editTarget: normalizeEditTarget(editTarget, text),
      confidence: 0.86,
      reason: '사용자 요청에서 구조화 가능한 편집 지시가 확인됨',
      operationType,
      newSubject,
      requestedMaterials,
      salesContext: parsedInstruction.salesContext || extractSalesContext(text),
      toneHint: parsedInstruction.toneHint || extractToneHint(text),
    }
  }

  if (wantsEdit || wantsVagueImprove) {
    return {
      intent: COPILOT_INTENTS.EDIT,
      shouldEdit: true,
      responseMode: wantsAdvice || wantsVagueImprove ? 'advice_then_edit' : 'edit_only',
      editTarget: normalizeEditTarget(editTarget, text),
      confidence: wantsAdvice || wantsVagueImprove ? 0.78 : 0.88,
      reason: wantsAdvice || wantsVagueImprove
        ? '사용자가 문제 진단과 수정을 함께 요청함'
        : '사용자가 명시적인 수정 동사를 사용함',
      operationType,
      newSubject,
      requestedMaterials,
      salesContext: parsedInstruction.salesContext || extractSalesContext(text),
      toneHint: parsedInstruction.toneHint || extractToneHint(text),
    }
  }

  if (wantsAdvice) {
    return {
      intent: COPILOT_INTENTS.ADVISE,
      shouldEdit: false,
      responseMode: 'advice_only',
      editTarget: 'none',
      confidence: 0.86,
      reason: '사용자가 수정 명령보다 대본 품질 판단이나 조언을 요청함',
    }
  }

  if (hasExplicitSectionTarget) {
    return {
      intent: COPILOT_INTENTS.EDIT,
      shouldEdit: true,
      responseMode: 'edit_only',
      editTarget: normalizedEditTarget,
      confidence: 0.66,
      reason: 'UI에서 특정 수정 섹션이 선택되어 있어 수정 요청으로 처리함',
      operationType,
      newSubject,
      requestedMaterials,
      salesContext: parsedInstruction.salesContext || extractSalesContext(text),
      toneHint: parsedInstruction.toneHint || extractToneHint(text),
    }
  }

  return {
    intent: COPILOT_INTENTS.GENERAL,
    shouldEdit: false,
    responseMode: 'chat_only',
    editTarget: 'none',
    confidence: 0.55,
    reason: '명확한 수정 또는 조언 신호가 없어 일반 대화로 처리함',
  }
}

function inferRequestedSections(request = '') {
  const text = String(request || '').toLowerCase()
  const normalized = text.replace(/\s+/g, '')
  const preservedSections = detectExplicitPreserveSections(request)
  const preservedSet = new Set(preservedSections)
  const withoutPreserved = (sections = SECTION_KEYS) => {
    const editable = SECTION_KEYS.filter((key) => sections.includes(key) && !preservedSet.has(key))
    if (editable.length) {
      return editable
    }
    const fallbackEditable = SECTION_KEYS.filter((key) => !preservedSet.has(key))
    return fallbackEditable.length ? fallbackEditable : sections
  }

  if (
    /전체|전부|모두|다\s*바꿔|다\s*수정|전체적으로|전반적으로/.test(request) ||
    /all|entire|whole/.test(text)
  ) {
    return withoutPreserved(SECTION_KEYS)
  }

  const requested = new Set()
  if (/(hook|훅|후크|후킹|첫문장|첫 문장|도입|오프닝)/i.test(request)) {
    requested.add('hook')
  }
  if (/(body|바디|본문|중간|내용|전개|근거|설명)/i.test(request)) {
    requested.add('body')
  }
  if (/(cta|씨티에이|콜투액션|행동유도|행동 유도|마무리|끝문장|끝 문장|클로징|댓글|저장|팔로우)/i.test(request)) {
    requested.add('cta')
  }

  if (/hook만|훅만|후킹만|첫문장만|첫 문장만|도입만|오프닝만/i.test(request)) {
    return withoutPreserved(['hook'])
  }
  if (/body만|바디만|본문만|중간만|내용만|전개만/i.test(request)) {
    return withoutPreserved(['body'])
  }
  if (/cta만|씨티에이만|콜투액션만|행동유도만|행동 유도만|마무리만|끝문장만|끝 문장만|클로징만/i.test(request)) {
    return withoutPreserved(['cta'])
  }

  if (normalized.includes('hook/')) requested.add('hook')
  if (normalized.includes('body/')) requested.add('body')
  if (normalized.includes('/cta')) requested.add('cta')

  if (requested.size) {
    return withoutPreserved(SECTION_KEYS.filter((key) => requested.has(key)))
  }

  return withoutPreserved(SECTION_KEYS)
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

function buildNarrativeSectioningInstruction({
  request = '',
  targetSections = SECTION_KEYS,
  narrativePatternContext = '',
} = {}) {
  if (!narrativePatternContext || targetSections.length !== SECTION_KEYS.length) return ''

  return [
    '스토리/감정선 전체 수정 분리 규칙:',
    '- 스토리형으로 수정하더라도 출력은 반드시 HOOK/BODY/CTA로 나눈다.',
    '- HOOK은 이야기의 첫 장면, 불편한 상황, 갈등을 여는 한 문장이다.',
    '- BODY는 문제 경험 → 전환 → 해결 근거 흐름을 담는다.',
    '- CTA는 시청자가 다음에 할 행동과 그 이유를 담는다.',
    '- 전체 수정 요청에서 narrative_patterns를 사용했다면 BODY 하나만 반환하지 말고 HOOK/BODY/CTA 전체를 반환한다.',
    '- 스토리 흐름은 내용 전개 방식이고, HOOK/BODY/CTA는 저장/편집 구조다. 둘을 섞지 않는다.',
    `- 현재 사용자 요청: ${String(request || '').trim() || '-'}`,
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
      [target]: stripSectionSurfaceLabel(parsed.section || parsed.sections?.[target] || '', target),
    }
  }

  return normalizeSections(parsed.sections)
}

export function createSectionDiff(previousSections = {}, nextSections = {}) {
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

export function validateScriptFlow(sections = {}) {
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

const QA_SEVERITIES = new Set(['high', 'medium', 'low'])
const QA_REPAIR_SEVERITIES = new Set(['high', 'medium'])

function createQaIssue({
  type = 'quality_issue',
  severity = 'medium',
  section = 'all',
  text = '',
  reason = '',
  suggestion = '',
} = {}) {
  const normalizedSection = SECTION_KEYS.includes(String(section || '').toLowerCase())
    ? String(section).toLowerCase()
    : 'all'
  const normalizedSeverity = QA_SEVERITIES.has(String(severity || '').toLowerCase())
    ? String(severity).toLowerCase()
    : 'medium'

  return {
    type: String(type || 'quality_issue').replace(/\s+/g, '_').trim() || 'quality_issue',
    severity: normalizedSeverity,
    section: normalizedSection,
    text: String(text || '').replace(/\s+/g, ' ').trim(),
    reason: String(reason || '').replace(/\s+/g, ' ').trim(),
    suggestion: String(suggestion || '').replace(/\s+/g, ' ').trim(),
  }
}

function normalizeQaIssues(value = []) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => (item && typeof item === 'object' ? createQaIssue(item) : null))
    .filter(Boolean)
    .slice(0, 12)
}

function qaShouldRepair(issues = []) {
  return normalizeQaIssues(issues).some((issue) => QA_REPAIR_SEVERITIES.has(issue.severity))
}

function sanitizeUserFacingRepairMessage(message) {
  const text = String(message || '').trim()
  if (!text) {
    return '문제였던 부분만 다시 다듬었어요. 핵심 흐름은 유지하면서 어색하거나 과해 보일 수 있는 표현을 정리했습니다.'
  }

  const internalPattern = /QA|quality\s*gate|repair|fallback|issue|이슈|품질\s*검사|검사에서|위험\s*요소|내부|안전\s*검사|사회적\s*증거|근거\s*없는\s*수치|최소\s*수정|hook\/body\/cta/i
  if (internalPattern.test(text)) {
    return '문제였던 부분만 다시 다듬었어요. 핵심 흐름은 유지하면서 어색하거나 과해 보일 수 있는 표현을 정리했습니다.'
  }

  return text
}

const COPILOT_USER_MESSAGE_INTERNAL_PATTERN =
  /QA|quality\s*gate|repair|리페어|fallback|issue|이슈|intent|qaMode|operationType|품질\s*검사|검사에서|검증\s*실패|위험\s*요소|내부\s*편집\s*계획|내부\s*검사|안전\s*검사|사회적\s*증거|근거\s*없는\s*수치|최소\s*수정|hook\/body\/cta/i

function buildCopilotIntentTemplateMessage({
  editPlan = {},
  responseMode = 'edit_only',
  changedSections = [],
} = {}) {
  const operationType = editPlan?.operationType || COPILOT_OPERATION_TYPES.EDIT_PARTIAL
  const targetSections = Array.isArray(editPlan?.targetSections) && editPlan.targetSections.length
    ? editPlan.targetSections
    : changedSections
  const targetLabel = formatSectionListForUser(targetSections)

  if (responseMode === 'advice_only') {
    return '전체적으로 방향은 괜찮지만, 가장 약한 부분을 조금 더 선명하게 만들면 좋아요. 원하면 그 부분부터 바로 다듬어볼게요.'
  }

  if (operationType === COPILOT_OPERATION_TYPES.TOPIC_REFRAME) {
    const subject = editPlan?.newSubject || '요청하신 새 주제'
    return `좋아요. 이번엔 기존 주제에 끌려가지 않도록 "${subject}" 중심으로 다시 잡았어요. HOOK/BODY/CTA가 새 주제 기준으로 자연스럽게 이어지도록 정리했습니다.`
  }

  if (operationType === COPILOT_OPERATION_TYPES.INSERT_MATERIAL) {
    return `좋아요. 요청하신 내용을 ${targetLabel}에 자연스럽게 넣었어요. 다른 섹션은 흐름이 흔들리지 않도록 최대한 유지했습니다.`
  }

  if (operationType === COPILOT_OPERATION_TYPES.DURATION_COMPRESS) {
    const seconds = editPlan?.targetDurationSeconds
    return `좋아요. 현재 대본의 핵심과 CTA는 유지하면서${seconds ? ` ${seconds}초 안에 말할 수 있게` : ''} 압축했어요. 중복 설명과 부연만 덜어내서 더 짧게 읽히도록 정리했습니다.`
  }

  if (operationType === COPILOT_OPERATION_TYPES.FRAMING_REWRITE) {
    return `좋아요. 기존 주제는 유지하면서 ${targetLabel} 흐름을 문제 제기에서 해소감으로 이어지게 다시 잡았어요.`
  }

  if (responseMode === 'advice_then_edit') {
    return `좋아요. 기존 주제와 흐름은 유지하면서 ${targetLabel}에서 가장 어색한 부분을 먼저 다듬었어요. 읽히는 흐름이 더 자연스럽게 이어지도록 정리했습니다.`
  }

  return `좋아요. 기존 주제와 흐름은 유지하면서 ${targetLabel} 표현만 더 자연스럽게 다듬었어요.`
}

export function sanitizeUserFacingCopilotMessage(message, context = {}) {
  const text = String(message || '').trim()
  const fallback = buildCopilotIntentTemplateMessage(context)
  if (!text) {
    return fallback
  }

  if (
    context?.editPlan?.operationType === COPILOT_OPERATION_TYPES.DURATION_COMPRESS &&
    /문제였던\s*부분|문제였던|문제.*다시\s*다듬/i.test(text)
  ) {
    return fallback
  }

  if (COPILOT_USER_MESSAGE_INTERNAL_PATTERN.test(text) || isGenericRefineMessage(text)) {
    return fallback
  }

  return text
}

function collectNumbersFromText(value = '') {
  return new Set(String(value || '').match(/\d+(?:[.,]\d+)?\s*(?:만|억|천|원|만원|개|명|회|번|배|%|퍼센트|kg|킬로|개월|일|시간|분)?/g) || [])
}

function findUnexpectedNumbers(candidateSections = {}, allowedText = '') {
  const allowed = collectNumbersFromText(allowedText)
  const candidate = collectNumbersFromText(Object.values(normalizeSections(candidateSections)).join('\n'))

  return [...candidate].filter((item) => !allowed.has(item))
}

function textIncludesLoosePhrase(text = '', phrase = '') {
  const source = String(text || '')
  const target = String(phrase || '').trim()
  if (!source || !target) {
    return false
  }
  return source.includes(target) || normalizeComparableText(source).includes(normalizeComparableText(target))
}

function subjectLeakAllowedByNewSubject(subject = '', newSubject = '') {
  const normalizedSubject = normalizeComparableText(subject)
  const normalizedNewSubject = normalizeComparableText(newSubject)
  return Boolean(
    normalizedSubject &&
      normalizedNewSubject &&
      (normalizedNewSubject.includes(normalizedSubject) || normalizedSubject.includes(normalizedNewSubject)),
  )
}

function resolvePrimaryGoal({ operationType, request = '', newSubject = '', requestedMaterials = [], targetDurationSeconds = null } = {}) {
  if (operationType === COPILOT_OPERATION_TYPES.TOPIC_REFRAME) {
    return newSubject ? `새 주제 "${newSubject}" 중심 재구성` : '새 주제 중심 재구성'
  }
  if (operationType === COPILOT_OPERATION_TYPES.INSERT_MATERIAL) {
    return requestedMaterials.length ? `요청 소재 삽입: ${requestedMaterials.join(', ')}` : '요청 소재 삽입'
  }
  if (operationType === COPILOT_OPERATION_TYPES.DURATION_COMPRESS) {
    return targetDurationSeconds ? `${targetDurationSeconds}초 기준 삭제 중심 압축` : '목표 시간 기준 삭제 중심 압축'
  }
  if (operationType === COPILOT_OPERATION_TYPES.FRAMING_REWRITE) {
    return '문제 상황에서 해소감으로 이어지는 전개 정리'
  }
  if (/광고\s*같지\s*않게|광고\s*같|판매\s*같|상업적|구매\s*압박|세일즈/i.test(request)) {
    return '광고감/판매 압박 제거'
  }
  if (/자연스럽게|말\s*되게|말되게|사람\s*말|말하듯|구어체|부자연|어색|번역체/i.test(request)) {
    return '자연스러운 구어체로 정리'
  }
  return '요청 범위 안에서 표현 개선'
}

function resolveRevisionStyle({ operationType, request = '' } = {}) {
  if (operationType === COPILOT_OPERATION_TYPES.DURATION_COMPRESS) return 'delete_only'
  if (operationType === COPILOT_OPERATION_TYPES.TOPIC_REFRAME) return 'reframe_subject'
  if (operationType === COPILOT_OPERATION_TYPES.INSERT_MATERIAL) return 'insert_material'
  if (operationType === COPILOT_OPERATION_TYPES.FRAMING_REWRITE) return 'reframe_flow'
  if (/광고\s*같지\s*않게|광고\s*같|판매\s*같|자연스럽게|말\s*되게|말되게|구어체|부자연|어색|번역체/i.test(request)) {
    return 'rewrite_light'
  }
  return 'rewrite_light'
}

function buildSectionInstructions({ operationType, targetSections = SECTION_KEYS, preserveSections = [], request = '' } = {}) {
  const targetSet = new Set(targetSections)
  const preserveSet = new Set(preserveSections)
  const targetLabel = targetSections.map((key) => SECTION_LABELS[key]).join('/')
  const instructions = {}

  for (const section of SECTION_KEYS) {
    if (!targetSet.has(section) || preserveSet.has(section)) {
      instructions[section] = {
        action: 'keep',
        reason: preserveSet.has(section)
          ? `사용자가 ${SECTION_LABELS[section]} 유지/잠금을 명시했거나 수정 대상에서 제외됨`
          : `수정 대상이 ${targetLabel || '지정 섹션'}이므로 ${SECTION_LABELS[section]}는 유지`,
      }
      continue
    }

    if (operationType === COPILOT_OPERATION_TYPES.DURATION_COMPRESS) {
      instructions[section] = {
        action: 'compress',
        reason: '목표 초수에 맞춘 삭제 중심 압축 대상',
      }
    } else if (operationType === COPILOT_OPERATION_TYPES.TOPIC_REFRAME) {
      instructions[section] = {
        action: section === 'cta' ? 'revise' : 'replace',
        reason: section === 'cta'
          ? '사용자가 새 주제 중심 재구성을 요청했으므로 CTA 의도는 살리고 새 주제에 맞게 수정'
          : '사용자가 새 주제 중심 재구성을 요청함',
      }
    } else if (operationType === COPILOT_OPERATION_TYPES.INSERT_MATERIAL) {
      instructions[section] = {
        action: 'insert',
        reason: '사용자가 이 섹션에 소재 추가를 요청함',
      }
    } else if (operationType === COPILOT_OPERATION_TYPES.FRAMING_REWRITE) {
      instructions[section] = {
        action: 'revise',
        reason: '사용자가 주제 변경이 아니라 문제 제기에서 해소감으로 이어지는 전개 조정을 요청함',
      }
    } else {
      instructions[section] = {
        action: 'revise',
        reason: request ? '사용자 요청 범위 안에서 표현과 흐름을 개선' : '수정 대상 섹션 표현 개선',
      }
    }
  }

  return instructions
}

function buildPlanGuardrails({
  operationType,
  reframeScope = '',
  request = '',
  targetSections = SECTION_KEYS,
  preserveSections = [],
  newSubject = '',
  requestedMaterials = [],
  oldSubjectToRemove = [],
  forbiddenSurfacePhrases = [],
  allowComparisonWithOldSubject = false,
  targetDurationSeconds = null,
  salesContext = '',
  toneHint = '',
} = {}) {
  const mustKeep = []
  const mustChange = []
  const mustAvoid = [
    '없는 수치/후기/고객 사례/전문가 권위 생성',
    '레퍼런스 원문 소재/상품명/고유명사 복사',
  ]

  if (operationType === COPILOT_OPERATION_TYPES.TOPIC_REFRAME) {
    mustKeep.push('레퍼런스 구조/문장 리듬/CTA 방식만 참고')
    mustChange.push(newSubject ? `새 주제 "${newSubject}"를 중심에 둔다` : '사용자가 명시한 새 주제를 중심에 둔다')
    mustChange.push(
      reframeScope === 'partial'
        ? '수정 대상 섹션만 새 주제 기준으로 바꾸고 잠금 섹션은 유지'
        : 'HOOK/BODY/CTA 전체를 새 주제 기준으로 재구성',
    )
    mustAvoid.push('기존 상품/소재/상황/pain point/구체 예시를 보존 대상으로 취급하기')
    if (salesContext) {
      mustChange.push(`판매 맥락 "${salesContext}"를 자연스럽게 반영`)
    }
    if (toneHint) {
      mustAvoid.push(`톤 힌트 "${toneHint}"를 문장에 그대로 붙여 쓰기`)
    }
    if (oldSubjectToRemove.length && !allowComparisonWithOldSubject) {
      mustAvoid.push(...oldSubjectToRemove.map((subject) => `기존 소재 "${subject}" 노출`))
    }
  } else {
    mustKeep.push('현재 주제/상품/타겟')
  }

  if (operationType === COPILOT_OPERATION_TYPES.INSERT_MATERIAL) {
    mustChange.push(requestedMaterials.length ? `요청 소재 포함: ${requestedMaterials.join(', ')}` : '요청 소재를 수정 대상 섹션에 포함')
    mustKeep.push('지정하지 않은 섹션 원문')
  }

  if (operationType === COPILOT_OPERATION_TYPES.TONE_ADJUST) {
    mustKeep.push('현재 주제/상품/타겟/소재', '수정 대상 외 섹션 원문')
    mustChange.push(toneHint ? `말투를 "${toneHint}" 방향으로 조정` : '사용자가 요청한 말투로 조정')
    mustAvoid.push('말투 요청을 새 주제/상품으로 해석하기')
  }

  if (operationType === COPILOT_OPERATION_TYPES.FRAMING_REWRITE) {
    mustKeep.push('현재 주제/상품/타겟/소재')
    mustChange.push(toneHint ? `"${toneHint}"이 느껴지는 전개로 조정` : '문제 상황에서 해결/해소 결과로 이어지는 전개로 조정')
    mustAvoid.push('전개/감정 효과 요청을 새 주제/상품으로 해석하기')
  }

  if (operationType === COPILOT_OPERATION_TYPES.DURATION_COMPRESS) {
    mustKeep.push('HOOK/BODY/CTA 구조', 'CTA 의도', '핵심 메시지')
    mustChange.push(
      targetDurationSeconds
        ? `${targetDurationSeconds}초 기준으로 중복/부연 설명을 줄이고 완결 문장으로 압축`
        : '목표 초수 기준으로 중복/부연 설명을 줄이고 완결 문장으로 압축',
    )
    mustAvoid.push('새 내용 추가', 'CTA 삭제', '서술어가 빠진 파편 문장', '맥락 없이 끊긴 단어형 문장')
  }

  if (/광고\s*같지\s*않게|광고\s*같|판매\s*같|상업적|구매\s*압박|세일즈/i.test(request)) {
    mustChange.push('판매 압박을 줄이고 행동 이유를 먼저 제시')
    mustAvoid.push('과한 구매 압박과 광고성 표현')
  }

  if (/자연스럽게|말\s*되게|말되게|사람\s*말|말하듯|구어체|부자연|어색|번역체/i.test(request)) {
    mustChange.push('기계적/번역체 표현을 구어체로 정리')
    mustAvoid.push('설명문처럼 길게 이어지는 문장')
  }

  for (const section of preserveSections) {
    mustKeep.push(`${SECTION_LABELS[section]} 원문`)
  }

  if (forbiddenSurfacePhrases.length) {
    mustAvoid.push(...forbiddenSurfacePhrases)
  }

  return {
    mustKeep: uniqueCompactList(mustKeep, 6),
    mustChange: uniqueCompactList(mustChange, 6),
    mustAvoid: uniqueCompactList(mustAvoid, 10),
  }
}

function getStrongMemoryConstraints(memory = {}) {
  const normalized = normalizeCopilotMemory(memory)
  return normalized.memoryEvents.filter((event) => event.type === 'constraint' && event.confidence >= 0.85)
}

function currentRequestOverridesMemoryConstraint(request = '', constraintValue = '', targetSections = SECTION_KEYS) {
  const text = String(request || '')
  const value = String(constraintValue || '')
  if (/HOOK|훅/i.test(value) && targetSections.includes('hook') && /(hook|훅|후킹|첫\s*문장).*(고쳐|수정|바꿔|다듬|강하게|자연스럽게)|(?:고쳐|수정|바꿔|다듬).*(hook|훅|후킹|첫\s*문장)/i.test(text)) {
    return true
  }
  if (/BODY|바디|본문/i.test(value) && targetSections.includes('body') && /(body|바디|본문).*(고쳐|수정|바꿔|다듬|자연스럽게)|(?:고쳐|수정|바꿔|다듬).*(body|바디|본문)/i.test(text)) {
    return true
  }
  if (/CTA|씨티에이|마무리/i.test(value) && targetSections.includes('cta') && /(cta|씨티에이|마무리|끝\s*문장).*(고쳐|수정|바꿔|다듬)|(?:고쳐|수정|바꿔|다듬).*(cta|씨티에이|마무리|끝\s*문장)/i.test(text)) {
    return true
  }
  return false
}

function evaluateMemoryConstraintViolations({
  original,
  candidate,
  request = '',
  targetSections = SECTION_KEYS,
  copilotMemory = {},
} = {}) {
  const issues = []
  const constraints = getStrongMemoryConstraints(copilotMemory)
  for (const constraint of constraints) {
    if (currentRequestOverridesMemoryConstraint(request, constraint.value, targetSections)) {
      continue
    }
    if (/HOOK은 유지|HOOK.*유지|훅.*유지/i.test(constraint.value) && candidate.hook !== original.hook) {
      issues.push(
        createQaIssue({
          type: 'memory_constraint_violated',
          severity: 'high',
          section: 'hook',
          text: candidate.hook,
          reason: `세션 메모리의 강한 제약을 어겼다: ${constraint.value}`,
          suggestion: '최신 요청이 HOOK 수정을 명시하지 않았다면 HOOK은 원문 그대로 유지한다.',
        }),
      )
    }
    if (/BODY 중심.*HOOK\/CTA 유지|HOOK\/CTA 유지/i.test(constraint.value)) {
      if (!targetSections.includes('hook') && candidate.hook !== original.hook) {
        issues.push(
          createQaIssue({
            type: 'memory_constraint_violated',
            severity: 'high',
            section: 'hook',
            text: candidate.hook,
            reason: `세션 메모리의 강한 제약을 어겼다: ${constraint.value}`,
            suggestion: 'BODY 중심 요청에서는 HOOK을 원문 그대로 유지한다.',
          }),
        )
      }
      if (!targetSections.includes('cta') && candidate.cta !== original.cta) {
        issues.push(
          createQaIssue({
            type: 'memory_constraint_violated',
            severity: 'high',
            section: 'cta',
            text: candidate.cta,
            reason: `세션 메모리의 강한 제약을 어겼다: ${constraint.value}`,
            suggestion: 'BODY 중심 요청에서는 CTA를 원문 그대로 유지한다.',
          }),
        )
      }
    }
  }
  return issues
}

export function runFeedbackFallbackRuleCheck({
  originalSections,
  candidateSections,
  editTarget = 'all',
  feedback = {},
  request = '',
  qaMode = COPILOT_QA_MODES.PRESERVE_TOPIC,
  newSubject = '',
  requestedMaterials = [],
  oldSubjectToRemove = [],
  forbiddenSurfacePhrases = [],
  allowComparisonWithOldSubject = false,
  editPlan = null,
  copilotMemory = {},
  targetSections: plannedTargetSections = null,
  targetDurationSeconds = null,
  targetCharRange = null,
} = {}) {
  const original = normalizeSections(originalSections)
  const candidate = normalizeSections(candidateSections)
  const targetSections = Array.isArray(plannedTargetSections) && plannedTargetSections.length
    ? plannedTargetSections.filter((section) => SECTION_KEYS.includes(section))
    : getTargetSections(normalizeEditTarget(editTarget, request))
  const targetSet = new Set(targetSections)
  const issues = []
  const flowValidation = validateScriptFlow(candidate)

  for (const issue of flowValidation.issues) {
    issues.push(
      createQaIssue({
        type: 'empty_or_invalid_section',
        severity: 'high',
        section: 'all',
        reason: issue,
        suggestion: 'HOOK/BODY/CTA가 모두 채워진 수정본만 적용한다.',
      }),
    )
  }

  for (const key of SECTION_KEYS) {
    if (!targetSet.has(key) && candidate[key] !== original[key]) {
      issues.push(
        createQaIssue({
          type: 'section_lock_violation',
          severity: 'high',
          section: key,
          text: candidate[key],
          reason: `${SECTION_LABELS[key]}는 수정 대상이 아닌데 변경되었다.`,
          suggestion: `${SECTION_LABELS[key]}는 원문 그대로 유지한다.`,
        }),
      )
    }
  }
  const sectionInstructions =
    editPlan && typeof editPlan === 'object' && editPlan.sectionInstructions && typeof editPlan.sectionInstructions === 'object'
      ? editPlan.sectionInstructions
      : {}
  for (const key of SECTION_KEYS) {
    const instruction = sectionInstructions[key]
    if (instruction?.action === 'keep' && candidate[key] !== original[key]) {
      issues.push(
        createQaIssue({
          type: 'section_instruction_violation',
          severity: 'high',
          section: key,
          text: candidate[key],
          reason: `${SECTION_LABELS[key]}는 editPlan에서 keep으로 지정됐는데 변경되었다. ${instruction.reason || ''}`.trim(),
          suggestion: `${SECTION_LABELS[key]}는 원문 그대로 유지한다.`,
        }),
      )
    }
  }
  issues.push(
    ...evaluateMemoryConstraintViolations({
      original,
      candidate,
      request,
      targetSections,
      copilotMemory,
    }),
  )

  const feedbackText = [
    feedback?.summary,
    feedback?.detail,
    ...(Array.isArray(feedback?.issues) ? feedback.issues : []),
    ...(Array.isArray(feedback?.recommendations) ? feedback.recommendations : []),
    request,
    Object.values(original).join('\n'),
  ].join('\n')
  const unexpectedNumbers = findUnexpectedNumbers(candidate, feedbackText)
  for (const number of unexpectedNumbers.slice(0, 4)) {
    issues.push(
      createQaIssue({
        type: 'unsupported_number',
        severity: 'high',
        section: 'all',
        text: number,
        reason: '원문/피드백/요청에 없는 수치가 새로 생성되었다.',
        suggestion: '근거 없는 수치, 성과, 기간, 가격은 제거한다.',
      }),
    )
  }

  const candidateText = Object.values(candidate).join('\n')
  const forbiddenPhrases = uniqueCompactList(forbiddenSurfacePhrases, 24)
  for (const phrase of forbiddenPhrases) {
    if (textIncludesLoosePhrase(candidateText, phrase)) {
      issues.push(
        createQaIssue({
          type: 'forbidden_phrase_leakage',
          severity: 'high',
          section: 'all',
          text: phrase,
          reason: '사용자 편집 지시문 표면 표현이 대본 문장에 섞였다.',
          suggestion: '편집 지시문 표현은 제거하고 새 주제/소재만 자연스럽게 반영한다.',
        }),
      )
    }
  }

  const oldSubjects = uniqueCompactList(oldSubjectToRemove, 8)
  if (oldSubjects.length && !allowComparisonWithOldSubject) {
    for (const subject of oldSubjects) {
      if (subjectLeakAllowedByNewSubject(subject, newSubject)) {
        continue
      }
      if (textIncludesLoosePhrase(candidateText, subject)) {
        issues.push(
          createQaIssue({
            type: 'old_subject_leakage',
            severity: 'high',
            section: 'all',
            text: subject,
            reason: '새 주제로 바꾸는 요청에서 제거해야 할 기존 소재가 대본에 남았다.',
            suggestion: `기존 소재 "${subject}"는 제거하고 "${newSubject || '새 주제'}" 중심으로 다시 정리한다.`,
          }),
        )
      }
    }
  }
  if (
    oldSubjects.length &&
    qaMode === COPILOT_QA_MODES.REFRAME_TOPIC &&
    !allowComparisonWithOldSubject &&
    /말고|대신|빼고|버리고|제외하고/i.test(candidateText)
  ) {
    issues.push(
      createQaIssue({
        type: 'instruction_leakage',
        severity: 'medium',
        section: 'all',
        reason: '편집 지시처럼 보이는 전환 표현이 대본에 남았다.',
        suggestion: '사용자 지시문을 설명하지 말고 새 주제 기준의 자연스러운 대본 문장으로 바꾼다.',
      }),
    )
  }

  if (qaMode === COPILOT_QA_MODES.REFRAME_TOPIC && newSubject) {
    const subjectTokens = tokenizeForRequestMatch(newSubject)
    const matched = subjectTokens.some((token) => candidateText.includes(token))
    if (!matched) {
      issues.push(
        createQaIssue({
          type: 'new_subject_missing',
          severity: 'high',
          section: 'all',
          text: newSubject,
          reason: '사용자가 명시한 새 주제가 수정본에 충분히 반영되지 않았다.',
          suggestion: `대본을 "${newSubject}" 중심으로 다시 맞춘다.`,
        }),
      )
    }
  }

  const materialTokens = uniqueCompactList(requestedMaterials, 8)
  if ((qaMode === COPILOT_QA_MODES.INSERT_MATERIAL || materialTokens.length) && materialTokens.length) {
    const targetText = targetSections.map((section) => candidate[section]).join('\n')
    for (const material of materialTokens) {
      const tokens = tokenizeForRequestMatch(material)
      const matched = tokens.some((token) => targetText.includes(token))
      if (!matched) {
        issues.push(
          createQaIssue({
            type: 'requested_material_missing',
            severity: 'high',
            section: targetSections.length === 1 ? targetSections[0] : 'all',
            text: material,
            reason: '사용자가 넣으라고 한 소재가 수정 대상 섹션에 반영되지 않았다.',
            suggestion: `요청 소재 "${material}"을 자연스럽게 포함한다.`,
          }),
        )
      }
    }
  }

  if (qaMode === COPILOT_QA_MODES.DURATION_COMPRESS) {
    const incompleteSentences = findIncompleteCompressedSentences(candidate)
    for (const item of incompleteSentences) {
      issues.push(
        createQaIssue({
          type: 'incomplete_compressed_sentence',
          severity: 'medium',
          section: item.section,
          text: item.text,
          reason: '시간 압축 과정에서 문장이 너무 잘려 맥락이나 서술어가 부족하다.',
          suggestion: '글자 수를 크게 늘리지 말고, 짧아도 자연스럽게 완결된 문장으로 다시 잇는다.',
        }),
      )
    }

    const range = targetCharRange || buildDurationCharRange(targetDurationSeconds || extractTargetDurationSeconds(request))
    if (range) {
      const characterCount = countSectionSpeechCharacters(candidate)
      if (characterCount > Math.round(range.max * 1.2)) {
        issues.push(
          createQaIssue({
            type: 'duration_range_miss',
            severity: 'medium',
            section: 'all',
            text: `${characterCount}자`,
            reason: `목표 초수에 비해 압축본이 아직 길다. 목표는 공백 제외 약 ${range.min}-${range.max}자다.`,
            suggestion: '중복 설명과 부연 설명을 더 줄이되 HOOK/BODY/CTA와 CTA 의도는 유지한다.',
          }),
        )
      }
      if (characterCount < Math.round(range.min * 0.65)) {
        issues.push(
          createQaIssue({
            type: 'core_message_loss',
            severity: 'medium',
            section: 'all',
            text: `${characterCount}자`,
            reason: '목표보다 지나치게 짧아 핵심 메시지가 손실됐을 가능성이 있다.',
            suggestion: '핵심 메시지와 CTA 의도를 유지할 만큼만 문장을 보강한다.',
          }),
        )
      }
    }
  }

  const issueTypes = issues.map((issue) => issue.type)

  return {
    ok: !qaShouldRepair(issues),
    shouldRepair: qaShouldRepair(issues),
    issues,
    issueTypes,
  }
}

export function buildPartialSafeFeedbackApplyFallback({
  originalSections,
  candidateSources = [],
  editTarget = 'all',
  feedback = {},
  request = '',
  qaMode = COPILOT_QA_MODES.PRESERVE_TOPIC,
  newSubject = '',
  requestedMaterials = [],
  oldSubjectToRemove = [],
  forbiddenSurfacePhrases = [],
  allowComparisonWithOldSubject = false,
  editPlan = null,
  copilotMemory = {},
  targetSections: plannedTargetSections = null,
  targetDurationSeconds = null,
  targetCharRange = null,
} = {}) {
  const original = normalizeSections(originalSections)
  const targetSections = Array.isArray(plannedTargetSections) && plannedTargetSections.length
    ? plannedTargetSections.filter((section) => SECTION_KEYS.includes(section))
    : getTargetSections(normalizeEditTarget(editTarget, request))
  let partialSections = { ...original }
  const changedSections = []
  const fallbackIssues = []

  for (const source of Array.isArray(candidateSources) ? candidateSources : []) {
    const sourceName = source?.source || source?.name || 'candidate'
    const candidate = normalizeSections(source?.sections || source?.candidateSections || source)

    for (const section of targetSections) {
      if (changedSections.includes(section)) {
        continue
      }
      if (!String(candidate[section] || '').trim() || candidate[section] === original[section]) {
        continue
      }

      const trialSections = {
        ...partialSections,
        [section]: candidate[section],
      }
      const trialChangedSections = SECTION_KEYS.filter((key) => trialSections[key] !== original[key])
      const trialCheck = runFeedbackFallbackRuleCheck({
        originalSections: original,
        candidateSections: trialSections,
        editTarget: trialChangedSections.length === SECTION_KEYS.length ? 'all' : section,
        feedback,
        request,
        qaMode,
        newSubject,
        requestedMaterials,
        oldSubjectToRemove,
        forbiddenSurfacePhrases,
        allowComparisonWithOldSubject,
        editPlan,
        targetSections: trialChangedSections,
        targetDurationSeconds,
        targetCharRange,
        copilotMemory,
      })

      if (trialCheck.shouldRepair) {
        fallbackIssues.push(
          ...trialCheck.issues.map((issue) => ({
            ...issue,
            fallbackSource: sourceName,
            fallbackSection: section,
          })),
        )
        continue
      }

      partialSections = trialSections
      changedSections.push(section)
    }
  }

  if (!changedSections.length) {
    return {
      success: false,
      sections: original,
      changedSections: [],
      fallbackType: 'original',
      issueTypes: [...new Set(fallbackIssues.map((issue) => issue.type))],
      issues: fallbackIssues,
    }
  }

  return {
    success: true,
    sections: partialSections,
    changedSections,
    fallbackType: 'partial_safe_apply',
    issueTypes: [...new Set(fallbackIssues.map((issue) => issue.type))],
    issues: fallbackIssues,
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

function createFallbackIntent(message = '', editTarget = '') {
  const text = String(message || '').trim()
  const compact = text.replace(/\s+/g, '').toLowerCase()
  const normalizedEditTarget = normalizeEditTarget(editTarget, text)

  if (!compact) {
    return {
      intent: 'clarification',
      editTarget: null,
      shouldModifyScript: false,
      reply: '수정할 내용을 입력해주세요. 예: "HOOK을 더 강하게 바꿔줘"처럼 요청하시면 됩니다.',
    }
  }

  const minimalGreetings = ['ㅎㅇ', '하이', '안녕', 'hi', 'hello']
  const hasEditOrFeedbackSignal = /(수정|바꿔|변경|고쳐|다듬|줄여|늘려|강하게|약하게|자연스럽게|존댓말|존대|반말|해요체|말투|어미|넣어|살려|hook|body|cta|훅|바디|본문|마무리|도입|문장|톤|느낌|감정선|스토리|서사|다시|피드백|점수|평가|검토)/i.test(text)
  if (minimalGreetings.includes(compact) || (compact.length <= 3 && !hasEditOrFeedbackSignal)) {
    return {
      intent: 'greeting',
      editTarget: null,
      shouldModifyScript: false,
      reply: '안녕하세요 :) 어떤 부분을 도와드릴까요? HOOK, BODY, CTA 중 하나를 골라서 요청해주시면 바로 도와드릴게요.',
    }
  }

  if (/점수|평가|피드백\s*(생성|받|리포트)|검토\s*리포트/i.test(text)) {
    return {
      intent: 'feedback_request',
      editTarget: null,
      shouldModifyScript: false,
      reply: '',
    }
  }

  if (/(수정해|수정해줘|바꿔|바꿔줘|변경해|변경해줘|고쳐|고쳐줘|다듬어|다듬어줘|줄여|줄여줘|늘려|늘려줘|넣어|넣어줘|살려|살려줘|짜줘|짜줄래|더\s*좋게|존댓말|존대|반말|해요체|하십시오체|말투|어미|광고\s*같지\s*않게|판매\s*같지\s*않게|후킹감\s*있게|강하게\s*(해|바꿔|수정)|약하게\s*(해|바꿔|수정)|자연스럽게\s*(해|바꿔|수정)|감정선\s*(넣|살려|보강)|스토리처럼|서사(?:로|처럼)|브이로그처럼|실패담처럼|고객\s*사례처럼|다시\s*(짜|써|작성|수정))/i.test(text)) {
    const parsedInstruction = parseEditInstruction(text)
    const operationType =
      parsedInstruction.operationType && parsedInstruction.operationType !== COPILOT_OPERATION_TYPES.UNKNOWN
        ? parsedInstruction.operationType
        : COPILOT_OPERATION_TYPES.EDIT_PARTIAL
    return {
      intent: 'edit_request',
      editTarget: normalizedEditTarget,
      shouldModifyScript: true,
      operationType,
      newSubject: operationType === COPILOT_OPERATION_TYPES.TOPIC_REFRAME ? parsedInstruction.newSubject : '',
      requestedMaterials: parsedInstruction.requestedMaterials || [],
      oldSubjectToRemove: parsedInstruction.oldSubjectToRemove || [],
      forbiddenSurfacePhrases: parsedInstruction.forbiddenSurfacePhrases || [],
      salesContext: parsedInstruction.salesContext || '',
      toneHint: parsedInstruction.toneHint || '',
      structuredEditInstruction: parsedInstruction,
      reply: '',
    }
  }

  if (/(비교|compare|차이|뭐가\s*더\s*나아|어느\s*쪽)/i.test(text)) {
    return {
      intent: 'compare_versions',
      editTarget: null,
      shouldModifyScript: false,
      reply: '현재 초안과 대화 흐름을 기준으로 비교해드릴게요. 어떤 버전끼리 비교할지 알려주시면 더 정확합니다.',
    }
  }

  if (/(어때|어떤가|괜찮|약한가|약해|별로|뭐가\s*문제|문제야|피드백|조언|올려도|업로드해도|이대로|봐줘|검토|진단|판단|반응\s*올|반응\s*나|안\s*끌리|왜\s*안|광고\s*같|판매\s*같|상업적|부담스러|아까\s*버전|이전\s*버전|이\s*느낌\s*좋)/i.test(text)) {
    return {
      intent: 'advise_script',
      editTarget: null,
      shouldModifyScript: false,
      reply: '',
    }
  }

  if (/(설명|왜|이유|해석|풀어서)/i.test(text)) {
    return {
      intent: 'explain_script',
      editTarget: null,
      shouldModifyScript: false,
      reply: '현재 초안의 구조와 문장 역할을 기준으로 설명해드릴게요. 궁금한 섹션을 같이 알려주시면 더 정확합니다.',
    }
  }

  if (/(아이디어|브레인스토밍|여러\s*개|옵션|방향\s*추천)/i.test(text)) {
    return {
      intent: 'brainstorm_options',
      editTarget: null,
      shouldModifyScript: false,
      reply: '좋습니다. 바로 수정하기보다 가능한 방향을 몇 가지로 나눠서 제안드릴게요.',
    }
  }

  return null
}

function shouldUseSemanticInstructionExtractor(message = '', fallbackIntent = null) {
  const text = String(message || '').trim()
  if (!text || fallbackIntent?.intent !== 'edit_request') {
    return false
  }

  if (extractTargetDurationSeconds(text)) {
    return false
  }

  const compact = text.replace(/\s+/g, '')
  const hasComplexReframeSignal =
    /(주제|소재|방향).{0,24}(바꿔|바꾸|변경|다시|가자)|(?:말고|대신|빼고|버리고|제외하고)|(?:으로|로).{0,20}(바꿔|바꾸|변경|다시|가자)/i.test(
      text,
    )
  const hasMaterialOrContextSignal =
    /(남편|아이|가족|육아맘|상황|느낌|공구|공동구매|만족도|전자레인지|에어프라이|냉동실|꺼내|바로|상담|구매|링크|모집)/i.test(
      text,
    )
  const hasMultiSentence = /[?.!。]\s*\S/.test(text) || text.split(/\s+/g).length >= 10

  return hasComplexReframeSignal || (hasMultiSentence && hasMaterialOrContextSignal) || compact.length >= 45
}

async function extractCopilotInstructionWithLLM({
  openai,
  model,
  message = '',
  sections,
  editTarget = '',
}) {
  const normalizedSections = normalizeSections(sections)
  const normalizedMessage = String(message || '').trim()
  if (!normalizedMessage) {
    return null
  }

  const response = await openai.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: [
          '당신은 HookAI 코파일럿 사용자 요청을 구조화된 편집 명령으로 정규화하는 파서다.',
          '대본을 작성하지 않는다. 사용자 문장을 대본에 넣을 문장으로 보지 말고, 편집 의도/새 주제/삭제할 기존 소재/삽입할 상황 힌트로 분리한다.',
          '출력은 JSON만 반환한다.',
          'operationType은 topic_reframe, insert_material, duration_compress, tone_adjust, framing_rewrite, partial_rewrite, edit_partial, unknown 중 하나다.',
          'topic_reframe: 사용자가 새 주제/상품/소재로 바꾸려는 요청이다. 예: "삼겹살로 주제 바꿔줘", "물광토너 주제로", "만두말고 치킨너겟으로".',
          'insert_material: 기존 대본에 특정 소재를 추가하는 요청이다. 예: "BODY에 손씻기 넣어줘".',
          'tone_adjust: 주제는 유지하고 말투/광고감/자연스러움만 바꾸는 요청이다.',
          'framing_rewrite: 주제/상품은 유지하고 불편함→해소감, 문제→해결, 공감 관점 같은 전개 방식만 바꾸는 요청이다.',
          'partial_rewrite/edit_partial: 특정 섹션이나 일부 표현만 수정하는 요청이다.',
          '"존댓말", "반말", "해요체", "하십시오체", "말투", "어미", "톤"은 절대 newSubject가 아니다. 이런 요청은 tone_adjust다.',
          '"불편함에서 해소되는 느낌", "문제가 해결되는 흐름", "공감되는 관점"처럼 전개/감정 효과를 말하는 표현은 절대 newSubject가 아니다. 이런 요청은 framing_rewrite다.',
          '사용자 요청의 raw 표현은 대본 문장에 복사할 표현이 아니다. "만두말고" 같은 표현은 forbiddenSurfacePhrases에 넣는다.',
          'newSubject는 최종 중심 주제/상품만 짧게 추출한다. 예: "간편 냉동볶음밥", "삼겹살", "치킨너겟".',
          'requestedMaterials는 대본에 그대로 복사할 문장이 아니라 반영할 상황/소재 힌트다.',
          'salesContext는 공구/상담/구매링크/모집 같은 판매 맥락만 짧게 추출한다.',
          'toneHint는 가족 생활 공감형, 자연스럽고 말하듯이, 공구 느낌처럼 톤 방향만 적는다.',
          '비교 요청이면 allowComparisonWithOldSubject=true다. 아니면 oldSubjectToRemove는 대본에 남기지 않는 소재다.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `현재 선택 UI editTarget: ${editTarget || 'all'}`,
          `사용자 요청: ${normalizedMessage}`,
          '',
          '[현재 초안 일부]',
          `HOOK: ${normalizedSections.hook.slice(0, 160) || '-'}`,
          `BODY: ${normalizedSections.body.slice(0, 220) || '-'}`,
          `CTA: ${normalizedSections.cta.slice(0, 140) || '-'}`,
          '',
          'JSON 형식:',
          '{"operationType":"topic_reframe|insert_material|duration_compress|tone_adjust|framing_rewrite|partial_rewrite|edit_partial|unknown","newSubject":"","oldSubjectToRemove":[],"forbiddenSurfacePhrases":[],"requestedMaterials":[],"salesContext":"","toneHint":"","explicitKeep":[],"explicitRemove":[],"allowComparisonWithOldSubject":false,"targetDurationSeconds":null,"confidence":0,"reason":""}',
        ].join('\n'),
      },
    ],
  })

  logAIUsage('copilot-instruction-extract', response, {
    model,
  })

  const parsed = parseModelJson(response.choices[0]?.message?.content || '')
  const instruction = normalizeSemanticEditInstruction(parsed, normalizedMessage)
  return {
    ...instruction,
    targetDurationSeconds:
      normalizeTargetDurationSeconds(parsed.targetDurationSeconds) || extractTargetDurationSeconds(normalizedMessage),
  }
}

export async function classifyCopilotIntent({
  message,
  sections,
  editTarget = '',
  characterSystemPrompt = '',
  personalizationContext = '',
  targetDurationSeconds = null,
  previousAdvice = null,
}) {
  const normalizedPreviousAdvice = normalizePreviousAdvice(previousAdvice)
  if (isApplyPreviousAdviceRequest(message)) {
    if (isPreviousAdviceFresh(normalizedPreviousAdvice)) {
      return {
        intent: COPILOT_INTENTS.APPLY_PREVIOUS_ADVICE,
        editTarget: previousAdviceTargetToEditTarget(normalizedPreviousAdvice, editTarget || 'all'),
        shouldModifyScript: true,
        operationType: COPILOT_OPERATION_TYPES.PARTIAL_REWRITE,
        previousAdvice: normalizedPreviousAdvice,
        newSubject: '',
        requestedMaterials: [],
        reply: '',
        reason: '사용자가 직전 코파일럿 조언을 실제 수정으로 반영해달라고 요청함',
      }
    }

    return {
      intent: 'clarification',
      editTarget: null,
      shouldModifyScript: false,
      reply: '방금 적용할 수정 방향을 찾지 못했어요. 어떤 방향으로 고칠지만 한 번 더 말해주시면 바로 수정해드릴게요.',
      reason: '직전 조언 실행 요청이지만 사용할 수 있는 previousAdvice가 없음',
    }
  }

  const durationIntent = classifyCopilotIntentByRule(message, editTarget, { targetDurationSeconds })
  if (durationIntent.operationType === COPILOT_OPERATION_TYPES.DURATION_COMPRESS) {
    return {
      intent: 'edit_request',
      editTarget: 'all',
      shouldModifyScript: true,
      operationType: COPILOT_OPERATION_TYPES.DURATION_COMPRESS,
      targetDurationSeconds: durationIntent.targetDurationSeconds,
      newSubject: '',
      requestedMaterials: [],
      reply: '',
      reason: durationIntent.reason,
    }
  }

  const fallback = createFallbackIntent(message, editTarget)
  const normalizedMessage = String(message || '').trim()
  const normalizedSections = normalizeSections(sections)

  if (
    fallback?.intent === 'edit_request' &&
    shouldUseSemanticInstructionExtractor(normalizedMessage, fallback) &&
    hasOpenAIConfig()
  ) {
    const { openai, models } = requireClients()
    try {
      const semanticInstruction = await extractCopilotInstructionWithLLM({
        openai,
        model: models.chatModel,
        message: normalizedMessage,
        sections: normalizedSections,
        editTarget,
      })
      if (semanticInstruction?.operationType && semanticInstruction.operationType !== COPILOT_OPERATION_TYPES.UNKNOWN) {
        const targetDuration =
          normalizeTargetDurationSeconds(semanticInstruction.targetDurationSeconds) ||
          normalizeTargetDurationSeconds(targetDurationSeconds)
        const operationType =
          semanticInstruction.operationType === COPILOT_OPERATION_TYPES.DURATION_COMPRESS && !targetDuration
            ? COPILOT_OPERATION_TYPES.EDIT_PARTIAL
            : semanticInstruction.operationType
        return {
          intent: 'edit_request',
          editTarget: operationType === COPILOT_OPERATION_TYPES.DURATION_COMPRESS
            ? 'all'
            : normalizeEditTarget(editTarget, normalizedMessage),
          shouldModifyScript: true,
          operationType,
          targetDurationSeconds: operationType === COPILOT_OPERATION_TYPES.DURATION_COMPRESS ? targetDuration : null,
          newSubject: operationType === COPILOT_OPERATION_TYPES.TOPIC_REFRAME ? semanticInstruction.newSubject : '',
          requestedMaterials: semanticInstruction.requestedMaterials || [],
          oldSubjectToRemove: semanticInstruction.oldSubjectToRemove || [],
          forbiddenSurfacePhrases: semanticInstruction.forbiddenSurfacePhrases || [],
          salesContext: semanticInstruction.salesContext || '',
          toneHint: semanticInstruction.toneHint || '',
          explicitKeep: semanticInstruction.explicitKeep || [],
          explicitRemove: semanticInstruction.explicitRemove || [],
          allowComparisonWithOldSubject: Boolean(semanticInstruction.allowComparisonWithOldSubject),
          structuredEditInstruction: semanticInstruction,
          reply: '',
          reason: semanticInstruction.reason || '복합 수정 요청을 의미 기반 편집 명령으로 정규화함',
        }
      }
    } catch (error) {
      logAIError('gpt', error, {
        stage: 'copilot-instruction-extract',
        message: normalizedMessage,
        model: models.chatModel,
      })
    }
  }

  if (fallback) {
    return fallback
  }

  if (!hasOpenAIConfig()) {
    return {
      intent: 'clarification',
      editTarget: null,
      shouldModifyScript: false,
      reply: '수정 의도를 정확히 판단하지 못했습니다. 바꾸고 싶은 섹션과 방향을 조금 더 구체적으로 알려주세요.',
    }
  }

  const { openai, models } = requireClients()

  try {
    const response = await openai.chat.completions.create({
      model: models.chatModel,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: [
            '당신은 HookAI 코파일럿 입력 의도 분류기다. 출력은 JSON만 반환한다.',
            '사용자 메시지가 대본 수정을 원하는지, 피드백을 원하는지, 질문/인사/불명확한 요청인지 분류한다.',
            '대본을 직접 수정하지 않는다. 수정이 필요할 때도 intent만 반환한다.',
            '수정 요청이면 operationType도 분류한다: edit_partial=기존 주제 유지 일부 개선, topic_reframe=새 주제로 재구성, insert_material=특정 소재 삽입, duration_compress=목표 초수에 맞춘 삭제 중심 압축, framing_rewrite=주제 유지 후 전개/감정 흐름 조정.',
            '사용자가 "30초로 압축", "45초 안에 말하게", "N초로 줄여줘"처럼 목표 초수를 말하면 duration_compress이고 targetDurationSeconds를 추출한다.',
            '사용자가 "주제를 ~로", "~로 바꿔줘", "~소재로 다시"처럼 새 주제를 명시하면 topic_reframe이고 newSubject를 추출한다.',
            '사용자가 "BODY에 ~ 넣어줘", "~도 포함해줘"처럼 소재 추가를 요청하면 insert_material이고 requestedMaterials를 추출한다.',
            '사용자가 "존댓말로", "반말 말고", "해요체로", "말투를"처럼 말투/어미를 요청하면 topic_reframe이 아니라 tone_adjust다. 이 단어들은 newSubject로 추출하지 않는다.',
            '사용자가 "불편함에서 해소되는 느낌", "문제가 해결되는 흐름", "공감되는 관점"처럼 전개/감정 효과를 요청하면 topic_reframe이 아니라 framing_rewrite다. "해소되는 느낌"은 newSubject가 아니다.',
            'topic_reframe에도 requestedMaterials가 함께 있을 수 있다. 예: "여름철 감염 예방법으로 손씻기, 물 자주 마시기 넣어줘".',
            'intent는 greeting, edit_request, feedback_request, advise_script, explain_script, compare_versions, brainstorm_options, question, clarification 중 하나만 사용한다.',
            'edit_request일 때만 shouldModifyScript=true다.',
            'feedback_request는 피드백 실행 대상이므로 shouldModifyScript=false다.',
            'advise_script는 말로만 조언/진단하는 요청이므로 shouldModifyScript=false다.',
            '"어때?", "조언해줘", "이대로 올려도 돼?", "뭐가 문제야?", "이거 반응 올까?", "왜 안 끌리지?"는 advise_script다.',
            '"광고 같지 않게 바꿔줘", "후킹감 있게 해줘"처럼 수정 의도가 명확하면 edit_request다.',
            '"문제점 보고 고쳐줘", "뭔가 별로야 고쳐줘", "살려줘"처럼 진단과 수정이 함께 필요해도 edit_request다.',
            'explain_script, compare_versions, brainstorm_options는 아직 수정하지 않는 말로만 답하는 요청이며 shouldModifyScript=false다.',
            '질문/인사/불명확한 요청이면 reply에 자연스러운 한국어 답변을 작성한다.',
            'reply는 짧게, 다음 행동이 분명하게 작성한다.',
            characterSystemPrompt ? `계정/캐릭터 규칙:\n${characterSystemPrompt}` : null,
            personalizationContext ? `개인화 메모리:\n${personalizationContext}` : null,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
        {
          role: 'user',
          content: [
            `현재 선택 UI editTarget: ${editTarget || 'all'}`,
            `사용자 메시지: ${normalizedMessage}`,
            '',
            '[현재 초안 요약]',
            `HOOK: ${normalizedSections.hook.slice(0, 180) || '-'}`,
            `BODY: ${normalizedSections.body.slice(0, 220) || '-'}`,
            `CTA: ${normalizedSections.cta.slice(0, 160) || '-'}`,
            '',
            'JSON 형식:',
            '{"intent":"greeting|edit_request|feedback_request|advise_script|explain_script|compare_versions|brainstorm_options|question|clarification","editTarget":"all|hook|body|cta|null","operationType":"edit_partial|topic_reframe|insert_material|duration_compress|framing_rewrite|null","targetDurationSeconds":null,"newSubject":"","requestedMaterials":[],"shouldModifyScript":false,"reply":"","reason":""}',
          ].join('\n'),
        },
      ],
    })

    logAIUsage('copilot-intent', response, {
      model: models.chatModel,
    })

    const parsed = parseModelJson(response.choices[0]?.message?.content || '')
    const allowedIntents = new Set([
      'greeting',
      'edit_request',
      'feedback_request',
      'advise_script',
      'explain_script',
      'compare_versions',
      'brainstorm_options',
      'question',
      'clarification',
    ])
    const intent = allowedIntents.has(parsed.intent) ? parsed.intent : 'clarification'
    const target = EDIT_TARGETS.has(String(parsed.editTarget || '').toLowerCase())
      ? String(parsed.editTarget).toLowerCase()
      : intent === 'edit_request'
        ? normalizeEditTarget(editTarget, normalizedMessage)
        : null
    const fallbackNewSubject = extractRequestedNewSubject(normalizedMessage)
    const fallbackMaterials = extractRequestedMaterials(normalizedMessage, fallbackNewSubject)
    const parsedTargetDurationSeconds =
      normalizeTargetDurationSeconds(parsed.targetDurationSeconds) || extractTargetDurationSeconds(normalizedMessage)
    let parsedOperationType = [
      COPILOT_OPERATION_TYPES.EDIT_PARTIAL,
      COPILOT_OPERATION_TYPES.TOPIC_REFRAME,
      COPILOT_OPERATION_TYPES.INSERT_MATERIAL,
      COPILOT_OPERATION_TYPES.DURATION_COMPRESS,
      COPILOT_OPERATION_TYPES.TONE_ADJUST,
      COPILOT_OPERATION_TYPES.FRAMING_REWRITE,
      COPILOT_OPERATION_TYPES.PARTIAL_REWRITE,
    ].includes(parsed.operationType)
      ? parsed.operationType
      : fallbackNewSubject
        ? COPILOT_OPERATION_TYPES.TOPIC_REFRAME
        : fallbackMaterials.length
          ? COPILOT_OPERATION_TYPES.INSERT_MATERIAL
          : COPILOT_OPERATION_TYPES.EDIT_PARTIAL
    if (parsedOperationType === COPILOT_OPERATION_TYPES.DURATION_COMPRESS && !parsedTargetDurationSeconds) {
      parsedOperationType = COPILOT_OPERATION_TYPES.EDIT_PARTIAL
    }

    return {
      intent,
      editTarget: parsedOperationType === COPILOT_OPERATION_TYPES.DURATION_COMPRESS ? 'all' : target,
      shouldModifyScript: intent === 'edit_request' && Boolean(parsed.shouldModifyScript),
      operationType: intent === 'edit_request' ? parsedOperationType : null,
      targetDurationSeconds: intent === 'edit_request'
        ? parsedTargetDurationSeconds
        : null,
      newSubject: intent === 'edit_request' ? cleanRequestedPhrase(parsed.newSubject || fallbackNewSubject) : '',
      requestedMaterials: intent === 'edit_request'
        ? uniqueCompactList(
            Array.isArray(parsed.requestedMaterials)
              ? parsed.requestedMaterials.map((item) => cleanRequestedPhrase(item))
              : fallbackMaterials,
            8,
          )
        : [],
      reply: String(parsed.reply || '').trim() ||
        (intent === 'question'
          ? '좋은 질문입니다. 이 초안에서 어떤 부분을 더 보고 싶은지 알려주시면 기준을 잡아드릴게요.'
          : intent === 'clarification'
            ? '어떤 방향으로 바꾸고 싶으신가요? 예: 더 강하게, 더 짧게, 더 자연스럽게처럼 알려주세요.'
            : ''),
      reason: String(parsed.reason || '').trim(),
    }
  } catch (error) {
    logAIError('gpt', error, {
      stage: 'copilot-intent',
      message: normalizedMessage,
      model: models.chatModel,
    })

    return {
      intent: 'clarification',
      editTarget: null,
      shouldModifyScript: false,
      reply: '수정 의도를 정확히 판단하지 못했습니다. 바꾸고 싶은 섹션과 방향을 조금 더 구체적으로 알려주세요.',
    }
  }
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

function findSelectedVariation(reference = {}, selectedLabel = '') {
  const variations = Array.isArray(reference.variations) ? reference.variations : []
  if (!variations.length) return null
  const normalizedLabel = String(selectedLabel || '').trim()
  return (
    variations.find((variation) => String(variation?.label || '').trim() === normalizedLabel) ||
    variations[0] ||
    null
  )
}

function formatVariationBlueprintContext(variation = null) {
  const blueprint = variation?.structureBlueprint
  const sentenceBlueprint = Array.isArray(blueprint?.sentenceBlueprint)
    ? blueprint.sentenceBlueprint.slice(0, 12)
    : []
  const substitutionMap = Array.isArray(blueprint?.substitutionMap)
    ? blueprint.substitutionMap.slice(0, 8)
    : []
  const structureMatch = variation?.structureMatch

  if (!sentenceBlueprint.length && !substitutionMap.length && !structureMatch) {
    return ''
  }

  const sentenceLines = sentenceBlueprint.length
    ? sentenceBlueprint
        .map((item) => {
          const pieces = [
            item.length ? `길이=${item.length}` : null,
            item.rhythm ? `리듬=${item.rhythm}` : null,
            item.desireTrigger ? `욕구=${item.desireTrigger}` : null,
            item.keywordSlot ? `키워드슬롯=${item.keywordSlot}` : null,
          ]
            .filter(Boolean)
            .join(' / ')
          return `${item.order}. [${String(item.section || '').toUpperCase()}] ${item.role || '-'}${pieces ? ` (${pieces})` : ''}`
        })
        .join('\n')
    : '- 없음'

  const substitutionLines = substitutionMap.length
    ? substitutionMap
        .map((item, index) =>
          `${index + 1}. ${[item.slot, item.preserve, item.replaceWith].filter(Boolean).join(' / ')}`,
        )
        .join('\n')
    : '- 없음'

  return [
    '선택 초안의 문장 단위 구조 설계도(피드백/수정에서도 유지):',
    sentenceLines,
    '소재 치환표:',
    substitutionLines,
    structureMatch
      ? `최근 구조 유사도: ${structureMatch.score ?? '-'}점 · ${structureMatch.warnings?.join(', ') || '특이사항 없음'}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')
}

function buildReferenceStructureContext(reference, selectedLabel = '') {
  const frameNotes = (reference.frame_notes || [])
    .slice(0, 3)
    .map((frame) =>
      [frame.timestamp != null ? `${frame.timestamp}초` : null, frame.observation, frame.hookReason]
        .filter(Boolean)
        .join(' · '),
    )
    .join('\n')
  const selectedVariation = findSelectedVariation(reference, selectedLabel)
  const variationBlueprintContext = formatVariationBlueprintContext(selectedVariation)

  return [
    '레퍼런스 구조 참고(원문 내용/주제 복사 금지):',
    `- 현재 작업 주제: ${reference.topic || '-'}`,
    `- 구조 신호: ${compactReferenceSignal(reference.structure_analysis) || '-'}`,
    `- 후킹/리듬 신호: ${compactReferenceSignal(reference.hook_analysis) || '-'}`,
    `- 심리 기제 신호: ${compactReferenceSignal(reference.psychology_analysis) || '-'}`,
    `프레임 인사이트: ${frameNotes || '-'}`,
    `기존 AI 피드백: ${compactReferenceSignal(reference.ai_feedback) || '-'}`,
    variationBlueprintContext,
    '레퍼런스 전사: 제외됨(refine/feedback 단계에서는 reference transcript 전체를 포함하지 않음)',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildStructureDiagnosis(reference, selectedLabel = '', parsed = {}) {
  const selectedVariation = findSelectedVariation(reference, selectedLabel)
  const match = selectedVariation?.structureMatch || null
  const score = Number(match?.score)
  const referenceMatch = Number.isFinite(score) ? Math.round(score) : null
  const problems = Array.isArray(match?.warnings)
    ? match.warnings.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
    : []
  const fixes = []

  if (referenceMatch != null && referenceMatch < 70) {
    fixes.push('레퍼런스의 문장 역할 순서와 길이감을 더 강하게 유지해야 합니다.')
  }
  if (String(parsed?.detail || '').includes('CTA')) {
    fixes.push('CTA 위치와 행동 이유를 더 또렷하게 맞춥니다.')
  }
  if (String(parsed?.detail || '').includes('HOOK') || String(parsed?.summary || '').includes('훅')) {
    fixes.push('첫 문장에서 문제/욕구를 더 빨리 찌릅니다.')
  }

  return {
    referenceMatch,
    level: referenceMatch == null ? '미확인' : referenceMatch >= 78 ? '높음' : referenceMatch >= 62 ? '보통' : '낮음',
    problems,
    fixes: fixes.length ? Array.from(new Set(fixes)).slice(0, 4) : ['선택 초안의 구조 설계도를 유지하면서 표현만 보정합니다.'],
  }
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

function shouldUseHookTemplatesForRefine(request = '', targetSections = SECTION_KEYS) {
  const text = String(request || '').trim()
  if (!targetSections.includes('hook')) return false
  if (targetSections.length === 1) return true
  return /(hook|훅|후킹|첫문장|첫 문장|도입|오프닝|강하게|초반|이탈|조회수|시선|임팩트|궁금|긴장|반전)/i.test(text)
}

function buildCopilotHookTemplateQuery({ sections = {}, request = '', reference = {}, selectedLabel = '' } = {}) {
  const normalized = normalizeSections(sections)
  const selectedVariation = findSelectedVariation(reference, selectedLabel)
  const blueprint = selectedVariation?.structureBlueprint || {}

  return {
    topic: reference.topic || '',
    target: [
      `사용자 요청: ${request}`,
      normalized.hook ? `현재 HOOK: ${normalized.hook}` : '',
      normalized.body ? `현재 BODY 요약: ${normalized.body.slice(0, 220)}` : '',
      normalized.cta ? `현재 CTA 요약: ${normalized.cta.slice(0, 120)}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    category: '',
    purpose: '',
    hookAnalysis: reference.hook_analysis || '',
    structureBlueprint: blueprint,
    settingCues: [
      reference.structure_analysis,
      reference.psychology_analysis,
      ...(reference.frame_notes || []).map((frame) => frame?.hookReason || frame?.observation || ''),
    ],
  }
}

function buildCopilotHookTemplateContext(templates = []) {
  return [
    '코파일럿 hook_templates 참고(내부 보조 지식):',
    '- hook_templates는 현재 초안의 HOOK을 더 잘 고치기 위한 구조 참고용이다.',
    '- 현재 초안의 주제, 상품, 타겟, 레퍼런스 구조를 바꾸지 않는다.',
    '- template 원문, 예시 문장, 특유의 시작 표현을 복사하거나 패러프레이즈하지 않는다.',
    '- BODY/CTA만 수정하는 요청이면 HOOK을 바꾸지 않는다.',
    '- rewrite_rule, emotions, risk_note만 참고해 현재 초안에 맞는 새 표현으로 고친다.',
    '',
    '검색된 hook_templates:',
    formatHookTemplatesForPrompt(templates, 3),
  ].join('\n')
}

function shouldUseNarrativePatternsForRefine(request = '', targetSections = SECTION_KEYS) {
  const text = String(request || '').trim()
  const canAffectBody = targetSections.includes('body')
  if (!canAffectBody) return false

  return /(스토리처럼|스토리\s*느낌|서사(?:로|처럼|형)?|감정선|감정\s*흐름|공감(?:되게|형)?|사람\s*냄새|인간적으로|브이로그처럼|실패담(?:처럼)?|성장\s*과정|고객\s*사례|수강생\s*사례|경험담(?:처럼)?|비하인드|도전기)/i.test(text)
}

function buildCopilotNarrativePatternQuery({ sections = {}, request = '', reference = {}, selectedLabel = '' } = {}) {
  return {
    request,
    sections,
    reference,
    selectedLabel,
    settingCues: [
      reference.structure_analysis,
      reference.psychology_analysis,
      reference.ai_feedback,
      ...(reference.frame_notes || []).map((frame) => frame?.hookReason || frame?.observation || ''),
    ],
  }
}

function buildCopilotNarrativePatternContext(patterns = []) {
  return [
    '코파일럿 narrative_patterns 참고(명시 요청 시에만 사용하는 내부 보조 지식):',
    '- narrative_patterns는 대본을 스토리형으로 바꾸기 위한 템플릿이 아니다.',
    '- 사용자가 스토리/서사/감정선/브이로그/실패담/고객 사례처럼 명시적으로 요청했을 때만 BODY 흐름과 전체 감정 연결을 약하게 보강한다.',
    '- 현재 초안에 이미 있는 사실, 감정, 상황만 재배열하거나 연결한다.',
    '- 실제로 없는 실패, 손실, 고객, 수강생, 매출, 성과, 가족/지인 발언, 전문가 권위를 새로 만들지 않는다.',
    '- 정보형/튜토리얼형/혜택형 초안을 억지 감동 서사로 바꾸지 않는다.',
    '- HOOK/CTA만 수정하는 요청이면 narrative_patterns를 사용하지 않는다.',
    '- 아래 자료의 emotional_arc, body_flow_rule, rewrite_rule, avoid_when, risk_note만 참고한다. 원문 템플릿이나 예시 문장은 저장되어 있지 않다.',
    '',
    '검색된 narrative_patterns:',
    formatNarrativePatternsForPrompt(patterns, 2),
  ].join('\n')
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
    '- 레퍼런스의 문장별 역할, 길이감, 전개 순서, 심리 트리거는 유지하되 원문 문장/주제/업종/상품명/상황/고유명사/표면 단어는 가져오지 않는다.',
    '- 레퍼런스 내용을 패러프레이즈하지 않는다.',
    '- 표절 방지는 구조 삭제가 아니라 소재/상황/상품명/고유명사 치환으로 해결한다.',
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
  hookTemplateContext = '',
  narrativePatternContext = '',
  targetSections = SECTION_KEYS,
  responseMode = 'edit_only',
}) {
  const normalizedSections = normalizeSections(sections)
  const normalizedRequest = String(request || '').trim()
  const narrativeSectioningInstruction = buildNarrativeSectioningInstruction({
    request: normalizedRequest,
    targetSections,
    narrativePatternContext,
  })

  return (
    `${buildCopilotEvaluationRubric()}\n\n` +
    `${buildCopilotEditPlaybook(targetSections)}\n\n` +
    `${buildCopilotResponseModeRule(responseMode)}\n\n` +
    `${buildDraftBlock(normalizedSections)}\n\n` +
    `${buildEditScopeInstruction(targetSections)}\n\n` +
    `${buildEditOutputInstruction(targetSections)}\n\n` +
    `${narrativeSectioningInstruction ? `${narrativeSectioningInstruction}\n\n` : ''}` +
    `선택한 안: ${selectedLabel || '-'}\n\n` +
    `${referenceContext}\n\n` +
    `${hookTemplateContext ? `${hookTemplateContext}\n\n` : ''}` +
    `${narrativePatternContext ? `${narrativePatternContext}\n\n` : ''}` +
    `핵심 인사이트:\n${formatGuideList(guides?.insights || [])}\n\n` +
    `바로 써먹을 체크포인트:\n${formatGuideList(guides?.checkpoints || [])}\n\n` +
    `사용자 요청: ${normalizedRequest}\n\n` +
    '톤 개선 지침:\n' +
    '- 공통: 대화체, 짧은 문장, 추상 표현 금지\n' +
    '- HOOK: 평범한 질문형 금지, 첫 문장 긴장감\n' +
    '- BODY: 교과서 문장 금지, 상황/경험형 전개\n' +
    '- CTA: 이유가 있는 행동 유도, 뻔한 부탁형 금지\n\n' +
    'message 작성 지침:\n' +
    '- "요청을 반영해 정리했습니다" 같은 일반 요약 금지\n' +
    '- 평가 기준표를 근거로 약한 점을 짧게 진단한 뒤, 어떤 섹션을 어떤 식으로 바꿨는지 1~2문장으로 구체적으로 작성\n' +
    '- 예: "HOOK은 불편 상황을 바로 찌르는 식으로 바꾸고, CTA는 댓글 행동 유도로 정리했습니다."\n\n' +
    '위 출력 JSON 형식으로만 답하세요.'
  )
}

function buildFeedbackUserPrompt({
  sections,
  selectedLabel,
  referenceContext,
  guides,
  previousFeedback = null,
}) {
  const normalizedSections = normalizeSections(sections)
  const previousScore = Number(previousFeedback?.score)
  const hasPreviousFeedback = previousFeedback && typeof previousFeedback === 'object'
  const previousFeedbackContext = hasPreviousFeedback
    ? [
        '[이전 피드백 반영 후 재평가 컨텍스트]',
        Number.isFinite(previousScore) ? `이전 피드백 점수: ${previousScore}점` : '',
        `이전 피드백 요약: ${compactReferenceSignal(previousFeedback.summary || '', 600) || '-'}`,
        `이전 피드백 문제: ${compactReferenceSignal(normalizeFeedbackList(previousFeedback.issues, 6).join(' / '), 900) || '-'}`,
        `이전 피드백 수정 방향: ${compactReferenceSignal(normalizeFeedbackList(previousFeedback.recommendations, 6).join(' / '), 900) || '-'}`,
        '재평가 규칙:',
        '- 현재 초안은 위 피드백을 반영한 뒤의 대본일 수 있다.',
        '- 먼저 이전 피드백에서 지적한 문제가 해결됐는지 판단한다.',
        '- 이전 문제가 해결됐고 새 치명 문제가 없다면 점수를 이전보다 낮게 주지 않는다.',
        '- 이전보다 낮은 점수를 줄 때는 새로 생긴 명확한 퇴행/치명 문제를 summary/detail/issues에 구체적으로 설명한다.',
        '- 단순히 더 높은 기준을 갑자기 적용해 점수를 낮추지 않는다.',
      ].filter(Boolean).join('\n')
    : ''

  return (
    `${buildDraftBlock(normalizedSections)}\n\n` +
    `선택한 안: ${selectedLabel || '-'}\n\n` +
    `${referenceContext}\n\n` +
    (previousFeedbackContext ? `${previousFeedbackContext}\n\n` : '') +
    `${buildCopilotEvaluationRubric()}\n\n` +
    `${buildCopilotMentorToneGuide()}\n\n` +
    `핵심 인사이트:\n${formatGuideList(guides?.insights || [])}\n\n` +
    `바로 써먹을 체크포인트:\n${formatGuideList(guides?.checkpoints || [])}\n\n` +
    '피드백 오염 방지 규칙:\n' +
    '- 현재 제공된 HOOK/BODY/CTA에 없는 상품, 음식, 소재, 주제, 상황을 새로 만들지 않는다.\n' +
    '- 이전 대화에서 나온 주제나 수정 요청은 현재 초안에 직접 포함되어 있지 않으면 무시한다.\n' +
    '- suggestedSections는 현재 초안의 주제와 상품을 유지해야 하며 피드백 과정에서 다른 주제로 바꾸지 않는다.\n\n' +
    '다음 JSON 형식으로만 답하세요: ' +
    '{"score":82,"summary":"","detail":"","issues":[""],"recommendations":[""],"suggestedSections":{"hook":"","body":"","cta":""}}'
  )
}

function buildNaturalResponseUserPrompt({
  sections,
  request,
  selectedLabel,
  referenceContext,
  guides,
  intent = COPILOT_INTENTS.ADVISE,
}) {
  const normalizedSections = normalizeSections(sections)
  const normalizedRequest = String(request || '').trim()

  return (
    `${buildDraftBlock(normalizedSections)}\n\n` +
    `사용자 요청: ${normalizedRequest}\n\n` +
    `요청 의도: ${intent}\n` +
    `선택한 안: ${selectedLabel || '-'}\n\n` +
    `${referenceContext}\n\n` +
    `${buildCopilotEvaluationRubric()}\n\n` +
    `핵심 인사이트:\n${formatGuideList(guides?.insights || [])}\n\n` +
    `바로 써먹을 체크포인트:\n${formatGuideList(guides?.checkpoints || [])}\n\n` +
    '응답 규칙:\n' +
    '- 지금은 대본을 수정하지 않는다. HOOK/BODY/CTA 문장을 새로 쓰거나 출력하지 않는다.\n' +
    '- 사용자의 질문에 자연어로만 답한다.\n' +
    '- 조언/평가 요청이면 공감/확인 → 핵심 진단 1개 → 살릴 점 1개 → 아쉬운 점 1~2개 → 추천 수정 방향 → 원하면 수정 가능 안내 흐름으로 답한다.\n' +
    '- HOOK/BODY/CTA를 전부 나열하지 말고 가장 큰 병목부터 말한다.\n' +
    '- 점수는 사용자가 명시적으로 점수나 몇 점인지 물었을 때만 말한다.\n' +
    '- 무조건 칭찬하지 않는다. 약한 부분이 있으면 약하다고 말한다.\n' +
    '- 약점만 던지지 말고 바로 개선 방향을 붙인다.\n' +
    '- 애매한 요청이면 바로 수정하지 말고 병목 후보나 선택지를 제안한다.\n' +
    '- 내부 용어와 평가 기준표 이름을 사용자에게 노출하지 않는다.\n' +
    '- 현재 초안과 레퍼런스 구조를 기준으로 판단하되, 레퍼런스 원문 소재를 가져오지 않는다.\n' +
    '- 사용자가 명시적으로 고쳐달라고 하지 않았으므로 섹션 변경을 제안만 하고 실행하지 않는다.\n\n' +
    '수정 가능한 조언이면 actionableAdvice를 함께 작성한다. 단순 인사/일반 질문이면 actionableAdvice는 null이다.\n' +
    'actionableAdvice.instructions는 나중에 "그렇게 수정해줘"를 실행할 수 있을 정도로 구체적인 지시 배열이어야 한다.\n' +
    'actionableAdvice에는 사용자에게 보여줄 내부 용어를 넣지 않는다.\n\n' +
    '기본 JSON 형식은 {"message":""}이며, 실행 가능한 조언이 있을 때만 actionableAdvice를 추가한다.\n' +
    '다음 JSON 형식으로만 답하세요: {"message":"","actionableAdvice":{"diagnosis":"","editTarget":"hook|body|cta|body_cta|full","instructions":[""],"preserveSections":["hook"],"expectedOutcome":""}}'
  )
}

function buildFallbackNaturalResponse(sections = {}, intent = COPILOT_INTENTS.ADVISE) {
  const normalized = normalizeSections(sections)
  if (intent === COPILOT_INTENTS.GENERAL) {
    return '지금 초안을 기준으로 도와드릴 수 있어요. 조언을 원하면 어떤 부분이 고민인지 말해주시고, 수정이 필요하면 HOOK/BODY/CTA 중 어디를 바꿀지 알려주세요.'
  }

  const hookNote = normalized.hook
    ? '첫 문장에서 주제는 보이는데, 멈춰 보게 만드는 긴장감은 조금 더 선명하면 좋아요.'
    : '첫 문장이 비어 있어서 시청자 고민을 바로 찌르는 시작점이 필요해요.'
  const bodyNote = normalized.body
    ? '살릴 점은 내용 흐름이 있다는 거고, 가장 먼저 볼 부분은 첫 문장과 본문 연결입니다.'
    : '본문이 비어 있어서 문제 원인과 해결 기준을 짧게 이어줘야 해요.'
  const ctaNote = normalized.cta
    ? '원하면 전체를 갈아엎기보다 가장 약한 구간부터 바로 다듬어볼게요.'
    : '마무리가 비어 있어서 시청자가 지금 해야 할 행동을 한 문장으로 잡아줘야 해요.'

  return `그 느낌 이해돼요. ${hookNote} ${bodyNote} ${ctaNote}`
}

async function generateCopilotNaturalResponse({
  openai,
  model,
  accountId,
  referenceId,
  selectedLabel,
  request,
  sections,
  referenceContext,
  guides,
  characterSystemPrompt = '',
  personalizationContext = '',
  copilotMemory = {},
  intentResult,
}) {
  const normalizedSections = normalizeSections(sections)
  const copilotMemoryContext = formatCopilotMemoryForPrompt(copilotMemory)
  try {
    const response = await openai.chat.completions.create({
      model,
      temperature: 0.45,
      messages: [
        {
          role: 'system',
          content: [
            '당신은 숏폼 콘텐츠 코파일럿이다. 지금은 대본 수정기가 아니라 대본 코치로 답한다. 출력은 JSON만 반환한다.',
            buildContextPriority(),
            buildReferenceContaminationGuard(),
            '수정 금지: 사용자가 명시적으로 수정/고치기/바꾸기를 요청하지 않았으므로 HOOK/BODY/CTA를 변경하지 않는다.',
            buildCopilotEvaluationRubric(),
            buildCopilotMentorToneGuide(),
            '응답 규칙: 자연어로 짧게 진단한다. 좋은 점, 약한 점, 다음 개선 방향을 기준표에 맞춰 구체적으로 말한다.',
            '응답 규칙: "좋아요"만 말하지 않는다. 약한 점이 있으면 약하다고 말한다. 단, 대본을 새로 쓰거나 적용하지 않는다.',
            '응답 구조: 공감/확인 → 핵심 진단 → 살릴 점 → 아쉬운 점 → 방향 제안 → 원하면 수정 가능 안내 순서로 답한다.',
            '말투 규칙: 항상 존댓말(하십시오체/해요체)만 사용한다. 반말, 친구 말투, 명령형 반말 어미는 금지한다.',
            buildCharacterBoundary(accountId),
            characterSystemPrompt ? `캐릭터 고정 규칙:\n${characterSystemPrompt}` : null,
            personalizationContext
              ? `개인화 메모리 컨텍스트(반드시 반영):\n${personalizationContext}`
              : null,
            copilotMemoryContext || null,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
        {
          role: 'user',
          content: buildNaturalResponseUserPrompt({
            sections: normalizedSections,
            request,
            selectedLabel,
            referenceContext,
            guides,
            intent: intentResult.intent,
          }),
        },
      ],
    })
    logAIUsage('copilot-natural-response', response, {
      model,
      accountId,
      referenceId,
      selectedLabel: selectedLabel || '',
      copilotIntent: intentResult.intent,
    })
    const parsed = parseModelJson(response.choices[0]?.message?.content || '')
    const message = String(parsed?.message || '').trim() || buildFallbackNaturalResponse(normalizedSections, intentResult.intent)
    const actionableAdvice = normalizePreviousAdvice({
      ...(parsed?.actionableAdvice && typeof parsed.actionableAdvice === 'object' ? parsed.actionableAdvice : {}),
      sourceUserMessage: request,
      createdAt: new Date().toISOString(),
      messageTurnsSinceCreated: 0,
    })
    return {
      message,
      actionableAdvice,
    }
  } catch (error) {
    logAIError('gpt', error, {
      referenceId,
      request,
      stage: 'script-natural-response',
      model,
    })
    return {
      message: buildFallbackNaturalResponse(normalizedSections, intentResult.intent),
      actionableAdvice: null,
    }
  }
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
  copilotMemory = {},
  editPlan = null,
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
  const referenceContext = buildReferenceStructureContext(reference, selectedLabel)
  const guides = buildReferenceGuides(reference)
  const intentResult = classifyCopilotIntentByRule(normalizedRequest, editTarget)
  const copilotMemoryContext = formatCopilotMemoryForPrompt(copilotMemory)
  const editPlanContext = formatEditPlanForPrompt(editPlan)

  if (!intentResult.shouldEdit) {
    logPromptAssembly({
      stage: 'script-natural-response',
      referenceId,
      currentDraftId,
      currentVersionId,
      editTarget: 'none',
      memoryIncluded: Boolean(personalizationContext),
      copilotMemoryIncluded: Boolean(copilotMemoryContext),
      includedTranscript: false,
    })

    const copilotModel = models.copilotModel || models.chatModel
    const naturalResponse = await generateCopilotNaturalResponse({
      openai,
      model: copilotModel,
      accountId,
      referenceId,
      selectedLabel,
      request: normalizedRequest,
      sections: normalizedSections,
      referenceContext,
      guides,
      characterSystemPrompt,
      personalizationContext,
      copilotMemory,
      intentResult,
    })
    const message = naturalResponse.message

    return {
      message,
      actionableAdvice: naturalResponse.actionableAdvice,
      sections: normalizedSections,
      editTarget: 'none',
      changedSections: [],
      flowValidation: validateScriptFlow(normalizedSections),
      copilotIntent: intentResult.intent,
      responseMode: intentResult.responseMode,
    }
  }

  const normalizedEditTarget = normalizeEditTarget(intentResult.editTarget || editTarget, normalizedRequest)
  const targetSections =
    Array.isArray(editPlan?.targetSections) && editPlan.targetSections.length
      ? editPlan.targetSections.filter((key) => SECTION_KEYS.includes(key))
      : getTargetSections(normalizedEditTarget)
  let hookTemplateContext = ''
  let matchedHookTemplateKeys = []
  let narrativePatternContext = ''
  let matchedNarrativePatternKeys = []
  if (shouldUseHookTemplatesForRefine(normalizedRequest, targetSections)) {
    const hookTemplateRetrieval = await retrieveHookTemplates({
      ...buildCopilotHookTemplateQuery({
        sections: normalizedSections,
        request: normalizedRequest,
        reference,
        selectedLabel,
      }),
      topK: 3,
    })
    const templates = hookTemplateRetrieval.templates || []
    matchedHookTemplateKeys = templates.map((item) => item.hook_code).filter(Boolean)
    hookTemplateContext = buildCopilotHookTemplateContext(templates)
  }
  if (shouldUseNarrativePatternsForRefine(normalizedRequest, targetSections)) {
    const narrativePatternRetrieval = await retrieveNarrativePatterns({
      ...buildCopilotNarrativePatternQuery({
        sections: normalizedSections,
        request: normalizedRequest,
        reference,
        selectedLabel,
      }),
      topK: 2,
    })
    const patterns = narrativePatternRetrieval.patterns || []
    matchedNarrativePatternKeys = patterns.map((item) => item.narrative_code).filter(Boolean)
    narrativePatternContext = buildCopilotNarrativePatternContext(patterns)
  }
  logPromptAssembly({
    stage: 'script-refine',
    referenceId,
    currentDraftId,
    currentVersionId,
    editTarget: normalizedEditTarget,
    memoryIncluded: Boolean(personalizationContext),
    copilotMemoryIncluded: Boolean(copilotMemoryContext),
    includedTranscript: false,
  })

  try {
    const copilotModel = models.copilotModel || models.chatModel
    const response = await openai.chat.completions.create({
      model: copilotModel,
      temperature: 0.5,
      messages: [
        {
          role: 'system',
          content: [
            '당신은 숏폼 콘텐츠 편집 코파일럿이다. 사용자의 수정 요청을 반영해 현재 초안의 HOOK/BODY/CTA만 한국어로 다듬는다. 출력은 JSON만 반환한다.',
            buildContextPriority(),
            buildReferenceContaminationGuard(),
            buildCopilotEvaluationRubric(),
            buildCopilotMentorToneGuide(),
            buildCopilotEditPlaybook(targetSections),
            buildCopilotResponseModeRule(intentResult.responseMode),
            buildEditOutputInstruction(targetSections),
            '부분 수정 규칙: 사용자가 특정 섹션만 요청하면 그 섹션만 수정한다. 요청받지 않은 섹션은 원문 그대로 반환한다.',
            '부분 수정 규칙: BODY만 요청하면 HOOK과 CTA는 절대 바꾸지 않는다. HOOK만 요청하면 BODY와 CTA는 절대 바꾸지 않는다. CTA만 요청하면 HOOK과 BODY는 절대 바꾸지 않는다.',
            '문체 규칙: 설명형/교과서형 문장을 피하고 실제 사람이 말하듯 자연스럽게 쓴다. 문장은 짧게 끊고 리듬감을 만든다.',
            'HOOK 규칙: 첫 문장에서 긴장감, 반전, 궁금증을 만든다. "~하시나요?" 같은 평범한 질문은 금지한다.',
            hookTemplateContext
              ? 'hook_templates 규칙: 검색된 hook_template은 HOOK 수정 시 참고하는 후킹 구조 자료다. COPILOT_EDIT_PLAYBOOK을 대체하지 않으며, 템플릿 원문, 예시 문장, 특유의 시작 표현을 복사하지 않는다.'
              : null,
            narrativePatternContext
              ? 'narrative_patterns 규칙: 검색된 narrative_pattern은 사용자가 명시적으로 요청한 서사/감정선 보강에만 사용한다. 현재 초안에 없는 실패, 손실, 고객 사례, 수강생 성과, 매출, 가족/지인 발언, 전문가 권위는 절대 만들지 않는다.'
              : null,
            narrativePatternContext && targetSections.length === SECTION_KEYS.length
              ? '스토리형 전체 수정 규칙: 서사/감정선을 살려도 최종 출력은 반드시 HOOK/BODY/CTA 전체 JSON으로 나눈다. 긴 스토리 전체를 BODY 하나에 몰아넣지 않는다.'
              : null,
            'BODY 규칙: 상황으로 시작하고 한 문장씩 끊어 전개한다. "많은 사람들이 ~ 하지만" 같은 문장을 금지한다.',
            'CTA 규칙: 행동 이유(손해/이득/궁금증)를 포함해 짧고 강하게 마무리한다. "좋아요/팔로우 부탁" 문구는 금지한다.',
            '연결성 규칙: HOOK에서 던진 문제를 BODY 첫 문장에서 이어받고, CTA는 BODY 결론을 행동으로 전환한다.',
            '구조 보존 규칙: 선택 초안에 문장 단위 구조 설계도가 있으면 문장 역할 순서, 길이감, 심리 트리거, CTA 위치를 유지한 채 요청받은 표현만 바꾼다.',
            '구조 보존 규칙: 더 좋게 고치더라도 레퍼런스 구조에서 완전히 멀어지는 새 대본으로 재창작하지 않는다.',
            '아래 핵심 인사이트/체크포인트는 현재 초안의 주제와 충돌하지 않는 경우에만 구조 참고로 사용한다.',
            '말투 규칙: 항상 존댓말(하십시오체/해요체)만 사용한다. 반말, 친구 말투, 명령형 반말 어미는 금지한다.',
            'message 규칙: "요청을 반영했습니다", "다시 정리했습니다"처럼 뭉뚱그린 말은 금지한다. 기준표에 따른 짧은 진단과 무엇을 어떤 식으로 바꿨는지 구체적으로 말한다.',
            'message 예시: "HOOK은 첫 1초 긴장감이 약해서 문제를 더 앞에 세웠습니다. BODY는 전후 변화가 보이게 풀었습니다." 실제로 바꾼 섹션만 언급한다.',
            buildCharacterBoundary(accountId),
            characterSystemPrompt ? `캐릭터 고정 규칙:\n${characterSystemPrompt}` : null,
            personalizationContext
              ? `개인화 메모리 컨텍스트(반드시 반영):\n${personalizationContext}`
              : null,
            copilotMemoryContext || null,
            editPlanContext || null,
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
            hookTemplateContext,
            narrativePatternContext,
            targetSections,
            responseMode: intentResult.responseMode,
          }),
        },
      ],
    })
    logAIUsage('copilot-refine', response, {
      model: copilotModel,
      accountId,
      referenceId,
      selectedLabel: selectedLabel || '',
      matchedHookTemplateKeys,
      matchedNarrativePatternKeys,
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
      copilotMemoryIncluded: Boolean(copilotMemoryContext),
      includedTranscript: false,
    })
    const parsedMessage = parsed.message?.trim() || ''
    const fallbackMessage = buildFallbackRefineMessage(normalizedSections, nextSections)
    const rawMessage =
      parsedMessage &&
      !isGenericRefineMessage(parsedMessage) &&
      !messageMentionsLockedSections(parsedMessage, targetSections)
        ? parsedMessage
        : fallbackMessage

    return {
      message: sanitizeUserFacingCopilotMessage(rawMessage, {
        editPlan,
        responseMode: intentResult.responseMode,
        changedSections,
      }),
      sections: nextSections,
      editTarget: normalizedEditTarget,
      changedSections,
      flowValidation,
      copilotIntent: intentResult.intent,
      responseMode: intentResult.responseMode,
    }
  } catch (error) {
    logAIError('gpt', error, {
      referenceId,
      request: normalizedRequest,
      stage: 'script-refine',
      model: models.copilotModel || models.chatModel,
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
  previousFeedback = null,
}) {
  const normalizedSections = normalizeSections(sections)
  const { supabaseAdmin, openai, models } = requireClients()
  const reference = await loadReferenceContext(supabaseAdmin, accountId, referenceId)
  const referenceContext = buildReferenceStructureContext(reference, selectedLabel)
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
    const copilotModel = models.copilotModel || models.chatModel
    const response = await openai.chat.completions.create({
      model: copilotModel,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content: [
            '당신은 숏폼 콘텐츠 평가자다. 제공된 초안을 100점 만점으로 평가하고, 개선 포인트를 짧고 명확하게 제안한다. 출력은 JSON만 반환한다.',
            buildContextPriority(),
            buildReferenceContaminationGuard(),
            buildCopilotEvaluationRubric(),
            'suggestedSections는 반드시 현재 초안을 개선한 결과여야 한다. 레퍼런스 전사/원문 내용을 기준으로 재생성하지 않는다.',
            '피드백 기준: 현재 제공된 HOOK/BODY/CTA에 없는 상품, 음식, 소재, 주제, 상황을 새로 만들지 않는다.',
            '피드백 기준: 이전 대화에서 나온 주제나 수정 요청은 현재 초안에 직접 포함되어 있지 않으면 무시한다.',
            'suggestedSections를 작성할 때는 설명형/교과서형 문장을 피하고, 실제 사람이 말하는 톤으로 다시 써라.',
            'suggestedSections는 현재 초안의 주제와 상품을 유지해야 한다. 피드백 과정에서 다른 주제로 바꾸지 않는다.',
            'suggestedSections는 선택 초안의 문장 단위 구조 설계도, 길이감, 문장 역할 순서, 심리 트리거, CTA 위치를 가능한 한 유지한다.',
            '피드백 반영안이 레퍼런스 구조를 버리고 새 대본처럼 바뀌면 실패다.',
            'HOOK은 긴장감 있게, BODY는 상황/경험형으로, CTA는 행동 이유를 담아 짧고 강하게 제안하라.',
            '평가 시 반드시 평가 기준표의 5개 항목을 기준으로 점수를 판단한다.',
            previousFeedback && typeof previousFeedback === 'object'
              ? '재평가 기준: 이전 피드백 반영 후 재평가라면, 이전 피드백의 핵심 문제가 해결됐는지 먼저 확인한다. 해결됐고 새 치명 문제가 없다면 점수를 이전보다 낮게 주지 않는다. 낮게 줄 때는 새 퇴행 사유를 명확히 적는다.'
              : null,
            'summary/detail에는 좋은 점과 약한 점을 모두 담는다. 무조건 칭찬하지 않는다.',
            'issues에는 실제 수정으로 해결해야 할 핵심 문제를 섹션명과 함께 1~4개로 적는다. 예: "HOOK: 첫 문장에 타겟 고민이 늦게 나온다."',
            'recommendations에는 issues를 해결하기 위한 구체적인 수정 방향을 1~4개로 적는다.',
            'suggestedSections는 issues/recommendations에서 말한 문제를 실제로 해결한 결과여야 한다. 진단과 수정본이 따로 놀면 실패다.',
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
            previousFeedback,
          }),
        },
      ],
    })
    logAIUsage('copilot-feedback', response, {
      model: copilotModel,
      accountId,
      referenceId,
      selectedLabel: selectedLabel || '',
    })

    const parsed = parseModelJson(response.choices[0]?.message?.content || '')
    const structureDiagnosis = buildStructureDiagnosis(reference, selectedLabel, parsed)
    const issues = normalizeFeedbackList(parsed.issues)
    const recommendations = normalizeFeedbackList(parsed.recommendations)
    const summary = parsed.summary?.trim() || '전체 구조는 괜찮지만 더 압축할 여지가 있습니다.'
    const detail =
      parsed.detail?.trim() || 'HOOK, BODY, CTA의 역할을 더 또렷하게 나누면 성능이 좋아질 수 있습니다.'
    const scoreRecheck = stabilizeFeedbackScoreAfterApply({
      previousFeedback,
      parsedScore: parsed.score,
      summary,
      detail,
      issues,
      recommendations,
    })
    const score = scoreRecheck.score
    const suggestedSections = normalizeSections(parsed.suggestedSections)
    const verdict = buildFeedbackVerdict({
      score,
      sections: normalizedSections,
      issues,
      recommendations,
    })

    return {
      score,
      summary: scoreRecheck.recheck?.scoreAdjusted
        ? `이전 피드백 반영 후 다시 보면, 새로 생긴 치명 문제는 뚜렷하지 않습니다. ${summary}`
        : summary,
      detail,
      issues,
      recommendations,
      suggestedSections,
      verdict,
      structureDiagnosis,
      recheck: scoreRecheck.recheck,
    }
  } catch (error) {
    logAIError('gpt', error, {
      referenceId,
      stage: 'script-feedback',
      model: models.copilotModel || models.chatModel,
    })

    throw new AppError('Script feedback generation failed', {
      code: 'SCRIPT_FEEDBACK_FAILED',
      statusCode: 502,
      cause: error,
    })
  }
}

export async function validateRefinedScriptQuality({
  accountId,
  referenceId,
  selectedLabel,
  originalSections,
  proposedSections,
  request = '',
  editTarget = 'all',
  feedback = {},
  characterSystemPrompt = '',
  personalizationContext = '',
  qaMode = COPILOT_QA_MODES.PRESERVE_TOPIC,
  newSubject = '',
  requestedMaterials = [],
  oldSubjectToRemove = [],
  forbiddenSurfacePhrases = [],
  allowComparisonWithOldSubject = false,
  targetSections: plannedTargetSections = null,
  preserveSections = [],
  targetDurationSeconds = null,
  targetCharRange = null,
  editPlan = null,
  copilotMemory = {},
}) {
  const original = normalizeSections(originalSections)
  const proposed = normalizeSections(proposedSections)
  const ruleCheck = runFeedbackFallbackRuleCheck({
    originalSections: original,
    candidateSections: proposed,
    editTarget,
    feedback,
    request,
    qaMode,
    newSubject,
    requestedMaterials,
    oldSubjectToRemove,
    forbiddenSurfacePhrases,
    allowComparisonWithOldSubject,
    editPlan,
    targetSections: plannedTargetSections,
    targetDurationSeconds,
    targetCharRange,
    copilotMemory,
  })

  const { supabaseAdmin, openai, models } = requireClients()
  const reference = await loadReferenceContext(supabaseAdmin, accountId, referenceId)
  const referenceContext = buildReferenceStructureContext(reference, selectedLabel)
  const copilotModel = models.copilotModel || models.chatModel

  try {
    const response = await openai.chat.completions.create({
      model: copilotModel,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: [
            '당신은 숏폼 대본 수정본의 내부 QA 검사자다. 수정자가 아니다.',
            '대본을 다시 작성하지 마라. 반드시 검사 결과 JSON만 반환한다.',
            '검사 기준은 qaMode에 따라 달라진다. 사용자 명시 요청을 기존 대본 보존 규칙보다 우선한다.',
            'preserve_topic: 기존 주제/사실/섹션 흐름 보존을 강하게 검사한다.',
            'reframe_topic: 기존 주제와 달라졌다는 이유로 실패 처리하지 말고, 새 주제가 명확히 반영됐는지와 기존 주제에 어중간하게 끌려가지 않았는지를 검사한다.',
            'reframe_topic은 기존 내용을 보존하는 작업이 아니다. 기존 대본에서는 구조/리듬/톤/CTA 방식만 참고하고, 기존 상품/소재/상황/pain point/구체 예시는 새 주제와 충돌하면 버리는 것이 정상이다.',
            'reframe_topic full에서는 HOOK/BODY/CTA가 모두 새 주제 기준으로 자연스럽게 이어지는지 검사한다.',
            'reframe_topic partial에서는 targetSections만 새 주제 기준으로 바뀌고 preserveSections는 원문 그대로 유지됐는지 검사한다.',
            'insert_material: 요청 소재가 targetSections에 실제로 들어갔는지, preserveSections가 불필요하게 바뀌지 않았는지 검사한다.',
            'duration_compress: 새 대본 생성이 아니라 압축인지 검사한다. 목표 글자 범위 근처인지, HOOK/BODY/CTA와 CTA 의도/핵심 메시지가 유지됐는지, 새 사실/수치/후기/효과가 생기지 않았는지 검사한다.',
            'duration_compress에서는 짧아도 문장이 완결되어야 한다. 조사/접속어/서술어가 빠진 파편 문장, "오해부터요", "톡톡", "다음에"처럼 맥락 없이 끊긴 문장은 incomplete_compressed_sentence다.',
            'structured edit plan에 forbiddenSurfacePhrases가 있으면 해당 표현은 대본에 절대 남으면 안 된다.',
            'structured edit plan의 sectionInstructions, mustKeep, mustChange, mustAvoid를 검사한다.',
            'sectionInstructions에서 action=keep인 섹션이 바뀌면 section_instruction_violation이다.',
            'mustChange의 핵심 변경점이 반영되지 않으면 must_change_missing 또는 edit_plan_not_followed다.',
            'mustKeep의 핵심 정보가 사라지면 must_keep_lost다.',
            'mustAvoid가 대본에 남으면 edit_plan_not_followed다.',
            '세션 메모리의 confidence 높은 constraint를 검사한다. 단, 현재 사용자 요청이 해당 섹션 수정을 명시한 경우 현재 요청을 우선한다.',
            '강한 세션 제약을 어기면 memory_constraint_violated다.',
            'allowComparisonWithOldSubject=false이면 oldSubjectToRemove는 대본에 남으면 안 된다. 비교/대비 표현으로도 쓰지 않는다.',
            'instruction_leakage, forbidden_phrase_leakage, old_subject_leakage, mixed_subject_contamination을 검사한다.',
            '공통 기준: 사용자 요청 반영, 피드백 진단 반영, 섹션 잠금, 자연스러운 한국어, 레퍼런스 소재 오염, 허위 수치/권위/후기.',
            'severity 기준: high는 반드시 repair, medium은 repair, low는 로그만 남기고 통과 가능하다.',
            'high 예: 섹션 잠금 위반, 피드백 핵심 미반영, 레퍼런스 상품명/상황/비유 오염, 허위 수치/고객 사례/전문가 권위 생성, 빈 섹션.',
            'medium 예: 어색한 한국어, 현재 주제와 맞지 않는 비유, 문장 연결 부자연스러움.',
            'low 예: 약간 딱딱함, 더 짧게 다듬을 여지.',
            buildReferenceContaminationGuard(),
            characterSystemPrompt ? `캐릭터 고정 규칙:\n${characterSystemPrompt}` : null,
            personalizationContext ? `개인화 메모리:\n${personalizationContext}` : null,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
        {
          role: 'user',
          content: [
            `수정 범위: ${editTarget || 'all'}`,
            `qaMode: ${qaMode || COPILOT_QA_MODES.PRESERVE_TOPIC}`,
            `새 주제: ${newSubject || '-'}`,
            `제거할 기존 소재: ${uniqueCompactList(oldSubjectToRemove, 8).join(', ') || '-'}`,
            `대본 금지 표현: ${uniqueCompactList(forbiddenSurfacePhrases, 24).join(', ') || '-'}`,
            `기존 소재 비교 허용: ${allowComparisonWithOldSubject ? '예' : '아니오'}`,
            `요청 소재: ${uniqueCompactList(requestedMaterials, 8).join(', ') || '-'}`,
            `유지 섹션: ${uniqueCompactList(preserveSections, 3).join(', ') || '-'}`,
            `목표 압축 시간: ${targetDurationSeconds || '-'}초`,
            `목표 글자 범위(공백 제외): ${targetCharRange ? `${targetCharRange.min}-${targetCharRange.max}자` : '-'}`,
            editPlan ? `[structured edit plan]\n${JSON.stringify({
              primaryGoal: editPlan.primaryGoal || '',
              revisionStyle: editPlan.revisionStyle || '',
              reframeScope: editPlan.reframeScope || '',
              sectionInstructions: editPlan.sectionInstructions || {},
              mustKeep: editPlan.mustKeep || [],
              mustChange: editPlan.mustChange || [],
              mustAvoid: editPlan.mustAvoid || [],
              preserveFromOriginal: editPlan.preserveFromOriginal || [],
              discardFromOriginal: editPlan.discardFromOriginal || [],
              salesContext: editPlan.salesContext || '',
              toneHint: editPlan.toneHint || '',
            })}` : '',
            getStrongMemoryConstraints(copilotMemory).length
              ? `[strong session constraints]\n${JSON.stringify(getStrongMemoryConstraints(copilotMemory))}`
              : '',
            `사용자/피드백 적용 요청:\n${request || '-'}`,
            '',
            buildDraftBlock(original),
            '',
            '[수정본]',
            `HOOK: ${proposed.hook || '-'}`,
            `BODY: ${proposed.body || '-'}`,
            `CTA: ${proposed.cta || '-'}`,
            '',
            '[피드백]',
            `summary: ${feedback?.summary || '-'}`,
            `detail: ${feedback?.detail || '-'}`,
            `issues: ${compactReferenceSignal((feedback?.issues || []).join(' / '), 1200) || '-'}`,
            `recommendations: ${compactReferenceSignal((feedback?.recommendations || []).join(' / '), 1200) || '-'}`,
            '',
            referenceContext,
            '',
            '[룰 기반 선검사 이슈]',
            ruleCheck.issues.length ? JSON.stringify(ruleCheck.issues) : '없음',
            '',
            'JSON 형식으로만 답하세요:',
            '{"ok":true,"shouldRepair":false,"issues":[{"type":"unnatural_korean","severity":"medium","section":"body","text":"","reason":"","suggestion":""}]}',
          ].join('\n'),
        },
      ],
    })
    logAIUsage('copilot-quality-qa', response, {
      model: copilotModel,
      accountId,
      referenceId,
      selectedLabel: selectedLabel || '',
    })

    const parsed = parseModelJson(response.choices[0]?.message?.content || '')
    const llmIssues = normalizeQaIssues(parsed.issues)
    const issues = [...ruleCheck.issues, ...llmIssues]
    const shouldRepair = qaShouldRepair(issues)

    return {
      ok: !shouldRepair,
      shouldRepair,
      issues,
      issueTypes: issues.map((issue) => issue.type),
    }
  } catch (error) {
    logAIError('gpt', error, {
      referenceId,
      stage: 'script-quality-qa',
      model: copilotModel,
    })

    return ruleCheck
  }
}

export async function repairRefinedScriptWithQaIssues({
  accountId,
  referenceId,
  selectedLabel,
  originalSections,
  proposedSections,
  request = '',
  editTarget = 'all',
  feedback = {},
  qaIssues = [],
  characterSystemPrompt = '',
  personalizationContext = '',
  qaMode = COPILOT_QA_MODES.PRESERVE_TOPIC,
  newSubject = '',
  requestedMaterials = [],
  oldSubjectToRemove = [],
  forbiddenSurfacePhrases = [],
  allowComparisonWithOldSubject = false,
  targetSections: plannedTargetSections = null,
  preserveSections = [],
  targetDurationSeconds = null,
  targetCharRange = null,
  editPlan = null,
  copilotMemory = {},
}) {
  const original = normalizeSections(originalSections)
  const proposed = normalizeSections(proposedSections)
  const targetSections = Array.isArray(plannedTargetSections) && plannedTargetSections.length
    ? plannedTargetSections.filter((section) => SECTION_KEYS.includes(section))
    : getTargetSections(normalizeEditTarget(editTarget, request))
  const targetSet = new Set(targetSections)
  const repairIssues = normalizeQaIssues(qaIssues).filter((issue) => QA_REPAIR_SEVERITIES.has(issue.severity))
  const issueSections = new Set(
    repairIssues
      .flatMap((issue) => {
        if (issue.section === 'all') {
          return targetSections
        }
        return [issue.section]
      })
      .filter((section) => SECTION_KEYS.includes(section) && targetSet.has(section)),
  )
  const restoredLockedSections = applyEditScope(original, proposed, targetSections)

  if (!issueSections.size) {
    return {
      success: true,
      sections: restoredLockedSections,
      message: '잠긴 섹션 변경을 원문으로 되돌렸습니다.',
    }
  }

  const { supabaseAdmin, openai, models } = requireClients()
  const reference = await loadReferenceContext(supabaseAdmin, accountId, referenceId)
  const referenceContext = buildReferenceStructureContext(reference, selectedLabel)
  const copilotModel = models.copilotModel || models.chatModel
  const repairTargets = [...issueSections]

  try {
    const response = await openai.chat.completions.create({
      model: copilotModel,
      temperature: 0.35,
      messages: [
        {
          role: 'system',
          content: [
            '당신은 숏폼 대본을 최종으로 다듬는 편집자다. 문제가 확인된 섹션만 최소 수정한다.',
            '문제가 없는 섹션은 수정본 그대로 유지한다.',
            '잠긴 섹션은 원문 그대로 유지한다.',
            editPlan?.sectionInstructions
              ? 'structured edit plan의 sectionInstructions를 따른다. action=keep인 섹션은 원문 그대로 유지한다.'
              : null,
            editPlan?.mustKeep?.length
              ? `반드시 유지할 것: ${uniqueCompactList(editPlan.mustKeep, 6).join(', ')}`
              : null,
            editPlan?.mustChange?.length
              ? `반드시 반영할 것: ${uniqueCompactList(editPlan.mustChange, 6).join(', ')}`
              : null,
            editPlan?.mustAvoid?.length
              ? `절대 피할 것: ${uniqueCompactList(editPlan.mustAvoid, 10).join(', ')}`
              : null,
            getStrongMemoryConstraints(copilotMemory).length
              ? `세션 메모리의 강한 제약: ${getStrongMemoryConstraints(copilotMemory).map((event) => event.value).join(' / ')}. 단, 현재 사용자 요청이 해당 섹션 수정을 명시하면 현재 요청을 우선한다.`
              : null,
            '사용자가 새 주제나 새 소재를 명시한 경우 그 요청은 기존 대본 주제 유지보다 우선한다.',
            qaMode === COPILOT_QA_MODES.REFRAME_TOPIC
              ? `이번 작업은 새 주제 "${newSubject || '사용자가 명시한 새 주제'}"가 잘 반영되도록 다듬는 작업이다. 기존 대본 내용 보존이 아니라 구조/리듬/톤/CTA 방식만 참고하는 작업이다. 기존 상품/소재/상황/pain point/구체 예시는 새 주제와 충돌하면 되살리지 않는다.`
              : null,
            uniqueCompactList(forbiddenSurfacePhrases, 24).length
              ? `대본에 절대 쓰면 안 되는 사용자 지시 표현: ${uniqueCompactList(forbiddenSurfacePhrases, 24).join(', ')}`
              : null,
            uniqueCompactList(oldSubjectToRemove, 8).length && !allowComparisonWithOldSubject
              ? `제거해야 할 기존 소재: ${uniqueCompactList(oldSubjectToRemove, 8).join(', ')}. 비교/대비 표현으로도 남기지 않는다.`
              : null,
            uniqueCompactList(oldSubjectToRemove, 8).length && allowComparisonWithOldSubject
              ? `기존 소재 비교가 허용된 요청이다. 단, 비교가 아닌 기존 주제 오염으로 남기지 않는다. 기존 소재: ${uniqueCompactList(oldSubjectToRemove, 8).join(', ')}`
              : null,
            qaMode === COPILOT_QA_MODES.INSERT_MATERIAL
              ? `이번 작업은 요청 소재 누락/삽입 위치 문제를 다듬는 작업이다. 요청 소재: ${uniqueCompactList(requestedMaterials, 8).join(', ') || '-'}`
              : null,
            qaMode === COPILOT_QA_MODES.DURATION_COMPRESS
              ? `이번 작업은 목표 ${targetDurationSeconds || '지정'}초에 맞춘 압축 결과를 다듬는 작업이다. 새 내용은 만들지 말고 공백 제외 목표 범위 ${targetCharRange ? `${targetCharRange.min}-${targetCharRange.max}자` : '안'}에 가깝게 줄이되, 문장은 짧아도 자연스럽게 완결한다.`
              : null,
            '없는 사실, 허위 수치, 허위 후기, 허위 고객 사례, 허위 전문가 권위, 레퍼런스 소재를 만들지 않는다.',
            '한국어가 어색한 문장은 실제 사람이 말하는 자연스러운 표현으로만 고친다.',
            '사용자에게 보여줄 message에는 QA, 품질 검사, 위험 요소, issue, repair, fallback, 내부 검사 같은 시스템/개발 용어를 절대 쓰지 않는다.',
            qaMode === COPILOT_QA_MODES.DURATION_COMPRESS
              ? 'duration_compress의 message에는 "문제였던 부분", "고쳤다" 같은 문제 해결 표현을 쓰지 않는다. 목표 시간에 맞춰 핵심만 압축했다는 식으로 한두 문장만 쓴다.'
              : 'message는 사용자가 이해하기 쉬운 말로 한두 문장만 쓴다. QA/repair 같은 내부 과정은 말하지 않는다.',
            buildContextPriority(),
            buildReferenceContaminationGuard(),
            buildEditOutputInstruction(repairTargets),
            characterSystemPrompt ? `캐릭터 고정 규칙:\n${characterSystemPrompt}` : null,
            personalizationContext ? `개인화 메모리:\n${personalizationContext}` : null,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
        {
          role: 'user',
          content: [
            `repair 대상 섹션: ${repairTargets.join(', ')}`,
            `qaMode: ${qaMode || COPILOT_QA_MODES.PRESERVE_TOPIC}`,
            `새 주제: ${newSubject || '-'}`,
            `제거할 기존 소재: ${uniqueCompactList(oldSubjectToRemove, 8).join(', ') || '-'}`,
            `대본 금지 표현: ${uniqueCompactList(forbiddenSurfacePhrases, 24).join(', ') || '-'}`,
            `기존 소재 비교 허용: ${allowComparisonWithOldSubject ? '예' : '아니오'}`,
            `요청 소재: ${uniqueCompactList(requestedMaterials, 8).join(', ') || '-'}`,
            `유지 섹션: ${uniqueCompactList(preserveSections, 3).join(', ') || '-'}`,
            `목표 압축 시간: ${targetDurationSeconds || '-'}초`,
            `목표 글자 범위(공백 제외): ${targetCharRange ? `${targetCharRange.min}-${targetCharRange.max}자` : '-'}`,
            editPlan ? `[structured edit plan]\n${JSON.stringify({
              primaryGoal: editPlan.primaryGoal || '',
              revisionStyle: editPlan.revisionStyle || '',
              reframeScope: editPlan.reframeScope || '',
              sectionInstructions: editPlan.sectionInstructions || {},
              mustKeep: editPlan.mustKeep || [],
              mustChange: editPlan.mustChange || [],
              mustAvoid: editPlan.mustAvoid || [],
              preserveFromOriginal: editPlan.preserveFromOriginal || [],
              discardFromOriginal: editPlan.discardFromOriginal || [],
            })}` : '',
            getStrongMemoryConstraints(copilotMemory).length
              ? `[strong session constraints]\n${JSON.stringify(getStrongMemoryConstraints(copilotMemory))}`
              : '',
            `사용자/피드백 적용 요청:\n${request || '-'}`,
            '',
            '[원문]',
            `HOOK: ${original.hook || '-'}`,
            `BODY: ${original.body || '-'}`,
            `CTA: ${original.cta || '-'}`,
            '',
            '[QA 전 수정본]',
            `HOOK: ${proposed.hook || '-'}`,
            `BODY: ${proposed.body || '-'}`,
            `CTA: ${proposed.cta || '-'}`,
            '',
            '[피드백]',
            `summary: ${feedback?.summary || '-'}`,
            `detail: ${feedback?.detail || '-'}`,
            `issues: ${compactReferenceSignal((feedback?.issues || []).join(' / '), 1200) || '-'}`,
            `recommendations: ${compactReferenceSignal((feedback?.recommendations || []).join(' / '), 1200) || '-'}`,
            '',
            '[QA 이슈]',
            JSON.stringify(repairIssues),
            '',
            referenceContext,
            '',
            '문제가 확인된 섹션만 고쳐서 JSON으로 반환하세요.',
          ].join('\n'),
        },
      ],
    })
    logAIUsage('copilot-quality-repair', response, {
      model: copilotModel,
      accountId,
      referenceId,
      selectedLabel: selectedLabel || '',
      repairTargets,
    })

    const parsed = parseModelJson(response.choices[0]?.message?.content || '')
    const repairedPartial = extractProposedSections(parsed, repairTargets)
    const repaired = applyEditScope(restoredLockedSections, repairedPartial, repairTargets)
    const postCheck = runFeedbackFallbackRuleCheck({
      originalSections: original,
      candidateSections: repaired,
      editTarget,
      feedback,
      request,
      qaMode,
      newSubject,
      requestedMaterials,
      oldSubjectToRemove,
      forbiddenSurfacePhrases,
      allowComparisonWithOldSubject,
      editPlan,
      targetSections,
      targetDurationSeconds,
      targetCharRange,
      copilotMemory,
    })

    return {
      success: !postCheck.shouldRepair,
      sections: repaired,
      message: sanitizeUserFacingRepairMessage(parsed.message),
      postCheck,
    }
  } catch (error) {
    logAIError('gpt', error, {
      referenceId,
      stage: 'script-quality-repair',
      model: copilotModel,
    })

    return {
      success: false,
      sections: restoredLockedSections,
      message: 'QA repair 생성에 실패했습니다.',
      error,
    }
  }
}

export const __scriptAssistantTest = {
  buildNaturalResponseUserPrompt,
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
  runFeedbackFallbackRuleCheck,
  buildPartialSafeFeedbackApplyFallback,
  buildEditScopeInstruction,
  buildCopilotEvaluationRubric,
  buildCopilotMentorToneGuide,
  buildCopilotResponseModeRule,
  buildCopilotEditPlaybook,
  buildEditPlan,
  shouldUseHeavyQualityGateForCopilot,
  normalizeCopilotMemory,
  formatCopilotMemoryForPrompt,
  buildCopilotHookTemplateContext,
  buildCopilotNarrativePatternContext,
  buildNarrativeSectioningInstruction,
  shouldUseHookTemplatesForRefine,
  shouldUseNarrativePatternsForRefine,
  classifyCopilotIntentByRule,
  classifyCopilotIntent,
  parseEditInstruction,
  detectExplicitPreserveSections,
  extractRequestedNewSubject,
  extractRequestedMaterials,
  sanitizeUserFacingCopilotMessage,
  COPILOT_OPERATION_TYPES,
  COPILOT_QA_MODES,
  normalizeTargetDurationSeconds,
  extractTargetDurationSeconds,
  buildDurationCharRange,
  buildFeedbackVerdict,
  feedbackToEditInstructions,
  detectFeedbackRecheckRegression,
  stabilizeFeedbackScoreAfterApply,
  createFallbackIntent,
  messageMentionsLockedSections,
  logPromptAssembly,
}
