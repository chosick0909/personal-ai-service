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

function comparableCaptionLength(value = '') {
  return normalizeCaption(value)
    .replace(/#[^\s#]+/g, ' ')
    .replace(/\s+/g, '')
    .length
}

function supportsCustomTemperature(model = '') {
  return !String(model || '').trim().toLowerCase().startsWith('gpt-5')
}

function isModelCompatibilityError(error) {
  const message = String(error?.message || error || '')
  const code = String(error?.code || '')

  return (
    error?.status === 400 ||
    error?.status === 404 ||
    /unsupported|unsupported_value|invalid_request|model|does not exist|not found|temperature/i.test(
      `${code} ${message}`,
    )
  )
}

function createCaptionResponseError(message, details = {}) {
  const error = new Error(message)
  error.code = 'CAPTION_MODEL_RESPONSE_INVALID'
  error.details = details
  return error
}

function isCaptionResponseError(error) {
  const message = String(error?.message || error || '')
  const code = String(error?.code || '')

  return (
    code === 'CAPTION_MODEL_RESPONSE_INVALID' ||
    /Model returned empty content|Model did not return JSON|Unexpected token|caption|hashtags/i.test(message)
  )
}

function isRecoverableCaptionModelError(error) {
  return isModelCompatibilityError(error) || isCaptionResponseError(error)
}

function parseCaptionJsonResponse(response, model, stage, validateParsed = null) {
  const rawContent = response.choices[0]?.message?.content || ''
  let parsed

  try {
    parsed = parseModelJson(rawContent)
  } catch (error) {
    throw createCaptionResponseError('Caption model returned invalid JSON', {
      model,
      stage,
      parserMessage: String(error?.message || error),
      rawPreview: String(rawContent || '').slice(0, 240),
    })
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createCaptionResponseError('Caption model returned invalid payload shape', {
      model,
      stage,
      parsedType: Array.isArray(parsed) ? 'array' : typeof parsed,
    })
  }

  if (typeof validateParsed === 'function') {
    validateParsed(parsed, { model, stage })
  }

  return parsed
}

async function createCaptionJsonCompletion({
  openai,
  model,
  fallbackModel,
  temperature,
  messages,
  stage,
  validateParsed,
}) {
  const models = [model, fallbackModel]
    .map((item) => String(item || '').trim())
    .filter((item, index, list) => item && list.indexOf(item) === index)
  let lastError = null

  for (const candidateModel of models) {
    const params = {
      model: candidateModel,
      messages,
    }

    if (supportsCustomTemperature(candidateModel)) {
      params.temperature = temperature
    }

    try {
      const response = await openai.chat.completions.create(params)
      const parsed = parseCaptionJsonResponse(response, candidateModel, stage, validateParsed)

      return {
        response,
        parsed,
        modelUsed: candidateModel,
        fallbackUsed: candidateModel !== model,
      }
    } catch (error) {
      lastError = error

      if (!isRecoverableCaptionModelError(error)) {
        throw error
      }

      console.warn('[caption-generator] generation fallback', {
        stage,
        model: candidateModel,
        fallbackModel,
        status: error.status || null,
        code: error.code || null,
        message: String(error.message || error).slice(0, 240),
      })
    }
  }

  throw lastError
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function splitSentences(text = '') {
  return normalizeCaption(text)
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function detectOpeningStyle(text = '') {
  const firstLine = normalizeCaption(text).split(/\n+/).find(Boolean) || ''
  if (!firstLine) return 'plain'
  if (/[?？]$/.test(firstLine) || /(\?|나요|까요|세요\?)\s*$/.test(firstLine)) return 'question'
  if (/(주의|조심|하지 마|안 하면|실수|모르면)/.test(firstLine)) return 'warning'
  if (/(저는|제가|나도|솔직히|사실)/.test(firstLine)) return 'confession'
  if (/(결과|바뀐|달라진|전후|먼저 보여)/.test(firstLine)) return 'result_first'
  if (/(어제|오늘|예전에|처음|한 번은)/.test(firstLine)) return 'story'
  return 'plain'
}

function detectTonePattern(text = '') {
  const patterns = []
  if (/(힘들|고민|괜찮|나도|공감|불안|답답)/.test(text)) patterns.push('empathetic')
  if (/(지금|당장|꼭|놓치|주의|조심|안 하면)/.test(text)) patterns.push('urgent')
  if (/(해보세요|확인하세요|저장|보세요|바꿔보세요)/.test(text)) patterns.push('directive')
  if (/(ㅋㅋ|ㅎㅎ|진짜|솔직히|근데|ㅠㅠ)/.test(text)) patterns.push('casual')
  if (/(기준|이유|방법|순서|체크|핵심)/.test(text)) patterns.push('informative')
  return patterns.length ? patterns : ['plain']
}

function detectCtaPosition(lines = []) {
  const ctaIndex = lines.findIndex((line) => /(저장|댓글|DM|디엠|링크|프로필|공유|확인|신청|문의)/i.test(line))
  if (ctaIndex < 0) return 'none'
  if (ctaIndex === 0) return 'beginning'
  if (ctaIndex >= lines.length - 2) return 'end'
  return 'middle'
}

function analyzeReferenceCaptionStructure(value = '') {
  const text = normalizeCaption(value)
  const compact = text.replace(/\s+/g, '')
  const koreanChars = compact.match(/[가-힣]/g)?.length || 0
  const alphaNumericChars = compact.match(/[0-9A-Za-z가-힣]/g)?.length || 0
  const words = text.split(/\s+/).filter((item) => /[0-9A-Za-z가-힣]/.test(item))
  const uniqueWords = new Set(words.map((item) => item.toLowerCase()))
  const lines = text.split(/\n+/).map((item) => item.trim()).filter(Boolean)
  const sentences = splitSentences(text)
  const sentenceLengths = sentences.map((sentence) => sentence.replace(/\s+/g, '').length).filter(Boolean)
  const averageLength = sentenceLengths.length
    ? sentenceLengths.reduce((sum, item) => sum + item, 0) / sentenceLengths.length
    : compact.length
  const repeatedJamoOnly = /^[ㄱ-ㅎㅏ-ㅣㅋㅎㅇㅠㅜ\s.,!?~]+$/.test(text)
  const repeatedShortPattern = /^(.{1,3})\1{2,}$/.test(compact)
  const paragraphCount = text.split(/\n\s*\n+/).filter((item) => item.trim()).length || (lines.length ? 1 : 0)
  const hasQuestion = /[?？]|(나요|까요|습니까)/.test(text)
  const hasCommand = /(하세요|해보세요|보세요|저장|확인|남겨|눌러|가세요)/.test(text)
  const hasEmpathy = /(나도|공감|힘들|고민|괜찮|답답|불안)/.test(text)
  const hashtags = text.match(/#[^\s#]+/g) || []
  const hasEmojisOrSymbols = /[\u{1F300}-\u{1FAFF}]|[★☆✓✔→←※]/u.test(text)
  const repeatedWords = words.filter((word, index) => words.indexOf(word) !== index)
  const repetitionPattern = repeatedJamoOnly || repeatedShortPattern
    ? 'word_repeat'
    : repeatedWords.length >= 2
      ? 'phrase_repeat'
      : lines.length >= 3 && lines.every((line) => line.length <= 25)
        ? 'structure_repeat'
        : 'none'
  const lengthType = compact.length < 20 ? 'too_short' : compact.length < 80 ? 'short' : compact.length < 260 ? 'medium' : 'long'
  const averageSentenceLength = averageLength < 28 ? 'short' : averageLength < 70 ? 'medium' : 'long'
  const sentenceRhythm = averageLength < 28 && sentences.length >= 2 ? 'short_bursts' : averageLength > 70 ? 'dense_long' : 'balanced'
  const density = words.length < 10 ? 'low' : words.length < 45 ? 'medium' : 'high'

  return {
    textLength: compact.length,
    wordCount: words.length,
    uniqueWordCount: uniqueWords.size,
    koreanChars,
    alphaNumericChars,
    repeatedJamoOnly,
    repeatedShortPattern,
    openingStyle: detectOpeningStyle(text),
    paragraphCount: Math.max(0, paragraphCount),
    lineBreakCount: Math.max(0, lines.length - 1),
    averageSentenceLength,
    sentenceRhythm,
    tonePattern: detectTonePattern(text),
    hasQuestion,
    hasCommand,
    hasEmpathy,
    hasCTA: detectCtaPosition(lines) !== 'none',
    ctaPosition: detectCtaPosition(lines),
    hasHashtags: hashtags.length > 0,
    hashtagCount: hashtags.length,
    hasEmojisOrSymbols,
    repetitionPattern,
    density,
    lengthType,
  }
}

function mergeReferenceStructures(structures = []) {
  const usable = structures.filter(Boolean)
  const pickMostStructured = (key, fallback) =>
    usable.find((item) => item[key] && item[key] !== 'none' && item[key] !== 'plain')?.[key] ||
    usable[0]?.[key] ||
    fallback

  const tonePattern = [...new Set(usable.flatMap((item) => item.tonePattern || []))].slice(0, 4)
  const paragraphCount = Math.max(...usable.map((item) => item.paragraphCount || 0), 0)
  const lineBreakCount = Math.max(...usable.map((item) => item.lineBreakCount || 0), 0)
  const hashtagCount = Math.max(...usable.map((item) => item.hashtagCount || 0), 0)
  const textLengths = usable.map((item) => item.textLength || 0).filter(Boolean)
  const averageTextLength = textLengths.length
    ? Math.round(textLengths.reduce((sum, item) => sum + item, 0) / textLengths.length)
    : 0
  const targetMinLength = averageTextLength ? Math.max(10, Math.round(averageTextLength * 0.9)) : 0
  const targetMaxLength = averageTextLength ? Math.max(targetMinLength, Math.round(averageTextLength * 1.15)) : 0

  return {
    openingStyle: pickMostStructured('openingStyle', 'plain'),
    paragraphCount,
    lineBreakCount,
    averageTextLength,
    targetMinLength,
    targetMaxLength,
    averageSentenceLength: pickMostStructured('averageSentenceLength', 'short'),
    sentenceRhythm: pickMostStructured('sentenceRhythm', 'balanced'),
    tonePattern: tonePattern.length ? tonePattern : ['plain'],
    hasQuestion: usable.some((item) => item.hasQuestion),
    hasCommand: usable.some((item) => item.hasCommand),
    hasEmpathy: usable.some((item) => item.hasEmpathy),
    hasCTA: usable.some((item) => item.hasCTA),
    ctaPosition: pickMostStructured('ctaPosition', 'none'),
    hasHashtags: hashtagCount > 0,
    hashtagCount,
    hasEmojisOrSymbols: usable.some((item) => item.hasEmojisOrSymbols),
    repetitionPattern: pickMostStructured('repetitionPattern', 'none'),
    density: pickMostStructured('density', 'low'),
    lengthType: pickMostStructured('lengthType', 'too_short'),
  }
}

function scoreReferenceQuality(structures = []) {
  const combined = mergeReferenceStructures(structures)
  const totalLength = structures.reduce((sum, item) => sum + (item.textLength || 0), 0)
  const totalWords = structures.reduce((sum, item) => sum + (item.wordCount || 0), 0)
  const totalKorean = structures.reduce((sum, item) => sum + (item.koreanChars || 0), 0)
  let score = 0
  const warnings = []

  if (totalLength >= 160) score += 20
  else if (totalLength >= 80) score += 14
  else if (totalLength >= 35) score += 8

  if (combined.lineBreakCount > 0 || combined.paragraphCount > 1) score += 15
  if (combined.openingStyle !== 'plain') score += 15
  if (combined.hasCTA) score += 15
  if (combined.hasQuestion || combined.hasCommand || combined.hasEmpathy || !combined.tonePattern.includes('plain')) score += 10
  if (combined.repetitionPattern !== 'none' || combined.sentenceRhythm !== 'balanced') score += 10
  if (totalWords >= 12 && combined.density !== 'low') score += 10
  if (combined.hasHashtags || combined.hasEmojisOrSymbols) score += 5

  if (structures.some((item) => item.textLength < 10)) {
    score -= 40
    warnings.push('레퍼런스 중 10자 미만 입력이 있어 구조 분석 신뢰도가 낮습니다.')
  }
  if (structures.some((item) => item.repeatedJamoOnly)) {
    score -= 50
    warnings.push('반복 자음/모음 위주의 레퍼런스가 있어 기본 구조로 보정될 수 있습니다.')
  }
  if (structures.some((item) => item.repeatedShortPattern)) {
    score -= 40
    warnings.push('같은 글자 반복이 많아 레퍼런스 구조가 약합니다.')
  }
  if (totalKorean < 15 || totalWords < 6) {
    score -= 50
    warnings.push('의미 있는 문장이 부족해 A/B 구조를 강하게 반영하기 어렵습니다.')
  }
  if (structures.every((item) => item.lengthType === 'too_short' || item.lengthType === 'short')) {
    score -= 30
    warnings.push('A/B가 모두 짧아서 말투와 흐름을 충분히 분석하기 어렵습니다.')
  }

  const normalizedScore = clampScore(score)
  const level = normalizedScore >= 70 ? 'strong' : normalizedScore >= 40 ? 'usable' : normalizedScore >= 20 ? 'weak' : 'poor'
  const applicationStrength = normalizedScore >= 70 ? 'strong' : normalizedScore >= 40 ? 'partial' : 'minimal'

  if (!warnings.length) {
    warnings.push(
      normalizedScore >= 70
        ? '레퍼런스의 줄바꿈, 문장 길이, CTA 흐름을 반영해 생성했습니다.'
        : '레퍼런스 구조 일부를 참고했습니다. 더 긴 캡션을 넣으면 말투와 흐름을 더 비슷하게 반영할 수 있습니다.',
    )
  }

  if (normalizedScore < 40) {
    warnings.unshift('레퍼런스 구조가 약해서 기본 캡션 구조로 보정해서 생성했습니다.')
  }

  return {
    score: normalizedScore,
    level,
    applicationStrength,
    warnings: [...new Set(warnings)],
  }
}

function analyzeReferenceCaptions(captionA, captionB) {
  const structures = [
    analyzeReferenceCaptionStructure(captionA),
    analyzeReferenceCaptionStructure(captionB),
  ]
  const referenceStructure = mergeReferenceStructures(structures)
  const quality = scoreReferenceQuality(structures)

  return {
    referenceStructure,
    quality,
  }
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

function normalizeReferencePattern(parsed = {}, referenceAnalysis = null) {
  const analyzedStructure = referenceAnalysis?.referenceStructure || {}
  const analyzedQuality = referenceAnalysis?.quality || {}
  const parsedStructure = parsed.referenceStructure && typeof parsed.referenceStructure === 'object'
    ? parsed.referenceStructure
    : {}
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
    referenceStructure: {
      ...analyzedStructure,
      openingStyle: normalizeCaption(parsedStructure.openingStyle) || analyzedStructure.openingStyle || 'plain',
      averageSentenceLength: normalizeCaption(parsedStructure.averageSentenceLength) || analyzedStructure.averageSentenceLength || 'short',
      sentenceRhythm: normalizeCaption(parsedStructure.sentenceRhythm) || analyzedStructure.sentenceRhythm || 'balanced',
      tonePattern: normalizeList(parsedStructure.tonePattern).length
        ? normalizeList(parsedStructure.tonePattern)
        : analyzedStructure.tonePattern || ['plain'],
      ctaPosition: normalizeCaption(parsedStructure.ctaPosition) || analyzedStructure.ctaPosition || 'none',
      repetitionPattern: normalizeCaption(parsedStructure.repetitionPattern) || analyzedStructure.repetitionPattern || 'none',
      density: normalizeCaption(parsedStructure.density) || analyzedStructure.density || 'low',
      lengthType: normalizeCaption(parsedStructure.lengthType) || analyzedStructure.lengthType || 'too_short',
    },
    quality: analyzedQuality,
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
  referenceQuality,
  referenceStructure,
}) {
  return {
    topic,
    category: category || '미지정',
    monetizationModel: monetizationModel || '미지정',
    priorityOrder: [
      '내 영상주제',
      '내 계정 세팅값',
      'A/B 캡션 구조 패턴',
      '수익화 모델',
      '카테고리별 캡션 전략',
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
    referenceStructure,
    referenceQuality,
    referenceApplicationRule:
      referenceQuality?.applicationStrength === 'strong'
        ? 'A/B 구조 신뢰도가 높다. 영상 주제와 계정 세팅을 유지하면서 첫 문장 방식, 줄바꿈 리듬, 문장 길이, CTA 위치를 강하게 반영한다.'
        : referenceQuality?.applicationStrength === 'partial'
          ? 'A/B 구조를 일부 참고한다. 첫 문장 방식, 줄바꿈, CTA 위치 중 확실한 요소만 반영하고 부족한 부분은 기본 구조로 보정한다.'
          : 'A/B 구조 신뢰도가 낮다. 영상 주제와 계정 세팅 중심의 기본 구조를 사용하고 A/B는 톤 힌트 정도만 약하게 반영한다.',
    referenceUsageRule:
      'A/B 캡션은 첫 문장 시작 방식, 줄바꿈, 문단 수, 문장 길이, 반복 리듬, 질문/명령/공감 톤, CTA 위치, 해시태그/기호 사용 방식만 참고한다. 주제, 상품명, 상황, 업종, 고유문장, 표면 표현, 문장 패러프레이즈는 사용하지 않는다.',
    referenceLengthRule:
      referenceQuality?.applicationStrength === 'minimal'
        ? 'A/B 구조 신뢰도가 낮으면 길이를 억지로 맞추지 말고 기본 캡션 길이로 보정한다.'
        : `해시태그를 제외한 caption 본문 길이는 A/B 평균 길이에 최대한 가깝게 맞춘다. 목표는 공백 제외 ${referenceStructure?.targetMinLength || 0}~${referenceStructure?.targetMaxLength || 0}자이며, 짧게 요약하거나 새 전개를 추가하지 말고 A/B의 정보 밀도와 호흡을 유지한다.`,
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

function getCaptionLengthCheck({ caption, referenceStructure, referenceQuality }) {
  const currentLength = comparableCaptionLength(caption)
  const targetMinLength = Number(referenceStructure?.targetMinLength || 0)
  const targetMaxLength = Number(referenceStructure?.targetMaxLength || 0)
  const shouldEnforce =
    referenceQuality?.applicationStrength !== 'minimal' &&
    targetMinLength > 0 &&
    targetMaxLength >= targetMinLength

  if (!shouldEnforce) {
    return {
      currentLength,
      targetMinLength,
      targetMaxLength,
      matched: true,
      direction: 'ok',
      enforced: false,
    }
  }

  if (currentLength < targetMinLength) {
    return {
      currentLength,
      targetMinLength,
      targetMaxLength,
      matched: false,
      direction: 'expand',
      enforced: true,
    }
  }

  if (currentLength > targetMaxLength) {
    return {
      currentLength,
      targetMinLength,
      targetMaxLength,
      matched: false,
      direction: 'compress',
      enforced: true,
    }
  }

  return {
    currentLength,
    targetMinLength,
    targetMaxLength,
    matched: true,
    direction: 'ok',
    enforced: true,
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

async function extractReferencePattern({ openai, model, fallbackModel, accountId, captionA, captionB, referenceAnalysis }) {
  const messages = [
    {
      role: 'system',
      content: [
        '당신은 인스타그램/숏폼 캡션 레퍼런스 분석가다. 출력은 JSON만 반환한다.',
        '목표는 레퍼런스의 내용이 아니라 구조 신호만 추출하는 것이다.',
        '상품명, 업종, 상황, 고유명사, 숫자, 문장 표현, 소재를 결과에 쓰지 마라.',
        'JSON 스키마: {"hookType":"string","tonePattern":"string","flow":["string"],"ctaType":"string","sentenceLength":"string","usablePattern":"string","referenceStructure":{"openingStyle":"confession | question | warning | story | result_first | plain","averageSentenceLength":"short | medium | long","sentenceRhythm":"short_bursts | balanced | dense_long","tonePattern":["empathetic | urgent | casual | directive | informative | plain"],"ctaPosition":"none | beginning | middle | end","repetitionPattern":"none | word_repeat | phrase_repeat | structure_repeat","density":"low | medium | high","lengthType":"too_short | short | medium | long"}}',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `레퍼런스 캡션 A:\n${truncateText(captionA)}`,
        `레퍼런스 캡션 B:\n${truncateText(captionB)}`,
        `룰 기반 1차 구조 분석:\n${JSON.stringify(referenceAnalysis?.referenceStructure || {}, null, 2)}`,
        `룰 기반 품질 점수:\n${JSON.stringify(referenceAnalysis?.quality || {}, null, 2)}`,
        '요청: 두 캡션에서 새 캡션에 참고 가능한 구조 패턴만 추출해줘. 원문 내용과 단어는 버려.',
      ].join('\n\n'),
    },
  ]

  const { response, parsed, modelUsed, fallbackUsed } = await createCaptionJsonCompletion({
    openai,
    model,
    fallbackModel,
    temperature: 0.2,
    messages,
    stage: 'caption-reference-pattern',
  })

  logAIUsage('caption-reference-pattern', response, {
    model: modelUsed,
    fallbackUsed,
    accountId,
  })

  return normalizeReferencePattern(parsed, referenceAnalysis)
}

async function generateCaptionFromBrief({
  openai,
  model,
  fallbackModel,
  accountId,
  brief,
  characterSystemPrompt,
  lengthCorrection = null,
}) {
  const messages = [
    {
      role: 'system',
      content: [
        '당신은 인스타그램/숏폼 캡션 카피라이터다. 출력은 JSON만 반환한다.',
        '우선순위는 1. 영상 주제, 2. 계정 세팅, 3. A/B 레퍼런스 구조, 4. 수익화 모델, 5. 카테고리 전략이다.',
        '가장 중요한 기준은 사용자의 영상 주제와 현재 계정 세팅값이며, A/B 구조가 이를 이기면 안 된다.',
        '카테고리별 캡션 전략은 말하는 방식과 위험 표현 회피에만 사용한다.',
        'A/B 캡션 원문은 제공되지 않는다. referencePattern은 구조 참고용일 뿐이다.',
        'A/B 캡션은 구조 참고용이며, 내용·상품명·상황·업종·문장·고유 표현은 절대 가져오지 않는다.',
        '레퍼런스의 주제, 업종, 상품명, 상황, 고유명사, 표면 단어를 가져오지 마라.',
        '레퍼런스 내용을 패러프레이즈하지 마라.',
        'referenceQuality.applicationStrength가 strong이면 줄바꿈, 문장 길이, 시작 방식, CTA 위치, 톤을 강하게 반영한다.',
        'referenceQuality.applicationStrength가 partial이면 확실한 구조만 일부 반영한다.',
        'referenceQuality.applicationStrength가 minimal이면 기본 구조를 사용하고 A/B는 약한 톤 힌트로만 반영한다.',
        'referenceLengthRule이 목표 길이를 제공하면 해시태그를 제외한 caption 본문 길이를 그 범위에 가깝게 맞춘다.',
        '단, 길이를 맞추려고 영상 주제와 계정 정체성을 희석하거나 불필요한 말을 늘리지 마라.',
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
        lengthCorrection
          ? [
              '길이 보정 지시:',
              `- 이전 결과 길이: 공백/해시태그 제외 ${lengthCorrection.currentLength}자`,
              `- 목표 길이: 공백/해시태그 제외 ${lengthCorrection.targetMinLength}~${lengthCorrection.targetMaxLength}자`,
              `- 조정 방향: ${lengthCorrection.direction === 'expand' ? 'A/B의 정보 밀도에 맞게 본문을 더 채운다.' : 'A/B보다 늘어진 부분을 압축한다.'}`,
              '- 문장 수와 흐름은 A/B 구조를 유지하고, 새 논리 전개를 임의로 추가하지 않는다.',
            ].join('\n')
          : null,
        '작성 규칙:',
        '1. 첫줄 Hook',
        '2. 공감/문제 제기',
        '3. 카테고리별 본문 강조점',
        '4. 수익모델에 맞는 CTA',
        '5. 필요한 경우 고지/주의 문구',
        '6. 금지 표현 회피',
      ].filter(Boolean).join('\n\n'),
    },
  ]

  const { response, parsed, modelUsed, fallbackUsed } = await createCaptionJsonCompletion({
    openai,
    model,
    fallbackModel,
    temperature: 0.65,
    messages,
    stage: 'caption-generate',
    validateParsed: (payload, context) => {
      if (!normalizeCaption(payload.caption)) {
        throw createCaptionResponseError('Caption model returned empty caption', context)
      }
    },
  })

  logAIUsage('caption-generate', response, {
    model: modelUsed,
    fallbackUsed,
    accountId,
    topic: brief.topic,
    category: brief.category,
    monetizationModel: brief.monetizationModel,
    referencePatternOnly: true,
  })

  return parsed
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
  const referenceAnalysis = analyzeReferenceCaptions(referenceCaptionA, referenceCaptionB)
  const referencePattern = await extractReferencePattern({
    openai,
    model: models.captionModel,
    fallbackModel: models.chatModel,
    accountId,
    captionA: referenceCaptionA,
    captionB: referenceCaptionB,
    referenceAnalysis,
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
    referenceQuality: referenceAnalysis.quality,
    referenceStructure: referencePattern.referenceStructure || referenceAnalysis.referenceStructure,
  })

  let parsed = await generateCaptionFromBrief({
    openai,
    model: models.captionModel,
    fallbackModel: models.chatModel,
    accountId,
    brief,
    characterSystemPrompt,
  })

  let caption = normalizeCaption(parsed.caption)
  let lengthCheck = getCaptionLengthCheck({
    caption,
    referenceStructure: brief.referenceStructure,
    referenceQuality: referenceAnalysis.quality,
  })

  if (caption && !lengthCheck.matched) {
    parsed = await generateCaptionFromBrief({
      openai,
      model: models.captionModel,
      fallbackModel: models.chatModel,
      accountId,
      brief,
      characterSystemPrompt,
      lengthCorrection: lengthCheck,
    })
    caption = normalizeCaption(parsed.caption)
    lengthCheck = {
      ...getCaptionLengthCheck({
        caption,
        referenceStructure: brief.referenceStructure,
        referenceQuality: referenceAnalysis.quality,
      }),
      corrected: true,
    }
  }

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
      referenceLength: {
        averageLength: brief.referenceStructure?.averageTextLength || 0,
        targetMinLength: lengthCheck.targetMinLength,
        targetMaxLength: lengthCheck.targetMaxLength,
        generatedLength: lengthCheck.currentLength,
        matched: lengthCheck.matched,
        corrected: Boolean(lengthCheck.corrected),
      },
      referenceUsage:
        referenceAnalysis.quality.applicationStrength === 'strong'
          ? 'A/B 원문은 구조 분석에만 사용했고, 줄바꿈·문장 길이·CTA 흐름을 강하게 반영했습니다.'
          : referenceAnalysis.quality.applicationStrength === 'partial'
            ? 'A/B 원문은 구조 분석에만 사용했고, 확실한 구조 요소만 일부 반영했습니다.'
            : 'A/B 원문은 구조 분석에만 사용했지만, 구조 신뢰도가 낮아 기본 캡션 구조로 보정했습니다.',
    },
    referencePattern,
    referenceStructure: referencePattern.referenceStructure || referenceAnalysis.referenceStructure,
    referenceQuality: referenceAnalysis.quality,
    abQualityScore: referenceAnalysis.quality.score,
    warnings: referenceAnalysis.quality.warnings,
    categoryRule,
    safetyCheck,
  }
}
