import { AppError } from './errors.js'
import { logAIError } from './ai-error-logger.js'
import { getOpenAIClient, getOpenAIModels, hasOpenAIConfig } from './openai.js'

function toVectorLiteral(embedding = []) {
  return `[${embedding.join(',')}]`
}

export async function createEmbeddings(input, context = {}) {
  if (!hasOpenAIConfig()) {
    throw new AppError('OpenAI API key is not configured', {
      code: 'OPENAI_NOT_CONFIGURED',
      statusCode: 500,
    })
  }

  const openai = getOpenAIClient()
  const { embeddingModel } = getOpenAIModels()

  try {
    const response = await openai.embeddings.create({
      model: embeddingModel,
      input,
    })

    return response.data.map((item) => ({
      index: item.index,
      embedding: item.embedding,
      vector: toVectorLiteral(item.embedding),
    }))
  } catch (error) {
    logAIError('embedding', error, {
      inputPreview: Array.isArray(input) ? input.join('\n').slice(0, 500) : input,
      model: embeddingModel,
      ...context,
    })

    throw new AppError('Embedding generation failed', {
      code: 'EMBEDDING_GENERATION_FAILED',
      statusCode: 502,
      cause: error,
    })
  }
}
