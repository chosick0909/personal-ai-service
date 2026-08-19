import { randomUUID } from 'node:crypto'
import { AppError } from './errors.js'
import { getOpenAIClient, getOpenAIModels, hasOpenAIConfig } from './openai.js'
import { getSupabaseAdmin, hasSupabaseAdminConfig } from './supabase.js'
import { logAIError } from './ai-error-logger.js'
import { logAIUsage } from './ai-usage-logger.js'
import { retrieveHookTemplates, formatHookTemplatesForPrompt } from './hook-templates.js'
import { retrieveNarrativePatterns, formatNarrativePatternsForPrompt } from './narrative-patterns.js'
import {
  retrieveWritingPlaybookRulesForSentences,
  formatWritingPlaybookRulesForPrompt,
} from './writing-playbook.js'
import { CATEGORY_PLAYBOOKS } from '../config/reference-analysis-config.js'
import {
  TOPIC_VARIATION_CONFIGS,
  countTopicActionSignals,
  validateTopicVariationSet,
} from './topic-script-validation.js'

export { validateTopicVariation, validateTopicVariationSet } from './topic-script-validation.js'

function normalizeText(value = '', maxLength = 20000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function normalizeList(value, maxItems = 6) {
  if (!Array.isArray(value)) return []
  return value.map((item) => normalizeText(item, 500)).filter(Boolean).slice(0, maxItems)
}

function parseModelJson(content = '') {
  const raw = String(content || '').trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    try {
      return JSON.parse(raw.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

function normalizeTopicBrief(value = {}, topic = '', accountSettings = {}) {
  const persona = accountSettings?.persona && typeof accountSettings.persona === 'object'
    ? accountSettings.persona
    : {}
  const actionableMethods = normalizeList(value.actionableMethods || value.actionable_methods, 4)
  const fallbackMethods = [
    `${topic}에서 먼저 확인할 기준을 한 가지 정한다`,
    `${topic}을 실행할 순서를 두 단계로 나눠 적용한다`,
  ]
  const coreInformation = normalizeList(value.coreInformation || value.core_information, 4)

  return {
    targetAudience: normalizeText(
      value.targetAudience || value.target_audience || persona.job || accountSettings.targetAudience || '이 주제에 관심 있는 시청자',
      300,
    ),
    specificPain: normalizeText(
      value.specificPain || value.specific_pain || persona.painPoints || `${topic}을 해도 원하는 결과가 잘 나지 않는 문제`,
      500,
    ),
    desiredOutcome: normalizeText(
      value.desiredOutcome || value.desired_outcome || persona.desiredChange || `${topic}을 더 쉽고 정확하게 실행하는 상태`,
      500,
    ),
    coreInformation: coreInformation.length
      ? coreInformation
      : [
          `${topic}의 결과를 가르는 핵심 기준`,
          `${topic}을 실제로 적용할 때 지켜야 할 순서`,
        ],
    actionableMethods: actionableMethods.length >= 2 ? actionableMethods : fallbackMethods,
    allowedEvidence: normalizeList(value.allowedEvidence || value.allowed_evidence, 4),
    forbiddenClaims: [
      ...normalizeList(value.forbiddenClaims || value.forbidden_claims, 5),
      '확인되지 않은 수치, 성과, 전문가 권위와 실제 경험을 만들지 않는다',
    ].slice(0, 5),
    ctaCandidates: normalizeList(value.ctaCandidates || value.cta_candidates, 4).length
      ? normalizeList(value.ctaCandidates || value.cta_candidates, 4)
      : ['저장', '댓글', '공유'],
  }
}

function normalizeVariation(value = {}, index = 0) {
  const config = TOPIC_VARIATION_CONFIGS[index]
  return {
    variantId: config.key,
    variantKey: config.key,
    label: `${config.key}안`,
    angle: config.label,
    hook: String(value?.hook || '').trim(),
    body: String(value?.body || '').trim(),
    cta: String(value?.cta || '').trim(),
    usedKnowledge: [],
    usedChunkIds: [],
  }
}

function buildAccountContext(accountSettings = {}, characterSystemPrompt = '') {
  const settings = accountSettings && typeof accountSettings === 'object' ? accountSettings : {}
  const persona = settings.persona && typeof settings.persona === 'object' ? settings.persona : {}
  const products = Array.isArray(settings.products) ? settings.products.slice(0, 3) : []
  return [
    settings.category ? `카테고리: ${settings.category}` : '',
    persona.job ? `타깃 직업/상황: ${persona.job}` : '',
    persona.interests ? `타깃 관심사: ${persona.interests}` : '',
    persona.painPoints ? `타깃 고민: ${persona.painPoints}` : '',
    persona.desiredChange ? `타깃이 원하는 변화: ${persona.desiredChange}` : '',
    settings.voiceTone ? `말투: ${settings.voiceTone}` : '',
    settings.toneGuide ? `톤 가이드: ${settings.toneGuide}` : '',
    settings.forbiddenExpressions ? `금지 표현: ${settings.forbiddenExpressions}` : '',
    products.length
      ? `연계 상품/서비스: ${products.map((item) => item?.name || item?.description).filter(Boolean).join(', ')}`
      : '',
    characterSystemPrompt ? `캐릭터 참고 정보:\n${characterSystemPrompt}` : '',
  ].filter(Boolean).join('\n')
}

function buildCategoryPlaybookPrompt(category = '') {
  const playbook = CATEGORY_PLAYBOOKS[category] || CATEGORY_PLAYBOOKS.기타
  if (!playbook) return '- 카테고리 플레이북 없음'
  return [
    playbook.uiCopy?.insight,
    playbook.uiCopy?.hookAiRule,
    ...(playbook.promptRules?.hard || []).map((item) => `금지: ${item}`),
    ...(playbook.promptRules?.soft || []).map((item) => `권장: ${item}`),
    ...(playbook.generationHints?.winningStructures || []).map((item) => `유효 구조: ${item}`),
  ].filter(Boolean).join('\n') || '- 카테고리 플레이북 없음'
}

function buildGenerationPrompt({ topic, accountContext, categoryPrompt, hookTemplates, narrativePatterns }) {
  return `릴스 주제: ${topic}\n\n계정/타깃 설정:\n${accountContext || '설정 없음'}\n\n카테고리 기준:\n${categoryPrompt}\n\n검색된 훅 성공공식(원문/예시 복사 금지, 추상 원리만 사용):\n${hookTemplates}\n\n검색된 서사 성공공식(C안에만 참고, 실제 경험 창작 금지):\n${narrativePatterns}\n\n먼저 세 안이 공유할 topicBrief를 설계한 뒤 A/B/C 대본을 작성하세요.\n\nA안 손실 회피형:\n- 놓치기 쉬운 행동/실수 → 구체적 손실 → 이유 → 예방 방법 2~4개 → 손실 방지 CTA.\n- HOOK은 질문하지 말고, 타깃의 현재 행동과 그 결과로 생기는 손실을 경고형 단정문으로 즉시 연결한다.\n- HOOK 문법은 “{현재 행동을 계속하면} {구체적 손실이 생긴다}”이며 무엇을 잃는지 생략하지 않는다.\n- 돈뿐 아니라 시간, 노동, 기회, 결과 저하, 반복 실패도 손실로 볼 수 있다. 공포 과장과 확인되지 않은 보장은 금지한다.\n\nB안 통념 반박형:\n- 흔한 믿음/방식 → 짧은 반박 → 왜 충분하지 않은지 → 올바른 판단 기준 → 적용 방법 2~4개 → CTA.\n- HOOK은 질문하지 말고 “문제는 X가 아니라 Y”, “X만으로는 부족하고 Y가 먼저”처럼 통념 X와 새 기준 Y를 한 문장 안에서 직접 대조한다.\n- 단순한 문제 질문, 손실 경고, 상황 공감으로 시작하면 B안 실패다.\n- 반박할 통념이 약하면 억지 논쟁 대신 잘못된 실행 순서 X와 올바른 순서 Y를 대조한다.\n\nC안 공감 스토리형:\n- 타깃의 구체적 일상 장면 → 불편/감정 → 막히는 지점 → 발견한 기준 → 실행 방법 2~4개 → CTA.\n- HOOK 첫 문장은 시간/장소/행동이 보이는 한 장면으로 시작한다. 추상적인 고민 질문으로 시작하지 않는다.\n- “~할 때마다”, “~하는 순간”, “막상 ~하려는데”처럼 장면을 연 뒤 타깃의 불편이나 감정을 붙인다.\n- 화자의 실제 경험처럼 쓰거나 허위 고객·가족·전문가 발언과 성과 사례를 만들지 않는다. 전체 대본의 절반 이상은 실행 정보여야 한다.\n\n공통 품질 계약:\n- 세 안은 같은 핵심 정보와 실행 방법을 공유하되 감정 진입점과 전개 방식은 분명히 다르게 한다.\n- 세 HOOK의 첫 문장 문법을 서로 다르게 만든다: A=손실 경고형 단정, B=통념 대조형 단정, C=장면 서사형.\n- 세 HOOK을 모두 질문형으로 쓰거나 같은 문제를 단어만 바꿔 반복하면 실패다.\n- 각 안의 BODY에 바로 실행할 수 있는 정보가 최소 2개 있어야 한다.\n- 인사말, 계정 ID, 자기소개, 내부 규칙명, 검색된 원문/예시는 출력하지 않는다.\n- 최신 통계, 허위 경험, 성과, 수치, 전문가 권위는 만들지 않는다.\n- CTA는 저장/댓글/공유/팔로우 중 내용상 가장 자연스러운 하나만 고른다.\n- 대본은 실제 말하는 자연스러운 한국어로 쓰고 HOOK/BODY/CTA 라벨을 본문에 넣지 않는다.\n\nJSON 형식만 반환하세요:\n{"topicBrief":{"targetAudience":"","specificPain":"","desiredOutcome":"","coreInformation":[""],"actionableMethods":["",""],"allowedEvidence":[""],"forbiddenClaims":[""],"ctaCandidates":[""]},"variations":[{"hook":"","body":"","cta":""},{"hook":"","body":"","cta":""},{"hook":"","body":"","cta":""}]}`
}

function variationsToSentences(variations = []) {
  return variations.flatMap((variation, index) => [
    { id: `${index}-hook`, stage: 'HOOK', section: 'hook', sentenceRole: 'HOOK_START', text: variation.hook },
    { id: `${index}-body`, stage: 'BODY', section: 'body', sentenceRole: 'BODY_SOLUTION', text: variation.body },
    { id: `${index}-cta`, stage: 'CTA', section: 'cta', sentenceRole: 'CTA', text: variation.cta },
  ])
}

async function collectWritingRules(variations) {
  const result = await retrieveWritingPlaybookRulesForSentences({
    sentences: variationsToSentences(variations),
    variantLabel: 'topic_only',
    topK: 2,
  })
  const unique = new Map()
  for (const rules of result.rulesBySentenceId?.values?.() || []) {
    for (const rule of rules || []) {
      unique.set(rule.rule_key || rule.id, rule)
    }
  }
  return Array.from(unique.values()).slice(0, 8)
}

async function repairAndPolish({ openai, model, topic, topicBrief, variations, rules, usageContext }) {
  const validation = validateTopicVariationSet(variations)
  const response = await openai.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: '당신은 이미 설계된 숏폼 대본을 검수하고 문장 품질만 보정하는 편집자다. 세 안의 컨셉과 핵심 정보는 바꾸지 않는다. JSON만 반환한다.',
      },
      {
        role: 'user',
        content: `주제: ${topic}\n공유 기획 요약: ${JSON.stringify(topicBrief)}\n\n현재 초안: ${JSON.stringify(variations)}\n\n안별 검증 이슈: ${JSON.stringify(validation.issuesByIndex)}\n\n문장 보정 규칙(구조 창작에 사용 금지):\n${formatWritingPlaybookRulesForPrompt(rules)}\n\n수정 조건:\n- A HOOK은 현재 행동이 초래할 구체적 손실을 질문 없이 경고형 단정문으로 쓴다.\n- B HOOK은 흔한 통념 X와 새 판단 기준 Y를 질문 없이 한 문장 안에서 직접 대조한다.\n- C HOOK은 시간/장소/행동이 보이는 구체 장면으로 시작하고 감정을 연결한다. 허위 1인칭 경험은 만들지 않는다.\n- 세 HOOK을 같은 질문형이나 같은 문장 골격으로 쓰지 않는다. 첫 문장만 읽어도 유형을 구분할 수 있어야 한다.\n- 각 BODY에 실행 정보 최소 2개를 명확하게 넣는다.\n- 인사말, 자기소개, @계정, 내부 규칙명, 근거 없는 숫자/성과를 제거한다.\n- 원래보다 구체적이고 압축된 자연스러운 한국어로 보정한다.\n- JSON만 반환한다: {"variations":[{"hook":"","body":"","cta":""},{"hook":"","body":"","cta":""},{"hook":"","body":"","cta":""}]}`,
      },
    ],
  })
  logAIUsage('topic-script-polish', response, { model, ...usageContext })
  const parsed = parseModelJson(response.choices[0]?.message?.content || '')
  const repaired = Array.isArray(parsed?.variations) ? parsed.variations : []
  return TOPIC_VARIATION_CONFIGS.map((_, index) => normalizeVariation(repaired[index] || variations[index], index))
}

