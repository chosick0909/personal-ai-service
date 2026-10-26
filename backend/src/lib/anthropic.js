import Anthropic from '@anthropic-ai/sdk'

// Claude for the writing stages of Creator Studio 2 (훅ai), switched on with CREATOR_STUDIO_MODEL.
let client = null
export const hasAnthropicConfig = (env = process.env) => Boolean(env.ANTHROPIC_API_KEY?.trim())
export function getAnthropicClient() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY.trim(), maxRetries: 0 })
  return client
}
