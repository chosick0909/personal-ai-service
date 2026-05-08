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
            '이미지 안에 제목/카피가 보이면 단어를 피해야 할 표현으로만 보지 말고, 문장 구조/길이/강조 방식/후킹 결을 추출한다.',
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
                '  "avoidRepeating": ["그대로 복붙하면 어색한 원본 고유 표현"],',
                '  "titleDirections": ["레퍼런스 제목의 문장 구조/후킹 방식/말맛"],',
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
  const { thumbnailModel } = getOpenAIModels()
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
    const response = await openai.chat.completions.create({
      model: thumbnailModel,
      temperature: 0.55,
      messages: [
        {
          role: 'system',
          content: [
            '당신은 인스타 릴스 썸네일 제목 카피라이터다. 출력은 JSON만 반환한다.',
            '핵심 작업: 썸네일 레퍼런스의 제목 결/문장 구조/후킹 방식을 유지하고, 내용 주제만 새 영상 주제로 갈아끼운다.',
            '우선순위: 1. 레퍼런스 제목의 구조와 말맛 2. 영상 주제 치환 3. 현재 계정 세팅 4. 모바일 가독성 5. 클릭/저장 전략.',
            '이미지 속 텍스트가 제목처럼 보이면 가장 중요한 레퍼런스로 쓴다. 단, 원본 고유 명사/대상/상황은 새 주제에 맞게 바꾼다.',
            '이미지 속 텍스트를 무조건 금지어처럼 피하지 말고, 반복하면 표절/어색함이 생기는 고유 표현만 피한다.',
            '제목은 8~18자 권장, 한눈에 읽히게 짧게 쓴다.',
            'A/B/C는 같은 레퍼런스 결 안에서 강도만 달라야 한다. A=가장 원본 결에 가까운 안정형, B=궁금증을 살린 오픈루프형, C=저장/정보형.',
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
            `- 그대로 복붙하지 않을 원본 고유 표현: ${analysis.avoidRepeating.join(', ') || '-'}`,
            `- 레퍼런스 제목 결/문장 구조: ${analysis.titleDirections.join(', ') || '-'}`,
            `- 주의점: ${analysis.risks.join(', ') || '-'}`,
            '',
            '[생성 규칙]',
            '- 썸네일 안 제목이 "A가 B한 이유" 형태면 새 제목도 그 구조를 유지한다.',
            '- 썸네일 안 제목이 짧은 단정형이면 새 제목도 짧은 단정형으로 만든다.',
            '- 썸네일 안 제목의 감정 강도, 말투, 문장 길이를 최대한 비슷하게 맞춘다.',
            '- 새 영상 주제의 핵심 명사/문제/상황은 반드시 제목에 들어가야 한다.',
            '- 원본 텍스트를 그대로 복사하지 말고, 구조만 가져와 주제를 치환한다.',
            '',
            '다음 JSON 형식으로만 답하세요.',
            '{',
            '  "recommendations": [',
            '    {"type":"A","label":"안정형","title":"","reason":"","strategy":""},',
            '    {"type":"B","label":"오픈루프형","title":"","reason":"","strategy":""},',
            '    {"type":"C","label":"저장/정보형","title":"","reason":"","strategy":""}',
            '  ],',
            '  "appliedInputs": {"topic":"","accountCategory":"","accountTone":"","imageAnalysisUsed":true},',
            '  "safetyCheck": {"topicPreserved":true,"accountTonePreserved":true,"imageTextRepeated":false,"bannedClaimsRemoved":true}',
            '}',
          ].join('\n'),
        },
      ],
    })

    logAIUsage('thumbnail-title-generation', response, {
      model: thumbnailModel,
      topic: normalizedTopic,
      category,
    })

    const parsed = parseModelJson(response.choices[0]?.message?.content || '')
    const recommendations = Array.isArray(parsed.recommendations)
      ? parsed.recommendations.slice(0, 3).map((item, index) => ({
          type: String(item?.type || ['A', 'B', 'C'][index] || '').trim(),
          label: String(item?.label || ['안정형', '오픈루프형', '저장/정보형'][index] || '').trim(),
          title: String(item?.title || '').trim(),
          reason: String(item?.reason || '').trim(),
          strategy: String(item?.strategy || '').trim(),
        }))
      : []

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
      topic: normalizedTopic,
      category,
    })

    throw new AppError('Thumbnail title generation failed', {
      code: 'THUMBNAIL_TITLE_GENERATION_FAILED',
      statusCode: 502,
      details: {
        stage: 'thumbnail-title-generation',
        model: thumbnailModel,
      },
      cause: error,
    })
  }
}
