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
  estimateTopicSpeechSeconds,
  validateTopicVariationSet,
} from './topic-script-validation.js'
import {
  assessTopicReadiness,
  normalizeTopicClarifications,
} from './topic-script-preflight.js'

export { validateTopicVariation, validateTopicVariationSet } from './topic-script-validation.js'
export { assessTopicReadiness } from './topic-script-preflight.js'

const HIGH_RISK_TOPIC_PATTERN = /(?:의료|질병|증상|진단|치료|약|복용|영양제|임신|출산|아기\s*안전|육아\s*안전|법률|소송|계약서|세금|절세|투자|주식|코인|대출|보험|재무|금융)/i
const CURRENT_INFO_PATTERN = /(?:최신|현재|올해|요즘|지금|정책|법\s*개정|알고리즘|금리|가격|지원금|통계|트렌드|업데이트)/i
const MIN_FACTS = 3
const MIN_METHODS = 3

function normalizeText(value = '', maxLength = 20000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function normalizeList(value, maxItems = 6, maxLength = 500) {
  if (!Array.isArray(value)) return []
  return value.map((item) => normalizeText(item, maxLength)).filter(Boolean).slice(0, maxItems)
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

function normalizeVariation(value = {}, index = 0) {
  const config = TOPIC_VARIATION_CONFIGS[index]
  const variation = {
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
  variation.estimatedDurationSeconds = estimateTopicSpeechSeconds(variation)
  return variation
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

function classifyTopicRisk(topic = '') {
  if (HIGH_RISK_TOPIC_PATTERN.test(topic)) return 'high_risk'
  if (CURRENT_INFO_PATTERN.test(topic)) return 'current_info'
  return 'general'
}

function extractResponseSources(response = {}) {
  const sources = new Map()
  for (const outputItem of response.output || []) {
    if (outputItem?.type !== 'message') continue
    for (const content of outputItem.content || []) {
      for (const annotation of content?.annotations || []) {
        const citation = annotation?.url_citation || annotation
        const url = normalizeText(citation?.url, 1000)
        if (!url) continue
        sources.set(url, {
          id: `source-${sources.size + 1}`,
          title: normalizeText(citation?.title, 300) || url,
          url,
        })
      }
    }
  }
  return Array.from(sources.values()).slice(0, 3)
}

async function gatherEvidence({ openai, model, topic, readiness, riskLevel, accountId, referenceId, usageContext }) {
  if (riskLevel === 'general') {
    return { searched: false, sources: [], evidenceNotes: [], safeMode: false }
  }

  try {
    const response = await openai.responses.create({
      model,
      tools: [{ type: 'web_search', search_context_size: 'low' }],
      input:
        '다음 숏폼 주제의 사실 검증용 근거를 조사한다. 정부·공공기관·학술기관·공식 제품 문서 등 권위 있는 출처를 우선한다. ' +
        '광고성 주장, 개인 후기, 검증되지 않은 수치를 제외한다. 대본은 쓰지 말고 JSON만 반환한다.\n\n' +
        `주제: ${topic}\n타깃: ${readiness.inferredContext.targetAudience}\n문제: ${readiness.inferredContext.specificProblem}\n원하는 결과: ${readiness.inferredContext.desiredOutcome}\n` +
        '형식: {"evidenceNotes":["검증된 사실 또는 안전한 표현"],"unsafeClaims":["피해야 할 단정"],"canGeneralizeSafely":true}',
    })
    logAIUsage('topic-script-grounding', response, { model, accountId, referenceId, ...usageContext })
    const parsed = parseModelJson(response.output_text || '') || {}
    const sources = extractResponseSources(response)
    const evidenceNotes = normalizeList(parsed.evidenceNotes, 6, 700)
    const canGeneralizeSafely = parsed.canGeneralizeSafely !== false
    if (riskLevel === 'high_risk' && (!evidenceNotes.length || !sources.length || !canGeneralizeSafely)) {
      throw new AppError('전문 주제의 근거를 충분히 확인하지 못했습니다.', {
        code: 'TOPIC_GROUNDING_REQUIRED',
        statusCode: 422,
        exposeMessage: true,
      })
    }
    return {
      searched: true,
      sources,
      evidenceNotes,
      unsafeClaims: normalizeList(parsed.unsafeClaims, 6, 500),
      safeMode: !canGeneralizeSafely || sources.length === 0,
    }
  } catch (error) {
    if (riskLevel === 'high_risk') {
      throw new AppError('전문 주제의 근거를 확인하지 못했어요. 공식 자료를 함께 입력하거나 주제를 일반 정보형으로 좁혀주세요.', {
        code: 'TOPIC_GROUNDING_REQUIRED',
        statusCode: 422,
        exposeMessage: true,
        cause: error,
      })
    }
    return {
      searched: false,
      sources: [],
      evidenceNotes: [],
      unsafeClaims: ['최신 수치와 현재 정책을 단정하지 않는다'],
      safeMode: true,
    }
  }
}

function normalizeFactPack(value = {}, evidence = {}) {
  const rawFacts = Array.isArray(value.coreFacts) ? value.coreFacts : []
  const rawMethods = Array.isArray(value.actionableMethods) ? value.actionableMethods : []
  const coreFacts = rawFacts.slice(0, 5).map((item, index) => ({
    id: normalizeText(item?.id, 40) || `fact-${index + 1}`,
    claim: normalizeText(item?.claim || item, 700),
    why: normalizeText(item?.why, 700),
    condition: normalizeText(item?.condition, 500),
    keywords: normalizeList(item?.keywords, 8, 80),
    evidenceSourceIds: normalizeList(item?.evidenceSourceIds, 3, 80),
  })).filter((item) => item.claim && item.why)
  const actionableMethods = rawMethods.slice(0, 5).map((item, index) => ({
    id: normalizeText(item?.id, 40) || `method-${index + 1}`,
    action: normalizeText(item?.action || item, 500),
    how: normalizeText(item?.how, 700),
    whyOrWhen: normalizeText(item?.whyOrWhen || item?.why_or_when, 700),
  })).filter((item) => item.action && item.how && item.whyOrWhen)
  return {
    coreFacts,
    actionableMethods,
    cautions: normalizeList(value.cautions, 6, 500),
    forbiddenClaims: [
      ...normalizeList(value.forbiddenClaims, 6, 500),
      ...normalizeList(evidence.unsafeClaims, 6, 500),
      '확인되지 않은 수치, 성과, 전문가 권위와 실제 경험을 만들지 않는다',
    ].filter(Boolean).slice(0, 8),
  }
}

function normalizeOutline(value = {}, index = 0) {
  const config = TOPIC_VARIATION_CONFIGS[index]
  const beats = (Array.isArray(value.beats) ? value.beats : []).slice(0, 13).map((item, beatIndex) => ({
    order: beatIndex + 1,
    section: ['hook', 'body', 'cta'].includes(String(item?.section || '').toLowerCase())
      ? String(item.section).toLowerCase()
      : beatIndex < 2 ? 'hook' : beatIndex >= 10 ? 'cta' : 'body',
    role: normalizeText(item?.role, 120),
    goal: normalizeText(item?.goal, 500),
    bridgeToNext: normalizeText(item?.bridgeToNext || item?.bridge_to_next, 500),
    factIds: normalizeList(item?.factIds, 4, 40),
    methodIds: normalizeList(item?.methodIds, 4, 40),
  })).filter((item) => item.goal)
  return { key: config.key, label: config.label, beats }
}

function normalizePlanningResult(parsed = {}, { topic, readiness, evidence, riskLevel }) {
  const contentBriefRaw = parsed.contentBrief || parsed.topicBrief || {}
  const factPack = normalizeFactPack(parsed.factPack || {}, evidence)
  const outlines = TOPIC_VARIATION_CONFIGS.map((_, index) => normalizeOutline(parsed.outlines?.[index] || {}, index))
  const contentBrief = {
    targetAudience: normalizeText(contentBriefRaw.targetAudience, 300) || readiness.inferredContext.targetAudience,
    specificProblem: normalizeText(contentBriefRaw.specificProblem, 500) || readiness.inferredContext.specificProblem,
    desiredOutcome: normalizeText(contentBriefRaw.desiredOutcome, 500) || readiness.inferredContext.desiredOutcome,
    corePromise: normalizeText(contentBriefRaw.corePromise, 500),
    topic,
  }

  if (!contentBrief.targetAudience || !contentBrief.specificProblem || !contentBrief.desiredOutcome || !contentBrief.corePromise) {
    throw new AppError('주제 기획의 핵심 맥락이 충분하지 않습니다.', {
      code: 'TOPIC_PLANNING_INCOMPLETE', statusCode: 422, exposeMessage: true,
    })
  }
  if (factPack.coreFacts.length < MIN_FACTS || factPack.actionableMethods.length < MIN_METHODS) {
    throw new AppError('검증 가능한 핵심 정보와 실행 방법을 충분히 구성하지 못했습니다.', {
      code: 'TOPIC_FACT_PACK_INCOMPLETE', statusCode: 422, exposeMessage: true,
    })
  }
  if (outlines.some((outline) => outline.beats.length < 9)) {
    throw new AppError('60초 이상 대본을 위한 구성안이 충분하지 않습니다.', {
      code: 'TOPIC_OUTLINE_INCOMPLETE', statusCode: 422, exposeMessage: true,
    })
  }

  return {
    inputQuality: readiness.inputQuality,
    clarifications: readiness.clarifications,
    contentBrief,
    factPack,
    riskLevel,
    grounding: evidence,
    durationTarget: { minimumSeconds: 60, maximumSeconds: 90, minimumSentences: 9, maximumSentences: 13 },
    outlines,
  }
}

function buildPlanningPrompt({ topic, readiness, accountContext, categoryPrompt, hookTemplates, narrativePatterns, evidence, riskLevel }) {
  return `릴스 주제: ${topic}\n위험도: ${riskLevel}\n\n추가 답변/계정에서 확정된 맥락:\n${JSON.stringify(readiness.inferredContext)}\n\n계정 설정:\n${accountContext || '설정 없음'}\n\n카테고리 기준:\n${categoryPrompt}\n\n검증 근거:\n${evidence.evidenceNotes?.join('\n') || '외부 근거 검색 대상 아님. 확인되지 않은 수치와 성과는 사용 금지.'}\n\n훅 성공공식(표현 복사 금지):\n${hookTemplates}\n\n서사 성공공식(C안에만 추상 원리로 사용):\n${narrativePatterns}\n\n대본을 쓰기 전에 정보 설계와 세 구성안을 만든다.\n- coreFacts는 서로 중복되지 않는 핵심 정보 3~5개다. claim만 쓰지 말고 왜 그런지와 적용 조건을 함께 적는다.\n- actionableMethods는 바로 실행 가능한 방법 3~5개다. 각 방법에 action, how, whyOrWhen을 모두 적는다.\n- “기준을 정한다”, “순서를 나눈다”, “꾸준히 한다” 같은 일반론은 금지한다.\n- 각 outline은 9~13개의 beat로 만들고 HOOK 1~2개, BODY 7~10개, CTA 1개로 구성한다.\n- 모든 beat에는 다음 문장으로 이어지는 이유 bridgeToNext를 적는다.\n- A는 현재 행동→손실→원인→예방 기준→방법→저장 CTA.\n- B는 흔한 믿음→반박→근거→새 기준→방법→의견/공유 CTA.\n- C는 장면→감정→막힘→관점 전환→방법→공감 CTA.\n- 세 안은 같은 factPack을 사용하고 관점과 전개만 다르게 한다.\n- 근거에 없는 수치, 진단, 보장, 전문가 권위, 실제 경험을 만들지 않는다.\n\nJSON만 반환한다:\n{"contentBrief":{"targetAudience":"","specificProblem":"","desiredOutcome":"","corePromise":""},"factPack":{"coreFacts":[{"id":"fact-1","claim":"","why":"","condition":"","keywords":[""]}],"actionableMethods":[{"id":"method-1","action":"","how":"","whyOrWhen":""}],"cautions":[""],"forbiddenClaims":[""]},"outlines":[{"beats":[{"section":"hook|body|cta","role":"","goal":"","bridgeToNext":"","factIds":["fact-1"],"methodIds":["method-1"]}]},{"beats":[]},{"beats":[]}]}`
}

function buildVariationPrompt({ planning, outline, config, writingRules }) {
  return `공유 기획:\n${JSON.stringify(planning.contentBrief)}\n\n검증된 정보팩:\n${JSON.stringify(planning.factPack)}\n\n이 안의 문장 구성안:\n${JSON.stringify(outline)}\n\n문장 보정 규칙:\n${writingRules || '없음'}\n\n${config.key}안 ${config.label} 대본만 작성한다.\n- 구성안 beat 1개를 결과 문장 1개로 작성하고 순서를 바꾸거나 생략하지 않는다.\n- 전체 9~13문장, HOOK 1~2문장, BODY 7~10문장, CTA 1문장이다.\n- 예상 발화 시간은 60~90초다. 공백과 문장부호 제외 글자 수를 초당 4.5자로 계산한다.\n- BODY에 정보팩의 실행 방법을 최소 3개 넣고 각 방법마다 무엇을 어떻게 해야 하는지와 이유 또는 적용 시점을 말한다.\n- HOOK의 약속이나 문제를 BODY 첫 두 문장 안에서 같은 핵심어로 이어받는다.\n- CTA는 BODY 결론에서 자연스럽게 이어지는 행동 하나만 제안한다.\n- 사실은 정보팩 범위 안에서만 쓴다. 새로운 수치·성과·경험·권위를 만들지 않는다.\n- 인사말, 자기소개, 계정 ID, 내부 규칙명, HOOK/BODY/CTA 라벨은 쓰지 않는다.\n- 실제 사람이 말하는 자연스러운 한국어로 쓴다.\n- ${config.key === 'A' ? 'HOOK은 질문하지 말고 현재 행동이 만드는 구체적 손실을 단정한다.' : config.key === 'B' ? 'HOOK은 질문하지 말고 흔한 믿음 X와 새 기준 Y를 한 문장 안에서 직접 대조한다.' : 'HOOK은 시간·장소·행동이 보이는 구체적 장면으로 시작하고 허위 1인칭 경험은 쓰지 않는다.'}\n\nJSON만 반환한다: {"hook":"","body":"","cta":""}`
}

function planningToSentences(planning = {}) {
  return (planning.outlines || []).flatMap((outline) => outline.beats.map((beat) => ({
    id: `${outline.key}-${beat.order}`,
    stage: String(beat.section || 'body').toUpperCase(),
    section: beat.section,
    sentenceRole: beat.role || 'BODY_SOLUTION',
    text: beat.goal,
  })))
}

async function collectWritingRules(planning) {
  const result = await retrieveWritingPlaybookRulesForSentences({
    sentences: planningToSentences(planning),
    variantLabel: 'topic_only',
    topK: 2,
  })
  const unique = new Map()
  for (const rules of result.rulesBySentenceId?.values?.() || []) {
    for (const rule of rules || []) unique.set(rule.rule_key || rule.id, rule)
  }
  return Array.from(unique.values()).slice(0, 8)
}

function normalizeEvaluation(parsed = {}) {
  const items = Array.isArray(parsed.evaluations) ? parsed.evaluations : []
  return TOPIC_VARIATION_CONFIGS.map((config, index) => {
    const item = items[index] || {}
    const scores = {
      relevance: Number(item?.scores?.relevance || 0),
      coherence: Number(item?.scores?.coherence || 0),
      specificity: Number(item?.scores?.specificity || 0),
      factualSafety: Number(item?.scores?.factualSafety || 0),
      naturalness: Number(item?.scores?.naturalness || 0),
    }
    const pass = scores.relevance >= 4 && scores.coherence >= 4 && scores.specificity >= 4 && scores.factualSafety >= 4 && scores.naturalness >= 3.5
    return { key: config.key, pass, scores, issues: normalizeList(item.issues, 8, 500) }
  })
}

async function evaluateVariations({ openai, model, planning, variations, hardValidation, accountId, referenceId, usageContext }) {
  const response = await openai.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: '당신은 숏폼 정보 대본 품질 심사자다. 문체 취향이 아니라 주제 적합성, 문장 연결, 정보 구체성, 사실 안전성, 말하기 자연스러움을 엄격하게 평가한다. JSON만 반환한다.',
      },
      {
        role: 'user',
        content: `공유 기획과 정보팩:\n${JSON.stringify(planning)}\n\n대본:\n${JSON.stringify(variations)}\n\n코드 검증 결과:\n${JSON.stringify(hardValidation.issuesByIndex)}\n\n각 안을 1~5점으로 평가한다.\n- relevance: 주제·타깃·약속 일치\n- coherence: HOOK→BODY→CTA와 문장 사이 인과 연결\n- specificity: 실행 정보가 무엇을·어떻게·왜/언제까지 설명하는지\n- factualSafety: 정보팩 밖의 주장·수치·경험이 없는지\n- naturalness: 실제 말할 수 있는 자연스러운 한국어인지\n- 코드 검증 이슈가 있으면 반드시 issues에 포함한다.\nJSON만 반환한다: {"evaluations":[{"key":"A","scores":{"relevance":0,"coherence":0,"specificity":0,"factualSafety":0,"naturalness":0},"issues":[""]},{"key":"B","scores":{},"issues":[]},{"key":"C","scores":{},"issues":[]}]}`,
      },
    ],
  })
  logAIUsage('topic-script-quality-evaluation', response, { model, accountId, referenceId, ...usageContext })
  return normalizeEvaluation(parseModelJson(response.choices[0]?.message?.content || '') || {})
}

