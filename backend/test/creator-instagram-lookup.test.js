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

test('a post just found unreadable answers again at once instead of queueing the Mac mini again', async () => {
  const db = fakeDb(), url = 'https://www.instagram.com/reel/AbCdE12345/'
  const first = await requestLookup(db, url, 0)
  Object.assign(db.rows.get(first), { status: 'failed', error: 'LINK_UNAVAILABLE' })
  assert.equal(await requestLookup(db, url, 0), first)
  await assert.rejects(awaitLookup({ db, redis: store() }, first, { sleep: async () => {} }), err => err.code === 'LINK_UNAVAILABLE')
  // Older than ten minutes, or a failure that is not about the post itself: the Mac mini looks again.
  db.rows.get(first).created_at = new Date(Date.now() - 11 * 60000).toISOString()
  const later = await requestLookup(db, url, 0)
  assert.notEqual(later, first)
  Object.assign(db.rows.get(later), { status: 'failed', error: 'TIMEOUT' })
  assert.notEqual(await requestLookup(db, url, 0), later)
})

test('only checked fields of what the Mac mini reports are kept', () => {
  const r = lookupResult({ videoUrl: 'https://scontent-ssn1-1.cdninstagram.com/o1/v.mp4?oe=1', thumbnailUrl: 'https://evil.example/t.jpg', username: '@Some.One', views: 1200000, likes: -1, comments: 3.5, caption: '캡션', postedAt: '2026-10-01T00:00:00Z', extra: 'x' })
  assert.deepEqual(r, { videoUrl: 'https://scontent-ssn1-1.cdninstagram.com/o1/v.mp4?oe=1', thumbnailUrl: null, caption: '캡션', username: 'some.one', views: 1200000, likes: null, comments: null, postedAt: '2026-10-01T00:00:00.000Z' })
  assert.equal(lookupError('LINK_DELETED'), 'LINK_DELETED')
  assert.equal(lookupError('anything else'), 'LINK_UNAVAILABLE')
})

test('a student\'s link goes to the paid reader at once while the Mac mini is limited; 추천 links keep waiting', async () => {
  const { createProviders } = await import('../src/creator-tools/providers.js')
  const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = await import('undici')
  const previous = getGlobalDispatcher(), agent = new MockAgent(), savedKey = process.env.BRIGHT_DATA_API_KEY
  process.env.BRIGHT_DATA_API_KEY = 'test-only-key'
  agent.disableNetConnect(); setGlobalDispatcher(agent)
  const pool = agent.get('https://api.brightdata.com')
  pool.intercept({ method: 'POST', path: path => path.startsWith('/datasets/v3/trigger') }).reply(200, { snapshot_id: 'sd_student' })
  pool.intercept({ method: 'GET', path: '/datasets/v3/progress/sd_student' }).reply(200, { status: 'ready' })
  pool.intercept({ method: 'GET', path: '/datasets/v3/snapshot/sd_student?format=json' }).reply(200, [{ video_url: 'https://scontent.cdninstagram.com/s.mp4', user_posted: 'maker', video_play_count: 1200 }])
  try {
    const db = fakeDb()
    db.rows.set('B', { id: 'B', shortcode: 'Other12345', status: 'failed', error: 'LOOKUP_BLOCKED', priority: 0, created_at: new Date().toISOString() })
    const redis = { get: async () => 0, incr: async () => 1, expire: async () => {}, del: async () => {}, set: async () => 'OK' }
    const events = { from: name => name === 'creator_provider_events' ? { insert: async () => ({ error: null }) } : db.from(name) }
    const providers = createProviders({ job: { id: null }, db: events, redis })
    const media = await providers.instagramReel('https://www.instagram.com/reel/AbCdE12345/')
    assert.equal(media.videoUrl, 'https://scontent.cdninstagram.com/s.mp4')
    assert.equal(media.views, 1200)
    agent.assertNoPendingInterceptors()
    await assert.rejects(providers.instagramReel('https://www.instagram.com/reel/AbCdE12345/', undefined, LOOKUP_PRIORITY.recommend), { code: 'LOOKUP_BLOCKED' })
  } finally {
    setGlobalDispatcher(previous); await agent.close()
    if (savedKey === undefined) delete process.env.BRIGHT_DATA_API_KEY
    else process.env.BRIGHT_DATA_API_KEY = savedKey
  }
})
