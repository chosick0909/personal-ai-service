import test from 'node:test'
import assert from 'node:assert/strict'
import { accountSearchQueries, profileUsername, searchProfiles, normalizePublicProfiles, normalizePublicReels, publicAccountCandidates, obviousBrandAccount } from '../src/creator-tools/public-discovery.js'
import { CREATOR_CATEGORIES, REFERENCE_CATEGORIES } from '../src/creator-tools/categories.js'
import { normalizeBrief } from '../src/creator-tools/domain.js'
import { discoverAccounts } from '../src/creator-tools/discovery.js'
import { workerConcurrency } from '../src/creator-tools/queue.js'
import { collectDataset } from '../src/creator-tools/brightdata.js'

const brief = { topic: '작은 집 수납', targetAudience: '자취 직장인', category: '살림/인테리어', contentGoal: '교육', region: 'KR', searchPage: 0,
  faceVisibility: 'any', contentFormat: 'any', accountSize: 'any', recentActivity: 'any', contentLanguage: 'ko',
  trendGoal:'education', audienceLevel:'beginner', keywordScope:'balanced', contentStructure:'howto', excludeAccounts: [] }
const now = Date.parse('2026-09-16T00:00:00Z')
const profile = (account, extra = {}) => ({ account, url: `https://www.instagram.com/${account}/`, is_private: false, is_professional_account: true,
  biography: '작은 집 정리 방법을 소개합니다.', followers: 100000, posts_count: 12,
  posts: [{ url: `https://www.instagram.com/reel/${account}12/`, caption: '자취방 수납법', datetime: '2026-09-14', likes: 0, comments: null }], ...extra })