function buildFallbackVariation(topic, brief, index) {
  const methods = brief.actionableMethods.slice(0, 3)
  const methodText = methods.map((item, methodIndex) => `${methodIndex + 1}. ${item}`).join(' ')
  if (index === 0) {
    return normalizeVariation({
      hook: `${topic}, 기준 없이 계속하면 같은 일을 두 번 하며 시간과 노력을 낭비하게 됩니다.`,
      body: `결과가 더뎌지는 이유는 기준 없이 한 번에 바꾸려 하기 때문입니다. ${methodText}`,
      cta: '다음에 놓치지 않도록 저장해두고 하나씩 체크해보세요.',
    }, index)
  }
  if (index === 1) {
    return normalizeVariation({
      hook: `${topic}의 문제는 적게 하는 게 아니라, 판단 기준 없이 반복하는 데 있습니다.`,
      body: `흔히 양부터 늘리지만 그것만으로는 충분하지 않습니다. ${methodText}`,
      cta: '기존 방식과 비교해보고 도움이 될 사람에게 공유해보세요.',
    }, index)
  }
  return normalizeVariation({
    hook: `${topic}을 다시 해보려는 순간, 어디서부터 손대야 할지 막혀 같은 자리에서 멈추게 됩니다.`,
    body: `열심히 해도 기준이 없으면 같은 지점에서 다시 멈추기 쉽습니다. 이럴 때는 순서를 단순하게 잡아야 합니다. ${methodText}`,
    cta: '비슷한 순간에 바로 꺼내볼 수 있게 저장해두세요.',
  }, index)
}

