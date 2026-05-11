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
          label: String(item?.label || ['카테고리 적합형', '문제 자극형', '저장/정보형'][index] || '').trim(),
          title: String(item?.title || '').trim(),
          reason: String(item?.reason || '').trim(),
          strategy: String(item?.strategy || '').trim(),
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
            '이미지 안에 제목/카피가 보이면 그대로 따라 쓸 템플릿이 아니라, 왜 클릭되는지에 대한 전략 신호로 분석한다.',
            '숫자, 대상, 상황, "대신", "이렇게" 같은 표면 문형은 새 주제에 자연스럽게 맞을 때만 참고할 수 있다.',
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
            '핵심 작업: 레퍼런스 썸네일을 그대로 치환하지 말고, 이미지에서 보이는 클릭 전략/가독성/감정 트리거를 분석한 뒤 현재 계정 카테고리와 영상 주제에 맞는 새 제목을 만든다.',
            '우선순위: 1. 영상 주제와 계정 카테고리 적합성 2. 타깃의 실제 고민/욕구 3. 모바일 가독성 4. 레퍼런스의 시각적 제목 배치/클릭 전략 5. 원본과의 비표절성.',
            '이미지 속 텍스트가 제목처럼 보여도 제목 구조를 잠그지 않는다. 숫자, 대상, 상황, "대신", "이렇게" 같은 표면 문형은 새 주제에 자연스럽게 맞을 때만 쓴다.',
            '원본 제목의 단어를 주제만 바꿔 억지로 변환하지 않는다. 예: "알람 10개 대신"을 "단골 10명 대신"처럼 기계적으로 바꾸면 실패다.',
            '제목은 8~18자 권장, 한눈에 읽히게 짧게 쓴다.',
            'A/B/C는 같은 원본 문형을 반복하는 세 버전이 아니라, 같은 영상 주제를 서로 다른 클릭 전략으로 푼다. A=카테고리 적합형, B=궁금증/문제 자극형, C=저장/정보형.',
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
            `- 억지 치환하면 어색한 원본 표현: ${analysis.avoidRepeating.join(', ') || '-'}`,
            `- 참고할 레퍼런스 클릭 전략: ${analysis.titleDirections.join(', ') || '-'}`,
            `- 주의점: ${analysis.risks.join(', ') || '-'}`,
            '',
            '[생성 규칙]',
            '- 먼저 영상 주제와 계정 카테고리에서 타깃의 구체적인 문제/욕구/행동을 뽑는다.',
            '- 그 다음 레퍼런스의 시각적 강점(짧음, 상단 배치, 대비, 질문, 권유, 정보성 등) 중 새 주제에 어울리는 것만 선택한다.',
            '- 원본 제목의 숫자, 대상, 대비 구문을 억지로 살리지 않는다. 새 주제에 없는 숫자나 비교 대상을 만들지 않는다.',
            '- 이미지 분석 결과는 디자인/가독성 참고용이며, 제목 카피는 현재 계정 카테고리와 영상 주제를 우선한다.',
            '- A/B/C 세 제목은 서로 표현이 확실히 달라야 한다.',
            '',
            '다음 JSON 형식으로만 답하세요.',
            '{',
            '  "recommendations": [',
            '    {"type":"A","label":"카테고리 적합형","title":"","reason":"","strategy":""},',
            '    {"type":"B","label":"문제 자극형","title":"","reason":"","strategy":""},',
            '    {"type":"C","label":"저장/정보형","title":"","reason":"","strategy":""}',
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
