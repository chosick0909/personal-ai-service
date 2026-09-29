import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
const calls = []
let responses = []
const client = { chat: { completions: { create: async (request) => {
  calls.push(request)
  assert.ok(responses.length, 'unexpected model call')
  const result = responses.shift()
  if (result instanceof Error) throw result
  return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] }
} } } }
const db = { from(table) {
  assert.equal(table, 'reference_videos')
  return { select() { return this }, eq() { return this }, async single() {
    return { data: { id: 'ref', structure_analysis: '도입 → 설명 → 행동', variations: [] }, error: null }
  } }
} }
mock.module('../../src/lib/openai.js', { namedExports: {
  getOpenAIClient: () => client, hasOpenAIConfig: () => true,
  getOpenAIModels: () => ({ chatModel: 'mock', copilotModel: 'mock' }),
} })
mock.module('../../src/lib/supabase.js', { namedExports: { getSupabaseAdmin: () => db, hasSupabaseAdminConfig: () => true } })
mock.module('../../src/lib/ai-usage-logger.js', { namedExports: { logAIUsage() {} } })
mock.module('../../src/lib/ai-error-logger.js', { namedExports: { logAIError() {} } })
mock.module('../../src/lib/hook-templates.js', { namedExports: { formatHookTemplatesForPrompt: () => '', retrieveHookTemplates: async () => ({ templates: [] }) } })
mock.module('../../src/lib/narrative-patterns.js', { namedExports: { formatNarrativePatternsForPrompt: () => '', retrieveNarrativePatterns: async () => ({ patterns: [] }) } })
const { classifyCopilotIntent, refineScriptWithAI, buildEditPlan } = await import('../../src/lib/script-assistant.js')
const { buildCopilotConversationContext } = await import('../../../frontend/src/lib/copilotConversation.js')
const { scopeCopilotConversation, conversationModelMessages } = await import('../../src/lib/copilot/conversation-context.js')
const scope = { accountId: 'account', referenceId: 'ref', currentDraftId: 'draft', currentVariantId: 'A' }
const draft = { hook: '현재 도입', body: '현재 본문', cta: '현재 마무리' }
function context(messages, version = 'v1') {
  return scopeCopilotConversation(buildCopilotConversationContext({
    chatMessages: messages, accountId: 'account', referenceId: 'ref', activeDraftId: 'draft', currentVersionId: version,
    selectedVariant: { selectedVariantId: 'A', selectedScriptId: 'script-a' },
  }), scope)
}
function assertHistory(request, history) {
  const actual = request.messages.slice(1, -1)
  assert.deepEqual(actual, conversationModelMessages(history))
}

test('user correction sees both sides of dialogue in classification and answer, no regex promise', async () => {
  calls.length = 0
  const history = context([
    { id: 'u1', role: 'user', content: '구매를 유도하는 마무리를 제안해줘' },
    { id: 'a1', role: 'assistant', content: '먼저 써보기 옵션이 열려 있을 때 담아두세요.' },
  ])
  responses = [
    { intent: 'advise_script', shouldModifyScript: false, resolvedRequest: '사용자가 부정한 체험 전제를 철회하고 구매 마무리 대안을 설명한다.' },
    { message: '그 전제는 빼겠습니다. 제품 정보를 확인하는 방향과 구매 시점을 생각해보는 방향이 있습니다.' },
  ]
  const intent = await classifyCopilotIntent({ message: '먼저 써보기 옵션은 없어.', sections: draft, conversationContext: history })
  assert.equal(calls.length, 1, 'keyword fallback must not bypass contextual classification')
  assert.equal(intent.intent, 'advise_script')
  const result = await refineScriptWithAI({ accountId: 'account', referenceId: 'ref', request: intent.resolvedRequest, sections: draft, resolvedIntent: intent, conversationContext: history })
  assertHistory(calls[0], history)
  assertHistory(calls[1], history)
  assert.deepEqual(result.sections, draft)
  assert.deepEqual(result.changedSections, [])
  assert.match(result.message, /제품 정보/)
})

