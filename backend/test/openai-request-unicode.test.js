import test from 'node:test'
import assert from 'node:assert/strict'
import OpenAI from 'openai'
import { createOpenAITransport, normalizeJSONUnicode, truncateUnicode } from '../src/lib/openai-transport.js'
import { __referenceVideoAnalysisTest as reference } from '../src/lib/reference-video-analysis.js'

test('reference context truncation does not cut the production U+1F449 boundary', () => {
  const source = '가'.repeat(513) + '😀😀😀' + '👉' + '추가 참고자료'
  assert.equal(source.indexOf('👉'), 519)
  const previous = source.slice(0, 520) + '...'
  assert.equal(previous.isWellFormed(), false)
  assert.equal(JSON.parse(JSON.stringify(previous)).isWellFormed(), false)
  const fixed = reference.clampText(source, 520)
  assert.equal(fixed.isWellFormed(), true)
  assert.equal(fixed, source.slice(0, 519) + '...')
  assert.equal(truncateUnicode('한글😀끝', 4), '한글😀')
  assert.equal(truncateUnicode('한글😀끝', 3), '한글')
  assert.equal(reference.clampText('짧은 👉 문장', 520), '짧은 👉 문장')
})

test('normal JSON is byte-identical; broken nested strings alone are repaired', () => {
  const normal = '{ "messages": [{"content":"한글\\n😀 \\"인용\\""}], "temperature":0.6 }'
  assert.deepEqual(normalizeJSONUnicode(normal), { body: normal, repairedStrings: 0 })
  const result = normalizeJSONUnicode(JSON.stringify({
    messages: [{ content: '앞\ud83d뒤\udc49' }], nested: [null, true, 3], valid: '👉',
  }))
  assert.equal(result.repairedStrings, 1)
  assert.deepEqual(JSON.parse(result.body), {
    messages: [{ content: '앞�뒤�' }], nested: [null, true, 3], valid: '👉',
  })
})

test('real SDK request passes strict Unicode decoding; original fails before generation', async () => {
  const events = []
  const received = []
  const strictProvider = async (_url, init) => {
    const body = JSON.parse(init.body)
    received.push(body)
    if (!body.messages.every(message => message.content.isWellFormed())) {
      return new Response(JSON.stringify({ error: { code: 'invalid_json', message: 'Invalid body' } }), {
        status: 400, headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ id: 'synthetic', choices: [{ message: { content: 'ok' } }] }), {
      headers: { 'content-type': 'application/json' },
    })
  }
  const request = { model: 'test-model', messages: [{ role: 'user', content: '가'.repeat(519) + '\ud83d' }], temperature: 0.6 }
  const before = new OpenAI({ apiKey: 'synthetic-not-a-key', fetch: strictProvider, maxRetries: 0 })
  await assert.rejects(before.chat.completions.create(request), error => error.code === 'invalid_json')
  const after = new OpenAI({ apiKey: 'synthetic-not-a-key', fetch: createOpenAITransport(strictProvider, e => events.push(e)), maxRetries: 0 })
  assert.equal((await after.chat.completions.create(request)).choices[0].message.content, 'ok')
  assert.equal(received.length, 2)
  assert.equal(received[1].temperature, 0.6)
  assert.equal(received[1].model, 'test-model')
  assert.deepEqual(events, [{ event: 'unicode_repaired', repairedStrings: 1 }])
})

test('multipart passes through; valid-body errors are not hidden or retried', async () => {
  const multipart = new FormData()
  multipart.set('file', new Blob(['audio fixture']), 'test.wav')
  let calls = 0
  const events = []
  const response = new Response(JSON.stringify({ error: { code: 'invalid_json', message: 'do not log this' } }), {
    status: 400, headers: { 'content-type': 'application/json', 'x-request-id': 'synthetic-request' },
  })
  const transport = createOpenAITransport(async (_url, init) => {
    calls++
    if (calls === 1) assert.equal(init.body, multipart)
    return response
  }, e => events.push(e))
  assert.equal(await transport('https://example.invalid/audio', { body: multipart }), response)
  const json = JSON.stringify({ messages: [{ content: 'private fixture' }] })
  assert.equal(await transport('https://example.invalid/chat', { body: json, headers: { 'content-type': 'application/json' } }), response)
  assert.equal(calls, 2)
  assert.equal(await response.text(), JSON.stringify({ error: { code: 'invalid_json', message: 'do not log this' } }))
  assert.equal(events[0].jsonParseValid, true)
  assert.equal(events[0].repairedStrings, 0)
  assert.equal(JSON.stringify(events).includes('private fixture'), false)
  assert.equal(JSON.stringify(events).includes('do not log this'), false)
})

test('streaming response is returned unread and the cancellation signal is preserved', async () => {
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"text":"합성"}\n\ndata: [DONE]\n\n'))
      controller.close()
    },
  }), { headers: { 'content-type': 'text/event-stream' } })
  const signal = new AbortController().signal
  const init = { body: '{"stream":true}', headers: { 'content-type': 'application/json' }, signal }
  const transport = createOpenAITransport(async (_url, actual) => {
    assert.equal(actual, init)
    assert.equal(actual.signal, signal)
    return response
  })
  const result = await transport('https://example.invalid/chat', init)
  assert.equal(result, response)
  assert.equal(result.bodyUsed, false)
  assert.match(await result.text(), /\[DONE\]/)
})

test('stage wrapper retains provider failure code and gives an accurate generation message', async () => {
  const error = Object.assign(new Error('Invalid body'), { code: 'invalid_json' })
  await assert.rejects(reference.runStage('variation-C안', {}, async () => { throw error }), e =>
    e.code === 'invalid_json' && e.details.stage === 'variation-C안' && e.cause === error)
  assert.match(reference.referenceFailureMessage('variation-C안'), /대본 생성 단계/)
  assert.doesNotMatch(reference.referenceFailureMessage('variation-C안'), /업로드/)
})

test('failure lifecycle persists the safe UI error and clears it when retry begins', async () => {
  const writes = []
  const supabaseAdmin = {
    from(table) {
      assert.equal(table, 'reference_videos')
      return { update(payload) {
        writes.push(structuredClone(payload))
        return { eq(column, value) {
          assert.equal(column, 'id')
          assert.equal(value, 'synthetic-reference')
          return { eq(column, value) {
            assert.equal(column, 'account_id')
            assert.equal(value, 'synthetic-account')
            return Promise.resolve({ error: null })
          } }
        } }
      } }
    },
  }
  const context = { supabaseAdmin, referenceId: 'synthetic-reference', accountId: 'synthetic-account' }
  await reference.updateReferenceLifecycleState({ ...context, patch: {
    processing_status: 'failed', failure_code: 'invalid_json', failure_stage: 'variation-C안',
    failure_message: 'provider diagnostic', error_message: reference.referenceFailureMessage('variation-C안'),
  } })
  await reference.updateReferenceLifecycleState({ ...context, patch: {
    processing_status: 'processing', failure_code: null, failure_message: null,
  } })
  assert.equal(writes[0].failure_code, 'invalid_json')
  assert.match(writes[0].error_message, /대본 생성 단계/)
  assert.equal(writes[1].error_message, null)
})
