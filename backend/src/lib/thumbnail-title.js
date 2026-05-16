import { AppError } from './errors.js'
import { logAIError } from './ai-error-logger.js'
import { logAIUsage } from './ai-usage-logger.js'
import { parseModelJson } from './model-json.js'
import { getOpenAIClient, getOpenAIModels, hasOpenAIConfig } from './openai.js'

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

function normalizeRecommendationReason(value) {
  const reason = normalizeDisplayText(value)

  if (/사용자에게\s*보여줄\s*자연어\s*설명만\s*작성/.test(reason)) {
    return ''
  }

  return reason
}

function normalizeTitleBlueprint(value) {
  const blueprint = normalizeObject(value)

  return {
    lineCount: Number.isFinite(Number(blueprint.lineCount)) ? Number(blueprint.lineCount) : 0,
    sentenceTemplate: String(blueprint.sentenceTemplate || '').trim(),
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
                '    "sentenceTemplate": "원본 제목의 문장 형식을 슬롯으로 추상화. 예: {대체 대상} 대신 {새 대상}을 먹었더니",',
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

    return {
      detectedText: normalizeList(parsed.detectedText),
      mainObjects: normalizeList(parsed.mainObjects),
      visualMood: String(parsed.visualMood || '').trim(),
      composition: String(parsed.composition || '').trim(),
      titleSpace: String(parsed.titleSpace || '').trim(),
      thumbnailRole: String(parsed.thumbnailRole || '').trim(),
      titleBlueprint: normalizeTitleBlueprint(parsed.titleBlueprint),
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
  const analysis = {
    detectedText: normalizeList(imageAnalysis.detectedText),
    mainObjects: normalizeList(imageAnalysis.mainObjects),
    visualMood: String(imageAnalysis.visualMood || '').trim(),
    composition: String(imageAnalysis.composition || '').trim(),
    titleSpace: String(imageAnalysis.titleSpace || '').trim(),
    thumbnailRole: String(imageAnalysis.thumbnailRole || '').trim(),
    titleBlueprint: normalizeTitleBlueprint(imageAnalysis.titleBlueprint),
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
            'A/B는 titleBlueprint.sentenceTemplate이 있으면 반드시 그 문장 형식을 우선한다. 예: 원본이 "밥 대신 두부를 먹었더니"이면 A/B도 "{대체 대상} 대신 {새 대상}을 먹었더니" 골격을 유지한다.',
            '원본 제목의 숫자, 대상, 상황을 기계적으로 바꾸지 않는다. 원본 소재가 새 주제와 맞지 않으면 역할만 가져오고 소재는 새로 잡는다.',
            '제목은 8~18자 권장, 한눈에 읽히게 짧게 쓴다.',
            'A/B/C는 고정한다. A=원본 보존형, B=후킹 강화형, C=3단공식 적용형.',
            'A 원본 보존형: 레퍼런스의 줄 수, 문장 역할, 대화체/질문형/반전 구조를 가장 강하게 유지한다.',
            'B 후킹 강화형: A와 같은 틀을 유지하되 결핍, 궁금증, 반전 압력만 더 강하게 만든다.',
            'C 3단공식 적용형: <수식어 + 키워드 + 서술어> 공식 완성도를 우선한다. 레퍼런스는 시각 배치와 모바일 가독성만 참고한다.',
            '3단 공식 정의: 수식어=사용자가 얻는 혜택/변화/시간 단축/난이도 완화, 키워드=영상 주제의 핵심 대상/방법/루틴/노하우, 서술어=유형/개수/단계/노하우/전략/체크리스트/루틴.',
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
            `- 억지 치환하면 어색한 원본 표현: ${analysis.avoidRepeating.join(', ') || '-'}`,
            `- 참고할 레퍼런스 클릭 전략: ${analysis.titleDirections.join(', ') || '-'}`,
            `- 주의점: ${analysis.risks.join(', ') || '-'}`,
            '',
            '[생성 규칙]',
            '- A와 B는 titleBlueprint의 lineRoles, sentenceTypes, hasDialogue, questionAnswerPattern, emotionFlow, layoutPattern을 우선 반영한다.',
            '- A와 B는 titleBlueprint.sentenceTemplate이 있으면 그 문장 골격을 반드시 벤치마킹한다.',
            '- A는 원본 구조 밀착형이다. 원본과 비슷한 줄 수/문장 역할/조사/어미 흐름을 유지하되 단어와 소재는 새 주제로 바꾼다.',
            '- B는 후킹 강화형이다. A와 같은 문장 형식을 유지하고 결과 기대감/변화 압력만 강화한다.',
            '- 예: 원본 "밥 대신 두부를 먹었더니", 주제 "콩요리"라면 A는 "쌀 대신 콩을 먹었더니"처럼 대신+먹었더니 골격이 드러나야 한다.',
            '- A/B에는 3단 공식 설명, modifier, keyword, predicate를 쓰지 않는다.',
            '- C는 3단공식 적용형이다. 반드시 formulaParts를 채우고, title은 modifier + keyword + predicate가 자연스럽게 이어져야 한다.',
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

    logAIUsage('thumbnail-title-generation', response, {
      model: modelUsed,
      fallbackUsed,
      topic: normalizedTopic,
      category,
    })

    return {
      recommendations,
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
