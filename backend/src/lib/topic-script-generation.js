import { normalizeSupportingMaterials, formatSupportingMaterials, SUPPORTING_MATERIAL_GUIDANCE } from '../../../shared/supporting-materials.mjs'
import { SPOKEN_SCRIPT_WRITING_RULES, groundedSpeechIssues } from './spoken-script.js'
import { durationWritingGuidance } from './script-duration-guidance.js'
import { TOPIC_DURATION } from '../../../shared/script-duration.mjs'
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
const MIN_FACTS = 1
const MIN_METHODS = 1

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

function readModelResult(response) {
  const choice = response?.choices?.[0]
  if (choice?.finish_reason && choice.finish_reason !== 'stop') {
    throw new AppError('대본 응답이 끝까지 수신되지 않았습니다.', {code:'INCOMPLETE_MODEL_RESPONSE',statusCode:502})
  }
  const parsed = parseModelJson(choice?.message?.content || '')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppError('대본 응답 형식을 확인하지 못했습니다.', {code:'INVALID_MODEL_RESPONSE',statusCode:502})
  }
  return parsed
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
  const coreFacts = rawFacts.slice(0, 12).map((item, index) => ({
    id: normalizeText(item?.id, 40) || `fact-${index + 1}`,
    claim: normalizeText(item?.claim || item, 700),
    why: normalizeText(item?.why, 700),
    condition: normalizeText(item?.condition, 500),
    keywords: normalizeList(item?.keywords, 8, 80),
    evidenceSourceIds: normalizeList(item?.evidenceSourceIds, 3, 80),
  })).filter((item) => item.claim && item.why)
  const actionableMethods = rawMethods.slice(0, 12).map((item, index) => ({
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
  const beats = (Array.isArray(value.beats) ? value.beats : []).slice(0, 24).map((item, beatIndex) => ({
    order: beatIndex + 1,
    section: ['hook', 'body', 'cta'].includes(String(item?.section || '').toLowerCase())
      ? String(item.section).toLowerCase()
      : beatIndex === 0 ? 'hook' : beatIndex === (value.beats?.length || 0) - 1 ? 'cta' : 'body',
    role: normalizeText(item?.role, 120),
    goal: normalizeText(item?.goal, 500),
    bridgeToNext: normalizeText(item?.bridgeToNext || item?.bridge_to_next, 500),
    factIds: normalizeList(item?.factIds, 4, 40),
    methodIds: normalizeList(item?.methodIds, 4, 40),
  })).filter((item) => item.goal)
  return { key: config.key, label: config.label, beats }
}

function normalizePlanningResult(parsed = {}, { topic, readiness, evidence, riskLevel, supportingMaterials = [] }) {
  const contentBriefRaw = parsed.contentBrief || parsed.topicBrief || {}
  const factPack = normalizeFactPack(parsed.factPack || {}, evidence)
  // One shared factual explanation + three short opening perspectives. Do
  // not ask the planner to generate three near-identical long blueprints.
  const sharedBeats = Array.isArray(parsed.sharedFlow) ? parsed.sharedFlow.slice(0, 8) : []
  const outlines = TOPIC_VARIATION_CONFIGS.map((config, index) => {
    const existing = parsed.outlines?.[index]
    if (existing?.beats?.length) return normalizeOutline(existing, index)
    const opening = normalizeText(parsed.openings?.[config.key], 250)
    const beats = sharedBeats.length ? sharedBeats : factPack.actionableMethods.map(method => ({
      goal: `${method.action}: ${method.how}. ${method.whyOrWhen}`, methodIds: [method.id],
    }))
    return normalizeOutline({beats: [...(opening ? [{section:'hook',goal:opening}] : []), ...beats]}, index)
  })
  // Resolve attachment knowledge against this topic, not unrelated account defaults.
  // Explicit answers remain binding; the non-attachment path keeps its contract.
  const resolveContext = (key, maxLength) => normalizeText(readiness.clarifications?.[key], maxLength)
    || (supportingMaterials.length ? normalizeText(contentBriefRaw[key], maxLength) : '')
    || (!supportingMaterials.length ? readiness.inferredContext[key] : '')
    || normalizeText(contentBriefRaw[key], maxLength)
  const contentBrief = {
    targetAudience: resolveContext('targetAudience', 300),
    specificProblem: resolveContext('specificProblem', 500),
    desiredOutcome: resolveContext('desiredOutcome', 500),
    corePromise: normalizeText(contentBriefRaw.corePromise, 500),
    communicationGoal: normalizeText(contentBriefRaw.communicationGoal, 500) || readiness.inferredContext.desiredOutcome,
    topic,
  }

  if (!contentBrief.targetAudience || !contentBrief.specificProblem || !contentBrief.desiredOutcome || !contentBrief.corePromise) {
    throw new AppError('주제 기획의 핵심 맥락이 충분하지 않습니다.', {
      code: 'TOPIC_PLANNING_INCOMPLETE', statusCode: 422, exposeMessage: true,
    })
  }
  if (factPack.coreFacts.length < MIN_FACTS || (!supportingMaterials.length && factPack.actionableMethods.length < MIN_METHODS)) {
    throw new AppError('검증 가능한 핵심 정보와 실행 방법을 충분히 구성하지 못했습니다.', {
      code: 'TOPIC_FACT_PACK_INCOMPLETE', statusCode: 422, exposeMessage: true,
    })
  }
  if (outlines.some((outline) => !outline.beats.length)) {
    throw new AppError('짧은 대본의 도입·설명·마무리 구성안이 충분하지 않습니다.', {
      code: 'TOPIC_OUTLINE_INCOMPLETE', statusCode: 422, exposeMessage: true,
    })
  }

  return {
    inputQuality: readiness.inputQuality,
    inputBrief: { topic, ...(supportingMaterials.length ? { targetAudience: contentBrief.targetAudience, specificProblem: contentBrief.specificProblem, desiredOutcome: contentBrief.desiredOutcome, supportingMaterials } : readiness.inferredContext) },
    confirmedSpeakerFacts: (Array.isArray(parsed.speakerFacts) ? parsed.speakerFacts : []).filter(item =>
      typeof item?.userQuote === 'string' && item.userQuote.trim().length >= 6 &&
      Object.values({topic,...readiness.inferredContext}).some(value=>String(value||'').includes(item.userQuote.trim())))
      .map(item=>({userQuote:item.userQuote.trim()})).slice(0,5),
    clarifications: readiness.clarifications,
    contentBrief,
    factPack,
    ...(supportingMaterials.length ? { referenceKnowledge: {
      understanding: normalizeText(parsed.referenceKnowledge?.understanding, 1200),
      selectedFacts: normalizeList((Array.isArray(parsed.referenceKnowledge?.selectedFacts) ? parsed.referenceKnowledge.selectedFacts : []).map(item => {
        if (typeof item === 'string') return item
        if (!item || typeof item !== 'object') return ''
        if (typeof item.subject === 'string' && typeof item.predicate === 'string') return `${item.subject} ${item.predicate}`
        return typeof item.claim === 'string' ? item.claim : ''
      }), 8, 700),
      narrativeFocus: normalizeText(parsed.referenceKnowledge?.narrativeFocus, 700),
    } } : {}),
    riskLevel,
    grounding: evidence,
    durationTarget: { minimumSeconds: TOPIC_DURATION.min, maximumSeconds: TOPIC_DURATION.targetMax, recommendedMaximumSeconds: TOPIC_DURATION.recommendedMax },
    outlines,
  }
}

function buildPlanningPrompt({ topic, readiness, accountContext, categoryPrompt, hookTemplates, narrativePatterns, evidence, riskLevel, supportingMaterials = [] }) {
  return `${supportingMaterials.length ? `이번 주제(최우선): ${topic}\n이번 작업에서 직접 답한 조건(필수): ${JSON.stringify(readiness.clarifications || {})}\n계정에서 추정한 기본 맥락(참고): ${JSON.stringify(readiness.inferredContext)}` : `주제: ${topic}\n사용자 맥락: ${JSON.stringify(readiness.inferredContext)}`}
${formatSupportingMaterials(supportingMaterials)}
${supportingMaterials.length ? '참고자료를 읽고 이해한 뒤 referenceKnowledge를 작성한다: understanding은 대상 자체의 특징과 청자의 상황 사이 관계를 이해한 메모, selectedFacts는 이번 전달 목적을 뒷받침하는 정보만 선택(보통 0~3개)하고, 각 사실의 주어는 실제 대상(제품·행사·사람), 서술어는 그 대상의 기능·속성·조건으로 쓴다. 이미지·문서·표를 주어나 근거 확인 행위의 대상으로 삼지 않는다. 원문을 읽었다는 메모가 아니라, 대상에 관해 이해한 지식으로 변환한다. narrativeFocus는 청자에게 전할 하나의 메시지다. 문서나 비교표의 존재를 설명하는 보고서가 아니라 대상의 기능·속성·조건을 직접 설명하는 지식으로 적는다. 자료에 없는 효능이나 기능은 추론하지 않는다. factPack과 sharedFlow도 이 선택을 중심으로 설계한다. actionableMethods는 청자에게 실제 행동 방법을 가르치는 목적일 때만 사용하며, 소개·설명·세일즈를 구매 체크리스트나 기능 확인법으로 바꿔 필드를 채우지 않는다. 방법 설명이 목적이 아니면 actionableMethods는 빈 배열이어도 된다. 자료 전체를 재구성하거나 자료의 불확실성을 설명하는 내용을 주제로 삼지 않는다. 사용자가 모든 항목을 넣으라고 명시했을 때만 빠짐없이 구성한다. referenceKnowledge는 {"understanding":"","selectedFacts":[{"subject":"실제 대상","predicate":"그 대상의 기능·속성·조건"}],"narrativeFocus":""} 형식으로 최상위 JSON에 포함한다.' : ''}
계정 참고: ${accountContext || '없음'}
${supportingMaterials.length ? '이번 주제와 직접 답한 조건에서 전달 대상·상황·목적을 먼저 정하고 contentBrief에 기록한다. 계정 기본 고민·관심사·캐릭터는 이번 주제와 실제로 관련 있을 때만 보완한다. 기본값을 상품의 용도나 효과를 설명하는 근거로 삼거나 관련 없는 고민을 억지로 상품과 연결하지 않는다. 첨부자료에 없는 사용 부위·효과·진단을 계정 설정에서 가져오지 않는다. 계정 기본값을 이번에 사용자가 직접 요청한 조건으로 취급하지 않는다.' : ''}
카테고리 참고: ${categoryPrompt}
확인된 외부 근거: ${JSON.stringify(evidence.evidenceNotes || [])}
참고 전개 원리(문장 복사 금지): ${hookTemplates}\n${narrativePatterns}

먼저 사용자가 이 대본으로 무엇을 전달하려는지 정한다. 정보 전달·방법 설명·상품/서비스 소개·비교 등 목적에 맞춰 청자가 이해할 핵심을 평이한 한 문장 communicationGoal로 적는다. 주어진 상품이나 서비스를 소개하려는 요청을, 소비자가 다른 상품을 고르는 방법으로 바꾸지 않는다. 처음 듣는 청자에게 무엇을 알려주면 도움이 될지 먼저 정한다. 사용자 주제와 필수 조건이 참고 자료보다 우선한다. 필요한 사실과 실행 방법을 중복 없이 골라, 한 번의 설명 흐름과 서로 다른 도입 관점 세 개로 정리한다. 아직 발화 대본은 쓰지 않는다.
30~50초의 간결한 설명을 목표로 한다. 보통 핵심 사실·방법은 1~3개면 되며 사용자 필수 항목은 모두 담는다. 항목 수를 채우기 위해 정보를 더하지 않는다. 각 필드는 평이한 한 문장으로 짧게 적는다. 같은 내용을 다른 필드에 길게 반복하지 않는다.
speakerFacts에는 사용자가 직접 제공한 화자의 실제 경험·사실이 있을 때만 그 원문을 userQuote로 인용하고, 없으면 빈 배열로 둔다. 가상의 예시나 경험을 만들지 말라는 문장을 경험 근거로 삼지 않는다. corePromise는 청자가 얻는 실제 이해나 행동이다. coreFacts는 확인한 내용과 이유·조건, actionableMethods는 행동·방법·시점이다. sharedFlow는 이 정보를 전달하는 순서만 2~4개 짧은 의미 메모로 적고, 사용자 항목 여러 개를 하나에 묶어도 된다. openings는 같은 전달 목적을 다른 출발점으로 보여준다. A는 청자의 관심이나 걱정과 실제 제공 정보를 연결하고, B는 주어진 사실 안에서 비교할 기준이나 궁금증을 풀며, C는 청자가 처할 수 있는 구체적 상황에서 출발한다. 주제에 없는 잘못된 통념·원인·문제·성공 경험을 만들어 관점을 억지로 맞추지 않는다.
openings를 정할 때는 첫 문장만 듣고도 청자가 자기에게 관련 있는 이야기임을 알아차리고 다음 설명을 듣고 싶어질 지점을 고른다. 구체적인 고민·선택의 갈림길·궁금한 차이·익숙한 상황 중 이번 주제에 가장 잘 맞는 출발점을 잡고, sharedFlow에서 실제로 풀어줄 내용과 연결한다. 세 안은 같은 정보를 서로 다른 관심 지점에서 시작한다.
위험도 ${riskLevel}. 기획 메모를 검증 근거로 취급하지 않는다. 제공되지 않은 화자 경험·성과·상품 기능·수치·빈도·발생 원인·건강/금전 효과 보장을 만들지 않는다. 확인할 수 없는 원인을 임의로 채우기보다, 사용자가 실제 해볼 행동을 짧고 분명하게 정리한다. 근거가 필요한 주장에는 확인한 근거만 쓴다. 평범한 행동 제안과 외부 검증이 필요한 사실 주장을 구분한다.
JSON만 반환한다:
{"contentBrief":{${supportingMaterials.length ? '"targetAudience":"","specificProblem":"","desiredOutcome":"",' : ''}"corePromise":"","communicationGoal":""},"factPack":{"coreFacts":[{"id":"fact-1","claim":"","why":"","condition":""}],"actionableMethods":[{"id":"method-1","action":"","how":"","whyOrWhen":""}],"cautions":[],"forbiddenClaims":[]},"sharedFlow":[{"goal":"","bridgeToNext":"","factIds":["fact-1"],"methodIds":["method-1"]}],"openings":{"A":"","B":"","C":""},"speakerFacts":[{"userQuote":""}]}`
}

function buildVariationPrompt({ planning, outline, config, writingRules, targetSeconds = 38 }) {
  const { supportingMaterials = [], ...writerBrief } = planning.inputBrief || planning.contentBrief
  const understoodReference = planning.referenceKnowledge?.understanding && planning.referenceKnowledge?.selectedFacts?.length
    ? planning.referenceKnowledge : null
  const meaningOutline = (outline.beats || []).map(beat => ({
    meaning: beat.goal, nextBecause: beat.bridgeToNext,
    factIds: beat.factIds, methodIds: beat.methodIds,
  }))
  return `${SPOKEN_SCRIPT_WRITING_RULES}\n${durationWritingGuidance(targetSeconds)}

[최우선: 사용자가 실제로 전달하려는 내용]
${JSON.stringify(writerBrief)}
[이번 대본의 전달 목적]
${planning.contentBrief.communicationGoal || planning.contentBrief.desiredOutcome}
${supportingMaterials.length ? SUPPORTING_MATERIAL_GUIDANCE : ''}
[말하는 사람의 역할]
${planning.confirmedSpeakerFacts?.length ? `사용자가 제공한 화자 사실만 활용한다: ${JSON.stringify(planning.confirmedSpeakerFacts)}` : '이 화자는 자기 경험담의 주인공이 아니라, 주어진 정보를 청자에게 안내하는 진행자다. 청자가 처할 수 있는 상황을 보여주고 방법을 제안하는 현재형 설명으로 쓴다.'}
[기획자가 정리한 설명 제안 — 그 자체가 검증 근거는 아님]
${JSON.stringify(understoodReference ? { referenceKnowledge: understoodReference, cautions: planning.factPack.cautions, forbiddenClaims: planning.factPack.forbiddenClaims } : planning.factPack)}
[사실의 근거: 사용자 입력과 확인한 외부 자료]
${JSON.stringify({user:writerBrief,reference:understoodReference || (supportingMaterials.length ? planning.factPack.coreFacts : []),evidence:planning.grounding?.evidenceNotes || []})}
${supportingMaterials.length ? '참고자료에서 선택한 기능·조건·수치는 사용자가 확인해 제공한 정보다. 이를 정보의 내용 자체로 설명한다. source의 존재나 외부 검증 상태를 발화문으로 설명할 필요는 없다. 제품의 선택 이유와 청자의 상황을 연결하되 알려지지 않은 기능을 덧붙이지 않는다.' : ''}
[이 안의 설명 순서 — 표현을 베끼지 않는 의미 메모]
${JSON.stringify(meaningOutline)}
${planning.inputBrief?.supportingMaterials?.length ? '첨부자료와 기획 메모는 필수 항목 목록이 아니다. 목적에 가장 도움이 되는 정보에 집중해 흐름을 다시 구성해도 된다. 자료 확인의 한계를 발화문으로 옮기는 대신, 정확히 아는 내용 안에서 시청자가 이해할 설명을 완성한다.' : ''}
[참고 원칙 — 현재 요청과 충돌하면 현재 요청 우선]
${writingRules || '없음'}

${config.key}안 ${config.label} 대본만 작성한다.
실제 청자 한 사람에게 카메라 앞에서 말하는 글이다. 먼저 그 사람이 처한 상황과 전할 핵심을 정하고, 눈앞에서 볼 수 있는 상황·행동·이유로 풀어 쓴다. 기획자의 역할명·전략명·심리 용어를 멋있는 문장으로 바꾸려 하지 않는다. 예시나 부연은 핵심을 이해시키는 데 필요한 만큼만 사용한다.
실제 발화의 첫 문장은 시청자가 멈춰 듣게 하는 후킹 문장으로 쓴다. 청자가 바로 알아들을 구체적인 상황이나 고민, 선택할 때 궁금한 차이를 짧고 선명하게 짚어 “내 이야기다” 또는 “왜 그렇지?”라는 관심이 생기게 한다. 주제를 소개하는 준비 설명보다 청자가 관심을 가질 핵심부터 말하고, 이어지는 문장에서 그 궁금증을 풀어준다. 질문·단정·상황 묘사 중 주제와 말투에 자연스러운 형태를 선택한다. 후킹의 힘은 구체성과 관련성에서 만들며, 대본에서 답할 수 있는 범위와 주어진 사실 안에서 쓴다. 이 지침은 저장 필드 이름과 관계없이 전체 대본에서 처음 읽히는 문장에 적용한다.
도입부터 설명과 마무리까지 한 가지 메시지가 이어지게 한다. ${config.key === 'A' ? '청자의 관심이나 걱정에서 출발해 주어진 정보의 실제 쓸모를 보여준다.' : config.key === 'B' ? '주어진 사실 안에서 비교할 기준이나 궁금증을 쉽게 설명한다.' : '청자가 처할 수 있는 구체적 상황에서 출발한다.'} 설명 방식 때문에 전달 목적을 바꾸거나 존재하지 않는 통념·문제·원인·경험을 만들지 않는다.
사용자가 지정한 항목과 조건은 모두 반영한다. 표현은 새로 써도 사용자 사실·상품 기능·경험을 덧붙이지 않는다. 근거 없는 수치·성과·진단·보장을 만들지 않는다. 평범한 방법 제안은 자연스럽게 말한다.
30~50초 정도로, 전체 약 140~170자를 출발점으로 핵심을 간결하게 말한다. 길이를 맞추려고 띄어쓰기를 지우거나 필수 항목을 빼지 않는다. 같은 내용을 반복해 늘리지 않는다.
문장별로 줄을 띄운 하나의 대본이다. hook/body/cta는 저장 호환 필드이며 구간별 길이·문장 수·행동 유도가 의무는 아니다. 필요한 경우 body에 전체를 담고 나머지는 빈 문자열로 둔다. 설명용 라벨·제목·내부 메모는 발화문에 넣지 않는다.
최종 문장을 쓰면서 각 문장이 앞 문장의 어떤 뜻을 이어받는지 확인한다. 듣는 사람이 뜻을 재해석해야 하는 표현은 실제 뜻을 직접 말한다. 별도 말투 요청이 있으면 그것을, 없으면 편안한 해요체를 유지한다.
JSON만 반환한다: {"hook":"","body":"","cta":""}`
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

function normalizeEvaluation(parsed = {}, variations = [], requireSourceClaims = false) {
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
    const speechIssues = groundedSpeechIssues(item?.speechIssues, variations[index])
    // Critical verdicts are categorical. A high aggregate score cannot
    // pardon a fabricated experience or a missed explicit user requirement.
    const criticalKinds = new Set(['unsupported_fact','unsupported_effect','copied_experience','invented_context','requested_requirement_missing','meaning_contradiction'])
    const criticalReviewValid = Array.isArray(item.criticalIssues) && item.criticalIssues.every(issue=>
      issue && criticalKinds.has(issue.type) && typeof issue.reason === 'string' && issue.reason.trim())
    const criticalIssues = criticalReviewValid ? [...item.criticalIssues] : [{type:'critical_review_invalid',reason:'치명 문제 판정 형식이 올바르지 않음'}]
    if (requireSourceClaims) {
      if (!Array.isArray(item.sourceClaims)) criticalIssues.push({type:'critical_review_invalid',reason:'첨부 사실 대조가 누락됨'})
      else for (const claim of item.sourceClaims) {
        if (typeof claim?.quote !== 'string' || typeof claim?.supported !== 'boolean' || typeof claim?.reason !== 'string') criticalIssues.push({type:'critical_review_invalid',reason:'첨부 사실 대조 형식이 올바르지 않음'})
        else if (!claim.supported) criticalIssues.push({type:'unsupported_fact',quote:claim.quote,reason:claim.reason || '제공자료가 이 제품 속성을 뒷받침하지 않음'})
      }
    }
    const conceptMatches = item?.conceptMatches === true
    const pass = criticalIssues.length === 0
    return { key: config.key, pass, scores, conceptMatches, speechIssues, criticalIssues,
      issues: criticalIssues.map(issue=>`${issue.type}: ${issue.quote || issue.requirement || ''} — ${issue.reason}`),
      guidanceDiagnostics: { notes: normalizeList(item.issues,8,500),conceptIssue: normalizeText(item?.conceptIssue, 500), naturalness: scores.naturalness, coherence: scores.coherence, specificity: scores.specificity } }

  })
}

async function evaluateVariations({ openai, model, planning, variations, hardValidation, accountId, referenceId, usageContext }) {
  const hasMaterials = Boolean(planning.inputBrief?.supportingMaterials?.length)
  const response = await openai.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: '당신은 숏폼 정보 대본 품질 심사자다. 사용자가 명시한 필수 요구의 충족과 사실 안전성을 검사한다. 후킹 방식·설명 스타일·구체성 점수·A/B/C의 기획 관점·문장 배치·길이는 참고 지표이며 재작성 사유가 아니다. 말투·어휘 취향·구어체를 실패 기준으로 사용하거나 말투 개선을 issues에 넣지 않는다. JSON만 반환한다.' + (hasMaterials ? ' 각 evaluations 항목에 sourceClaims 배열도 반드시 반환한다. 대본의 제품·행사에 대한 구체적 속성(기능·수치·사용 방식·원리·비교 성능·행사 조건)을 빠짐없이 분리하여 {"quote":"실제 대본 구절","supported":true,"reason":"제공자료가 직접 뒷받침하는 내용"} 형식으로 대조한다. 직접 근거가 없거나 수치·부품에서 다른 속성을 추론했으면 supported=false로 기록한다. 이 대조는 점수나 일반 issues와 독립적인 판정이다. 평범한 행동 제안·가정·일상적 편의 기대는 새로운 제품 속성을 주장하지 않으면 이 배열에 넣지 않는다. 대상 속성이 없는 대본만 빈 배열이다.' : ''),
      },
      {
        role: 'user',
        content: `${planning.inputBrief?.supportingMaterials?.length ? '첨부자료의 정보는 사용자가 확인해 제공한 사실 근거다. 외부 출처가 없거나 대본에서 출처를 반복하지 않았다는 이유만으로 unsupported_fact로 판정하지 않는다. 자료 전체가 필수 항목 목록은 아니며, 사용자 명시 조건에 필요한 부분만 선택할 수 있다. 자료에 없는 주장·화자 경험·기능을 새로 만들어낸 경우는 기존 기준대로 판정한다. 상품의 기능·사용 방식·작동 원리·비교 성능을 서술한 구절은 제공된 자료가 그 속성을 직접 뒷받침하는지 확인한다. 부품이나 수치 하나에서 다른 제품 기능이나 성능 우위를 추론한 구절은 가능성 표현을 붙였어도 unsupported_fact로 판정한다. 일반적인 일상 편의 기대와 새로운 제품 속성 주장을 구분한다.\n' : ''}사용자가 입력한 주제와 요구사항(평가의 기준):\n${JSON.stringify(planning.inputBrief || {topic:planning.contentBrief.topic,...planning.clarifications})}\n\n외부에서 확인한 근거(있는 경우에만):\n${JSON.stringify(planning.grounding?.evidenceNotes || [])}\n\n기획자가 만든 표현·역할명·비유를 정답으로 취급하지 말고 처음 듣는 시청자의 입장에서 판단한다.\n\n대본:\n${JSON.stringify(variations)}\n\n코드 검증 결과:\n${JSON.stringify(hardValidation.issuesByIndex)}\n\n각 안을 1~5점으로 평가한다.\n- relevance: 주제·타깃·사용자 필수 요청 충족. 표현 취향이나 설명의 자세함은 점수를 내리는 이유가 아니다. 사용자가 명시한 필수 항목·항목 수·제외 조건을 하나씩 대조한다. 숫자만 맞고 필요한 항목이 빠졌다면 3점 이하로 평가하고 빠진 요구를 issues에 적는다.\n- coherence: HOOK→BODY→CTA와 문장 사이 인과 연결. 같은 단어 반복 여부가 아니라 지시어를 포함한 실제 뜻의 연결을 본다. CTA는 본문 결론에서 이어지는 실행·반응인지 판단하고, 저장·댓글 같은 특정 동사가 있어야 통과하는 것은 아니다.\n- specificity: 실행 정보가 무엇을·어떻게·왜/언제까지 설명하는지\n- factualSafety: 없는 1인칭 경험·성과·제품 기능, 근거 없는 발생 빈도·행동 원인·결과 수치·건강·금전 효과 보장이 없는지. 기획자가 적은 정보팩 자체를 근거로 인정하지 않는다. 일상적인 방법 제안이나 비교 팁은 그 자체로 허위 사실로 보지 않는다.\n- naturalness: 참고 점수만 기록하며 합격 여부·재작성 조건에 사용하지 않는다. 말투의 문제는 issues나 speechIssues에 넣지 않는다\n- conceptMatches: A는 구체적 손실·회피 기준, B는 흔한 믿음과 새 기준의 대조, C는 타깃의 구체 상황·막힘에서 해결로 이어지는 관점을 의미로 확인한다. 특정 시작 단어나 표현 유무로 판정하지 않는다. 맞지 않으면 conceptIssue에 실제 문장을 인용해 이유를 적는다.\n- 코드 검증 이슈가 있으면 반드시 issues에 포함한다.\n점수와 별개로 criticalIssues를 먼저 판정한다. 다음 중 실제 문제가 있으면 점수가 높아도 반드시 criticalIssues에 넣는다: unsupported_fact(없는 경험·제품 기능·수치 등 사실), unsupported_effect(근거 없는 위험한 효과 보장), copied_experience(제공되지 않은 1인칭 경험·과거 행동을 실제 화자 사실처럼 서술), invented_context(주어진 상황과 모순), requested_requirement_missing(명시적 사용자 조건·필수 항목 누락), meaning_contradiction(실제 의미 모순). quote에는 문제가 되는 실제 대본 구절을, 누락은 requirement에 사용자 필수 요구를 인용하고 reason을 적는다. 일상적 방법 제안·가정한 상황·기준을 제안하는 말투 자체를 허위 경험으로 보지 않는다. 사용자 입력에 없는 과거 사용·행동·결과를 말하는 실제 경험담과 구분한다. 비판을 점수나 일반 issues에만 적고 criticalIssues를 비워두지 않는다. criticalIssues는 문제가 없으면 빈 배열이다.\nJSON만 반환한다: {"evaluations":[{"key":"A","criticalIssues":[],"scores":{"relevance":0,"coherence":0,"specificity":0,"factualSafety":0,"naturalness":0},"issues":[],"speechIssues":[],"conceptMatches":true},{"key":"B","criticalIssues":[],"scores":{},"issues":[],"speechIssues":[],"conceptMatches":true},{"key":"C","criticalIssues":[],"scores":{},"issues":[],"speechIssues":[],"conceptMatches":true}]}\n}`,
      },
    ],
  })
  logAIUsage('topic-script-quality-evaluation', response, { model, accountId, referenceId, ...usageContext })
  const evaluations = normalizeEvaluation(readModelResult(response), variations, hasMaterials)
  if (evaluations.some(item=>item.criticalIssues.some(issue=>issue.type==='critical_review_invalid'))) {
    throw new AppError('필수 사실 검토의 응답 형식이 올바르지 않습니다.',{code:'INVALID_CRITICAL_REVIEW',statusCode:502})
  }
  return evaluations
}