async function repairVariation({ openai, model, planning, variation, outline, config, issues, writingRules, accountId, referenceId, usageContext }) {
  const response = await openai.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: '당신은 품질 기준에 미달한 정보형 숏폼 대본 한 안만 재작성한다. 검증된 정보팩과 원래 구성안을 벗어나지 않고 지적된 문제를 모두 해결한다. JSON만 반환한다.',
      },
      {
        role: 'user',
        content: `${buildVariationPrompt({ planning, outline, config, writingRules })}\n\n현재 대본:\n${JSON.stringify(variation)}\n\n반드시 해결할 문제:\n${issues.map((item) => `- ${item}`).join('\n')}`,
      },
    ],
  })
  logAIUsage('topic-script-quality-repair', response, { model, accountId, referenceId, label: config.key, ...usageContext })
  return normalizeVariation(parseModelJson(response.choices[0]?.message?.content || '') || {}, TOPIC_VARIATION_CONFIGS.indexOf(config))
}

function buildReferencePayload({ topic, title, projectId, clientGenerationId, readiness }) {
  const now = new Date().toISOString()
  return {
    title: normalizeText(title, 200) || `${normalizeText(topic, 120)} 기획`,
    topic: normalizeText(topic, 500),
    original_filename: '주제만으로 기획',
    mime_type: 'application/x-hookai-topic',
    project_id: projectId || null,
    source_mode: 'topic_only',
    topic_brief: {
      inputQuality: readiness.inputQuality,
      clarifications: readiness.clarifications,
    },
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

export function preflightTopicOnlyScripts({ topic, accountSettings = {}, clarifications = {} } = {}) {
  return assessTopicReadiness({ topic, accountSettings, clarifications })
}

export async function generateTopicOnlyScripts({
  accountId,
  topic,
  title = '',
  projectId = null,
  clientGenerationId = '',
  clarifications = {},
  characterSystemPrompt = '',
  accountSettings = {},
  usageContext = {},
  beforeCreate = null,
  onAccepted = null,
}) {
  if (!hasSupabaseAdminConfig()) throw new AppError('Supabase admin client is not configured', { code: 'SUPABASE_NOT_CONFIGURED', statusCode: 500 })
  const normalizedTopic = normalizeText(topic, 500)
  if (normalizedTopic.length < 2) throw new AppError('릴스 주제를 2자 이상 입력해주세요.', { code: 'TOPIC_TOO_SHORT', statusCode: 400 })

  const readiness = assessTopicReadiness({ topic: normalizedTopic, accountSettings, clarifications })
  if (!readiness.ready) {
    throw new AppError('대본 품질을 위해 주제를 조금 더 구체화해주세요.', {
      code: 'TOPIC_CLARIFICATION_REQUIRED',
      statusCode: 409,
      details: { questions: readiness.questions, inferredContext: readiness.inferredContext },
      exposeMessage: true,
    })
  }

  const supabaseAdmin = getSupabaseAdmin()
  const normalizedIdempotencyKey = normalizeText(clientGenerationId, 200)
  if (normalizedIdempotencyKey) {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('reference_videos').select('*').eq('account_id', accountId)
      .eq('idempotency_key', normalizedIdempotencyKey).eq('source_mode', 'topic_only')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (existingError) throw existingError
    if (existing) {
      if (typeof onAccepted === 'function') {
        await onAccepted(existing)
      }
      return { analysis: existing, reused: true, creationContext: null }
    }
  }

  if (!hasOpenAIConfig()) throw new AppError('OpenAI client is not configured', { code: 'OPENAI_NOT_CONFIGURED', statusCode: 500 })
  const creationContext = typeof beforeCreate === 'function' ? await beforeCreate() : null
  const referenceId = randomUUID()
  const { data: createdReference, error: createError } = await supabaseAdmin.from('reference_videos').insert({
    id: referenceId,
    account_id: accountId,
    ...buildReferencePayload({ topic: normalizedTopic, title, projectId, clientGenerationId: normalizedIdempotencyKey, readiness }),
  }).select('*').single()
  if (createError) {
    if (createError.code === '23505' && normalizedIdempotencyKey) {
      const { data: racedExisting, error: racedExistingError } = await supabaseAdmin
        .from('reference_videos').select('*').eq('account_id', accountId)
        .eq('idempotency_key', normalizedIdempotencyKey).eq('source_mode', 'topic_only').maybeSingle()
      if (!racedExistingError && racedExisting) {
        if (typeof onAccepted === 'function') {
          await onAccepted(racedExisting)
        }
        return { analysis: racedExisting, reused: true, creationContext: null }
      }
    }
    throw new AppError('주제 기획 작업을 만들지 못했습니다.', { code: 'TOPIC_GENERATION_CREATE_FAILED', statusCode: 500, cause: createError })
  }

  if (typeof onAccepted === 'function') {
    await onAccepted(createdReference)
  }

  const openai = getOpenAIClient()
  const { variationModel } = getOpenAIModels()
  const searchModel = process.env.OPENAI_SEARCH_MODEL?.trim() || variationModel
  const category = normalizeText(accountSettings?.category || '', 100)
  const accountContext = buildAccountContext(accountSettings, characterSystemPrompt)

  try {
    const riskLevel = classifyTopicRisk(`${normalizedTopic} ${readiness.inferredContext.specificProblem}`)
    const [hookResult, narrativeResult, evidence] = await Promise.all([
      retrieveHookTemplates({ topic: normalizedTopic, target: readiness.inferredContext.targetAudience, category, purpose: '정보 기반 반응 유도', topK: 5 }),
      retrieveNarrativePatterns({ request: `주제만으로 정보형 릴스 기획: ${normalizedTopic}`, reference: { topic: normalizedTopic }, selectedLabel: '공감 스토리형', topK: 2 }),
      gatherEvidence({ openai, model: searchModel, topic: normalizedTopic, readiness, riskLevel, accountId, referenceId, usageContext }),
    ])

    const planningResponse = await openai.chat.completions.create({
      model: variationModel,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '당신은 정보형 숏폼의 대본을 쓰기 전에 사실, 실행 방법, 문장별 인과 흐름을 설계하는 콘텐츠 전략가다. 일반론을 구체 정보로 위장하지 않으며 JSON만 반환한다.' },
        {
          role: 'user',
          content: buildPlanningPrompt({
            topic: normalizedTopic,
            readiness,
            accountContext,
            categoryPrompt: buildCategoryPlaybookPrompt(category),
            hookTemplates: formatHookTemplatesForPrompt(hookResult.templates || [], 5),
            narrativePatterns: formatNarrativePatternsForPrompt(narrativeResult.patterns || [], 2),
            evidence,
            riskLevel,
          }),
        },
      ],
    })
    logAIUsage('topic-script-planning', planningResponse, { model: variationModel, accountId, referenceId, ...usageContext })
    const planning = normalizePlanningResult(parseModelJson(planningResponse.choices[0]?.message?.content || '') || {}, {
      topic: normalizedTopic, readiness, evidence, riskLevel,
    })
    const rules = await collectWritingRules(planning)
    const writingRules = formatWritingPlaybookRulesForPrompt(rules)

    let variations = await Promise.all(TOPIC_VARIATION_CONFIGS.map(async (config, index) => {
      const response = await openai.chat.completions.create({
        model: variationModel,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '당신은 검증된 정보 설계와 문장별 구성안을 실제 60~90초 숏폼 대본으로 옮기는 작가다. 정보의 정확성, 연결성, 말하기 자연스러움을 동시에 지키고 JSON만 반환한다.' },
          { role: 'user', content: buildVariationPrompt({ planning, outline: planning.outlines[index], config, writingRules }) },
        ],
      })
      logAIUsage('topic-script-variation', response, { model: variationModel, accountId, referenceId, label: config.key, ...usageContext })
      return normalizeVariation(parseModelJson(response.choices[0]?.message?.content || '') || {}, index)
    }))

    const allowedEvidenceText = JSON.stringify({ evidence: planning.grounding.evidenceNotes, factPack: planning.factPack })
    let hardValidation = validateTopicVariationSet(variations, { allowedEvidenceText })
    let evaluations = await evaluateVariations({ openai, model: variationModel, planning, variations, hardValidation, accountId, referenceId, usageContext })
    const failingIndexes = TOPIC_VARIATION_CONFIGS.map((_, index) => index).filter((index) =>
      hardValidation.issuesByIndex[index].length > 0 || !evaluations[index].pass,
    )

    if (failingIndexes.length) {
      const repaired = await Promise.all(failingIndexes.map((index) => repairVariation({
        openai,
        model: variationModel,
        planning,
        variation: variations[index],
        outline: planning.outlines[index],
        config: TOPIC_VARIATION_CONFIGS[index],
        issues: [...hardValidation.issuesByIndex[index], ...evaluations[index].issues],
        writingRules,
        accountId,
        referenceId,
        usageContext,
      })))
      variations = variations.map((variation, index) => {
        const repairedIndex = failingIndexes.indexOf(index)
        return repairedIndex >= 0 ? repaired[repairedIndex] : variation
      })
      hardValidation = validateTopicVariationSet(variations, { allowedEvidenceText })
      evaluations = await evaluateVariations({ openai, model: variationModel, planning, variations, hardValidation, accountId, referenceId, usageContext })
    }

    const qualityPassed = hardValidation.ok && evaluations.every((item) => item.pass)

    const topicBrief = {
      ...planning,
      estimatedDurationSeconds: hardValidation.metricsByIndex.map((item) => item.estimatedSeconds),
      qualityScores: evaluations,
      qualityGatePassed: qualityPassed,
      qualityWarnings: qualityPassed
        ? []
        : hardValidation.issuesByIndex.map((issues, index) => ({
            key: TOPIC_VARIATION_CONFIGS[index].key,
            issues,
            evaluationIssues: evaluations[index]?.issues || [],
          })),
      repaired: failingIndexes.length > 0,
    }
    const completedAt = new Date().toISOString()
    const { data: completed, error: updateError } = await supabaseAdmin.from('reference_videos').update({
      topic_brief: topicBrief,
      variations,
      structure_analysis: '공유 정보팩을 기준으로 손실 회피, 통념 교정, 공감 상황의 인과 흐름을 각각 설계했습니다.',
      hook_analysis: `${planning.contentBrief.targetAudience}이 ${planning.contentBrief.specificProblem}을 자기 문제로 인식하도록 세 가지 진입점을 분리했습니다.`,
      psychology_analysis: '손실 방지, 새로운 판단 기준, 구체 장면 공감을 각각 활용했습니다.',
      ai_feedback: `핵심 정보 ${planning.factPack.coreFacts.length}개와 실행 방법 ${planning.factPack.actionableMethods.length}개를 기준으로 길이·연결성·사실 안전성을 검증했습니다.`,
      processing_status: 'completed',
      current_stage: 'completed',
      processing_completed_at: completedAt,
      last_heartbeat_at: completedAt,
      error_message: null,
    }).eq('id', referenceId).eq('account_id', accountId).select('*').single()
    if (updateError) throw updateError
    return { analysis: completed, reused: false, creationContext }
  } catch (error) {
    logAIError('topic-script-generation', error, { accountId, referenceId, topic: normalizedTopic })
    const exposedMessage = error?.exposeMessage ? error.message : '주제 기반 대본 생성에 실패했습니다. 잠시 후 다시 시도해주세요.'
    await supabaseAdmin.from('reference_videos').update({
      processing_status: 'failed',
      current_stage: 'failed',
      failure_stage: 'topic_generation',
      failure_code: String(error?.code || 'TOPIC_GENERATION_FAILED'),
      failure_message: exposedMessage,
      error_message: exposedMessage,
      last_heartbeat_at: new Date().toISOString(),
    }).eq('id', referenceId).eq('account_id', accountId)
    if (error instanceof AppError) throw error
    throw new AppError('주제 기반 대본 생성에 실패했습니다. 잠시 후 다시 시도해주세요.', {
      code: 'TOPIC_GENERATION_FAILED', statusCode: 500, cause: error,
    })
  }
}

export const __topicScriptGenerationTest = {
  classifyTopicRisk,
  normalizeFactPack,
  normalizeVariation,
  normalizeTopicClarifications,
}
