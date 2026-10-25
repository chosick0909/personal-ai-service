import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { shortcodePostedAt, normalizeIngest, qualifyingReels, reviewDecision, ingestAccount, listSuccessReels, successReelReviewSchema, searchTerm, normalizeCaptions, storeReelCaptions, classifyReelCategories, cacheVideoUrl } from '../src/creator-tools/success-reels.js'
import { ingestTokenValid, successReelsEnabled } from '../src/creator-tools/success-reels-routes.js'
import { keywordsForDay, keywordsForCatchUp, SUCCESS_REEL_KEYWORDS } from '../src/creator-tools/success-reels-keywords.js'
import { CREATOR_CATEGORIES, SUCCESS_REEL_CATEGORIES } from '../src/creator-tools/categories.js'

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
  assert.equal(reviewDecision({ ...ok, ordinaryCreator: null }, profile).eligible, true, 'no fame signal is not a reason to exclude')
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

test('every day covers every category in both regions, and seeds rotate across days', () => {
  const today = keywordsForDay(20751)
  assert.equal(today.length, SUCCESS_REEL_KEYWORDS.length * 2)
  for (const { category } of SUCCESS_REEL_KEYWORDS) {
    assert.ok(today.some(k => k.category === category && k.region === 'domestic'), category)
    assert.ok(today.some(k => k.category === category && k.region === 'overseas'), category)
  }
  const total = SUCCESS_REEL_KEYWORDS.reduce((sum, k) => sum + k.domestic.length + k.overseas.length, 0)
  const seen = new Set()
  const days = Math.max(...SUCCESS_REEL_KEYWORDS.map(k => Math.max(k.domestic.length, k.overseas.length)))
  for (let day = 0; day < days; day += 1) keywordsForDay(day).forEach(k => seen.add(`${k.region}:${k.keyword}`))
  assert.equal(seen.size, total)
})

