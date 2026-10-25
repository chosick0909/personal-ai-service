import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { shortcodePostedAt, normalizeIngest, qualifyingReels, reviewDecision, ingestAccount, listSuccessReels, successReelReviewSchema } from '../src/creator-tools/success-reels.js'
import { ingestTokenValid, successReelsEnabled } from '../src/creator-tools/success-reels-routes.js'
import { keywordsForDay, SUCCESS_REEL_KEYWORDS } from '../src/creator-tools/success-reels-keywords.js'

const NOW = Date.parse('2026-10-25T00:00:00Z')

test('upload dates decode from shortcodes and match dates read from the post pages', () => {
  // Dates read by hand from the Instagram post pages during the 2026-10-23 on-site test.
  for (const [code, day] of [['Dd8xyurzlmx', '2026-10-01'], ['DdTFnCDxcGN', '2026-09-15'], ['DcdnugUTjcE', '2026-08-25'], ['DejMmcehxla', '2026-10-16'], ['DeOnc-nBHV9', '2026-10-08']]) {
    assert.equal(shortcodePostedAt(code).toISOString().slice(0, 10), day)
  }
  assert.equal(shortcodePostedAt('bad code!'), null)
  assert.equal(shortcodePostedAt(''), null)
})

const reel = (shortcode, views, extra = {}) => ({ shortcode, views, likes: 10, comments: 2, caption: 'cap', thumbnailUrl: 'https://scontent-ssn1-1.cdninstagram.com/v/t51/x.jpg', ...extra })
const body = (reels, account = {}) => ({ account: { username: 'Ojirapper_', fullName: '오지랖퍼', biography: '코덕', followers: 6784, ...account }, reels, source: '키워드:피부관리' })

test('ingest input is re-validated and only 500k+ reels from the last 3 months qualify', () => {
  const input = normalizeIngest(body([reel('Dd8xyurzlmx', 1220000), reel('DcdnugUTjcE', 1267000), reel('DejMmcehxla', 499999),
    reel('Dd8xyurzlmx', 1), reel('bad!', 900000), { shortcode: 'DeOnc-nBHV9', views: '600000' }]), NOW)
  assert.equal(input.username, 'ojirapper_')
  assert.deepEqual(input.reels.map(r => r.shortcode), ['Dd8xyurzlmx', 'DcdnugUTjcE', 'DejMmcehxla'])
  assert.deepEqual(qualifyingReels(input.reels, NOW).map(r => r.shortcode), ['Dd8xyurzlmx', 'DcdnugUTjcE'])
  assert.deepEqual(qualifyingReels(input.reels, Date.parse('2026-12-20T00:00:00Z')).map(r => r.shortcode), ['Dd8xyurzlmx'])
  assert.equal(normalizeIngest(body([reel('Dd8xyurzlmx', 1, { thumbnailUrl: 'https://evil.example/x.jpg' })]), NOW).reels[0].thumbnailUrl, null)
  assert.throws(() => normalizeIngest(body([], { username: '../etc' }), NOW), /계정 아이디/)
  assert.throws(() => normalizeIngest(body([], { isPrivate: true }), NOW), /비공개/)
})

test('account decision follows the existing exclusion policy and rejects undecidable accounts', () => {
  const profile = { username: 'creator', fullName: '홍길동', biography: '30대 직장인 홈트', categoryName: '' }
  const ok = { accountType: 'individual_creator', ordinaryCreator: true, productionLevel: 'personal' }
  assert.deepEqual(reviewDecision(ok, profile), { eligible: true, reason: null })
  assert.equal(reviewDecision({ ...ok, ordinaryCreator: null }, profile).reason, '일반인 여부 판단 불가')
  assert.equal(reviewDecision({ ...ok, ordinaryCreator: false }, profile).reason, '연예인·소속사 등 제외 대상')
  assert.equal(reviewDecision({ ...ok, productionLevel: 'professional' }, profile).eligible, false)
  assert.equal(reviewDecision({ ...ok, accountType: 'brand' }, profile).eligible, false)
  assert.equal(reviewDecision(ok, { ...profile, biography: '○○엔터테인먼트 소속' }).eligible, false)
  assert.ok(successReelReviewSchema.required.every(key => key in successReelReviewSchema.properties))
})

test('collector token is checked against a stored SHA-256 only', () => {
  const token = 'a'.repeat(48)
  const env = { CREATOR_REELS_INGEST_TOKEN_SHA256: createHash('sha256').update(token).digest('hex') }
  assert.equal(ingestTokenValid(`Bearer ${token}`, env), true)
  assert.equal(ingestTokenValid(`Bearer ${'b'.repeat(48)}`, env), false)
  assert.equal(ingestTokenValid(token, env), false)
  assert.equal(ingestTokenValid(`Bearer ${token}`, {}), false)
  assert.equal(successReelsEnabled('u1', { CREATOR_SUCCESS_REELS_USER_IDS: 'u0, u1' }), true)
  assert.equal(successReelsEnabled('u2', { CREATOR_SUCCESS_REELS_USER_IDS: 'u0, u1' }), false)
  assert.equal(successReelsEnabled('u2', { CREATOR_SUCCESS_REELS_ENABLED: 'true' }), true)
})

test('daily keywords rotate through every seed, domestic and overseas', () => {
  const total = SUCCESS_REEL_KEYWORDS.reduce((sum, k) => sum + k.domestic.length + k.overseas.length, 0)
  const seen = new Set()
  for (let day = 0; day < Math.ceil(total / 6); day += 1) keywordsForDay(day, 6).forEach(k => seen.add(`${k.region}:${k.keyword}`))
  assert.equal(seen.size, total)
  assert.ok(keywordsForDay(3, 6).some(k => k.region === 'overseas') || keywordsForDay(4, 6).some(k => k.region === 'overseas'))
})

