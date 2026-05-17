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
const COPILOT_INTENTS = {
  ADVISE: 'advise_script',
  EDIT: 'edit_script',
  GENERAL: 'general_chat',
}
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

function buildCopilotResponseModeRule(responseMode = 'edit_only') {
  if (responseMode === 'advice_then_edit') {
    return [
      '응답 모드: 평가 + 수정',
      '- 사용자가 문제점 확인과 수정을 함께 요청했다.',
      '- message에는 기준표에 따른 짧은 진단 1문장과 실제 수정 방향 1문장을 함께 쓴다.',
      '- 예: "HOOK은 첫 1초 긴장감이 약해서 문제를 더 앞에 세웠고, BODY는 원인→해결 순서가 보이게 정리했습니다."',
    ].join('\n')
  }

  return [
    '응답 모드: 짧은 진단 + 수정',
    '- 사용자가 수정을 요청했으므로 대본은 수정한다.',
    '- message에는 기준표에 따른 짧은 진단을 먼저 넣고, 그 다음 무엇을 고쳤는지 말한다.',
    '- 단, 사용자가 요청하지 않은 섹션은 진단에서도 과하게 언급하지 않는다.',
    '- 예: "HOOK은 첫 문장의 긴장감이 약해서, 문제 상황이 바로 보이도록 바꿨습니다."',
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

function classifyCopilotIntentByRule(request = '', editTarget = '') {
  const text = String(request || '').trim()
  const normalizedEditTarget = String(editTarget || '').trim().toLowerCase()
  const hasExplicitSectionTarget = SECTION_KEYS.includes(normalizedEditTarget)
  const editPattern =
    /(고쳐|수정|바꿔|바꾸|다듬|고도화|개선|보완|줄여|늘려|짧게|길게|강하게|세게|약하게|자연스럽게|세련되게|정리해|압축|추가해|넣어|넣어줘|살려|살려줘|빼줘|삭제|교체|리라이트|rewrite|edit|revise|fix)/i
  const advicePattern =
    /(어때|어떤가|괜찮|약한가|약해|별로|문제|피드백|조언|평가|점수|올려도|업로드해도|이대로|봐줘|검토|진단|판단|좋아\?|나아\?|괜찮아\?)/i

  const wantsEdit = editPattern.test(text)
  const wantsAdvice = advicePattern.test(text)

  if (wantsEdit) {
    return {
      intent: COPILOT_INTENTS.EDIT,
      shouldEdit: true,
      responseMode: wantsAdvice ? 'advice_then_edit' : 'edit_only',
      editTarget: normalizeEditTarget(editTarget, text),
      confidence: wantsAdvice ? 0.78 : 0.88,
    }
  }

  if (wantsAdvice) {
    return {
      intent: COPILOT_INTENTS.ADVISE,
      shouldEdit: false,
      responseMode: 'advice_only',
      editTarget: 'none',
      confidence: 0.86,
    }
  }

  if (hasExplicitSectionTarget) {
    return {
      intent: COPILOT_INTENTS.EDIT,
      shouldEdit: true,
      responseMode: 'edit_only',
      editTarget: normalizedEditTarget,
      confidence: 0.66,
    }
  }

  return {
    intent: COPILOT_INTENTS.GENERAL,
    shouldEdit: false,
    responseMode: 'chat_only',
    editTarget: 'none',
    confidence: 0.55,
  }
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
  if (/(body|바디|본문|중간|내용|전개|근거|설명)/i.test(request)) {
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
  const hasEditOrFeedbackSignal = /(수정|바꿔|변경|고쳐|다듬|줄여|늘려|강하게|약하게|자연스럽게|넣어|살려|hook|body|cta|훅|바디|본문|마무리|도입|문장|톤|느낌|감정선|스토리|서사|다시|피드백|점수|평가|검토)/i.test(text)
  if (minimalGreetings.includes(compact) || (compact.length <= 3 && !hasEditOrFeedbackSignal)) {
    return {
      intent: 'greeting',
      editTarget: null,
      shouldModifyScript: false,
      reply: '안녕하세요 :) 어떤 부분을 도와드릴까요? HOOK, BODY, CTA 중 하나를 골라서 요청해주시면 바로 도와드릴게요.',
    }
  }

  if (/점수|평가|피드백\s*(생성|받|해줘|줘)|검토\s*(리포트|해줘|해)/i.test(text)) {
    return {
      intent: 'feedback_request',
      editTarget: null,
      shouldModifyScript: false,
      reply: '',
    }
  }

  if (/(수정해|수정해줘|바꿔|바꿔줘|변경해|변경해줘|고쳐|고쳐줘|다듬어|다듬어줘|줄여|줄여줘|늘려|늘려줘|넣어|넣어줘|살려|살려줘|강하게\s*(해|바꿔|수정)|약하게\s*(해|바꿔|수정)|자연스럽게\s*(해|바꿔|수정)|감정선\s*(넣|살려|보강)|스토리처럼|서사(?:로|처럼)|브이로그처럼|실패담처럼|고객\s*사례처럼|다시\s*(써|작성|수정))/i.test(text)) {
    return {
      intent: 'edit_request',
      editTarget: normalizedEditTarget,
      shouldModifyScript: true,
      reply: '',
    }
  }

  if (/(어때|어떤가|괜찮|약한가|약해|별로|뭐가\s*문제|문제야|조언|올려도|업로드해도|이대로|봐줘|검토|진단|판단)/i.test(text)) {
    return {
      intent: 'advise_script',
      editTarget: null,
      shouldModifyScript: false,
      reply: '',
    }
  }

  return null
}

export async function classifyCopilotIntent({
  message,
  sections,
  editTarget = '',
  characterSystemPrompt = '',
  personalizationContext = '',
}) {
  const fallback = createFallbackIntent(message, editTarget)
  if (fallback) {
    return fallback
  }

  const normalizedMessage = String(message || '').trim()
  const normalizedSections = normalizeSections(sections)

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
            'intent는 greeting, edit_request, feedback_request, advise_script, question, clarification 중 하나만 사용한다.',
            'edit_request일 때만 shouldModifyScript=true다.',
            'feedback_request는 피드백 실행 대상이므로 shouldModifyScript=false다.',
            'advise_script는 말로만 조언/진단하는 요청이므로 shouldModifyScript=false다.',
            '"어때?", "조언해줘", "이대로 올려도 돼?", "뭐가 문제야?"는 advise_script다.',
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
            '{"intent":"greeting|edit_request|feedback_request|advise_script|question|clarification","editTarget":"all|hook|body|cta|null","shouldModifyScript":false,"reply":"","reason":""}',
          ].join('\n'),
        },
      ],
    })

    logAIUsage('copilot-intent', response, {
      model: models.chatModel,
    })

    const parsed = parseModelJson(response.choices[0]?.message?.content || '')
    const allowedIntents = new Set(['greeting', 'edit_request', 'feedback_request', 'advise_script', 'question', 'clarification'])
    const intent = allowedIntents.has(parsed.intent) ? parsed.intent : 'clarification'
    const target = EDIT_TARGETS.has(String(parsed.editTarget || '').toLowerCase())
      ? String(parsed.editTarget).toLowerCase()
      : intent === 'edit_request'
        ? normalizeEditTarget(editTarget, normalizedMessage)
        : null

    return {
      intent,
      editTarget: target,
      shouldModifyScript: intent === 'edit_request' && Boolean(parsed.shouldModifyScript),
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
}) {
  const normalizedSections = normalizeSections(sections)

  return (
    `${buildDraftBlock(normalizedSections)}\n\n` +
    `선택한 안: ${selectedLabel || '-'}\n\n` +
    `${referenceContext}\n\n` +
    `${buildCopilotEvaluationRubric()}\n\n` +
    `핵심 인사이트:\n${formatGuideList(guides?.insights || [])}\n\n` +
    `바로 써먹을 체크포인트:\n${formatGuideList(guides?.checkpoints || [])}\n\n` +
    '다음 JSON 형식으로만 답하세요: ' +
    '{"score":82,"summary":"","detail":"","suggestedSections":{"hook":"","body":"","cta":""}}'
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
    '- 조언/평가 요청이면 평가 기준표에 따라 좋은 점 1개와 아쉬운 점 1~2개, 다음 개선 방향을 짧게 말한다.\n' +
    '- 점수 언급을 요청했거나 "이대로 올려도 돼?"처럼 판단을 요구하면 100점 기준의 대략적 점수도 함께 말한다.\n' +
    '- 무조건 칭찬하지 않는다. 약한 부분이 있으면 약하다고 말한다.\n' +
    '- 현재 초안과 레퍼런스 구조를 기준으로 판단하되, 레퍼런스 원문 소재를 가져오지 않는다.\n' +
    '- 사용자가 명시적으로 고쳐달라고 하지 않았으므로 섹션 변경을 제안만 하고 실행하지 않는다.\n\n' +
    '다음 JSON 형식으로만 답하세요: {"message":""}'
  )
}

