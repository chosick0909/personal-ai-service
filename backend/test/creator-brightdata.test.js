import test from 'node:test'
import assert from 'node:assert/strict'
import { collectInstagram } from '../src/creator-tools/brightdata.js'

test('Bright Data retries reuse the receipt after a progress failure', async () => {
  const saved = {}, calls = []
  let interrupted = true
  const request = async (operation, path, options) => {
    calls.push(operation)
    if (operation === 'trigger') {
      assert.deepEqual(JSON.parse(options.body), [{ url: 'https://www.instagram.com/reel/abc/' }])
      return { snapshot_id: 'sd_test' }
    }
    if (interrupted) { interrupted = false; throw new Error('network') }
    if (operation === 'progress') return { status: 'ready' }
    assert.equal(path, '/snapshot/sd_test?format=json')
    return [{ video_url: 'https://example.com/video.mp4' }]
  }
  const checkpoint = async (key, run) => saved[key] ?? (saved[key] = await run())
  const input = { url: 'https://www.instagram.com/reel/abc/', request, checkpoint, pause: async () => {} }
  await assert.rejects(collectInstagram(input), /network/)
  assert.equal((await collectInstagram(input)).length, 1)
  assert.equal(calls.filter((op) => op === 'trigger').length, 1)
})

test('Bright Data collection has a bounded pending state and rejects terminal failures', async () => {
  const checkpoint = async () => ({ snapshotId: 'sd_test' })
  let polls = 0
  await assert.rejects(collectInstagram({ checkpoint, pause: async () => {}, request: async () => { polls += 1; return { status: 'running' } } }), { code: 'PROVIDER_PENDING' })
  assert.equal(polls, 30)
  await assert.rejects(collectInstagram({ checkpoint, request: async () => ({ status: 'failed' }) }), { code: 'LINK_COLLECTION_FAILED' })
})
