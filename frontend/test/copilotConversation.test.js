import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildCopilotConversationContext, sameCopilotEditorSnapshot } from '../src/lib/copilotConversation.js'
// Use the actual cache normalizer; resolve its extensionless Vite imports for Node.
const cacheUrl = new URL('../src/store/appStateCache.js', import.meta.url)
const cacheSource = (await readFile(cacheUrl, 'utf8')).replace(/from '([^']+)'/g,
  (_, path) => `from '${new URL(path + '.js', cacheUrl).href}'`)
const { normalizeHistoryCacheItem } = await import('data:text/javascript;base64,' + Buffer.from(cacheSource).toString('base64'))
const scope = { accountId: 'a', referenceId: 'r', activeDraftId: 'd', selectedVariant: { selectedVariantId: 'A', selectedScriptId: 'script-a' } }

test('cache round-trip preserves conversation summary, source and proposal snapshot', () => {
  const summary = { text: '사용자는 자신의 과거 경험이 아니라고 정정했다.', throughMessageId: 'u1', accountId: 'a', referenceId: 'r', activeDraftId: 'd', variantId: 'A' }
  const sourceSections = { hook: 'h', body: 'b', cta: 'c' }
  const item = normalizeHistoryCacheItem(JSON.parse(JSON.stringify({ id: 'r', chatMessages: [
    { id: 'u1', role: 'user', content: '정정', sourceDraftId: 'd' },
    { id: 'a1', role: 'assistant', content: '답변', conversationSummary: summary, sourceAccountId: 'a', sourceReferenceId: 'r', sourceDraftId: 'd', sourceVariantId: 'script-a', sourceVersionId: 'v1', sourceSections },
  ] })))
  const result = buildCopilotConversationContext({ ...scope, chatMessages: item.chatMessages, currentVersionId: 'v2' })
  assert.equal(result.summary.text, summary.text)
  assert.deepEqual(result.recentTurns.map(t => t.id), ['a1'])
  assert.deepEqual(item.chatMessages[1].sourceSections, sourceSections)
  assert.equal(item.chatMessages[1].sourceVersionId, 'v1')
})

test('manual editing and account/draft/variant/version changes invalidate pending result, not history', () => {
  const current = { accountId: 'a', referenceId: 'r', draftId: 'd', variantId: 'A', versionId: 'v1', sections: { hook: 'h', body: 'b', cta: 'c' } }
  assert.equal(sameCopilotEditorSnapshot(current, structuredClone(current)), true)
  for (const key of ['accountId', 'referenceId', 'draftId', 'variantId', 'versionId']) {
    assert.equal(sameCopilotEditorSnapshot(current, { ...current, [key]: 'changed' }), false)
  }
  assert.equal(sameCopilotEditorSnapshot(current, { ...current, sections: { ...current.sections, body: '수동 수정' } }), false)
})

test('different users and scripts cannot reuse a saved summary', () => {
  const messages = [{ id: 'u1', role: 'user', content: 'current' }, { id: 'a1', role: 'assistant', content: 'reply', conversationSummary: {
    text: '외부 내용', throughMessageId: 'u1', accountId: 'other', referenceId: 'r', activeDraftId: 'd', variantId: 'A',
  } }]
  const result = buildCopilotConversationContext({ ...scope, chatMessages: messages })
  assert.equal(result.summary, null)
  assert.equal(result.recentTurns.length, 2)
})
