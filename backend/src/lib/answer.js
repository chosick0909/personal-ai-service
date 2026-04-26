import { AppError } from './errors.js'
import { logAIError } from './ai-error-logger.js'
import { getOpenAIClient, getOpenAIModels, hasOpenAIConfig } from './openai.js'
import { searchChunks } from './document-query.js'

function buildContextBlock(results) {
  return results
    .map(
      (result, index) =>
        `[#${index + 1}] 문서 ${result.document_id} / chunk ${result.chunk_index}\n${result.content}`,
    )
    .join('\n\n')
}

function buildCharacterBoundary(accountId) {
  return [
    `현재 선택된 캐릭터 계정 ID: ${accountId}`,
    '이 답변은 현재 캐릭터 계정 전용이다.',
    '다른 캐릭터/다른 계정의 업종, 상품, 타겟, 말투, 메모리를 섞지 않는다.',
    '캐릭터 고정 규칙과 개인화 메모리가 충돌하면 캐릭터 고정 규칙과 현재 계정 설정을 우선한다.',
  ].join('\n')
}

export async function answerQuestion({
  query,
  accountId,
  matchCount = 5,
  characterSystemPrompt = '',
  personalizationContext = '',
}) {
  const normalizedQuery = query?.trim()

  if (!normalizedQuery) {
    throw new AppError('query is required', {
      code: 'INVALID_QUESTION_QUERY',
      statusCode: 400,
    })
  }

  const contextResults = await searchChunks({
    query: normalizedQuery,
    accountId,
    matchCount,
  })

  if (!hasOpenAIConfig()) {
    throw new AppError('OpenAI API key is not configured', {
      code: 'OPENAI_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  const openai = getOpenAIClient()
  const { chatModel } = getOpenAIModels()
  const contextText = buildContextBlock(contextResults)

  try {
    const response = await openai.chat.completions.create({
      model: chatModel,
      temperature: 0.5,
      messages: [
        {
          role: 'system',
          content: [
            '당신은 문서 검색 기반 한국어 어시스턴트다. 답변은 반드시 제공된 context를 바탕으로 해야 한다. 다만 말투는 자연스럽고 실무적으로 풀어 설명한다. 사용자가 이해하기 쉽도록 핵심 설명 뒤에 필요한 경우 짧은 예시를 1~3개 만든다. context에 없는 사실을 단정하지 말고, 부족하면 context 기준으로는 확인되지 않는다고 분명히 말한다. 답변은 한국어로 작성한다.',
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
          content: `질문:\n${normalizedQuery}\n\n답변 방식:\n- 먼저 핵심을 자연스럽게 설명\n- 필요하면 바로 적용 가능한 예시 추가\n- 문장이 너무 딱딱하지 않게 작성\n\ncontext:\n${contextText || '관련 문서 없음'}`,
        },
      ],
    })

    return {
      answer:
        response.choices[0]?.message?.content?.trim() ||
        '답변을 생성하지 못했습니다.',
      contextResults,
      model: chatModel,
    }
  } catch (error) {
    logAIError('gpt', error, {
      query: normalizedQuery,
      matchCount,
      model: chatModel,
      contextPreview: contextText.slice(0, 500),
    })

    throw new AppError('GPT answer generation failed', {
      code: 'GPT_ANSWER_FAILED',
      statusCode: 502,
      cause: error,
    })
  }
}