// Minimal in-memory stand-in for the Supabase query builder used by this module.
function fakeDb() {
  const tables = { creator_reel_accounts: new Map(), creator_success_reels: new Map() }
  const keys = { creator_reel_accounts: 'username', creator_success_reels: 'shortcode' }
  const uploads = new Map()
  const builder = table => {
    const filters = []
    let action = 'select', payload, single = false, order, range
    const run = () => {
      const rows = [...tables[table].values()].filter(row => filters.every(([k, v]) => row[k] === v))
      if (action === 'upsert') { const key = keys[table]; tables[table].set(payload[key], { ...(tables[table].get(payload[key]) || {}), ...payload }); return null }
      if (action === 'update') { rows.forEach(row => Object.assign(row, payload)); return null }
      let out = rows
      if (order) out = [...out].sort((a, b) => (b[order] > a[order] ? 1 : -1))
      if (range) out = out.slice(range[0], range[1] + 1)
      return single ? out[0] ?? null : out
    }
    const api = {
      select() { return api }, eq(k, v) { filters.push([k, v]); return api }, maybeSingle() { single = true; return api },
      upsert(row) { action = 'upsert'; payload = row; return api }, update(row) { action = 'update'; payload = row; return api },
      order(k) { order = k; return api }, range(a, b) { range = [a, b]; return api },
      then(resolve) { resolve({ data: run(), error: null }) },
    }
    return api
  }
  return { tables, uploads, from: builder, storage: { from: () => ({
    upload: async (path, data) => { uploads.set(path, data); return { error: null } },
    createSignedUrls: async paths => ({ data: paths.map(path => ({ path, signedUrl: `https://signed/${path}` })), error: null }),
  }) } }
}

test('ingest reviews once, stores thumbnails, and shows only eligible accounts', async () => {
  const db = fakeDb()
  const calls = []
  const providers = { json: async (operation, _prompt, input, frames) => {
    calls.push({ operation, input, frames })
    return { accountType: 'individual_creator', accountTypeEvidence: ['본인 경험'], ordinaryCreator: true, ordinaryCreatorEvidence: ['개인 메일'],
      productionLevel: 'personal', productionEvidence: ['매장·집 촬영'], monetizationEvidence: [], replicability: 85, replicabilityEvidence: ['스마트폰'],
      category: '뷰티', region: 'domestic', regionEvidence: ['국내 매장'], language: 'ko',
      reels: input.successReels.map(r => ({ shortcode: r.shortcode, faceVisibility: 'hidden', captionKo: '' })) }
  } }
  const readImage = async () => `data:image/jpeg;base64,${Buffer.from('jpeg').toString('base64')}`
  const payload = body([reel('Dd8xyurzlmx', 1220000), reel('DdTFnCDxcGN', 576000), reel('DejMmcehxla', 21000)])
  const first = await ingestAccount({ db, providers, readImage, now: NOW }, payload)
  assert.deepEqual(first, { username: 'ojirapper_', qualified: 2, saved: 2, eligible: true, reason: null })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].operation, 'success-reel-review')
  assert.ok(calls[0].frames.length >= 2)
  assert.deepEqual([...db.uploads.keys()].sort(), ['Dd8xyurzlmx.jpg', 'DdTFnCDxcGN.jpg'])
  const stored = db.tables.creator_success_reels.get('Dd8xyurzlmx')
  assert.equal(stored.visible, true)
  assert.equal(stored.posted_at.slice(0, 10), '2026-10-01')
  assert.equal(stored.category, '뷰티')
  assert.equal(stored.face_visibility, 'hidden')

  // A second run within 30 days reuses the review and updates the numbers only.
  await ingestAccount({ db, providers, readImage, now: NOW + 86400000 }, body([reel('Dd8xyurzlmx', 1300000), reel('DdTFnCDxcGN', 580000)]))
  assert.equal(calls.length, 1)
  assert.equal(db.tables.creator_success_reels.get('Dd8xyurzlmx').views, 1300000)

  const list = await listSuccessReels(db, { sort: 'views' })
  assert.deepEqual(list.reels.map(r => r.shortcode), ['Dd8xyurzlmx', 'DdTFnCDxcGN'])
  assert.equal(list.reels[0].thumbnailUrl, 'https://signed/Dd8xyurzlmx.jpg')
  assert.equal(list.reels[0].permalink, 'https://www.instagram.com/reel/Dd8xyurzlmx/')
})

test('rejected accounts keep their reels hidden', async () => {
  const db = fakeDb()
  const providers = { json: async (_op, _p, input) => ({ accountType: 'brand', accountTypeEvidence: ['쇼핑몰'], ordinaryCreator: null, ordinaryCreatorEvidence: [],
    productionLevel: 'professional', productionEvidence: [], monetizationEvidence: [], replicability: 10, replicabilityEvidence: [],
    category: '뷰티', region: 'overseas', regionEvidence: [], language: 'en',
    reels: input.successReels.map(r => ({ shortcode: r.shortcode, faceVisibility: 'visible', captionKo: '번역' })) }) }
  const result = await ingestAccount({ db, providers, readImage: async () => 'data:image/jpeg;base64,AA==', now: NOW }, body([reel('Dd8xyurzlmx', 1220000)]))
  assert.equal(result.eligible, false)
  assert.equal(db.tables.creator_success_reels.get('Dd8xyurzlmx').visible, false)
  assert.equal((await listSuccessReels(db, {})).reels.length, 0)
})