// Minimal in-memory stand-in for the Supabase query builder used by this module.
function fakeDb() {
  const tables = { creator_reel_accounts: new Map(), creator_success_reels: new Map(), creator_reel_ingest_runs: new Map(), creator_reel_saves: new Map(), creator_reel_user_analyses: new Map(), creator_reference_catalog: new Map() }
  const keys = { creator_reel_accounts: 'username', creator_success_reels: 'shortcode', creator_reel_ingest_runs: 'id' }
  const uploads = new Map()
  const builder = table => {
    const filters = []
    let action = 'select', payload, single = false, order, range, limit
    const run = () => {
      const rows = [...tables[table].values()].filter(row => filters.every(([k, v]) => k === null ? v(row) : row[k] === v))
      if (action === 'upsert') { const key = keys[table]; tables[table].set(payload[key], { ...(tables[table].get(payload[key]) || {}), ...payload }); return null }
      if (action === 'update') { rows.forEach(row => Object.assign(row, payload)); return null }
      let out = rows
      // Descending with nulls last, like the queries in the module.
      if (order) out = [...out].sort((a, b) => (a[order] ?? '') === (b[order] ?? '') ? 0 : (b[order] ?? '') > (a[order] ?? '') ? 1 : -1)
      if (range) out = out.slice(range[0], range[1] + 1)
      if (limit) out = out.slice(0, limit)
      return single ? out[0] ?? null : out
    }
    const api = {
      select() { return api }, eq(k, v) { filters.push([k, v]); return api }, maybeSingle() { single = true; return api },
      upsert(row) { action = 'upsert'; payload = row; return api }, update(row) { action = 'update'; payload = row; return api },
      in(k, values) { filters.push([null, row => values.includes(row[k])]); return api },
      order(k) { order = k; return api }, range(a, b) { range = [a, b]; return api }, limit(n) { limit = n; return api },
      // Supports the "field.ilike.%term%,field.ilike.%term%" form used for search.
      or(expr) { const parts = expr.split(',').map(p => p.match(/^(\w+)\.ilike\.%(.*)%$/)); filters.push([null, row => parts.some(([, f, t]) => String(row[f] ?? '').toLowerCase().includes(t.toLowerCase()))]); return api },
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

  db.tables.creator_reel_ingest_runs.set('r1', { id: 'r1', finished_at: '2026-10-24T18:42:00Z' })
  db.tables.creator_reel_ingest_runs.set('r2', { id: 'r2', finished_at: null })
  db.tables.creator_reel_ingest_runs.set('r3', { id: 'r3', finished_at: '2026-10-23T18:40:00Z' })
  const list = await listSuccessReels(db, { sort: 'views' })
  assert.equal(list.lastUpdatedAt, '2026-10-24T18:42:00Z')
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

test('a reel a student analyzed or saved stays listed when its account is later rejected', async () => {
  const db = fakeDb()
  db.tables.creator_success_reels.set('Dd8xyurzlmx', { shortcode: 'Dd8xyurzlmx', visible: true, analysis_status: 'ready', thumbnail_path: 'Dd8xyurzlmx.jpg' })
  db.tables.creator_success_reels.set('DdTFnCDxcGN', { shortcode: 'DdTFnCDxcGN', visible: true, analysis_status: 'none', thumbnail_path: 'DdTFnCDxcGN.jpg' })
  db.tables.creator_success_reels.set('DejMmcehxla', { shortcode: 'DejMmcehxla', visible: true, analysis_status: 'none', thumbnail_path: 'DejMmcehxla.jpg' })
  db.tables.creator_reel_saves.set('u1:DdTFnCDxcGN', { user_id: 'u1', shortcode: 'DdTFnCDxcGN' })
  const providers = { json: async (_op, _p, input) => ({ accountType: 'brand', accountTypeEvidence: [], ordinaryCreator: false, ordinaryCreatorEvidence: [],
    productionLevel: 'professional', productionEvidence: [], monetizationEvidence: [], replicability: 10, replicabilityEvidence: [],
    category: '뷰티', region: 'domestic', regionEvidence: [], language: 'ko',
    reels: input.successReels.map(r => ({ shortcode: r.shortcode, faceVisibility: 'visible', captionKo: '' })) }) }
  await ingestAccount({ db, providers, readImage: async () => 'data:image/jpeg;base64,AA==', now: NOW },
    body([reel('Dd8xyurzlmx', 1220000), reel('DdTFnCDxcGN', 900000), reel('DejMmcehxla', 800000)]))
  assert.equal(db.tables.creator_success_reels.get('Dd8xyurzlmx').visible, true, 'analyzed')
  assert.equal(db.tables.creator_success_reels.get('DdTFnCDxcGN').visible, true, 'saved')
  assert.equal(db.tables.creator_success_reels.get('DejMmcehxla').visible, false, 'untouched reels follow the review')
})

test('success reels split skin from beauty and add trend-board topics without touching shared categories', () => {
  for (const name of ['피부', '뷰티', '먹방', '일상', '부업', '부동산', '다이어트·운동']) assert.ok(SUCCESS_REEL_CATEGORIES.includes(name), name)
  assert.equal(new Set(SUCCESS_REEL_CATEGORIES).size, SUCCESS_REEL_CATEGORIES.length)
  assert.deepEqual(successReelReviewSchema.properties.category.enum, SUCCESS_REEL_CATEGORIES)
  // Every searchable category exists, and every category except 기타 is searched.
  assert.ok(SUCCESS_REEL_KEYWORDS.every(k => SUCCESS_REEL_CATEGORIES.includes(k.category)))
  assert.deepEqual(SUCCESS_REEL_CATEGORIES.filter(c => c !== '기타' && !SUCCESS_REEL_KEYWORDS.some(k => k.category === c)), [])
  assert.ok(!CREATOR_CATEGORIES.includes('피부'), 'other creator tools keep their own list')
})

test('search matches caption, translation, account and audio, and strips filter syntax', async () => {
  assert.equal(searchTerm('다이소, 꿀템)(%*'), '다이소 꿀템')
  assert.equal(searchTerm('  @ojirapper_  '), '@ojirapper_')
  assert.equal(searchTerm('x'.repeat(80)).length, 40)
  assert.equal(searchTerm(42), '')
  const db = fakeDb()
  const base = { visible: true, views: 600000, posted_at: '2026-10-01T00:00:00Z', thumbnail_path: null }
  db.tables.creator_success_reels.set('A1aaaa', { ...base, shortcode: 'A1aaaa', username: 'ojirapper_', caption: '다이소 대란템 대결', caption_ko: null, audio: null })
  db.tables.creator_success_reels.set('B2bbbb', { ...base, shortcode: 'B2bbbb', username: 'glowbyjess', caption: 'The one skincare step', caption_ko: '다들 건너뛰는 스킨케어 단계', audio: 'Pump It' })
  db.tables.creator_success_reels.set('C3cccc', { ...base, shortcode: 'C3cccc', username: 'hidden', caption: '다이소 꿀템', visible: false })
  const codes = async q => (await listSuccessReels(db, { q })).reels.map(r => r.shortcode)
  assert.deepEqual(await codes('다이소'), ['A1aaaa'])
  assert.deepEqual(await codes('스킨케어'), ['B2bbbb'])
  assert.deepEqual(await codes('GLOWBY'), ['B2bbbb'])
  assert.deepEqual(await codes('pump'), ['B2bbbb'])
  assert.deepEqual((await codes('')).sort(), ['A1aaaa', 'B2bbbb'])
})

test('celebrity-size accounts are rejected before AI review', async () => {
  const db = fakeDb()
  let calls = 0
  const providers = { json: async () => { calls += 1; return {} } }
  const result = await ingestAccount({ db, providers, readImage: async () => 'data:image/jpeg;base64,AA==', now: NOW },
    body([reel('Dd8xyurzlmx', 29695484)], { username: 'kendalljenner', followers: 277683563 }))
  assert.deepEqual(result, { username: 'kendalljenner', qualified: 1, saved: 0, eligible: false, reason: '초대형 계정(유명인)' })
  assert.equal(calls, 0)
  assert.equal(db.tables.creator_success_reels.size, 0)
  assert.equal(db.tables.creator_reel_accounts.get('kendalljenner').eligible, false)
})

test('students see 분석됨 only on reels they analyzed themselves', async () => {
  const db = fakeDb()
  const base = { visible: true, views: 600000, posted_at: '2026-10-01T00:00:00Z', thumbnail_path: null, analysis_status: 'ready' }
  db.tables.creator_success_reels.set('Aaaaa1', { ...base, shortcode: 'Aaaaa1' })
  db.tables.creator_success_reels.set('Bbbbb2', { ...base, shortcode: 'Bbbbb2' })
  db.tables.creator_reel_user_analyses.set('u1:Aaaaa1', { user_id: 'u1', shortcode: 'Aaaaa1' })
  const mine = await listSuccessReels(db, {}, 'u1')
  assert.deepEqual(Object.fromEntries(mine.reels.map(r => [r.shortcode, r.analysisStatus])), { Aaaaa1: 'ready', Bbbbb2: 'none' })
  const other = await listSuccessReels(db, {}, 'u2')
  assert.ok(other.reels.every(r => r.analysisStatus === 'none'))
  assert.deepEqual((await listSuccessReels(db, { analyzed: '1' }, 'u1')).reels.map(r => r.shortcode), ['Aaaaa1'])
})

test('accounts vetted for 계정 추천 are listed even when the AI review would reject them', async () => {
  const db = fakeDb()
  db.tables.creator_reference_catalog.set('ojirapper_', { username: 'ojirapper_', active: true })
  const providers = { json: async (_op, _p, input) => ({ accountType: 'brand', accountTypeEvidence: [], ordinaryCreator: false, ordinaryCreatorEvidence: [],
    productionLevel: 'professional', productionEvidence: [], monetizationEvidence: [], replicability: 10, replicabilityEvidence: [],
    category: '뷰티', region: 'domestic', regionEvidence: [], language: 'ko',
    reels: input.successReels.map(r => ({ shortcode: r.shortcode, faceVisibility: 'visible', captionKo: '' })) }) }
  const result = await ingestAccount({ db, providers, readImage: async () => 'data:image/jpeg;base64,AA==', now: NOW }, body([reel('Dd8xyurzlmx', 1220000)]))
  assert.equal(result.eligible, true)
  assert.equal(db.tables.creator_success_reels.get('Dd8xyurzlmx').visible, true)
  assert.equal(db.tables.creator_success_reels.get('Dd8xyurzlmx').category, '뷰티', 'the review still classifies the reel')
})

test('catch-up keywords search every seed of short categories and one pair elsewhere', () => {
  const plan = keywordsForCatchUp(3, ['피부', '부업'])
  assert.equal(plan.filter(k => k.category === '피부').length, 7)
  assert.equal(plan.filter(k => k.category === '부업').length, 7)
  assert.equal(plan.filter(k => k.category === '먹방').length, 2)
  assert.equal(plan.filter(k => k.category === '피부')[0].keyword, keywordsForDay(3).find(k => k.category === '피부').keyword, 'the usual seed comes first')
})

test('captions read from reel pages are stored, and a revisit without one keeps the stored caption', async () => {
  const db = fakeDb()
  const providers = { json: async (_op, _p, input) => ({ accountType: 'individual_creator', accountTypeEvidence: [], ordinaryCreator: true, ordinaryCreatorEvidence: [],
    productionLevel: 'personal', productionEvidence: [], monetizationEvidence: [], replicability: 80, replicabilityEvidence: [],
    category: '피부', region: 'domestic', regionEvidence: [], language: 'ko',
    reels: input.successReels.map(r => ({ shortcode: r.shortcode, faceVisibility: 'visible', captionKo: '' })) }) }
  const deps = { db, providers, readImage: async () => 'data:image/jpeg;base64,AA==', now: NOW }
  await ingestAccount(deps, body([reel('Dd8xyurzlmx', 1220000, { caption: '' })]))
  assert.equal(db.tables.creator_success_reels.get('Dd8xyurzlmx').caption, '')
  assert.deepEqual(normalizeCaptions({ captions: [{ shortcode: 'Dd8xyurzlmx', caption: ' 택배비 4,500원만 내세요 ' }, { shortcode: 'Dd8xyurzlmx', caption: 'dup' }, { shortcode: 'bad!', caption: 'x' }, { shortcode: 'DcdnugUTjcE', caption: '' }] }),
    [{ shortcode: 'Dd8xyurzlmx', caption: '택배비 4,500원만 내세요', videoUrl: null }])
  assert.throws(() => normalizeCaptions({ captions: 'no' }), /캡션 목록/)
  db.tables.creator_success_reels.get('Dd8xyurzlmx').analysis_status = 'ready'
  const stored = await storeReelCaptions(db, { captions: [{ shortcode: 'Dd8xyurzlmx', caption: '택배비 4,500원만 내세요' }, { shortcode: 'DcdnugUTjcE', caption: '없는 릴스' }] })
  assert.equal(stored.saved, 1, 'unknown shortcodes are ignored'); assert.deepEqual(stored.reanalyze, ['Dd8xyurzlmx']); assert.deepEqual(stored.filled.map(f => f.shortcode), ['Dd8xyurzlmx'])
  assert.equal(db.tables.creator_success_reels.get('Dd8xyurzlmx').caption, '택배비 4,500원만 내세요')
  assert.equal(db.tables.creator_success_reels.get('Dd8xyurzlmx').analysis_status, 'none', 'an analysis made without the caption is redone')
  assert.deepEqual(await storeReelCaptions(db, { captions: [{ shortcode: 'Dd8xyurzlmx', caption: '택배비 4,500원만 내세요' }] }), { saved: 1, reanalyze: [], filled: [] })
  await ingestAccount({ ...deps, now: NOW + 86400000 }, body([reel('Dd8xyurzlmx', 1300000, { caption: '' })]))
  assert.equal(db.tables.creator_success_reels.get('Dd8xyurzlmx').caption, '택배비 4,500원만 내세요', 'the reels tab never carries captions')
  await ingestAccount({ ...deps, now: NOW + 2 * 86400000 }, body([reel('Dd8xyurzlmx', 1300000, { caption: '새 캡션' })]))
  assert.equal(db.tables.creator_success_reels.get('Dd8xyurzlmx').caption, '새 캡션')
})

test('captions can carry the reel video link, which is cached until shortly before it expires', async () => {
  const store = new Map(), sets = []
  const redis = { set: async (k, v, _ex, ttl) => { store.set(k, v); sets.push(ttl) }, exists: async k => store.has(k) ? 1 : 0 }
  const now = Date.parse('2026-10-25T00:00:00Z')
  const oe = Math.floor(now / 1000 + 30 * 86400).toString(16).toUpperCase()
  const cdn = `https://scontent.cdninstagram.com/v/reel.mp4?oe=${oe}`
  assert.equal(await cacheVideoUrl(redis, 'Dd8xyurzlmx', cdn, now), true)
  assert.equal(store.get('success-reel-video:Dd8xyurzlmx'), cdn); assert.equal(sets[0], 5 * 86400, 'capped at five days')
  assert.equal(await cacheVideoUrl(redis, 'Dd8xyurzlmx', 'https://evil.example/a.mp4', now), false)
  assert.deepEqual(normalizeCaptions({ captions: [{ shortcode: 'DcdnugUTjcE', caption: '', videoUrl: cdn }] }), [{ shortcode: 'DcdnugUTjcE', caption: '', videoUrl: cdn }])
  const db = fakeDb()
  db.tables.creator_success_reels.set('DcdnugUTjcE', { shortcode: 'DcdnugUTjcE', username: 'u', caption: '', analysis_status: 'none' })
  const result = await storeReelCaptions(db, { captions: [{ shortcode: 'DcdnugUTjcE', caption: '욕실 청소', videoUrl: cdn }] }, redis)
  assert.deepEqual(result, { saved: 1, reanalyze: [], filled: [{ shortcode: 'DcdnugUTjcE', username: 'u', caption: '욕실 청소' }] })
  assert.equal(store.get('success-reel-video:DcdnugUTjcE'), cdn)
})

test('reel categories are re-read from captions and marked as checked', async () => {
  const db = fakeDb()
  db.tables.creator_success_reels.set('A', { shortcode: 'A', username: 'liv', caption: '하수구에 한 알 넣어두면 한달 내내 깨끗', category: '부업', visible: true })
  db.tables.creator_success_reels.set('B', { shortcode: 'B', username: 'x', caption: '', category: '일상', visible: true })
  const providers = { json: async (op, _p, input) => { assert.equal(op, 'success-reel-category'); assert.deepEqual(input.reels.map(r => r.shortcode), ['A']); return { reels: [{ shortcode: 'A', category: '살림' }] } } }
  assert.equal(await classifyReelCategories(db, providers, [...db.tables.creator_success_reels.values()], NOW), 1)
  assert.equal(db.tables.creator_success_reels.get('A').category, '살림')
  assert.ok(db.tables.creator_success_reels.get('A').category_checked_at)
  assert.equal(db.tables.creator_success_reels.get('B').category_checked_at, undefined, 'no caption, nothing to judge')
})