async function repairVariation({ openai, model, planning, variation, outline, config, issues, writingRules, accountId, referenceId, usageContext, targetSeconds = 38 }) {
  const response = await openai.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: '당신은 품질 기준에 미달한 정보형 숏폼 대본 한 안만 재작성한다. 사용자 요청과 확인된 정보, 전개 목적을 보존하고 지적된 문제를 해결한다. 기획안의 용어나 원문 표현을 보존할 의무는 없다. 발화 의미 문제의 plainMeaning을 먼저 이해한 뒤 해당 뜻을 청자가 실제로 쓰는 말로 전달한다. 기획 메모와 검토 지적이 충돌하면 사용자 원래 요구와 사실을 우선하고 문제로 지적된 표현은 되살리지 않는다. JSON만 반환한다.',
      },
      {
        role: 'user',
        content: `${buildVariationPrompt({ planning, outline, config, writingRules, targetSeconds })}\n\n현재 대본:\n${JSON.stringify(variation)}\n\n${durationWritingGuidance(targetSeconds, {}, variation)}\n\n반드시 해결할 문제:\n${issues.map((item) => `- ${item}`).join('\n')}`,
      },
    ],
  })
  logAIUsage('topic-script-quality-repair', response, { model, accountId, referenceId, label: config.key, ...usageContext })
  return normalizeVariation(readModelResult(response), TOPIC_VARIATION_CONFIGS.indexOf(config))
}

