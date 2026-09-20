import assert from 'node:assert/strict'
import test from 'node:test'
import { getOpenAIModels } from '../src/lib/openai.js'

test('script generation defaults to GPT-5.6 Terra while allowing an explicit override', () => {
  const previousVariation = process.env.OPENAI_VARIATION_MODEL
  const previousCopilot = process.env.OPENAI_COPILOT_MODEL
  try {
    delete process.env.OPENAI_VARIATION_MODEL
    delete process.env.OPENAI_COPILOT_MODEL
    assert.equal(getOpenAIModels().variationModel, 'gpt-5.6-terra')
    assert.equal(getOpenAIModels().copilotModel, 'gpt-5.2')

    process.env.OPENAI_VARIATION_MODEL = 'fixed-model'
    assert.equal(getOpenAIModels().variationModel, 'fixed-model')
  } finally {
    if (previousVariation === undefined) delete process.env.OPENAI_VARIATION_MODEL
    else process.env.OPENAI_VARIATION_MODEL = previousVariation
    if (previousCopilot === undefined) delete process.env.OPENAI_COPILOT_MODEL
    else process.env.OPENAI_COPILOT_MODEL = previousCopilot
  }
})