test('reference and trend discovery accept only bounded selection values', () => {
  assert.equal(CREATOR_CATEGORIES.length, 16)
  for (const category of REFERENCE_CATEGORIES) assert.equal(normalizeBrief({ ...brief, category }, 'reference-accounts').category, category)
  for (const category of REFERENCE_CATEGORIES) assert.equal(normalizeBrief({ ...brief, category }, 'trend-keywords').category, category)
  assert.throws(() => normalizeBrief({ ...brief, category: 'made up' }), { code: 'INVALID_CATEGORY' })
  assert.deepEqual(normalizeBrief(brief, 'reference-accounts'), { category:'살림/인테리어', faceVisibility:'any', contentFormat:'any', accountSize:'any', recentActivity:'any', contentLanguage:'ko', region:'GLOBAL' })
  assert.throws(() => normalizeBrief({ ...brief, faceVisibility:'sometimes' }, 'reference-accounts'), { code:'INVALID_FILTER' })
  assert.deepEqual(normalizeBrief(brief, 'trend-keywords'), { category:'살림/인테리어', trendGoal:'education', audienceLevel:'beginner', keywordScope:'balanced', contentStructure:'howto', contentLanguage:'ko', region:'GLOBAL' })
  assert.throws(() => normalizeBrief({ ...brief, keywordScope:'everything' }, 'trend-keywords'), { code:'INVALID_FILTER' })
})
test('search only yields actual Instagram profile links, never posts, spoofed domains or AI names', () => {
  assert.equal(profileUsername('https://instagram.com/Good.Name/?hl=ko'), 'good.name')
  for (const url of ['https://instagram.com/p/', 'https://instagram.com/reel/ABCDE/', 'https://instagram.com.evil.test/a/', 'https://secret@instagram.com/a/', 'https://instagram.com:444/a/', 'http://instagram.com/a/']) assert.equal(profileUsername(url), null)
  assert.deepEqual(searchProfiles({ body: JSON.stringify({ organic: [{ link: 'https://instagram.com/person/' }, { link: 'https://instagram.com/person/' }, { link: 'https://instagram.com/p/ABCDE/' }] }) }), ['person'])
  assert.throws(() => searchProfiles({ body: '<html>' }), { code: 'SEARCH_INVALID_RESPONSE' })
  assert.ok(accountSearchQueries({ ...brief, topic: '살림 site:evil.com OR -site:instagram.com' }).every(q => q.startsWith('site:instagram.com ') && !q.includes('site:evil')))
})
test('verified public accounts qualify; private, unsolicited and mismatched records do not', () => {
  const records = [profile('ordinary'), profile('private', { is_private: true }), profile('unknown', { is_private: null }),
    profile('personal', { is_professional_account: false }), profile('invented'), profile('mismatch', { url: 'https://instagram.com/someone_else/' }), profile('ordinary')]
  const rows = normalizePublicProfiles(records, ['ordinary', 'private', 'unknown', 'personal', 'mismatch'], now)
  assert.deepEqual(rows.map(row => row.username), ['ordinary', 'personal'])
  assert.equal(rows[0].profile.followers, 100000)
  assert.equal(rows[0].profile.exampleMedia[0].likes, 0)
  assert.equal(rows[0].profile.exampleMedia[0].comments, null)
  assert.equal(rows[0].last_active_at, '2026-09-14T00:00:00.000Z')
  const sparse = normalizePublicProfiles([profile('ordinary', { followers: '100k', posts: [{ url: 'https://evil.test/p/1', datetime: '2026-09-10' }] })], ['ordinary'], now)[0]
  assert.equal(sparse.profile.followers, null); assert.equal(sparse.last_active_at, null)
})
test('clear brand and official-account signals are rejected without excluding an individual business account', () => {
  assert.equal(obviousBrandAccount(profile('kahi_official'), 'kahi_official'), true)
  assert.equal(obviousBrandAccount(profile('shop', { account:'ordinary_shop', full_name:'정리 상점' }), 'ordinary_shop'), true)
  assert.equal(obviousBrandAccount(profile('brand', { account:'plainname', category_name:'Product/Service' }), 'plainname'), true)
  assert.equal(obviousBrandAccount(profile('creator', { account:'jiwoo.home', is_business_account:true, full_name:'김지우', biography:'두 아이 엄마의 정리 기록' }), 'jiwoo.home'), false)
  const rows = normalizePublicProfiles([
    profile('kahi_official'),
    profile('plainname', { full_name:'KAHI', biography:'브랜드 공식 계정' }),
    profile('jiwoo.home', { is_business_account:true, full_name:'김지우', biography:'두 아이 엄마의 정리 기록' }),
  ], ['kahi_official', 'plainname', 'jiwoo.home'], now)
  assert.deepEqual(rows.map(row => row.username), ['jiwoo.home'])
})
test('reel reach evidence must match the requested URL owner and have a numeric view count', () => {
  const owners = new Map([['https://www.instagram.com/reel/ordinary12/', 'ordinary']])
  const rows = normalizePublicReels([
    { input:{ url:'https://www.instagram.com/reel/ordinary12/' }, url:'https://www.instagram.com/reel/CANONICAL/', user_posted:'@ordinary', views:500000, video_play_count:700000 },
    { input:{ url:'https://www.instagram.com/reel/ordinary12/' }, user_posted:'someone_else', views:900000 },
    { input:{ url:'https://www.instagram.com/reel/ordinary12/' }, user_posted:'ordinary', views:null },
  ], owners)
  assert.deepEqual(rows, [{ username:'ordinary', permalink:'https://www.instagram.com/reel/CANONICAL/', views:700000 }])
})
function context() {
  const memory = new Map(), saved = {}, stages = [], calls = []
  return { job: { user_id: 'test-user', input: brief },
    db: { from(table) { assert.equal(table, 'creator_account_preferences'); return { select() { return { eq: async () => ({ data: [], error: null }) } } } } },
    redis: { get: async key => memory.get(key), set: async (key, value) => memory.set(key, value) },
    checkpoint: async (key, fn) => saved[key] ?? (saved[key] = await fn()), stage: async value => stages.push(value),
    providers: { searchAccounts: async (_q, region, page) => { calls.push(['search', region, page]); return ['ordinary', 'private'] },
      publicProfiles: async names => { calls.push(['profiles', names]); return [profile('ordinary'), profile('private', { is_private: true })] },
      publicReels: async urls => { calls.push(['reels', urls]); return urls.map(url => ({ input:{ url }, url, user_posted:'ordinary', video_play_count:600000 })) },
      json: async () => ({ accounts: [{ username: 'ordinary', accountType:'individual_creator', accountTypeEvidence:['개인의 경험과 관점이 확인됨'], categoryMatch:95, reasons: ['수납 주제'], referencePoints: ['정리 순서'] }, { username: 'hallucinated', accountType:'individual_creator', categoryMatch:100 }] }) }, calls, stages }
}
test('discovery works with no catalog or Meta, filters hallucinations and caches verified evidence', async () => {
  const ctx = context()
  const result = await discoverAccounts(ctx)
  assert.deepEqual(result.accounts.map(a => a.username), ['ordinary'])
  assert.equal(result.sourceStatus, 'public_search')
  assert.equal(result.accounts[0].followers, 100000)
  assert.equal(result.accounts[0].maxViews, 600000)
  assert.ok(ctx.stages.includes('verifying_public_accounts'))
  assert.ok(ctx.stages.includes('verifying_reach'))
  await publicAccountCandidates(ctx, new Set())
  assert.equal(ctx.calls.filter(c => c[0] === 'profiles').length, 1)
})
test('AI account-type verification excludes brands and unknown account types after numeric checks', async () => {
  const ctx = context()
  ctx.providers.searchAccounts = async () => ['person', 'commercialpage', 'unknownpage']
  ctx.providers.publicProfiles = async () => [profile('person'), profile('commercialpage'), profile('unknownpage')]
  ctx.providers.publicReels = async urls => urls.map(url => ({ input:{ url }, url, user_posted:url.match(/reel\/([^/]+)12/)?.[1], views:600000 }))
  ctx.providers.json = async () => ({ accounts: [
    { username:'person', accountType:'individual_creator', accountTypeEvidence:['개인 이름과 경험 중심'], categoryMatch:90 },
    { username:'commercialpage', accountType:'brand', accountTypeEvidence:['제품 브랜드'], categoryMatch:95 },
    { username:'unknownpage', accountType:'unknown', accountTypeEvidence:['근거 부족'], categoryMatch:85 },
  ] })
  const result = await discoverAccounts(ctx)
  assert.deepEqual(result.accounts.map(row => row.username), ['person'])
  assert.equal(result.accounts[0].accountType, 'individual_creator')
})
test('selected follower range and 500k reach are hard requirements', async () => {
  const ctx = context()
  ctx.job.input = { ...brief, accountSize:'50k_200k' }
  ctx.providers.publicProfiles = async () => [profile('too_small', { followers:4077 }), profile('qualified', { followers:50000 }), profile('too_large', { followers:200000 })]
  ctx.providers.searchAccounts = async () => ['too_small', 'qualified', 'too_large']
  ctx.providers.publicReels = async urls => urls.map(url => ({ input:{ url }, url, user_posted:url.includes('qualified12') ? 'qualified' : 'too_small', views:url.includes('qualified12') ? 500000 : 499999 }))
  ctx.providers.json = async () => ({ accounts:[{ username:'qualified', accountType:'individual_creator', accountTypeEvidence:['개인 경험 중심'], categoryMatch:90 }] })
  const result = await discoverAccounts(ctx)
  assert.deepEqual(result.accounts.map(row => row.username), ['qualified'])
  assert.equal(result.accounts[0].followers, 50000)
  assert.equal(result.accounts[0].maxViews, 500000)
})
test('one failed top-result query does not erase verified candidates and exclusions cannot leak through cache', async () => {
  const ctx = context(); let fail = true
  const search = ctx.providers.searchAccounts
  ctx.providers.searchAccounts = async (...args) => { if (fail) { fail = false; throw new Error('network') }; return search(...args) }
  assert.equal((await publicAccountCandidates(ctx, new Set())).length, 1)
  assert.equal(ctx.calls.filter(c => c[0] === 'search').length, 3)
  assert.deepEqual(await publicAccountCandidates(ctx, new Set(['ordinary'])), [])
})
test('profile collection has a separate receipt and bounded batch input', async () => {
  const calls = [], keys = []
  const records = await collectDataset({ input: [{ url: 'https://instagram.com/ordinary/' }], dataset: 'gd_l1vikfch901nx3by4', receiptKey: 'accountProfilesReceipt',
    checkpoint: async (key, fn) => { keys.push(key); return fn() },
    request: async (operation, path, options) => { calls.push({ operation, path, options }); return operation === 'trigger' ? { snapshot_id: 'sd_profile' } : operation === 'progress' ? { status: 'ready' } : [profile('ordinary')] } })
  assert.deepEqual(keys, ['accountProfilesReceipt']); assert.equal(records.length, 1)
  assert.match(calls[0].path, /gd_l1vikfch901nx3by4/)
  assert.equal(JSON.parse(calls[0].options.body)[0].url, 'https://instagram.com/ordinary/')
})
test('worker concurrency is explicit and bounded; default stays at one', () => {
  assert.equal(workerConcurrency({}), 1); assert.equal(workerConcurrency({ CREATOR_WORKER_CONCURRENCY: '4' }), 4)
  for (const value of ['100', '0', '-1', 'NaN', '1.5']) assert.throws(() => workerConcurrency({ CREATOR_WORKER_CONCURRENCY: value }))
})
