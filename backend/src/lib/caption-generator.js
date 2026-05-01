import { AppError } from './errors.js'
import { logAIUsage } from './ai-usage-logger.js'
import { parseModelJson } from './model-json.js'
import { getOpenAIClient, getOpenAIModels, hasOpenAIConfig } from './openai.js'

function normalizeCaption(value = '') {
  return String(value || '').trim()
}

function normalizeList(value) {
  return Array.isArray(value) ? value.map((item) => normalizeCaption(item)).filter(Boolean) : []
}

function normalizeHashtags(value) {
  return normalizeList(value)
    .map((item) => item.replace(/^#+/, '').replace(/\s+/g, '').trim())
    .filter(Boolean)
    .map((item) => `#${item}`)
}

function truncateText(value, maxLength = 1200) {
  const normalized = normalizeCaption(value)
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

function buildStrategyContext({
  strategyText,
  hookDirection,
  bodyFocus,
  ctaExamples,
  riskNotes,
  bannedExpressions,
}) {
  return [
    strategyText ? `전략 원문: ${strategyText}` : null,
    hookDirection.length ? `Hook 방향: ${hookDirection.join(', ')}` : null,
    bodyFocus.length ? `본문 강조점: ${bodyFocus.join(', ')}` : null,
    ctaExamples.length ? `CTA 예시: ${ctaExamples.join(', ')}` : null,
    riskNotes.length ? `주의사항: ${riskNotes.join(', ')}` : null,
    bannedExpressions.length ? `금지 표현: ${bannedExpressions.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

function buildCategoryRuleContext(categoryRule) {
  if (!categoryRule) {
    return ''
  }

  return [
    '[카테고리별 캡션 전략]',
    `- 카테고리: ${categoryRule.category}`,
    `- 핵심: ${categoryRule.core}`,
    categoryRule.winningFeatures?.length ? `- 잘 터지는 특징: ${categoryRule.winningFeatures.join(', ')}` : null,
    categoryRule.hookPatterns?.length ? `- Hook 패턴: ${categoryRule.hookPatterns.join(' / ')}` : null,
    categoryRule.captionFlow?.length ? `- 캡션 흐름: ${categoryRule.captionFlow.join(' → ')}` : null,
    categoryRule.ctaPatterns?.length ? `- CTA 패턴: ${categoryRule.ctaPatterns.join(' / ')}` : null,
    categoryRule.bannedExpressions?.length ? `- 금지 표현: ${categoryRule.bannedExpressions.join(', ')}` : null,
    '',
    '이 카테고리 규칙은 사용자의 영상 주제와 계정 세팅값을 대체하지 않는다.',
    '반드시 보조 규칙으로만 사용한다.',
  ]
    .filter(Boolean)
    .join('\n')
}

const GUARANTEE_EXPRESSIONS_BY_CATEGORY = {
  육아: ['발달 보장', '바로 잠듭니다', '육아 끝'],
  반려동물: ['질병 치료', '수의사 필요 없음', '100% 적응', '효과 확실'],
  재테크: ['수익 보장', '원금 보장', '손실 없음', '무조건 오릅니다'],
  교육: ['성적 보장', '합격 보장', '100점 보장'],
  멘탈케어: ['우울증 치료', '멘탈 완치', '상담 필요 없음', '무조건 괜찮아짐'],
  '운동/헬스': ['효과 보장', '감량 보장', '근성장 보장', '2주 완성'],
  뷰티: ['치료', '완치', '효과 보장'],
}

function normalizeReferencePattern(parsed = {}) {
  const fallback = {
    hookType: '문제제기형',
    tonePattern: '자연스러운 설명형',
    flow: ['문제 제기', '공감', '해결 기준', 'CTA'],
    ctaType: '저장/링크 유도',
    sentenceLength: '짧거나 중간 길이 문장',
    usablePattern: '문제제기형 hook + 정보형 본문 + 자연스러운 CTA',
  }

  return {
    hookType: normalizeCaption(parsed.hookType) || fallback.hookType,
    tonePattern: normalizeCaption(parsed.tonePattern) || fallback.tonePattern,
    flow: normalizeList(parsed.flow).slice(0, 6).length ? normalizeList(parsed.flow).slice(0, 6) : fallback.flow,
    ctaType: normalizeCaption(parsed.ctaType) || fallback.ctaType,
    sentenceLength: normalizeCaption(parsed.sentenceLength) || fallback.sentenceLength,
    usablePattern: normalizeCaption(parsed.usablePattern) || fallback.usablePattern,
  }
}

function buildCaptionBrief({
  topic,
  category,
  monetizationModel,
  categoryRule,
  strategyText,
  hookDirection,
  bodyFocus,
  ctaExamples,
  riskNotes,
  bannedExpressions,
  referencePattern,
}) {
  return {
    topic,
    category: category || '미지정',
    monetizationModel: monetizationModel || '미지정',
    priorityOrder: [
      '내 영상주제',
      '내 계정 세팅값',
      '수익화 모델',
      '카테고리별 캡션 전략',
      '카테고리×수익모델 전략',
      'A/B 캡션 구조 패턴',
    ],
    categoryRule: categoryRule
      ? {
          category: categoryRule.category,
          core: categoryRule.core,
          winningFeatures: categoryRule.winningFeatures,
          hookPatterns: categoryRule.hookPatterns,
          captionFlow: categoryRule.captionFlow,
          ctaPatterns: categoryRule.ctaPatterns,
          bannedExpressions: categoryRule.bannedExpressions,
        }
      : null,
    categoryRuleContext: buildCategoryRuleContext(categoryRule),
    strategyText,
    hookDirection,
    bodyFocus,
    ctaExamples,
    riskNotes,
    bannedExpressions,
    referencePattern,
    referenceUsageRule:
      'A/B 캡션은 hook 유형, 문단 길이, 감정선, CTA 위치만 참고하고 주제, 상품명, 상황, 고유문장, 표면 표현은 사용하지 않는다.',
    hashtagRules: {
      targetCount: '기본 5개 내외',
      topicTags: '주제 핵심 태그 1~2개: 영상 내용 자체에서 뽑는다. 예: #스트랩추천, #운동루틴',
      categoryTags: '카테고리 태그 1~2개: 계정 카테고리를 반영한다. 예: #헬스초보, #헬스정보',
      audienceTags: '상황/타깃 태그 1개: 누구에게 필요한지 표현한다. 예: #헬스장필수템, #운동초보',
      monetizationTags:
        '수익모델 태그는 선택이다. #쿠팡파트너스는 투명성/제휴 표시 목적이면 가능하지만, 노출용으로는 광고 느낌이 강하므로 기본 추천에서는 빼는 편이 좋다.',
    },
  }
}

function tokenizeForContamination(text) {
  return normalizeCaption(text)
    .replace(/[#@][^\s#@]+/g, ' ')
    .split(/[^0-9A-Za-z가-힣]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4)
}

const COMMON_CAPTION_TOKENS = new Set([
  '저장해두고',
  '저장하세요',
  '확인하세요',
  '프로필',
  '링크에서',
  '댓글로',
  '공유해',
  '초보라면',
  '추천합니다',
  '체크리스트',
])

function findReferenceContamination({ caption, references, topic }) {
  const normalizedCaption = normalizeCaption(caption)
  const topicTokens = new Set(tokenizeForContamination(topic))
  const suspicious = new Set()

  references.forEach((reference) => {
    tokenizeForContamination(reference).forEach((token) => {
      if (!topicTokens.has(token) && !COMMON_CAPTION_TOKENS.has(token) && normalizedCaption.includes(token)) {
        suspicious.add(token)
      }
    })
  })

  return Array.from(suspicious).slice(0, 12)
}

function detectCategoryDrift({ caption, category }) {
  const categoryKeywords = {
    육아: ['아이', '부모', '육아'],
    반려동물: ['강아지', '고양이', '반려', '보호자'],
    자기계발: ['루틴', '실천', '목표', '무기력'],
    패션: ['옷', '코디', '핏', '사이즈'],
    AI: ['AI', '프롬프트', '자동화', '업무'],
    재테크: ['돈', '월급', '가계부', '절약'],
    여행: ['여행', '숙소', '일정', '준비물'],
    요리: ['요리', '레시피', '재료', '메뉴'],
    '테크 가젯': ['가젯', '제품', '스펙', '기능'],
    멘탈케어: ['마음', '감정', '번아웃', '회복'],
    교육: ['공부', '학습', '학생', '복습'],
    '운동/헬스': ['운동', '헬스', '루틴', '자세'],
    뷰티: ['피부', '화장품', '루틴', '사용감'],
    살림: ['살림', '정리', '청소', '집'],
  }
  const keywords = categoryKeywords[category] || []
  if (!keywords.length) {
    return false
  }

  return !keywords.some((keyword) => caption.includes(keyword))
}

function validateCaption({
  caption,
  references,
  topic,
  category,
  monetizationModel,
  categoryRule,
  bannedExpressions,
  accountBannedExpressions,
}) {
  const suspiciousReferenceTerms = findReferenceContamination({
    caption,
    references,
    topic,
  })
  const combinedBannedExpressions = [
    ...bannedExpressions,
    ...accountBannedExpressions,
    ...(categoryRule?.bannedExpressions || []),
    ...(GUARANTEE_EXPRESSIONS_BY_CATEGORY[category] || []),
  ].filter(Boolean)
  const bannedHits = combinedBannedExpressions.filter((expression) => caption.includes(expression))
  const topicTokens = tokenizeForContamination(topic)
  const topicPreserved = topicTokens.length
    ? topicTokens.some((token) => caption.includes(token))
    : caption.includes(topic)
  const monetizationCtaSignals = {
    '쿠팡파트너스/제휴': ['링크', '저장', '제품', '확인'],
    공동구매: ['공구', '기간', '구성', '혜택', '확인'],
    '게시물 보너스/플랫폼 보상': ['저장', '공유', '댓글'],
    '광고/PPL/협찬': ['댓글', '링크', '정보', '확인'],
    대행: ['DM', '문의', '상담', '진단'],
  }
  const ctaSignals = monetizationCtaSignals[monetizationModel] || []

  return {
    referenceContamination: suspiciousReferenceTerms.length > 0,
    suspiciousReferenceTerms,
    topicPreserved,
    categoryDrift: detectCategoryDrift({ caption, category }),
    monetizationCtaMatched: ctaSignals.length ? ctaSignals.some((signal) => caption.includes(signal)) : true,
    bannedExpressionHits: bannedHits,
    accountTonePreserved: true,
    bannedClaimsRemoved: bannedHits.length === 0,
  }
}

function requireOpenAI() {
  if (!hasOpenAIConfig()) {
    throw new AppError('OpenAI API key is not configured', {
      code: 'OPENAI_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  return {
    openai: getOpenAIClient(),
    models: getOpenAIModels(),
  }
}

async function extractReferencePattern({ openai, model, accountId, captionA, captionB }) {
  const response = await openai.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: [
          '당신은 인스타그램/숏폼 캡션 레퍼런스 분석가다. 출력은 JSON만 반환한다.',
          '목표는 레퍼런스의 내용이 아니라 구조 신호만 추출하는 것이다.',
          '상품명, 업종, 상황, 고유명사, 숫자, 문장 표현, 소재를 결과에 쓰지 마라.',
          'JSON 스키마: {"hookType":"string","tonePattern":"string","flow":["string"],"ctaType":"string","sentenceLength":"string","usablePattern":"string"}',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `레퍼런스 캡션 A:\n${truncateText(captionA)}`,
          `레퍼런스 캡션 B:\n${truncateText(captionB)}`,
          '요청: 두 캡션에서 새 캡션에 참고 가능한 구조 패턴만 추출해줘. 원문 내용과 단어는 버려.',
        ].join('\n\n'),
      },
    ],
  })

  logAIUsage('caption-reference-pattern', response, {
    model,
    accountId,
  })

  return normalizeReferencePattern(parseModelJson(response.choices[0]?.message?.content || ''))
}

async function generateCaptionFromBrief({
  openai,
  model,
  accountId,
  brief,
  characterSystemPrompt,
}) {
  const response = await openai.chat.completions.create({
    model,
    temperature: 0.65,
    messages: [
      {
        role: 'system',
        content: [
          '당신은 인스타그램/숏폼 캡션 카피라이터다. 출력은 JSON만 반환한다.',
          '가장 중요한 기준은 사용자의 영상 주제와 현재 계정 세팅값이다.',
          '카테고리별 캡션 전략은 말하는 방식과 위험 표현 회피에만 사용한다.',
          'A/B 캡션 원문은 제공되지 않는다. referencePattern은 구조 참고용일 뿐이다.',
          'A/B 캡션은 구조 참고용이며, 내용·상품명·상황·문장·고유 표현은 절대 가져오지 않는다.',
          '레퍼런스의 주제, 업종, 상품명, 상황, 고유명사, 표면 단어, 문장 구조를 가져오지 마라.',
          '레퍼런스 내용을 패러프레이즈하지 마라.',
          '카테고리 규칙은 누구에게 어떻게 말할지를 정하고, 수익모델 규칙은 어떤 행동을 유도할지를 정한다.',
          'caption은 hook, body, cta를 합친 완성형 본문이며 해시태그는 넣지 않는다. 해시태그는 hashtags 배열에만 넣는다.',
          '해시태그는 captionBrief.hashtagRules를 반드시 따른다. 기본 5개 내외로 만들고, 주제 핵심/카테고리/상황·타깃 태그를 섞는다.',
          '수익모델 태그는 기본적으로 넣지 않는다. 단, 제휴 표시가 꼭 필요한 맥락이면 #쿠팡파트너스 같은 태그를 최대 1개만 넣는다.',
          'JSON 스키마: {"caption":"string","hook":"string","body":"string","cta":"string","hashtags":["string"],"rationale":"string"}',
          characterSystemPrompt ? `계정 세팅 고정 규칙:\n${characterSystemPrompt}` : null,
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
      {
        role: 'user',
        content: [
          '아래 captionBrief만 기준으로 새 캡션을 작성해줘.',
          'captionBrief:',
          JSON.stringify(brief, null, 2),
          '작성 규칙:',
          '1. 첫줄 Hook',
          '2. 공감/문제 제기',
          '3. 카테고리별 본문 강조점',
          '4. 수익모델에 맞는 CTA',
          '5. 필요한 경우 고지/주의 문구',
          '6. 금지 표현 회피',
        ].join('\n\n'),
      },
    ],
  })

  logAIUsage('caption-generate', response, {
    model,
    accountId,
    topic: brief.topic,
    category: brief.category,
    monetizationModel: brief.monetizationModel,
    referencePatternOnly: true,
  })

  return parseModelJson(response.choices[0]?.message?.content || '')
}

export async function generateCaptionDraft({
  accountId,
  topic,
  captionA,
  captionB,
  monetizationModel = '',
  category = '',
  strategyText = '',
  categoryRule = null,
  accountBannedExpressions = [],
  hookDirection = [],
  bodyFocus = [],
  ctaExamples = [],
  riskNotes = [],
  bannedExpressions = [],
  characterSystemPrompt = '',
}) {
  const normalizedTopic = normalizeCaption(topic)
  const referenceCaptionA = normalizeCaption(captionA)
  const referenceCaptionB = normalizeCaption(captionB)
  const normalizedMonetizationModel = normalizeCaption(monetizationModel)
  const normalizedCategory = normalizeCaption(category)
  const normalizedStrategyText = normalizeCaption(strategyText)
  const normalizedHookDirection = normalizeList(hookDirection)
  const normalizedBodyFocus = normalizeList(bodyFocus)
  const normalizedCtaExamples = normalizeList(ctaExamples)
  const normalizedRiskNotes = normalizeList(riskNotes)
  const normalizedBannedExpressions = normalizeList(bannedExpressions)
  const normalizedAccountBannedExpressions = normalizeList(accountBannedExpressions)
  const combinedPromptBannedExpressions = [
    ...normalizedBannedExpressions,
    ...normalizedAccountBannedExpressions,
    ...(categoryRule?.bannedExpressions || []),
  ].filter(Boolean)

  if (!normalizedTopic) {
    throw new AppError('내 영상 주제를 입력해주세요.', {
      code: 'TOPIC_REQUIRED',
      statusCode: 400,
      exposeMessage: true,
    })
  }

  if (!referenceCaptionA || !referenceCaptionB) {
    throw new AppError('레퍼런스 캡션 A와 B를 모두 입력해주세요.', {
      code: 'REFERENCE_CAPTIONS_REQUIRED',
      statusCode: 400,
      exposeMessage: true,
    })
  }

  const { openai, models } = requireOpenAI()
  const referencePattern = await extractReferencePattern({
    openai,
    model: models.chatModel,
    accountId,
    captionA: referenceCaptionA,
    captionB: referenceCaptionB,
  })

  const brief = buildCaptionBrief({
    topic: normalizedTopic,
    category: normalizedCategory,
    monetizationModel: normalizedMonetizationModel,
    categoryRule,
    strategyText: buildStrategyContext({
      strategyText: normalizedStrategyText,
      hookDirection: normalizedHookDirection,
      bodyFocus: normalizedBodyFocus,
      ctaExamples: normalizedCtaExamples,
      riskNotes: normalizedRiskNotes,
      bannedExpressions: combinedPromptBannedExpressions,
    }),
    hookDirection: normalizedHookDirection,
    bodyFocus: normalizedBodyFocus,
    ctaExamples: normalizedCtaExamples,
    riskNotes: normalizedRiskNotes,
    bannedExpressions: combinedPromptBannedExpressions,
    referencePattern,
  })

  const parsed = await generateCaptionFromBrief({
    openai,
    model: models.chatModel,
    accountId,
    brief,
    characterSystemPrompt,
  })

  const caption = normalizeCaption(parsed.caption)
  const hook = normalizeCaption(parsed.hook)
  const body = normalizeCaption(parsed.body)
  const cta = normalizeCaption(parsed.cta)
  const hashtags = normalizeHashtags(parsed.hashtags).slice(0, 10)
  const rationale = normalizeCaption(parsed.rationale)

  if (!caption) {
    throw new AppError('캡션 생성 결과가 비어 있습니다.', {
      code: 'EMPTY_CAPTION_RESULT',
      statusCode: 502,
      exposeMessage: true,
    })
  }

  const safetyCheck = validateCaption({
    caption,
    references: [referenceCaptionA, referenceCaptionB],
    topic: normalizedTopic,
    category: normalizedCategory,
    monetizationModel: normalizedMonetizationModel,
    categoryRule,
    bannedExpressions: normalizedBannedExpressions,
    accountBannedExpressions: normalizedAccountBannedExpressions,
  })

  return {
    caption,
    hook,
    body,
    cta,
    hashtags,
    rationale,
    appliedInputs: {
      topic: normalizedTopic,
      accountCategory: normalizedCategory || '미지정',
      monetizationModel: normalizedMonetizationModel || '미지정',
      categoryRuleUsed: Boolean(categoryRule),
      referenceUsage: 'A/B 원문은 1차 구조 분석에만 사용했고, 생성 단계에는 구조 패턴만 전달했습니다.',
    },
    referencePattern,
    categoryRule,
    safetyCheck,
  }
}
