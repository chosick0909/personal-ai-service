import { readFileSync } from 'node:fs'
import OpenAI from 'openai'
import { Agent, setGlobalDispatcher } from 'undici'

function getOpenAIConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  const chatModel = process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-4.1'
  const variationModel =
    process.env.OPENAI_VARIATION_MODEL?.trim() || 'gpt-5.2'
  const copilotModel =
    process.env.OPENAI_COPILOT_MODEL?.trim() || variationModel
  const thumbnailModel =
    process.env.OPENAI_THUMBNAIL_MODEL?.trim() || 'gpt-5-mini'
  const embeddingModel =
    process.env.OPENAI_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small'
  const transcribeModel =
    process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || 'gpt-4o-mini-transcribe'
  const visionModel = process.env.OPENAI_VISION_MODEL?.trim() || 'gpt-4o'
  const caCertPath =
    process.env.OPENAI_CA_CERT_PATH?.trim() ||
    process.env.NODE_EXTRA_CA_CERTS?.trim() ||
    ''
  const insecureTls = process.env.OPENAI_TLS_INSECURE === 'true'

  return {
    apiKey,
    chatModel,
    variationModel,
    copilotModel,
    thumbnailModel,
    embeddingModel,
    transcribeModel,
    visionModel,
    caCertPath,
    insecureTls,
    hasConfig: Boolean(apiKey),
  }
}

let cachedDispatcher
let hasConfiguredGlobalDispatcher = false

function getOpenAIDispatcher({ caCertPath, insecureTls }) {
  if (cachedDispatcher) {
    return cachedDispatcher
  }

  if (insecureTls) {
    cachedDispatcher = new Agent({
      connect: {
        rejectUnauthorized: false,
      },
    })

    return cachedDispatcher
  }

  if (caCertPath) {
    cachedDispatcher = new Agent({
      connect: {
        ca: readFileSync(caCertPath, 'utf8'),
      },
    })

    return cachedDispatcher
  }

  return undefined
}

function configureOpenAINetwork(config) {
  if (hasConfiguredGlobalDispatcher) {
    return
  }

  const dispatcher = getOpenAIDispatcher(config)

  if (!dispatcher) {
    return
  }

  setGlobalDispatcher(dispatcher)
  hasConfiguredGlobalDispatcher = true
}

export function hasOpenAIConfig() {
  return getOpenAIConfig().hasConfig
}

export function getOpenAIModels() {
  const {
    chatModel,
    variationModel,
    copilotModel,
    thumbnailModel,
    embeddingModel,
    transcribeModel,
    visionModel,
  } = getOpenAIConfig()

  return {
    chatModel,
    variationModel,
    copilotModel,
    thumbnailModel,
    embeddingModel,
    transcribeModel,
    visionModel,
  }
}

export function getOpenAIClient() {
  const config = getOpenAIConfig()
  const { apiKey, hasConfig } = config

  if (!hasConfig) {
    return null
  }

  configureOpenAINetwork(config)

  return new OpenAI({
    apiKey,
  })
}