function buildFallbackNaturalResponse(sections = {}, intent = COPILOT_INTENTS.ADVISE) {
  const normalized = normalizeSections(sections)
  if (intent === COPILOT_INTENTS.GENERAL) {
    return '지금 초안을 기준으로 도와드릴 수 있어요. 조언을 원하면 어떤 부분이 고민인지 말해주시고, 수정이 필요하면 HOOK/BODY/CTA 중 어디를 바꿀지 알려주세요.'
  }

  const hookNote = normalized.hook
    ? 'HOOK은 주제는 보이지만 첫 1초에 걸리는 긴장감이 더 선명하면 좋아요.'
    : 'HOOK이 비어 있어서 첫 문장부터 시청자 고민을 바로 찌르는 구성이 필요해요.'
  const bodyNote = normalized.body
    ? 'BODY는 HOOK에서 던진 문제를 바로 이어받는지 보면 됩니다.'
    : 'BODY가 비어 있어서 문제 원인과 해결 기준을 짧게 이어줘야 해요.'
  const ctaNote = normalized.cta
    ? 'CTA는 행동 이유가 분명할수록 구매나 저장으로 자연스럽게 이어집니다.'
    : 'CTA가 비어 있어서 시청자가 지금 해야 할 행동을 한 문장으로 잡아줘야 해요.'

  return `${hookNote} ${bodyNote} ${ctaNote}`
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
  intentResult,
}) {
  const normalizedSections = normalizeSections(sections)
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
            '응답 규칙: 자연어로 짧게 진단한다. 좋은 점, 약한 점, 다음 개선 방향을 기준표에 맞춰 구체적으로 말한다.',
            '응답 규칙: "좋아요"만 말하지 않는다. 약한 점이 있으면 약하다고 말한다. 단, 대본을 새로 쓰거나 적용하지 않는다.',
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
    const message = String(parsed?.message || '').trim()
    return message || buildFallbackNaturalResponse(normalizedSections, intentResult.intent)
  } catch (error) {
    logAIError('gpt', error, {
      referenceId,
      request,
      stage: 'script-natural-response',
      model,
    })
    return buildFallbackNaturalResponse(normalizedSections, intentResult.intent)
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

  if (!intentResult.shouldEdit) {
    logPromptAssembly({
      stage: 'script-natural-response',
      referenceId,
      currentDraftId,
      currentVersionId,
      editTarget: 'none',
      memoryIncluded: Boolean(personalizationContext),
      includedTranscript: false,
    })

    const copilotModel = models.copilotModel || models.chatModel
    const message = await generateCopilotNaturalResponse({
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
      intentResult,
    })

    return {
      message,
      sections: normalizedSections,
      editTarget: 'none',
      changedSections: [],
      flowValidation: validateScriptFlow(normalizedSections),
      copilotIntent: intentResult.intent,
      responseMode: intentResult.responseMode,
    }
  }

  const normalizedEditTarget = normalizeEditTarget(intentResult.editTarget || editTarget, normalizedRequest)
  const targetSections = getTargetSections(normalizedEditTarget)
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
            'suggestedSections를 작성할 때는 설명형/교과서형 문장을 피하고, 실제 사람이 말하는 톤으로 다시 써라.',
            'suggestedSections는 선택 초안의 문장 단위 구조 설계도, 길이감, 문장 역할 순서, 심리 트리거, CTA 위치를 가능한 한 유지한다.',
            '피드백 반영안이 레퍼런스 구조를 버리고 새 대본처럼 바뀌면 실패다.',
            'HOOK은 긴장감 있게, BODY는 상황/경험형으로, CTA는 행동 이유를 담아 짧고 강하게 제안하라.',
            '평가 시 반드시 평가 기준표의 5개 항목을 기준으로 점수를 판단한다.',
            'summary/detail에는 좋은 점과 약한 점을 모두 담는다. 무조건 칭찬하지 않는다.',
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
      model: copilotModel,
      accountId,
      referenceId,
      selectedLabel: selectedLabel || '',
    })

    const parsed = parseModelJson(response.choices[0]?.message?.content || '')
    const structureDiagnosis = buildStructureDiagnosis(reference, selectedLabel, parsed)

    return {
      score: Number(parsed.score) || 0,
      summary: parsed.summary?.trim() || '전체 구조는 괜찮지만 더 압축할 여지가 있습니다.',
      detail: parsed.detail?.trim() || 'HOOK, BODY, CTA의 역할을 더 또렷하게 나누면 성능이 좋아질 수 있습니다.',
      suggestedSections: normalizeSections(parsed.suggestedSections),
      structureDiagnosis,
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
  buildEditScopeInstruction,
  buildCopilotEvaluationRubric,
  buildCopilotResponseModeRule,
  buildCopilotEditPlaybook,
  buildCopilotHookTemplateContext,
  buildCopilotNarrativePatternContext,
  buildNarrativeSectioningInstruction,
  shouldUseHookTemplatesForRefine,
  shouldUseNarrativePatternsForRefine,
  classifyCopilotIntentByRule,
  createFallbackIntent,
  messageMentionsLockedSections,
  logPromptAssembly,
}
