import { createHash } from 'node:crypto'
import { fail } from '../domain.js'

// 무료 사진 검색 for the carousel maker, through the Pixabay API (free photos, no credit line required).
// Pixabay's API rules decide the shape of this file: the key stays on the server, the same search is answered from a
// 24-hour cache, results say where they come from, and a photo the student picks is copied to our storage rather
// than linked (Pixabay forbids permanent hotlinking). Unsplash was the other option in the proposal, but it requires
// the opposite (hotlinking and a credit line on every use), which a downloaded PNG cannot carry.
const API = 'https://pixabay.com/api/'
const CACHE_SECONDS = 24 * 3600
const PER_PAGE = 30
export const STOCK_SOURCE = { name: 'Pixabay', url: 'https://pixabay.com/' }

export const stockKey = (env = process.env) => String(env.PIXABAY_API_KEY || '').trim()
export const stockReady = (env = process.env) => Boolean(stockKey(env))

const clean = (value, max) => typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max) : ''
const ORIENTATIONS = { vertical: 'vertical', horizontal: 'horizontal', all: 'all' }

async function pixabay({ env = process.env, fetcher = fetch }, params) {
  const key = stockKey(env)
  if (!key) fail('STOCK_NOT_CONFIGURED', '무료 사진 검색이 아직 준비되지 않았어요.', 503)
  const search = new URLSearchParams({ key, lang: 'ko', image_type: 'photo', safesearch: 'true', ...params })
  const response = await fetcher(`${API}?${search}`, { signal: AbortSignal.timeout(15000) }).catch(() => null)
  if (response?.status === 429) fail('STOCK_BUSY', '사진 검색이 잠시 몰렸어요. 1분 뒤에 다시 검색해주세요.', 429)
  const data = response?.ok ? await response.json().catch(() => null) : null
  if (!data || !Array.isArray(data.hits)) fail('STOCK_FAILED', '사진을 찾지 못했어요. 잠시 뒤 다시 검색해주세요.', 502)
  return data
}

const hit = h => ({ id: String(h.id), thumbUrl: h.webformatURL || h.previewURL, width: Number(h.imageWidth) || null, height: Number(h.imageHeight) || null, tags: clean(h.tags, 120), author: clean(h.user, 60), pageUrl: h.pageURL })

// One page of results. Korean words are searched as Korean (lang=ko).
export async function searchStock({ redis, env, fetcher }, { q, orientation = 'vertical', page = 1 }) {
  const words = clean(q, 100)
  if (!words) fail('STOCK_QUERY_REQUIRED', '찾을 사진을 한두 단어로 적어주세요.')
  const params = { q: words, orientation: ORIENTATIONS[orientation] || 'vertical', page: String(Math.min(10, Math.max(1, Math.round(Number(page)) || 1))), per_page: String(PER_PAGE) }
  const cacheKey = `stock:pixabay:${createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 32)}`
  const cached = await redis?.get(cacheKey).catch(() => null)
  if (cached) { try { return JSON.parse(cached) } catch { /* fetch again */ } }
  const data = await pixabay({ env, fetcher }, params)
  const result = { photos: data.hits.map(hit).filter(p => p.thumbUrl), total: Math.min(Number(data.totalHits) || 0, PER_PAGE * 10), page: Number(params.page), perPage: PER_PAGE }
  await redis?.set(cacheKey, JSON.stringify(result), 'EX', CACHE_SECONDS).catch(() => {})
  return result
}

// The photo the student picked, fetched again by id (links in a search result expire) at the largest size the free
// API gives (long side 1,280px), ready to be stored in the student's library.
export async function fetchStockPhoto({ env, fetcher = fetch }, id) {
  const photoId = String(id || '').replace(/\D/g, '').slice(0, 20)
  if (!photoId) fail('STOCK_NOT_FOUND', '사진을 찾을 수 없어요.', 404)
  const found = (await pixabay({ env, fetcher }, { id: photoId })).hits?.[0]
  const url = found?.largeImageURL
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) fail('STOCK_NOT_FOUND', '사진을 찾을 수 없어요. 다른 사진을 골라주세요.', 404)
  const file = await fetcher(url, { signal: AbortSignal.timeout(30000) }).catch(() => null)
  if (!file?.ok) fail('STOCK_FAILED', '사진을 받지 못했어요. 다시 시도해주세요.', 502)
  const type = String(file.headers.get('content-type') || '').split(';')[0].trim()
  const bytes = Buffer.from(await file.arrayBuffer())
  if (bytes.length > 8 * 1024 * 1024) fail('STOCK_FAILED', '사진이 너무 커서 받지 못했어요. 다른 사진을 골라주세요.', 422)
  const w = Number(found.imageWidth) || 0, h = Number(found.imageHeight) || 0, scale = w && h ? Math.min(1, 1280 / Math.max(w, h)) : 0
  return { bytes, type: type === 'image/png' ? 'image/png' : 'image/jpeg', width: scale ? Math.round(w * scale) : null, height: scale ? Math.round(h * scale) : null }
}
