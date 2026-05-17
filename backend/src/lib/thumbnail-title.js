import { AppError } from './errors.js'
import { logAIError } from './ai-error-logger.js'
import { logAIUsage } from './ai-usage-logger.js'
import { parseModelJson } from './model-json.js'
import { getOpenAIClient, getOpenAIModels, hasOpenAIConfig } from './openai.js'

const THUMBNAIL_TEMPLATE_FAMILIES = new Set([
  'substitution_result',
  'group_superlative_nominal',
  'unexpected_subject_reaction',
  'problem_solution_contrast',
  'question_answer',
  'numbered_benefit',
  'generic_short_hook',
])

function normalizeList(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : []
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function normalizeFormulaParts(value) {
  const parts = normalizeObject(value)

  return {
    modifier: String(parts.modifier || '').trim(),
    keyword: String(parts.keyword || '').trim(),
    predicate: String(parts.predicate || '').trim(),
  }
}

function normalizeDisplayText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSlot(value) {
  const slot = normalizeObject(value)

  return {
    name: String(slot.name || '').trim(),
    surface: String(slot.surface || '').trim(),
    semanticRole: String(slot.semanticRole || '').trim(),
    replacementRule: String(slot.replacementRule || '').trim(),
  }
}

function normalizeSlots(value) {
  return Array.isArray(value)
    ? value.map(normalizeSlot).filter((slot) => slot.name || slot.semanticRole || slot.replacementRule)
    : []
}

function normalizeTemplateFamily(value) {
  const family = String(value || '').trim()
  return THUMBNAIL_TEMPLATE_FAMILIES.has(family) ? family : 'generic_short_hook'
}

function normalizeRecommendationReason(value) {
  const reason = normalizeDisplayText(value)

  if (/사용자에게\s*보여줄\s*자연어\s*설명만\s*작성/.test(reason)) {
    return ''
  }

  if (/(타깃\(|문장\s*골격|후킹\s*장치|치환|templateFamily|semanticRole|replacementRule|slot|슬롯|3단\s*공식|수식어|서술어|modifier|keyword|predicate|의외의\s*인정자|까다로운\s*반응자|강한\s*인정자)/i.test(reason)) {
    return ''
  }

  return reason
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function inferTemplateFamily({ detectedText = [], blueprint = {} } = {}) {
  const source = compactText(
    [
      ...normalizeList(detectedText),
      blueprint.sentenceTemplate,
      blueprint.lineRoles?.join(' '),
      blueprint.keepStructure?.join(' '),
      blueprint.questionAnswerPattern,
    ].join(' '),
  )

  if (!source) {
    return 'generic_short_hook'
  }

  if (/대신/.test(source) && /(했더니|먹었더니|바꿨더니|써봤더니|해봤더니|갔더니)/.test(source)) {
    return 'substitution_result'
  }

  if (/중에/.test(source) && /제일/.test(source)) {
    return 'group_superlative_nominal'
  }

  if (/(도|까지)/.test(source) && /(홀려|반하|놀라|찾게|멈추|빠지|끌리|혹하)/.test(source)) {
    return 'unexpected_subject_reaction'
  }

  if (/대신/.test(source) && /(해보세요|하세요|바꿔보세요|관리|해결|루틴|방법)/.test(source)) {
    return 'problem_solution_contrast'
  }

  if (/[?？]/.test(source) || /(질문|답변|반전)/.test(source)) {
    return 'question_answer'
  }

  if (/\d+/.test(source) && /(가지|단계|방법|노하우|전략|루틴|체크리스트)/.test(source)) {
    return 'numbered_benefit'
  }

  return 'generic_short_hook'
}

function defaultMarkersForFamily(family) {
  switch (family) {
    case 'substitution_result':
      return ['대신', '했더니']
    case 'group_superlative_nominal':
      return ['중에', '제일', '명사형 종결']
    case 'unexpected_subject_reaction':
      return ['도/까지', '강한 반응', '감탄']
    case 'problem_solution_contrast':
      return ['대신', '해보세요']
    case 'question_answer':
      return ['질문', '답변/반전']
    case 'numbered_benefit':
      return ['숫자', '유형/단계']
    default:
      return []
  }
}

function enrichTitleBlueprint(blueprint, detectedText = []) {
  const normalized = normalizeTitleBlueprint(blueprint)
  const inferredFamily =
    normalized.templateFamily === 'generic_short_hook'
      ? inferTemplateFamily({ detectedText, blueprint: normalized })
      : normalized.templateFamily
  const requiredMarkers = normalized.requiredMarkers.length
    ? normalized.requiredMarkers
    : defaultMarkersForFamily(inferredFamily)

  return {
    ...normalized,
    templateFamily: inferredFamily,
    requiredMarkers,
  }
}

function normalizeTitleBlueprint(value) {
  const blueprint = normalizeObject(value)

  return {
    lineCount: Number.isFinite(Number(blueprint.lineCount)) ? Number(blueprint.lineCount) : 0,
    templateFamily: normalizeTemplateFamily(blueprint.templateFamily),
    sentenceTemplate: String(blueprint.sentenceTemplate || '').trim(),
    slots: normalizeSlots(blueprint.slots),
    requiredMarkers: normalizeList(blueprint.requiredMarkers),
    linePattern: String(blueprint.linePattern || '').trim(),
    endingStyle: String(blueprint.endingStyle || '').trim(),
    lineRoles: normalizeList(blueprint.lineRoles),
    sentenceTypes: normalizeList(blueprint.sentenceTypes),
    hasDialogue: Boolean(blueprint.hasDialogue),
    questionAnswerPattern: String(blueprint.questionAnswerPattern || '').trim(),
    emotionFlow: String(blueprint.emotionFlow || '').trim(),
    layoutPattern: String(blueprint.layoutPattern || '').trim(),
    keepStructure: normalizeList(blueprint.keepStructure),
    avoidCopying: normalizeList(blueprint.avoidCopying),
  }
}

function hasFormulaBenefitModifier(title) {
  return /(분|시간|하루|일주일|돈|비용|반값|무료|없이|줄이는|아끼는|쉽게|왕초보|초보|방구석|혼자|바로|안 해도|하지 않고)/.test(
    compactText(title),
  )
}

function hasFormulaPredicate(title) {
  return /\d+/.test(title) && /(가지|단계|방법|노하우|전략|비밀|꿀팁|매뉴얼|메뉴얼|특징|체크리스트|루틴|공식|템플릿|메뉴|동작)/.test(title)
}

function hasAwkwardFormulaJoin(title) {
  const normalizedTitle = compactText(title)

  return /10분\s*줄이는\s*살림|두껍게\s*안\s*발라도\s*베이스|헬스장\s*없이\s*홈트|시간\s*절약\s*단골|간단히\s*단골|쉽게\s*단골/.test(
    normalizedTitle,
  )
}

function validateThreePartFormulaTitle(item) {
  const title = compactText(item?.title)
  const formulaParts = normalizeFormulaParts(item?.formulaParts)
  const hasParts = Boolean(formulaParts.modifier && formulaParts.keyword && formulaParts.predicate)

  return {
    ok: Boolean(title && hasFormulaBenefitModifier(title) && hasFormulaPredicate(title) && hasParts && !hasAwkwardFormulaJoin(title)),
    reason: 'requires_benefit_keyword_numbered_predicate',
  }
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

function createThumbnailTitleResponseError(message, details = {}) {
  const error = new Error(message)
  error.code = 'THUMBNAIL_TITLE_RESPONSE_INVALID'
  error.details = details
  return error
}

function isThumbnailTitleResponseError(error) {
  const message = String(error?.message || error || '')
  const code = String(error?.code || '')

  return (
    code === 'THUMBNAIL_TITLE_RESPONSE_INVALID' ||
    /Model returned empty content|Model did not return JSON|Unexpected token|recommendations|thumbnail title/i.test(
      message,
    )
  )
}

function isRecoverableThumbnailTitleError(error) {
  return isModelCompatibilityError(error) || isThumbnailTitleResponseError(error)
}

function normalizeThumbnailRecommendations(parsed) {
  return Array.isArray(parsed?.recommendations)
    ? parsed.recommendations
        .slice(0, 3)
        .map((item, index) => ({
          type: String(item?.type || ['A', 'B', 'C'][index] || '').trim(),
          label: String(item?.label || ['원본 보존형', '후킹 강화형', '3단공식 적용형'][index] || '').trim(),
          title: String(item?.title || '').trim(),
          reason: normalizeRecommendationReason(item?.reason),
          strategy: normalizeDisplayText(item?.strategy),
          blueprintUsed: normalizeDisplayText(item?.blueprintUsed),
          formulaParts: normalizeFormulaParts(item?.formulaParts),
        }))
        .filter((item) => item.title)
    : []
}

function parseThumbnailTitleResponse(response, model) {
  const rawContent = response.choices[0]?.message?.content || ''
  let parsed

  try {
    parsed = parseModelJson(rawContent)
  } catch (error) {
    throw createThumbnailTitleResponseError('Thumbnail title model returned invalid JSON', {
      model,
      parserMessage: String(error?.message || error),
      rawPreview: String(rawContent || '').slice(0, 240),
    })
  }

  const recommendations = normalizeThumbnailRecommendations(parsed)

  if (!recommendations.length) {
    throw createThumbnailTitleResponseError('Thumbnail title model returned empty recommendations', {
      model,
      parsedKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [],
    })
  }

  return {
    parsed,
    recommendations,
  }
}

async function createThumbnailTitleCompletion(openai, { model, fallbackModel, messages }) {
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
      params.temperature = 0.55
    }

    try {
      const response = await openai.chat.completions.create(params)
      const parsedPayload = parseThumbnailTitleResponse(response, candidateModel)

      return {
        response,
        ...parsedPayload,
        modelUsed: candidateModel,
        fallbackUsed: candidateModel !== model,
      }
    } catch (error) {
      lastError = error

      if (!isRecoverableThumbnailTitleError(error)) {
        throw error
      }

      console.warn('[thumbnail-title] generation fallback', {
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

function deriveThumbnailKeyword(topic) {
  const normalizedTopic = compactText(topic)

  if (/단골|재방문|손님|고객/.test(normalizedTopic)) {
    return '단골 관리법'
  }

  if (/살림|집안일|정리|청소/.test(normalizedTopic)) {
    return '살림 루틴'
  }

  if (/운동|헬스|다이어트|몸/.test(normalizedTopic)) {
    return '몸관리 루틴'
  }

  if (/요리|레시피|식단|식사|음식/.test(normalizedTopic)) {
    return '식단 루틴'
  }

  if (/뷰티|피부|화장|메이크업|쿠션|베이스/.test(normalizedTopic)) {
    return '베이스 루틴'
  }

  if (/육아|아이|등원|훈육|부모|아기/.test(normalizedTopic)) {
    return '육아 루틴'
  }

  return normalizedTopic.replace(/[.,!?！？]/g, '').slice(0, 12) || '실전 루틴'
}

function deriveFormulaParts(topic) {
  const normalizedTopic = compactText(topic)

  if (/단골|재방문|손님|고객|가게|매장/.test(normalizedTopic)) {
    return {
      modifier: '쿠폰 없이',
      keyword: '단골 만드는 법',
      predicate: '5가지 전략',
    }
  }

  if (/살림|집안일|정리|청소/.test(normalizedTopic)) {
    return {
      modifier: '청소 시간 10분 줄이는',
      keyword: '살림 루틴',
      predicate: '5가지 방법',
    }
  }

  if (/뷰티|피부|화장|메이크업|쿠션|베이스/.test(normalizedTopic)) {
    return {
      modifier: '얇아도 커버력 좋은',
      keyword: '베이스 루틴',
      predicate: '5가지 방법',
    }
  }

  if (/요리|레시피|식단|식사|음식/.test(normalizedTopic)) {
    return {
      modifier: '10분 안에 차리는',
      keyword: '집밥 반찬',
      predicate: '5가지 메뉴',
    }
  }

  if (/운동|헬스|다이어트|몸/.test(normalizedTopic)) {
    return {
      modifier: '집에서 헬스장 효과 내는',
      keyword: '홈트 루틴',
      predicate: '5가지 동작',
    }
  }

  if (/육아|아이|등원|훈육|부모|아기/.test(normalizedTopic)) {
    return {
      modifier: '잔소리 줄이는',
      keyword: '등원 루틴',
      predicate: '5가지 방법',
    }
  }

  return {
    modifier: '바로 써먹는',
    keyword: deriveThumbnailKeyword(topic),
    predicate: '5가지 방법',
  }
}

function fallbackFormulaRecommendation(item, topic) {
  const formulaParts = deriveFormulaParts(topic)

  return {
    ...item,
    title: `${formulaParts.modifier} ${formulaParts.keyword} ${formulaParts.predicate}`,
    reason: '혜택, 핵심 주제, 숫자형 방법이 한눈에 보이도록 구성했습니다.',
    formulaParts,
  }
}

function enforceThumbnailRecommendations(options) {
  return options.recommendations.map((item) => {
    if (item.type !== 'C') {
      return item
    }

    const validation = validateThreePartFormulaTitle(item)
    return validation.ok ? item : fallbackFormulaRecommendation(item, options.topic)
  })
}

export async function analyzeThumbnailImage({
  imageBuffer,
  mimeType,
  topic = '',
  category = '',
  tone = '',
}) {
  if (!hasOpenAIConfig()) {
    throw new AppError('OpenAI API key is not configured', {
      code: 'OPENAI_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new AppError('Thumbnail image is required', {
      code: 'THUMBNAIL_IMAGE_REQUIRED',
      statusCode: 400,
    })
  }

  const openai = getOpenAIClient()
  const { visionModel } = getOpenAIModels()
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${imageBuffer.toString('base64')}`

  try {
    const response = await openai.chat.completions.create({
      model: visionModel,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: [
            '당신은 인스타 릴스 썸네일 카피 전략가다.',
            '업로드된 이미지를 OCR/시각 분위기/구도 관점에서 분석한다.',
            '아직 최종 제목을 생성하지 말고, 제목 생성에 필요한 이미지 분석 결과만 JSON으로 반환한다.',
            '이미지 안에 제목/카피가 보이면 단어를 베끼지 말고, 줄 수/문장 역할/대화체/질문-답변/반전 흐름/배치 구조를 titleBlueprint로 구조화한다.',
            'templateFamily는 닫힌 생성 템플릿이 아니라 참고용 보조 태그다. 애매하면 generic_short_hook을 선택한다.',
            '레퍼런스 제목을 가능한 한 원문에 가까운 동적 슬롯 단위로 분해하고, 각 슬롯의 의미 역할과 새 주제 치환 규칙을 slots에 작성한다.',
            '원본 단어와 소재는 복사 대상이 아니다. 보존할 것은 문장 역할, 줄 구성, 가독성, 감정 흐름이다.',
            '이미지에 없는 내용을 지어내지 않는다.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                `영상 주제: ${topic || '-'}`,
                `계정 카테고리: ${category || '-'}`,
                `계정 톤: ${tone || '-'}`,
                '',
                '아래 JSON 형식으로만 답하세요.',
                '{',
                '  "detectedText": ["이미지 안에 보이는 텍스트"],',
                '  "mainObjects": ["인물/제품/장소/도구"],',
                '  "visualMood": "이미지 분위기",',
                '  "composition": "구도와 시선 흐름",',
                '  "titleSpace": "텍스트를 얹기 좋은 위치",',
                '  "thumbnailRole": "이미지가 제목 생성에서 맡아야 할 역할",',
                '  "titleBlueprint": {',
                '    "lineCount": 0,',
                '    "templateFamily": "substitution_result | group_superlative_nominal | unexpected_subject_reaction | problem_solution_contrast | question_answer | numbered_benefit | generic_short_hook",',
                '    "sentenceTemplate": "원본 제목의 고유한 문장 형식을 슬롯으로 추상화. 미리 정한 패턴에 끼워 맞추지 말 것.",',
                '    "slots": [',
                '      {"name":"slot_name","surface":"원본에서 해당하는 표현","semanticRole":"이 슬롯이 제목에서 맡는 의미 역할","replacementRule":"새 주제로 치환할 때 지켜야 할 규칙"}',
                '    ],',
                '    "requiredMarkers": ["새 제목에서도 반드시 유지할 조사/부사/어미/감탄 표지"],',
                '    "linePattern": "1줄형 | 2줄형 | 대화형 | 질문답변형",',
                '    "endingStyle": "명사형 | 감탄형 | 의문형 | 결과형 | 명령형",',
                '    "lineRoles": ["각 줄의 역할: 상황 제시/질문/답변/반전/해결 약속 등"],',
                '    "sentenceTypes": ["서술형/질문형/대답형/명령형/숫자형"],',
                '    "hasDialogue": false,',
                '    "questionAnswerPattern": "질문-답변 구조가 있으면 설명",',
                '    "emotionFlow": "감정 흐름: 공백/궁금증/반전/해결 등",',
                '    "layoutPattern": "중앙 자막/상단 배치/짧은 3줄 등",',
                '    "keepStructure": ["새 주제에서도 유지할 구조"],',
                '    "avoidCopying": ["복사하지 말아야 할 원본 단어/소재"]',
                '  },',
                '  "avoidRepeating": ["새 주제로 억지 치환하면 어색한 원본 숫자/대상/상황/표현"],',
                '  "titleDirections": ["레퍼런스 제목에서 참고할 클릭 전략/감정 트리거/가독성 신호"],',
                '  "risks": ["주의할 점"]',
                '}',
              ].join('\n'),
            },
            {
              type: 'image_url',
              image_url: {
                url: dataUrl,
                detail: 'high',
              },
            },
          ],
        },
      ],
    })

    logAIUsage('thumbnail-vision-analysis', response, {
      model: visionModel,
      topic,
      category,
    })

    const parsed = parseModelJson(response.choices[0]?.message?.content || '')
    const detectedText = normalizeList(parsed.detectedText)

    return {
      detectedText,
      mainObjects: normalizeList(parsed.mainObjects),
      visualMood: String(parsed.visualMood || '').trim(),
      composition: String(parsed.composition || '').trim(),
      titleSpace: String(parsed.titleSpace || '').trim(),
      thumbnailRole: String(parsed.thumbnailRole || '').trim(),
      titleBlueprint: enrichTitleBlueprint(parsed.titleBlueprint, detectedText),
      avoidRepeating: normalizeList(parsed.avoidRepeating),
      titleDirections: normalizeList(parsed.titleDirections),
      risks: normalizeList(parsed.risks),
    }
  } catch (error) {
    logAIError('vision', error, {
      stage: 'thumbnail-image-analysis',
      model: visionModel,
      topic,
      category,
    })

    throw new AppError('Thumbnail image analysis failed', {
      code: 'THUMBNAIL_IMAGE_ANALYSIS_FAILED',
      statusCode: 502,
      details: {
        stage: 'thumbnail-image-analysis',
        model: visionModel,
      },
      cause: error,
    })
  }
}

export async function generateThumbnailTitles({
  topic = '',
  category = '',
  tone = '',
  imageAnalysis = {},
  characterSystemPrompt = '',
}) {
  if (!hasOpenAIConfig()) {
    throw new AppError('OpenAI API key is not configured', {
      code: 'OPENAI_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  const normalizedTopic = String(topic || '').trim()
  if (!normalizedTopic) {
    throw new AppError('topic is required', {
      code: 'INVALID_INPUT',
      statusCode: 400,
      details: { field: 'topic' },
    })
  }

  const openai = getOpenAIClient()
  const { chatModel, thumbnailModel } = getOpenAIModels()
  const detectedText = normalizeList(imageAnalysis.detectedText)
  const analysis = {
    detectedText,
    mainObjects: normalizeList(imageAnalysis.mainObjects),
    visualMood: String(imageAnalysis.visualMood || '').trim(),
    composition: String(imageAnalysis.composition || '').trim(),
    titleSpace: String(imageAnalysis.titleSpace || '').trim(),
    thumbnailRole: String(imageAnalysis.thumbnailRole || '').trim(),
    titleBlueprint: enrichTitleBlueprint(imageAnalysis.titleBlueprint, detectedText),
    avoidRepeating: normalizeList(imageAnalysis.avoidRepeating),
    titleDirections: normalizeList(imageAnalysis.titleDirections),
    risks: normalizeList(imageAnalysis.risks),
  }

  try {
    const messages = [
        {
          role: 'system',
          content: [
            '당신은 인스타 릴스 썸네일 제목 카피라이터다. 출력은 JSON만 반환한다.',
            '핵심 작업: 레퍼런스 썸네일 제목의 단어가 아니라 titleBlueprint의 줄 수, 문장 역할, 대화체/질문-답변/반전 흐름, 시각 배치감을 현재 영상 주제에 맞게 재구성한다.',
            '우선순위: 1. 레퍼런스 titleBlueprint 보존(A/B) 2. 영상 주제와 계정 카테고리 적합성 3. 타깃의 실제 고민/욕구 4. 모바일 가독성 5. 원본 단어/소재 비표절성.',
            'A/B는 원본 단어를 베끼지 않되 원본의 문장 역할과 줄 구성은 유지한다. C는 레퍼런스 문장틀보다 3단 공식 완성도를 우선한다.',
            'A/B는 미리 정해진 템플릿으로 만들지 않는다. 매번 레퍼런스 OCR 텍스트와 titleBlueprint에서 즉석으로 추출한 문장틀을 따라간다.',
            'A/B는 titleBlueprint.sentenceTemplate이 있으면 그 문장 형식을 우선하되, templateFamily 이름에 억지로 끼워 맞추지 않는다. 예: 원본이 "밥 대신 두부를 먹었더니"이면 A/B도 "{대체 대상} 대신 {새 대상}을 먹었더니" 골격을 유지한다.',
            'A/B는 titleBlueprint.slots의 semanticRole과 replacementRule을 따른다. 표면 단어보다 슬롯의 의미 역할이 중요하다.',
            'templateFamily와 requiredMarkers는 참고용 안전 신호다. 생성의 출발점은 항상 실제 OCR 제목과 동적 sentenceTemplate이다.',
            '원본 제목의 숫자, 대상, 상황을 기계적으로 바꾸지 않는다. 원본 소재가 새 주제와 맞지 않으면 역할만 가져오고 소재는 새로 잡는다.',
            '제목은 8~18자 권장, 한눈에 읽히게 짧게 쓴다.',
            'A/B/C는 고정한다. A=원본 보존형, B=후킹 강화형, C=3단공식 적용형.',
            'A 원본 보존형: 레퍼런스의 줄 수, 문장 역할, 대화체/질문형/반전 구조를 가장 강하게 유지한다.',
            'B 후킹 강화형: A와 같은 틀을 유지하되 결핍, 궁금증, 반전 압력만 더 강하게 만든다.',
            'B는 자극적 수식어를 붙이는 방식이 아니라, 타깃 시청자가 클릭하고 싶어지는 감정 적합성을 강화한다.',
            'B는 레퍼런스의 후킹 장치가 왜 먹히는지 먼저 추론하고, 같은 종류의 감정 압력만 강화한다.',
            'B는 "딱", "진짜", "바로", "완전" 같은 부사를 덧붙이는 식으로 강화하지 않는다. 가장 감정이 걸리는 슬롯 자체를 더 정확한 타깃 문제/욕망으로 바꾼다.',
            'B에서 원본이 "{문제 행동} 대신 {해결 권유}" 구조라면, 앞 슬롯은 타깃이 실제로 반복하지만 효과가 낮은 행동이어야 한다. 상태명사나 추상 문제명 대신 손에 잡히는 행동을 쓴다.',
            '예: 청소법 주제에서 "걸레만 돌리기"보다 "바닥만 닦기", "청소기만 돌리기", "매일 쓸고 닦기"가 더 자연스럽고 타깃 문제에 가깝다.',
            'B는 레퍼런스에 없는 새 후킹 장치를 추가하지 않는다. 예: 원본이 최고 평가 구조라면 인정자/까다로운 반응자 구조를 새로 만들지 않는다.',
            '의외의 인정자/까다로운 반응자 장치는 원본 OCR 자체가 "{예상 밖 대상도/까지} {강한 반응} / {대상} {감탄}" 구조일 때만 사용한다.',
            'C 3단공식 적용형: <수식어 + 키워드 + 서술어> 공식 완성도를 우선한다. 레퍼런스는 시각 배치와 모바일 가독성만 참고한다.',
            '3단 공식 정의: 수식어=사용자가 얻는 혜택/변화/시간 단축/난이도 완화, 키워드=영상 주제의 핵심 대상/방법/루틴/노하우, 서술어=유형/개수/단계/노하우/전략/체크리스트/루틴.',
            'C의 수식어에는 반드시 시간 절약, 돈 절약, 노동 절감, 난이도 완화, 초보 가능성 중 하나의 혜택이 드러나야 한다.',
            'C의 키워드는 사용자가 실제로 검색하거나 이해할 법한 핵심 단어를 쓴다. 예: 릴스 기획법, 단골 만드는 법, 살림 루틴, 베이스 루틴.',
            'C의 서술어는 반드시 숫자+유형으로 끝낸다. 예: 5가지 전략, 3단계 방법, 7가지 노하우, 10가지 체크리스트.',
            'C는 "간단히", "쉽게", "좋은"처럼 단독으로는 약한 수식어만 쓰지 않는다. 가능하면 "10분 안에", "쿠폰 없이", "왕초보도", "하루 10분으로"처럼 구체 혜택을 붙인다.',
            'C는 수식어+키워드+서술어를 기계적으로 붙이지 말고 한 문장처럼 자연스럽게 읽혀야 한다.',
            'C의 수식어는 키워드 바로 앞에서 관형어처럼 자연스럽게 붙어야 한다. 절감형 수식어는 무엇을 줄이는지 명시한다.',
            'C 금지 예: "10분 줄이는 살림 루틴", "두껍게 안 발라도 베이스 루틴", "헬스장 없이 홈트 루틴", "시간 절약 단골 루틴".',
            'C 좋은 예: "청소 시간 10분 줄이는 살림 루틴", "얇아도 커버력 좋은 베이스 루틴", "집에서 헬스장 효과 내는 홈트 루틴".',
            '영상 주제가 살림처럼 추상적이면 살림 루틴, 집안일 동선, 정리 습관, 가사 공백 대처처럼 구체 키워드를 먼저 잡고 제목화한다.',
            '과장 보장, 허위 수치, 의료/재테크/교육/건강 효과 보장 표현은 금지한다.',
            '계정 카테고리, 타깃, 상품/서비스 방향을 바꾸지 않는다.',
            characterSystemPrompt ? `계정/캐릭터 고정 규칙:\n${characterSystemPrompt}` : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
        {
          role: 'user',
          content: [
            `영상 주제: ${normalizedTopic}`,
            `계정 카테고리: ${category || '-'}`,
            `계정 톤: ${tone || '-'}`,
            '',
            `[썸네일 이미지 분석]`,
            `- 이미지 내 텍스트: ${analysis.detectedText.join(', ') || '-'}`,
            `- 주요 요소: ${analysis.mainObjects.join(', ') || '-'}`,
            `- 분위기: ${analysis.visualMood || '-'}`,
            `- 구도: ${analysis.composition || '-'}`,
            `- 제목 위치: ${analysis.titleSpace || '-'}`,
            `- 이미지 역할: ${analysis.thumbnailRole || '-'}`,
            `- 제목 틀/블루프린트: ${JSON.stringify(analysis.titleBlueprint)}`,
            `- 참고용 패턴 태그: ${analysis.titleBlueprint.templateFamily}`,
            `- 참고용 표면 마커: ${analysis.titleBlueprint.requiredMarkers.join(', ') || '-'}`,
            `- 슬롯 의미 역할: ${JSON.stringify(analysis.titleBlueprint.slots)}`,
            `- 억지 치환하면 어색한 원본 표현: ${analysis.avoidRepeating.join(', ') || '-'}`,
            `- 참고할 레퍼런스 클릭 전략: ${analysis.titleDirections.join(', ') || '-'}`,
            `- 주의점: ${analysis.risks.join(', ') || '-'}`,
            '',
            '[생성 규칙]',
            '- A와 B는 titleBlueprint의 lineRoles, sentenceTypes, hasDialogue, questionAnswerPattern, emotionFlow, layoutPattern을 우선 반영한다.',
            '- A와 B는 titleBlueprint.sentenceTemplate이 있으면 그 문장 골격을 반드시 벤치마킹한다.',
            '- A와 B는 titleBlueprint.slots의 semanticRole과 replacementRule을 반드시 따른다. 각 슬롯 자리에 같은 의미 역할의 새 주제 표현을 넣는다.',
            '- A와 B는 templateFamily별 고정 제목으로 만들지 않는다. templateFamily는 보조 태그일 뿐이며, 실제 레퍼런스 OCR 제목과 sentenceTemplate이 우선이다.',
            '- A와 B는 requiredMarkers를 기계적으로 모두 넣는 것이 아니라, 실제 OCR 제목에서 의미 있게 작동한 조사/어미/감탄만 자연스럽게 보존한다.',
            '- A는 원본 구조 밀착형이다. 원본과 비슷한 줄 수/문장 역할/조사/어미 흐름을 유지하되 단어와 소재는 새 주제로 바꾼다.',
            '- B는 후킹 강화형이다. A와 같은 문장 형식을 유지하고 결과 기대감/변화 압력만 강화한다.',
            '- B는 타깃 시청자의 입장에서 클릭 안 하고는 못 베길 감정 적합성을 강화한다. 의미 없는 수식어를 붙이지 않는다.',
            '- B는 레퍼런스 제목의 후킹 장치가 왜 강한지 추론한 뒤 같은 종류의 감정 압력만 강화한다.',
            '- B는 A 제목에 "딱", "진짜", "바로", "완전" 같은 부사만 붙이는 것을 금지한다. A와 B의 차이는 부사가 아니라 핵심 슬롯의 정확도여야 한다.',
            '- B는 문장틀 안에서 타깃이 가장 자주 겪는 불편/비효율/욕망 슬롯을 더 날카롭게 바꾼다.',
            '- 원본이 "{문제 행동} 대신 {해결 권유}" 구조라면 B의 앞 슬롯은 타깃이 실제로 하는 비효율 행동이어야 한다. 예: "걸레만 돌리기"보다 "바닥만 닦기", "청소기만 돌리기", "매일 쓸고 닦기".',
            '- B는 레퍼런스에 없는 새 후킹 장치를 추가하지 않는다. 원본이 "대상 한정 + 최고 평가"이면 B도 그 안에서 대상/평가 강도만 조정한다.',
            '- 예: 원본 "밥 대신 두부를 먹었더니", 주제 "콩요리"라면 A는 "쌀 대신 콩을 먹었더니"처럼 대신+먹었더니 골격이 드러나야 한다.',
            '- 예: 원본 "알람 10개 대신 이렇게 해보세요"에서 "알람 10개" 슬롯은 타깃이 반복하지만 효과가 낮은 기존 행동이다. 새 주제에서도 "단골부족" 같은 상태명사가 아니라 "쿠폰 뿌리기", "손님 기다리기" 같은 비효율 행동으로 치환한다.',
            '- 예: 원본 "404 춘 사람 중에 / 제일 쫀쫀함", 주제 "단골이 계속 생기는 꿀팁"이라면 A/B는 "사장님들 중에 제일 단골 잘 만듦"처럼 중에+제일+명사형 평가가 드러나야 한다.',
            '- 예: 원본 "경쟁자도 홀려버린 / 최미나수 드레스 ㄷㄷ"처럼 원본 자체가 도+반응+감탄 구조일 때만 A/B도 "지나가던 손님도 들어오게 만든 / 매장 문구 ㄷㄷ"처럼 같은 장치를 쓴다.',
            '- 원본에 의외의 인정자/까다로운 반응자가 없으면 B에 모르는 사람, 전문가, 까다로운 고객, 입짧은 아이 같은 인정자 주체를 만들지 않는다.',
            '- A/B에는 3단 공식 설명, modifier, keyword, predicate를 쓰지 않는다.',
            '- A/B는 fallback처럼 보이는 범용 제목을 금지한다. 레퍼런스 OCR 제목을 보지 않고도 만들 수 있는 제목이면 실패다.',
            '- C는 3단공식 적용형이다. 반드시 formulaParts를 채우고, title은 modifier + keyword + predicate가 자연스럽게 이어져야 한다.',
            '- C의 modifier는 상품/콘텐츠가 주는 혜택이어야 한다. 시간, 돈, 노동 절감, 난이도 완화, 초보 가능성 중 하나를 드러낸다.',
            '- C의 keyword는 콘텐츠의 핵심 이름이어야 한다. 사용자가 실제로 쓰는 쉬운 단어를 사용한다.',
            '- C의 predicate는 숫자+유형이어야 한다. 예: 5가지 전략, 3단계 방법, 7가지 노하우, 10가지 체크리스트.',
            '- C 제목은 "간단히 단골 만드는 루틴"처럼 숫자와 유형이 빠진 제목으로 만들지 않는다.',
            '- C 제목은 수식어와 키워드가 자연스럽게 이어져야 한다. "무엇을 줄이는지", "무엇 없이 어떤 효과를 얻는지"가 명확해야 한다.',
            '- 실패 예: "10분 줄이는 살림 루틴", "두껍게 안 발라도 베이스 루틴", "헬스장 없이 홈트 루틴", "시간 절약 단골 루틴".',
            '- 좋은 예: "청소 시간 10분 줄이는 살림 루틴", "얇아도 커버력 좋은 베이스 루틴", "집에서 헬스장 효과 내는 홈트 루틴".',
            '- 예: 주제 "단골 고객이 계속 생기는 꿀팁"이라면 C는 "쿠폰 없이 단골 만드는 법 5가지 전략"처럼 혜택+키워드+숫자형 유형이 보여야 한다.',
            '- C는 레퍼런스의 대화체/상황극 문장틀보다 3단 공식 완성도를 우선한다.',
            '- 원본 제목의 숫자, 대상, 대비 구문을 억지로 살리지 않는다. 새 주제에 없는 숫자나 비교 대상을 만들지 않는다.',
            '- A/B/C 세 제목은 모두 같은 영상 주제에서 벗어나지 않아야 한다.',
            '',
            '다음 JSON 형식으로만 답하세요.',
            '{',
            '  "recommendations": [',
            '    {"type":"A","label":"원본 보존형","title":"","reason":"","strategy":"","blueprintUsed":"","formulaParts":{"modifier":"","keyword":"","predicate":""}},',
            '    {"type":"B","label":"후킹 강화형","title":"","reason":"","strategy":"","blueprintUsed":"","formulaParts":{"modifier":"","keyword":"","predicate":""}},',
            '    {"type":"C","label":"3단공식 적용형","title":"","reason":"","strategy":"","blueprintUsed":"","formulaParts":{"modifier":"","keyword":"","predicate":""}}',
            '  ],',
            '  "appliedInputs": {"topic":"","accountCategory":"","accountTone":"","imageAnalysisUsed":true},',
            '  "safetyCheck": {"topicPreserved":true,"accountTonePreserved":true,"imageTextRepeated":false,"bannedClaimsRemoved":true}',
            '}',
          ].join('\n'),
        },
      ]
    const { response, parsed, recommendations, modelUsed, fallbackUsed } = await createThumbnailTitleCompletion(openai, {
      model: thumbnailModel,
      fallbackModel: chatModel,
      messages,
    })
    const patternCheckedRecommendations = enforceThumbnailRecommendations({
      recommendations,
      topic: normalizedTopic,
    })

    logAIUsage('thumbnail-title-generation', response, {
      model: modelUsed,
      fallbackUsed,
      topic: normalizedTopic,
      category,
    })

    return {
      recommendations: patternCheckedRecommendations,
      appliedInputs: {
        topic: normalizedTopic,
        accountCategory: category || '',
        accountTone: tone || '',
        imageAnalysisUsed: Boolean(imageAnalysis),
        ...(parsed.appliedInputs && typeof parsed.appliedInputs === 'object' ? parsed.appliedInputs : {}),
      },
      safetyCheck: {
        topicPreserved: Boolean(parsed.safetyCheck?.topicPreserved ?? true),
        accountTonePreserved: Boolean(parsed.safetyCheck?.accountTonePreserved ?? true),
        imageTextRepeated: Boolean(parsed.safetyCheck?.imageTextRepeated ?? false),
        bannedClaimsRemoved: Boolean(parsed.safetyCheck?.bannedClaimsRemoved ?? true),
      },
    }
  } catch (error) {
    logAIError('gpt', error, {
      stage: 'thumbnail-title-generation',
      model: thumbnailModel,
      fallbackModel: chatModel,
      topic: normalizedTopic,
      category,
    })

    throw new AppError('썸네일 제목 생성에 실패했습니다. 잠시 후 다시 시도해주세요.', {
      code: 'THUMBNAIL_TITLE_GENERATION_FAILED',
      statusCode: 502,
      details: {
        stage: 'thumbnail-title-generation',
        model: thumbnailModel,
        fallbackModel: chatModel,
      },
      exposeMessage: true,
      cause: error,
    })
  }
}
