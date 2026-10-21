import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (typeof mock.module !== 'function') {
  test('actual reference preview contract in an isolated process', () => {
    const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--test', fileURLToPath(import.meta.url)], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stdout + result.stderr)
  })
} else {
  const path = name => new URL('../src/lib/' + name, import.meta.url).href
  let failPreview = false, seq = 0, storedRow = {}
  const noop = async () => ({})
  const db = { rpc: noop, from() {
    let payload = null
    const q = {
      insert(value) { payload = value; storedRow = { ...value }; return q }, update(value) { payload = value; storedRow = { ...storedRow, ...value }; return q },
      select() { return q }, eq() { return q }, in() { return q }, gte() { return q },
      order() { return q }, limit() { return q },
      async maybeSingle() { return { data: { id: 'preview-ref', processing_status: 'processing', ...payload }, error: null } },
      async single() { return failPreview && payload?.current_stage === 'draft-generation'
        ? { data: null, error: { message: 'synthetic preview persistence failure' } }
        : { data: { id: 'preview-ref', ...storedRow, ...payload }, error: null } },
      then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve) },
    }
    return q
  } }
  mock.module(path('supabase.js'), { namedExports: { hasSupabaseAdminConfig: () => true, getSupabaseAdmin: () => db } })
  mock.module(path('openai.js'), { namedExports: {
    hasOpenAIConfig: () => true, getOpenAIModels: () => ({ chatModel: 'stub', variationModel: 'stub' }),
    getOpenAIClient: () => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content: '{}' } }] }) } } }),
  } })
  mock.module(path('cache.js'), { namedExports: { cacheConfig: { enableAnalysisResultReuse: false }, buildCacheKey: (...args) => args.join(':'), hashText: value => String(value), getCacheJson: async () => null, setCacheJson: noop } })
  for (const [name, namedExports] of [
    ['ai-error-logger.js', { logAIError() {} }], ['ai-usage-logger.js', { logAIUsage() {}, sumAIUsage: () => ({}) }],
    ['document-ingest.js', { ingestDocument: noop }], ['embeddings.js', { createEmbeddings: async () => [] }],
    ['global-knowledge.js', { retrieveGlobalKnowledgeContext: async () => ({ contextText: '', items: [] }) }],
    ['hook-templates.js', { retrieveHookTemplates: async () => ({ templates: [] }), formatHookTemplatesForPrompt: () => '' }],
    ['account-profile.js', { getAccountProfile: noop }],
  ]) mock.module(path(name), { namedExports })
  const { analyzeReferenceVideo } = await import('../src/lib/reference-video-analysis.js')
  const scriptText = '직접 붙여넣은 한국어 대본입니다. 쓰는 곳 가까이에 물건을 모아두세요.'
  const stop = new Error('stop after observing actual preview')

  test('actual text pipeline publishes the reference row, not the database result envelope', async () => {
    failPreview = false
    let preview
    await assert.rejects(analyzeReferenceVideo({ accountId: 'synthetic-' + ++seq, scriptText,
      onAnalysisPreviewReady(value) { preview = structuredClone(value); throw stop } }), error => error === stop || error.cause === stop)
    assert.equal(preview.id, 'preview-ref')
    assert.equal(preview.source_mode, 'script_text')
    assert.equal(preview.transcript, scriptText)
    assert.equal(preview.processing_status, 'processing')
    assert.deepEqual(preview.variations, [])
    assert.equal(preview.transcript_quality.reliable, true)
    assert.equal(Object.hasOwn(preview, 'data'), false)
  })

  test('reference preview retains attachment facts and separates changed-material fingerprints', async () => {
    failPreview = false
    const previews = []
    for (const content of ['행사는 11월 3일입니다.', '행사는 11월 4일입니다.']) {
      await assert.rejects(analyzeReferenceVideo({ accountId: 'synthetic-' + ++seq, scriptText,
        supportingMaterials: [{ name: '행사.txt', content }],
        onAnalysisPreviewReady(value) { previews.push(structuredClone(value)); throw stop } }), error => error === stop || error.cause === stop)
    }
    assert.equal(previews[0].topic_brief.supportingMaterials[0].content, '행사는 11월 3일입니다.')
    assert.equal(previews[1].topic_brief.supportingMaterials[0].content, '행사는 11월 4일입니다.')
    assert.notEqual(previews[0].analysis_fingerprint, previews[1].analysis_fingerprint)
  })

  test('failed preview persistence cannot publish a successful empty analysis', async () => {
    failPreview = true
    let published = false
    await assert.rejects(analyzeReferenceVideo({ accountId: 'synthetic-' + ++seq, scriptText,
      onAnalysisPreviewReady() { published = true; throw stop } }), error => error.code === 'REFERENCE_PREVIEW_SAVE_FAILED')
    assert.equal(published, false)
  })
}
