import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildEditPlanSummary,
  normalizeCopilotQualityEvent,
} from '../src/lib/analytics-logger.js'
import {
  estimateAIUsageCostUsd,
  getModelPricePer1M,
  logAIUsage,
} from '../src/lib/ai-usage-logger.js'

test('AI usage cost estimator stores null for unknown models', () => {
  assert.equal(getModelPricePer1M('unknown-model'), null)
  assert.equal(
    estimateAIUsageCostUsd({
      model: 'unknown-model',
      promptTokens: 1000,
      completionTokens: 1000,
    }),
    null,
  )
})

test('AI usage cost estimator calculates known model estimates', () => {
  assert.equal(
    estimateAIUsageCostUsd({
      model: 'gpt-4o-mini',
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    }),
    0.75,
  )
})

test('logAIUsage returns estimated cost without requiring Supabase config', () => {
  const previousUrl = process.env.SUPABASE_URL
  const previousServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  process.env.SUPABASE_URL = ''
  process.env.SUPABASE_SERVICE_ROLE_KEY = ''

  const result = logAIUsage('unit-test', {
    model: 'gpt-4o-mini',
    usage: {
      prompt_tokens: 1000,
      completion_tokens: 500,
      total_tokens: 1500,
    },
  })

  assert.equal(result.promptTokens, 1000)
  assert.equal(result.completionTokens, 500)
  assert.equal(result.totalTokens, 1500)
  assert.equal(result.estimatedCostUsd, 0.00045)

  if (previousUrl === undefined) delete process.env.SUPABASE_URL
  else process.env.SUPABASE_URL = previousUrl
  if (previousServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
  else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceKey
})

test('copilot quality event payload is normalized for DB logging', () => {
  const payload = normalizeCopilotQualityEvent({
    eventType: 'suggestion_created',
    accountId: 'account-1',
    userId: 'user-1',
    referenceId: 'reference-1',
    changedSections: ['hook', 'body', 'hook', 'invalid'],
    editPlan: {
      operationType: 'topic_reframe',
      qaMode: 'reframe_topic',
      targetSections: ['hook', 'body', 'cta'],
      preserveSections: [],
      newSubject: '치킨너겟',
      requestedMaterials: ['에어프라이어'],
      mustKeep: Array.from({ length: 20 }, (_, index) => `keep-${index}`),
    },
  })

  assert.equal(payload.event_type, 'suggestion_created')
  assert.deepEqual(payload.changed_sections, ['hook', 'body'])
  assert.equal(payload.edit_plan_summary.operationType, 'topic_reframe')
  assert.equal(payload.edit_plan_summary.mustKeep.length, 12)
})

test('edit plan summary keeps only analytics-safe fields', () => {
  const summary = buildEditPlanSummary({
    operationType: 'duration_compress',
    qaMode: 'duration_compress',
    targetDurationSeconds: 30,
    targetCharRange: { min: 150, max: 195 },
    rawUserRequest: 'should not be stored here',
  })

  assert.deepEqual(summary, {
    operationType: 'duration_compress',
    qaMode: 'duration_compress',
    strategy: null,
    editTarget: null,
    targetSections: [],
    preserveSections: [],
    newSubject: null,
    requestedMaterials: [],
    targetDurationSeconds: 30,
    targetCharRange: { min: 150, max: 195 },
    mustKeep: [],
    mustChange: [],
    mustAvoid: [],
  })
})