test('a contextual choice drives CTA edit even when bare request has no edit keyword', async () => {
  calls.length = 0
  const history = context([
    { id: 'u1', role: 'user', content: '본문은 유지하고 마무리 두 가지를 비교해줘' },
    { id: 'a1', role: 'assistant', content: '1. 상담 질문 유도\n2. 필요할 때 찾아볼 수 있게 저장 유도' },
  ])
  responses = [
    { intent: 'edit_request', shouldModifyScript: true, editTarget: 'cta', operationType: 'edit_partial', resolvedRequest: 'CTA만 두 번째 저장 유도로 바꿔줘. HOOK과 BODY는 유지해.' },
    { message: '마무리를 저장 유도로 제안했습니다.', cta: '필요할 때 다시 볼 수 있도록 저장해두세요.' },
  ]
  const intent = await classifyCopilotIntent({ message: '두 번째로 부탁해', sections: draft, conversationContext: history })
  const plan = buildEditPlan({ userRequest: intent.resolvedRequest, currentSections: draft, intentResult: intent, editTarget: intent.editTarget })
  const result = await refineScriptWithAI({ accountId: 'account', referenceId: 'ref', request: '두 번째로 부탁해', sections: draft,
    editTarget: 'cta', resolvedIntent: intent, editPlan: plan, conversationContext: history })
  assert.equal(calls.length, 2)
  assertHistory(calls[1], history)
  assert.equal(result.sections.hook, draft.hook)
  assert.equal(result.sections.body, draft.body)
  assert.match(result.sections.cta, /저장/)
  assert.deepEqual(result.changedSections, ['cta'])
})

test('same draft keeps old messages and exact unapplied proposal after version change', async () => {
  const oldProposal = { hook: '예전 도입', body: '예전 본문', cta: '예전 마무리' }
  const history = context([
    { id: 'a1', role: 'assistant', content: '이렇게 제안합니다.', sourceDraftId: 'draft', sourceVariantId: 'script-a', sourceVersionId: 'v1', proposedSections: oldProposal },
    { id: 'u2', role: 'user', content: '그 경험은 내 경험이 아니야', sourceDraftId: 'draft' },
  ], 'v2')
  assert.equal(history.recentTurns.length, 2)
  assert.deepEqual(history.recentTurns[0].proposedSections, oldProposal)
  assert.equal(history.recentTurns[0].suggestionApplied, false)
  calls.length = 0
  responses = [ { intent: 'edit_request', shouldModifyScript: true, editTarget: 'cta', operationType: 'edit_partial', resolvedRequest: 'CTA만 예전 마무리로 복원해줘. 나머지는 현재 에디터를 유지해.' },
    { message: '마무리만 예전 표현으로 제안합니다.', cta: oldProposal.cta } ]
  const intent = await classifyCopilotIntent({ message: '처음 제안한 마무리만 다시', sections: draft, conversationContext: history })
  const result = await refineScriptWithAI({ accountId: 'account', referenceId: 'ref', request: intent.resolvedRequest, sections: draft, resolvedIntent: intent, conversationContext: history })
  assertHistory(calls[0], history)
  assertHistory(calls[1], history)
  assert.equal(result.sections.cta, oldProposal.cta)
  assert.equal(result.sections.body, draft.body)
})

test('unrelated account/draft/variant context cannot enter prompts', () => {
  const history = context([{ id: 'u', role: 'user', content: 'private' }])
  for (const field of ['accountId', 'referenceId', 'currentDraftId', 'currentVariantId']) {
    assert.equal(scopeCopilotConversation(history, { ...scope, [field]: 'other' }), null)
  }
  const filtered = context([
    { id: 'x', role: 'user', content: 'OTHER', sourceAccountId: 'other' },
    { id: 'y', role: 'assistant', content: 'OTHER', sourceDraftId: 'other' },
    { id: 'z', role: 'assistant', content: 'OTHER', sourceVariantId: 'B' },
    { id: 'ok', role: 'user', content: 'current' },
  ])
  assert.deepEqual(filtered.recentTurns.map(t => t.id), ['ok'])
})

