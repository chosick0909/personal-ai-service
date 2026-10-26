import test from 'node:test'
import assert from 'node:assert/strict'
import { requestLookup, awaitLookup, lookupResult, lookupError, collectorOnline, markCollectorSeen, LOOKUP_PRIORITY } from '../src/creator-tools/instagram-lookup.js'

function fakeDb() {
  const rows = new Map()
  return { rows, from() {
    const filters = []; let action = 'select', payload, single = false
    const api = { select() { return api }, order() { return api }, limit() { return api },
      eq(k, v) { filters.push(r => r[k] === v); return api }, in(k, vs) { filters.push(r => vs.includes(r[k])); return api }, gte(k, v) { filters.push(r => r[k] >= v); return api },
      single() { single = true; return api }, insert(p) { action = 'insert'; payload = p; return api }, update(p) { action = 'update'; payload = p; return api },
      then(resolve) {
        if (action === 'insert') { const row = { id: `L${rows.size + 1}`, status: 'queued', created_at: new Date().toISOString(), ...payload }; rows.set(row.id, row); return resolve({ data: row, error: null }) }
        const found = [...rows.values()].filter(r => filters.every(f => f(r))).sort((a, b) => b.created_at.localeCompare(a.created_at))
        if (action === 'update') { found.forEach(r => Object.assign(r, payload)); return resolve({ data: null, error: null }) }
        resolve({ data: single ? found[0] : found, error: null })
      } }
    return api } }
}
const store = () => { const m = new Map(); return { get: async k => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); return 'OK' } } }

test('one queued lookup per reel, raised to the most urgent request', async () => {
  const db = fakeDb()
  const first = await requestLookup(db, 'https://www.instagram.com/reel/AbCdE12345/?igsh=x', LOOKUP_PRIORITY.study)
  const again = await requestLookup(db, 'https://instagram.com/reels/AbCdE12345', LOOKUP_PRIORITY.student)
  assert.equal(first, again)
  assert.equal(db.rows.get(first).priority, LOOKUP_PRIORITY.student)
  assert.equal(db.rows.get(first).url, 'https://www.instagram.com/reel/AbCdE12345/')
  await assert.rejects(requestLookup(db, 'https://example.com/reel/AbCdE12345/', 0), /링크를 확인/)
})

test('a waiting request returns the Mac mini\'s result, and fails fast when the Mac mini is off', async () => {
  const db = fakeDb(), redis = store()
  const id = await requestLookup(db, 'https://www.instagram.com/reel/AbCdE12345/', 0)
  await assert.rejects(awaitLookup({ db, redis }, id, { sleep: async () => {} }), /응답하지 않아요/)
  await markCollectorSeen(redis)
  assert.equal(await collectorOnline(redis), true)
  let polls = 0
  const sleep = async () => { polls += 1; if (polls === 2) Object.assign(db.rows.get(id), { status: 'done', result: { videoUrl: 'https://scontent.cdninstagram.com/v.mp4' } }) }
  assert.deepEqual(await awaitLookup({ db, redis }, id, { sleep }), { videoUrl: 'https://scontent.cdninstagram.com/v.mp4' })
  Object.assign(db.rows.get(id), { status: 'failed', error: 'LINK_PRIVATE' })
  await assert.rejects(awaitLookup({ db, redis }, id, { sleep }), err => err.code === 'LINK_PRIVATE')
})

test('only checked fields of what the Mac mini reports are kept', () => {
  const r = lookupResult({ videoUrl: 'https://scontent-ssn1-1.cdninstagram.com/o1/v.mp4?oe=1', thumbnailUrl: 'https://evil.example/t.jpg', username: '@Some.One', views: 1200000, likes: -1, comments: 3.5, caption: '캡션', postedAt: '2026-10-01T00:00:00Z', extra: 'x' })
  assert.deepEqual(r, { videoUrl: 'https://scontent-ssn1-1.cdninstagram.com/o1/v.mp4?oe=1', thumbnailUrl: null, caption: '캡션', username: 'some.one', views: 1200000, likes: null, comments: null, postedAt: '2026-10-01T00:00:00.000Z' })
  assert.equal(lookupError('LINK_DELETED'), 'LINK_DELETED')
  assert.equal(lookupError('anything else'), 'LINK_UNAVAILABLE')
})