function buildReferencePayload({ topic, title, projectId, clientGenerationId, readiness }) {
  const now = new Date().toISOString()
  return {
    title: normalizeText(title, 200) || `${normalizeText(topic, 120)} 기획`,
    topic: String(topic || '').trim(),
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
  supportingMaterials = [],
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
  supportingMaterials = normalizeSupportingMaterials(supportingMaterials)
  const normalizedTopic = String(topic || '').trim()
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
    topic_brief: { ...buildReferencePayload({ topic: normalizedTopic, title, projectId, readiness }).topic_brief, ...(supportingMaterials.length ? { supportingMaterials } : {}) },
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
            supportingMaterials,
          }),
        },
      ],
    })
    logAIUsage('topic-script-planning', planningResponse, { model: variationModel, accountId, referenceId, ...usageContext })
    const planning = normalizePlanningResult(readModelResult(planningResponse), {
      topic: normalizedTopic, readiness, evidence, riskLevel, supportingMaterials,
    })
    const rules = await collectWritingRules(planning)
    const writingRules = formatWritingPlaybookRulesForPrompt(rules)

    let variations = await Promise.all(TOPIC_VARIATION_CONFIGS.map(async (config, index) => {
      const response = await openai.chat.completions.create({
        model: variationModel,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '당신은 검증된 정보 설계와 문장별 구성안을 실제 30~50초 숏폼 대본으로 옮기는 작가다. 정보의 정확성, 연결성, 말하기 자연스러움을 동시에 지키고 JSON만 반환한다.' },
          { role: 'user', content: buildVariationPrompt({ planning, outline: planning.outlines[index], config, writingRules }) },
        ],
      })
      logAIUsage('topic-script-variation', response, { model: variationModel, accountId, referenceId, label: config.key, ...usageContext })
      return normalizeVariation(readModelResult(response), index)
    }))

    const allowedEvidenceText = JSON.stringify({ evidence: planning.grounding.evidenceNotes, user: planning.inputBrief })
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

    // Timing is generation guidance. Record estimates without failing or
    // rerunning a successful draft solely for duration or stylistic scores.
    const qualityPassed = hardValidation.ok && evaluations.every((item) => item.pass)
    if (!qualityPassed) {
      throw new AppError('필수 요청과 사실을 반영한 대본 생성을 완료하지 못했습니다.', {
        code:'TOPIC_CRITICAL_VALIDATION_FAILED',statusCode:502,exposeMessage:true,
      })
    }

    const topicBrief = {
      ...planning,
      ...(supportingMaterials.length ? { supportingMaterials } : {}),
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
      durationRepairIndexes: [],
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
  evaluateVariations,
  repairVariation,
  normalizePlanningResult,
}