test('rolling summary survives history reopen and leaves twelve recent turns intact', async () => {
  const messages = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `발화 ${i}` }))
  const history = context(messages)
  responses = [{ intent: 'advise_script', shouldModifyScript: false, resolvedRequest: '현재 질문 답변', historySummary: '사용자는 개인 경험이 없다고 정정했다. AI가 제시한 경험은 철회됨.' }]
  const intent = await classifyCopilotIntent({ message: '앞서 정한 기준으로 봐줘', sections: draft, conversationContext: history })
  assert.equal(intent.conversationSummary.throughMessageId, 'm7')
  const stored = JSON.parse(JSON.stringify([...messages, { id: 'a21', role: 'assistant', content: '답변', conversationSummary: intent.conversationSummary }]))
  const next = context(stored, 'v2')
  assert.equal(next.summary.text, intent.conversationSummary.text)
  assert.equal(next.recentTurns[0].id, 'm8')
  assert.equal(next.recentTurns.length, 13)
})

test('model failure reports inability instead of fabricated product-specific advice', async () => {
  responses = [new Error('mock unavailable')]
  await assert.rejects(refineScriptWithAI({ accountId: 'account', referenceId: 'ref', request: '없는 기능이라고 정정', sections: draft,
    resolvedIntent: { intent: 'advise_script', shouldModifyScript: false }, conversationContext: context([]) }),
    { code: 'COPILOT_RESPONSE_FAILED' })
})

test('one structured decision retains per-section operations and locks through generation', async () => {
  calls.length = 0
  const history = context([{ id: 'a', role: 'assistant', content: '본문 설명을 짧게 하고 도입과 마무리는 그대로 두는 방향입니다.' }])
  responses = [{
    intent: 'edit_request', editTarget: 'body', operationType: 'partial_rewrite', shouldModifyScript: true,
    resolvedRequest: '본문만 간결하게 수정하고 도입과 마무리는 유지해.',
    semanticInstruction: {
      intent: 'edit_script', confidence: 0.95,
      topicChange: { requested: false, oldSubjects: [], newSubject: null, confidence: 0.95, evidence: null },
      operations: [{ type: 'partial_rewrite', target: 'body', goal: '본문 설명을 간결하게', styleTarget: null, evidence: '이전 제안 선택', confidence: 0.95 }],
      locks: [{ target: 'hook', lockType: 'keep_exact', evidence: '이전 대화의 도입 유지' }, { target: 'cta', lockType: 'keep_exact', evidence: '마무리 유지' }],
      metadata: { requestedMaterials: [], forbiddenSurfacePhrases: [], salesContext: null, toneHint: null, explicitKeep: [], explicitRemove: [], allowComparisonWithOldSubject: false, targetDurationSeconds: null },
      userFacingNeed: 'modify_script', clarificationQuestion: null,
    },
  }, { message: '본문 설명을 간결하게 제안했습니다.', body: '짧은 설명' }]
  const intent = await classifyCopilotIntent({ message: '그걸로 부탁해', sections: draft, conversationContext: history })
  assert.equal(calls[0].response_format.json_schema.strict, true)
  const plan = buildEditPlan({ userRequest: intent.resolvedRequest, currentSections: draft, intentResult: intent, editTarget: intent.editTarget })
  assert.deepEqual(plan.targetSections, ['body'])
  assert.ok(plan.preserveSections.includes('hook'))
  assert.ok(plan.preserveSections.includes('cta'))
  const result = await refineScriptWithAI({ accountId: 'account', referenceId: 'ref', request: '그걸로 부탁해', sections: draft, resolvedIntent: intent, editPlan: plan, conversationContext: history })
  assert.equal(calls.length, 2)
  assert.deepEqual(result.sections, { ...draft, body: '짧은 설명' })
})