function buildReferencePayload({ topic, title, projectId, clientGenerationId }) {
  const now = new Date().toISOString()
  return {
    title: normalizeText(title, 200) || `${normalizeText(topic, 120)} 기획`,
    topic: normalizeText(topic, 500),
    original_filename: '주제만으로 기획',
    mime_type: 'application/x-hookai-topic',
    project_id: projectId || null,
    source_mode: 'topic_only',
    topic_brief: {},
    transcript: '',
    transcript_segments: [],
    frame_timestamps: [],
    frame_notes: [],
    variations: [],
    processing_status: 'processing',
    current_stage: 'topic_planning',
    idempotency_key: clientGenerationId || null,
    processing_started_at: now,
    last_heartbeat_at: now,
    error_message: null,
  }
}

export async function generateTopicOnlyScripts({
  accountId,
  topic,
  title = '',
  projectId = null,
  clientGenerationId = '',
  characterSystemPrompt = '',
  accountSettings = {},
  usageContext = {},
  beforeCreate = null,
}) {
  if (!hasSupabaseAdminConfig()) {
    throw new AppError('Supabase admin client is not configured', { code: 'SUPABASE_NOT_CONFIGURED', statusCode: 500 })
  }
  const normalizedTopic = normalizeText(topic, 500)
  if (normalizedTopic.length < 2) {
    throw new AppError('릴스 주제를 2자 이상 입력해주세요.', { code: 'TOPIC_TOO_SHORT', statusCode: 400 })
  }

  const supabaseAdmin = getSupabaseAdmin()
  const normalizedIdempotencyKey = normalizeText(clientGenerationId, 200)
  if (normalizedIdempotencyKey) {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('reference_videos')
      .select('*')
      .eq('account_id', accountId)
      .eq('idempotency_key', normalizedIdempotencyKey)
      .eq('source_mode', 'topic_only')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existingError) throw existingError
    if (existing) return { analysis: existing, reused: true, creationContext: null }
  }

  if (!hasOpenAIConfig()) {
    throw new AppError('OpenAI client is not configured', { code: 'OPENAI_NOT_CONFIGURED', statusCode: 500 })
  }
  const creationContext = typeof beforeCreate === 'function' ? await beforeCreate() : null
  const referenceId = randomUUID()
  const { error: createError } = await supabaseAdmin
    .from('reference_videos')
    .insert({
      id: referenceId,
      account_id: accountId,
      ...buildReferencePayload({ topic: normalizedTopic, title, projectId, clientGenerationId: normalizedIdempotencyKey }),
    })
    .select('*')
    .single()
  if (createError) {
    if (createError.code === '23505' && normalizedIdempotencyKey) {
      const { data: racedExisting, error: racedExistingError } = await supabaseAdmin
        .from('reference_videos')
        .select('*')
        .eq('account_id', accountId)
        .eq('idempotency_key', normalizedIdempotencyKey)
        .eq('source_mode', 'topic_only')
        .maybeSingle()
      if (!racedExistingError && racedExisting) {
        return { analysis: racedExisting, reused: true, creationContext: null }
      }
    }
    throw new AppError('주제 기획 작업을 만들지 못했습니다.', { code: 'TOPIC_GENERATION_CREATE_FAILED', statusCode: 500, cause: createError })
  }

  const openai = getOpenAIClient()
  const { variationModel } = getOpenAIModels()
  const category = normalizeText(accountSettings?.category || '', 100)
  const accountContext = buildAccountContext(accountSettings, characterSystemPrompt)

  try {
    const [hookResult, narrativeResult] = await Promise.all([
      retrieveHookTemplates({ topic: normalizedTopic, target: accountSettings?.persona?.job || '', category, purpose: '정보 기반 반응 유도', topK: 5 }),
      retrieveNarrativePatterns({ request: `주제만으로 정보형 릴스 기획: ${normalizedTopic}`, reference: { topic: normalizedTopic }, selectedLabel: '공감 스토리형', topK: 2 }),
    ])
    const response = await openai.chat.completions.create({
      model: variationModel,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: '당신은 레퍼런스 영상 없이도 타깃에게 실질적으로 유용한 숏폼 대본을 설계하는 콘텐츠 전략가다. 정보 가치와 실행 가능성을 최우선으로 하며 JSON만 반환한다.',
        },
        {
          role: 'user',
          content: buildGenerationPrompt({
            topic: normalizedTopic,
            accountContext,
            categoryPrompt: buildCategoryPlaybookPrompt(category),
            hookTemplates: formatHookTemplatesForPrompt(hookResult.templates || [], 5),
            narrativePatterns: formatNarrativePatternsForPrompt(narrativeResult.patterns || [], 2),
          }),
        },
      ],
    })
    logAIUsage('topic-script-generation', response, { model: variationModel, accountId, referenceId, ...usageContext })
    const parsed = parseModelJson(response.choices[0]?.message?.content || '')
    const topicBrief = normalizeTopicBrief(parsed?.topicBrief || {}, normalizedTopic, accountSettings)
    let variations = TOPIC_VARIATION_CONFIGS.map((_, index) => normalizeVariation(parsed?.variations?.[index] || {}, index))
    const rules = await collectWritingRules(variations)
    variations = await repairAndPolish({
      openai,
      model: variationModel,
      topic: normalizedTopic,
      topicBrief,
      variations,
      rules,
      usageContext: { accountId, referenceId, ...usageContext },
    })
    const finalValidation = validateTopicVariationSet(variations)
    variations = variations.map((variation, index) =>
      finalValidation.issuesByIndex[index].length === 0
        ? variation
        : buildFallbackVariation(normalizedTopic, topicBrief, index),
    )

    const structureAnalysis = '세 안은 같은 핵심 정보를 공유하고 손실 회피, 통념 교정, 공감 상황이라는 서로 다른 진입점으로 전개됩니다.'
    const hookAnalysis = `핵심 타깃인 ${topicBrief.targetAudience}이 겪는 ${topicBrief.specificPain}을 첫 문장에서 바로 자기 문제로 인식하도록 설계했습니다.`
    const psychologyAnalysis = '놓치고 싶지 않은 마음, 새로운 판단 기준을 얻는 만족감, 내 상황과 닮았다는 공감을 각각 활용합니다.'
    const aiFeedback = `실행 방법 ${topicBrief.actionableMethods.length}개를 중심으로 정보 밀도와 반응 CTA를 함께 점검했습니다.`
    const completedAt = new Date().toISOString()
    const { data: completed, error: updateError } = await supabaseAdmin
      .from('reference_videos')
      .update({
        topic_brief: topicBrief,
        variations,
        structure_analysis: structureAnalysis,
        hook_analysis: hookAnalysis,
        psychology_analysis: psychologyAnalysis,
        ai_feedback: aiFeedback,
        processing_status: 'completed',
        current_stage: 'completed',
        processing_completed_at: completedAt,
        last_heartbeat_at: completedAt,
        error_message: null,
      })
      .eq('id', referenceId)
      .eq('account_id', accountId)
      .select('*')
      .single()
    if (updateError) throw updateError
    return { analysis: completed, reused: false, creationContext }
  } catch (error) {
    logAIError('topic-script-generation', error, { accountId, referenceId, topic: normalizedTopic })
    await supabaseAdmin
      .from('reference_videos')
      .update({
        processing_status: 'failed',
        current_stage: 'failed',
        failure_stage: 'topic_generation',
        failure_code: String(error?.code || 'TOPIC_GENERATION_FAILED'),
        failure_message: '주제 기반 대본 생성에 실패했습니다.',
        error_message: '주제 기반 대본 생성에 실패했습니다. 잠시 후 다시 시도해주세요.',
        last_heartbeat_at: new Date().toISOString(),
      })
      .eq('id', referenceId)
      .eq('account_id', accountId)
    throw new AppError('주제 기반 대본 생성에 실패했습니다. 잠시 후 다시 시도해주세요.', {
      code: 'TOPIC_GENERATION_FAILED',
      statusCode: 500,
      cause: error,
    })
  }
}

export const __topicScriptGenerationTest = {
  normalizeTopicBrief,
  normalizeVariation,
  countActionSignals: countTopicActionSignals,
  buildFallbackVariation,
}
