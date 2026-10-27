import { setTimeout as delay } from 'node:timers/promises'
import { query } from './store.js'
import { fail } from './domain.js'
import { instagramPostUrl } from './reference-quality.js'

// Instagram reels are read by the operator's Mac mini (its own logged-in Chrome), not by a paid data service.
// The server queues a lookup; the Mac mini claims the most urgent one, reads the reel page and posts the result back.
// Lower priority numbers go first: what a student is waiting for, then 추천 links, then the daily study.
export const LOOKUP_PRIORITY = { student: 0, recommend: 1, study: 2 }
const SEEN_KEY = 'hookai:collector:seen'
const ONLINE_MS = 2 * 60000
const REUSE_MS = 30 * 60000
const BLOCKED_REUSE_MS = 10 * 60000
const UNAVAILABLE = '영상을 가져올 수 없어요. 사진 게시물(카드뉴스)이나 연령 제한·비공개 게시물은 분석할 수 없어요. 영상 파일(MP4)이나 대본을 직접 올려 주세요.'
export const OFFLINE_MESSAGE = '인스타 조회용 컴퓨터가 지금 응답하지 않아요. 잠시 후 다시 시도하거나 MP4·대본 업로드를 이용해주세요.'
export const TIMEOUT_MESSAGE = '인스타 조회가 늦어지고 있어요. 잠시 후 다시 시도해주세요.'
export const BLOCKED_MESSAGE = '지금 인스타에서 릴스를 읽지 못하고 있어요(조회용 계정 확인 중). 잠시 후 다시 시도하거나 MP4·대본 업로드를 이용해주세요.'
const ERRORS = new Set(['LINK_PRIVATE', 'LINK_DELETED', 'LINK_UNAVAILABLE', 'LOOKUP_BLOCKED'])

export const markCollectorSeen = (redis, now = Date.now()) => redis?.set(SEEN_KEY, String(now), 'EX', 3600).catch(() => {})
export async function collectorOnline(redis, now = Date.now()) {
  const seen = Number(await redis?.get(SEEN_KEY).catch(() => 0))
  return Number.isFinite(seen) && seen > now - ONLINE_MS
}

// One queued lookup per reel: a recent request for the same reel is reused (and raised to the more urgent priority).
export async function requestLookup(db, url, priority, now = Date.now()) {
  const clean = instagramPostUrl(String(url || ''))
  if (!clean) fail('LINK_INVALID', '인스타그램 릴스·게시물 링크를 확인해주세요.', 422)
  const shortcode = clean.split('/')[4]
  const since = new Date(now - REUSE_MS).toISOString()
  // While the Mac mini is resting from Instagram's request limit, a new request gets that answer at once instead of
  // adding another page load Instagram would refuse (and that would keep the limit going).
  const blocked = await query(db.from('creator_instagram_lookups').select('id').eq('status', 'failed').eq('error', 'LOOKUP_BLOCKED')
    .gte('created_at', new Date(now - BLOCKED_REUSE_MS).toISOString()).order('created_at', { ascending: false }).limit(1))
  if (blocked[0]) return blocked[0].id
  const recent = await query(db.from('creator_instagram_lookups').select('id,status,priority').eq('shortcode', shortcode)
    .in('status', ['queued', 'claimed', 'done']).gte('created_at', since).order('created_at', { ascending: false }).limit(1))
  if (recent[0]) {
    if (recent[0].status === 'queued' && priority < recent[0].priority) await query(db.from('creator_instagram_lookups').update({ priority }).eq('id', recent[0].id))
    return recent[0].id
  }
  return (await query(db.from('creator_instagram_lookups').insert({ shortcode, url: clean, priority }).select('id').single())).id
}

export async function awaitLookup({ db, redis, signal }, id, { timeoutMs = 180000, pollMs = 2000, now = Date.now, sleep = delay } = {}) {
  const until = now() + timeoutMs
  for (;;) {
    const row = await query(db.from('creator_instagram_lookups').select('status,result,error').eq('id', id).single())
    if (row.status === 'done') return row.result
    if (row.status === 'failed') fail(ERRORS.has(row.error) ? row.error : 'LINK_UNAVAILABLE', row.error === 'LOOKUP_BLOCKED' ? BLOCKED_MESSAGE : UNAVAILABLE, row.error === 'LOOKUP_BLOCKED' ? 503 : 422)
    if (!(await collectorOnline(redis, now()))) fail('LOOKUP_OFFLINE', OFFLINE_MESSAGE, 503)
    if (now() > until) fail('LOOKUP_TIMEOUT', TIMEOUT_MESSAGE, 503)
    await sleep(pollMs, undefined, { signal })
  }
}

// What the Mac mini may report: only the fields the link features use, each checked.
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null
const https = (value, hosts) => { try { const u = new URL(value); return u.protocol === 'https:' && hosts.test(u.hostname) ? u.href : null } catch { return null } }
const CDN = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/
export function lookupResult(raw) {
  const username = String(raw?.username || '').replace(/^@/, '').toLowerCase()
  return {
    videoUrl: https(raw?.videoUrl, CDN), thumbnailUrl: https(raw?.thumbnailUrl, CDN),
    caption: typeof raw?.caption === 'string' ? raw.caption.normalize('NFC').slice(0, 5000) : '',
    username: /^[a-z0-9_.]{1,30}$/.test(username) ? username : null,
    views: count(raw?.views), likes: count(raw?.likes), comments: count(raw?.comments),
    postedAt: Number.isFinite(Date.parse(raw?.postedAt)) ? new Date(raw.postedAt).toISOString() : null,
  }
}
export const lookupError = code => ERRORS.has(code) ? code : 'LINK_UNAVAILABLE'
