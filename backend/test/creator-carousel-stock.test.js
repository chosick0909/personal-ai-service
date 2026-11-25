import test from 'node:test'
import assert from 'node:assert/strict'
import { searchStock, fetchStockPhoto, stockReady } from '../src/creator-tools/studio/carousel-stock.js'

const env = { PIXABAY_API_KEY: 'k' }
const HIT = { id: 42, pageURL: 'https://pixabay.com/photos/42', tags: '커피, 컵', webformatURL: 'https://cdn.pixabay.com/w.jpg', previewURL: 'https://cdn.pixabay.com/p.jpg', largeImageURL: 'https://cdn.pixabay.com/l.jpg', imageWidth: 4000, imageHeight: 6000, user: 'someone' }
function memoryRedis() { const store = new Map(); return { store, get: async k => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); return 'OK' } } }
function fakeFetch(answers) {
  const calls = []
  const fetcher = async url => { calls.push(String(url)); const answer = answers(String(url)); return { ok: answer.status ? answer.status < 400 : true, status: answer.status || 200, headers: new Map([['content-type', answer.type || 'application/json']]), json: async () => answer.body, arrayBuffer: async () => answer.bytes || new ArrayBuffer(8) } }
  return { calls, fetcher }
}

test('stock search: needs the server key, searches Korean words, and answers the same search from the cache', async () => {
  assert.equal(stockReady({}), false)
  await assert.rejects(searchStock({ env: {} }, { q: '커피' }), e => e.code === 'STOCK_NOT_CONFIGURED')
  const redis = memoryRedis(), { calls, fetcher } = fakeFetch(() => ({ body: { totalHits: 500, hits: [HIT] } }))
  const first = await searchStock({ redis, env, fetcher }, { q: '  커피  ', orientation: 'sideways', page: 99 })
  const query = new URL(calls[0]).searchParams
  assert.equal(query.get('q'), '커피'); assert.equal(query.get('lang'), 'ko'); assert.equal(query.get('orientation'), 'vertical'); assert.equal(query.get('page'), '10'); assert.equal(query.get('safesearch'), 'true')
  assert.deepEqual(first.photos[0], { id: '42', thumbUrl: HIT.webformatURL, width: 4000, height: 6000, tags: '커피, 컵', author: 'someone', pageUrl: HIT.pageURL })
  assert.equal(first.total, 300, 'the free API serves ten pages at most')
  const again = await searchStock({ redis, env, fetcher }, { q: '커피', orientation: 'sideways', page: 99 })
  assert.deepEqual(again, first); assert.equal(calls.length, 1)
  assert.ok(![...redis.store.values()].some(v => v.includes('"k"')) && ![...redis.store.keys()].some(k => k.includes('커피')), 'the key and the words are not kept in the cache key')
  await assert.rejects(searchStock({ redis, env, fetcher }, { q: '   ' }), e => e.code === 'STOCK_QUERY_REQUIRED')
})

test('stock search: a busy or failing provider gets a message the student can act on', async () => {
  await assert.rejects(searchStock({ env, fetcher: fakeFetch(() => ({ status: 429 })).fetcher }, { q: '커피' }), e => e.code === 'STOCK_BUSY')
  await assert.rejects(searchStock({ env, fetcher: fakeFetch(() => ({ status: 500 })).fetcher }, { q: '커피' }), e => e.code === 'STOCK_FAILED')
})

test('picking a stock photo fetches it again by id at the largest free size and keeps its real proportions', async () => {
  const { calls, fetcher } = fakeFetch(url => url.startsWith('https://pixabay.com/api/') ? { body: { hits: [HIT] } } : { type: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]).buffer })
  const photo = await fetchStockPhoto({ env, fetcher }, '42abc')
  assert.equal(new URL(calls[0]).searchParams.get('id'), '42')
  assert.equal(calls[1], HIT.largeImageURL)
  assert.deepEqual({ type: photo.type, width: photo.width, height: photo.height, size: photo.bytes.length }, { type: 'image/jpeg', width: 853, height: 1280, size: 3 })
  await assert.rejects(fetchStockPhoto({ env, fetcher: fakeFetch(() => ({ body: { hits: [] } })).fetcher }, '7'), e => e.code === 'STOCK_NOT_FOUND')
  await assert.rejects(fetchStockPhoto({ env, fetcher }, 'abc'), e => e.code === 'STOCK_NOT_FOUND')
})
