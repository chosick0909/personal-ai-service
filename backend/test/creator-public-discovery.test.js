import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { accountSearchQueries, profileUsername, searchProfiles, normalizePublicProfiles, normalizePublicReels, normalizeRecentPublicReels, mergeRecentPublicReels, publicAccountCandidates, obviousNonReferenceAccount } from '../src/creator-tools/public-discovery.js'
import { CREATOR_CATEGORIES, REFERENCE_CATEGORIES } from '../src/creator-tools/categories.js'
import { normalizeBrief } from '../src/creator-tools/domain.js'
import { discoverAccounts } from '../src/creator-tools/discovery.js'
import { workerConcurrency } from '../src/creator-tools/queue.js'
import { collectDataset } from '../src/creator-tools/brightdata.js'
import { referencePerformance, hardReferenceMetrics, REFERENCE_QUALITY_VERSION, catalogQualityEligible, referenceReviewSchema } from '../src/creator-tools/reference-quality.js'
import { normalizeReviewedCatalog, reviewRecord } from '../src/creator-tools/reference-catalog.js'
import { seedPlan, createSeedBudget, requireSeedApproval } from '../src/creator-tools/reference-seed-budget.js'
import { createProviders } from '../src/creator-tools/providers.js'

const brief = { topic: '작은 집 수납', targetAudience: '자취 직장인', category: '살림/인테리어', contentGoal: '교육', region: 'KR', searchPage: 0,
  faceVisibility: 'any', contentFormat: 'any', accountSize: 'any', recentActivity: 'any', contentLanguage: 'ko',
  trendGoal:'education', audienceLevel:'beginner', keywordScope:'balanced', contentStructure:'howto', excludeAccounts: [] }
const now = Date.parse('2026-09-16T00:00:00Z')
const samplePosts = (account, views) => Array.from({ length:12 }, (_, i) => ({ url:`https://www.instagram.com/reel/${account}12${i ? `_${i}` : ''}/`, caption:'자취방 수납법', datetime:new Date(now - (i + 2) * 86400000).toISOString(), likes:0, comments:null, content_type:'Video', ...(views === undefined ? {} : { views }) }))
const profile = (account, extra = {}) => ({ account, url: `https://www.instagram.com/${account}/`, is_private: false, is_professional_account: true,
  biography: '작은 집 정리 방법을 소개합니다.', followers: 100000, posts_count: 12,
  posts: samplePosts(account), ...extra })

const quality = (name, extra = {}) => ({ domesticCreator:true, domesticCreatorEvidence:['국내 거주·국내 소비자 대상 사용 경험'], ordinaryCreator:true, ordinaryCreatorEvidence:['개인의 일상과 직접 경험'],
  productionLevel:'personal', productionEvidence:['집에서 스마트폰으로 촬영한 사용법'], replicability:85, replicabilityEvidence:['일상 소품만 필요'],
  monetizationEvidence:['협찬 표기'], monetizationSourceUrls:[`https://www.instagram.com/reel/${name}12/`],
  evidencePostUrls:[`https://www.instagram.com/reel/${name}12/`], ...extra })
const reviewedProfile = () => ({ qualityVersion:REFERENCE_QUALITY_VERSION, reviewedByOperator:true, reviewedBy:'test-operator', reviewedAt:new Date().toISOString() })

test('reference and trend discovery accept only bounded selection values', () => {
  assert.equal(CREATOR_CATEGORIES.length, 16)
  for (const category of REFERENCE_CATEGORIES) assert.equal(normalizeBrief({ ...brief, category }, 'reference-accounts').category, category)
  for (const category of REFERENCE_CATEGORIES) assert.equal(normalizeBrief({ ...brief, category }, 'trend-keywords').category, category)
  assert.throws(() => normalizeBrief({ ...brief, category: 'made up' }), { code: 'INVALID_CATEGORY' })
  assert.deepEqual(normalizeBrief(brief, 'reference-accounts'), { category:'살림/인테리어', faceVisibility:'any', accountSize:'any', contentLanguage:'ko', region:'GLOBAL' })
  assert.throws(() => normalizeBrief({ ...brief, accountSize:'under_10k' }, 'reference-accounts'), { code:'INVALID_FILTER' })
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
test('verified view counts embedded in a matched public profile avoid a second reel lookup', async () => {
  const rows = normalizePublicProfiles([profile('ordinary', { posts:[{ url:'https://www.instagram.com/reel/ordinary12/', datetime:'2026-09-14', views:500000 }] })], ['ordinary'], now)
  assert.equal(rows[0].profile.maxViews, 500000)
  assert.deepEqual(rows[0].profile.viralMedia, { permalink:'https://www.instagram.com/reel/ordinary12/', views:500000 })
})
test('clear brand and official-account signals are rejected without excluding an individual business account', () => {
  assert.equal(obviousNonReferenceAccount(profile('kahi_official'), 'kahi_official'), true)
  assert.equal(obviousNonReferenceAccount(profile('shop', { account:'ordinary_shop', full_name:'정리 상점' }), 'ordinary_shop'), true)
  assert.equal(obviousNonReferenceAccount(profile('brand', { account:'plainname', category_name:'Product/Service' }), 'plainname'), true)
  assert.equal(obviousNonReferenceAccount(profile('creator', { account:'jiwoo.home', is_business_account:true, full_name:'김지우', biography:'두 아이 엄마의 정리 기록' }), 'jiwoo.home'), false)
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
  assert.deepEqual(rows, [{ username:'ordinary', permalink:'https://www.instagram.com/reel/CANONICAL/', views:700000, reels:[{ requestedPermalink:'https://www.instagram.com/reel/ordinary12/', permalink:'https://www.instagram.com/reel/CANONICAL/', views:700000 }] }])
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
      json: async () => ({ accounts: [{ username: 'ordinary', ...quality('ordinary'), accountType:'individual_creator', accountTypeEvidence:['개인의 경험과 관점이 확인됨'], categoryMatch:95, reasons: ['수납 주제'], referencePoints: ['정리 순서'] }, { username: 'hallucinated', accountType:'individual_creator', categoryMatch:100 }] }) }, calls, stages }
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
    { username:'person', ...quality('person'), accountType:'individual_creator', accountTypeEvidence:['개인 이름과 경험 중심'], categoryMatch:90 },
    { username:'commercialpage', accountType:'brand', accountTypeEvidence:['제품 브랜드'], categoryMatch:95 },
    { username:'unknownpage', accountType:'unknown', accountTypeEvidence:['근거 부족'], categoryMatch:85 },
  ] })
  const result = await discoverAccounts(ctx)
  assert.deepEqual(result.accounts.map(row => row.username), ['person'])
  assert.equal(result.accounts[0].accountType, 'individual_creator')
})
test('five fresh prepared creators return without paid discovery or ranking calls', async () => {
  const ctx = context(), nowIso = new Date().toISOString(), writes = []
  const rows = Array.from({ length:5 }, (_, index) => ({ username:`prepared${index}`, active:true, professional:true,
    verified_at:nowIso, last_active_at:nowIso, profile:{ ...normalizePublicProfiles([profile(`prepared${index}`, {posts:samplePosts(`prepared${index}`, 600000)})], [`prepared${index}`])[0].profile,
      ...reviewedProfile(), accountType:'individual_creator', categories:['살림/인테리어'], maxViews:600000,
      viralMedia:{ permalink:`https://www.instagram.com/reel/prepared${index}12/`, views:600000 },
      accountInsights:{ '살림/인테리어':{ ...quality(`prepared${index}`), accountType:'individual_creator', accountTypeEvidence:['개인 경험 중심'], categoryMatch:90,
        faceVisibility:'mixed', contentFormats:['talking'], language:'ko', reasons:['정리 경험을 설명함'], referencePoints:['설명 순서를 확인'] } } } }))
  const chain = data => ({ select(){return this}, eq(){return this}, gte(){return this}, order(){return this}, limit:async()=>({data,error:null}),
    upsert:async payload => { writes.push(payload); return {data:payload,error:null} } })
  ctx.db = { from(table) { return table === 'creator_account_preferences' ? { select(){ return { eq:async()=>({data:[],error:null}) } } } : chain(rows) } }
  ctx.providers.searchAccounts = async () => { throw new Error('paid search must not run') }
  ctx.providers.publicProfiles = async () => { throw new Error('paid profiles must not run') }
  ctx.providers.publicReels = async () => { throw new Error('paid reels must not run') }
  ctx.providers.json = async () => { throw new Error('paid ranking must not run') }
  const result = await discoverAccounts(ctx)
  assert.deepEqual(result.accounts.map(row => row.username), rows.map(row => row.username))
  assert.match(result.message, /사전 검증된 계정 풀/)
  assert.equal(writes.length, 0)
})
test('every remaining home filter combination returns reviewed catalog accounts without paid discovery', async () => {
  const fixedNow = Date.parse('2026-09-20T04:00:00Z')
  const reviewed = JSON.parse(readFileSync(new URL('../catalog/home-2026-09-20.reviewed.json', import.meta.url)))
  const catalog = normalizeReviewedCatalog(reviewed, fixedNow)
  const originalNow = Date.now
  Date.now = () => fixedNow
  try {
    for (const accountSize of ['any', '10k_50k', '50k_100k', '100k_200k', 'over_200k']) {
      for (const faceVisibility of ['any', 'visible', 'mixed', 'hidden']) {
        for (const contentLanguage of ['any', 'ko', 'en', 'ja']) {
          const ctx = context()
          ctx.job.input = normalizeBrief({ category:'살림/인테리어', accountSize, faceVisibility, contentLanguage }, 'reference-accounts')
          ctx.db = { from(table) {
            if (table === 'creator_account_preferences') return { select(){ return { eq:async()=>({data:[],error:null}) } } }
            return { select(){return this}, eq(){return this}, gte(){return this}, order(){return this}, limit:async()=>({data:catalog,error:null}) }
          } }
          ctx.providers.searchAccounts = async () => assert.fail('reviewed home pool must not run paid discovery')
          ctx.providers.publicProfiles = async () => assert.fail('reviewed home pool must not fetch profiles')
          ctx.providers.publicReels = async () => assert.fail('reviewed home pool must not fetch reels')
          ctx.providers.json = async () => assert.fail('reviewed home pool must not rerank')
          const result = await discoverAccounts(ctx)
          assert.ok(result.accounts.length > 0, `${accountSize}/${faceVisibility}/${contentLanguage}`)
          assert.ok(result.accounts.every(account => account.followers >= 10000))
          if (accountSize === '10k_50k') assert.ok(result.accounts.every(account => account.followers < 50000))
          if (accountSize === '50k_100k') assert.ok(result.accounts.every(account => account.followers >= 50000 && account.followers < 100000))
          if (accountSize === '100k_200k') assert.ok(result.accounts.every(account => account.followers >= 100000 && account.followers < 200000))
          if (accountSize === 'over_200k') assert.ok(result.accounts.every(account => account.followers >= 200000))
        }
      }
    }
  } finally { Date.now = originalNow }
})
test('selected follower range and 500k reach are hard requirements', async () => {
  const ctx = context()
  ctx.job.input = { ...brief, accountSize:'50k_100k' }
  ctx.providers.publicProfiles = async () => [profile('too_small', { followers:4077 }), profile('qualified', { followers:50000 }), profile('too_large', { followers:200000 })]
  ctx.providers.searchAccounts = async () => ['too_small', 'qualified', 'too_large']
  ctx.providers.publicReels = async urls => urls.map(url => ({ input:{ url }, url, user_posted:url.includes('qualified12') ? 'qualified' : 'too_small', views:url.includes('qualified12') ? 500000 : 499999 }))
  ctx.providers.json = async () => ({ accounts:[{ username:'qualified', ...quality('qualified'), accountType:'individual_creator', accountTypeEvidence:['개인 경험 중심'], categoryMatch:90 }] })
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
  assert.ok(ctx.calls.some(c => c[0] === 'search' && c[2] === 4), 'search expands through later pages when fewer than 12 verified accounts remain')
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

test('SERP metadata excludes celebrity, agency, MCN and media before paid profile collection', () => {
  const descriptions = ['배우 소속사 XX', 'MCN 소속 전업 크리에이터', 'Business contact: agency@example.test',
    'Fashion model represented by ABC', '매거진 뉴스 큐레이션', '프로 운동선수', '방송인 데뷔 2010']
  assert.deepEqual(searchProfiles({ organic:descriptions.map((description, i) => ({ link:`https://instagram.com/person${i}/`, description })) }), [])
  assert.deepEqual(searchProfiles({ organic:[{ link:'https://instagram.com/person/', title:'두 아이 엄마', description:'내돈내산 리뷰, 협찬, 공동구매' }] }), ['person'])
  const queries = accountSearchQueries(brief).join(' ')
  for (const word of ['공동구매','내돈내산','체험단','협찬','스마트스토어']) assert.ok(queries.includes(word))
})
test('profile signatures are removed before paid reach and ranking calls', async () => {
  const ctx = context(), reached = [], ranked = []
  ctx.providers.searchAccounts = async () => ['actorperson', 'agency_person', 'mcn_person', 'magperson', 'normalperson']
  ctx.providers.publicProfiles = async () => [profile('actorperson', { biography:'배우 출연작' }), profile('agency_person', { biography:'비즈니스 문의: 소속사' }),
    profile('mcn_person', { biography:'MCN 크리에이터' }), profile('magperson', { category_name:'Magazine' }), profile('normalperson')]
  ctx.providers.publicReels = async urls => {
    reached.push(...urls)
    return urls.map(url => ({ input:{url}, url, user_posted:'normalperson', views:500000 }))
  }
  ctx.providers.json = async (_operation, prompt, input, _frames, schema) => {
    ranked.push(...input.candidates.map(row => row.username))
    assert.equal(schema, referenceReviewSchema); assert.match(prompt, /외모.*절대 평가하지/)
    return { accounts:[] }
  }
  await discoverAccounts(ctx)
  assert.deepEqual(ranked, ['normalperson'])
  assert.ok(reached.length > 0 && reached.every(url => url.includes('normalperson12')))
})
test('ordinary false/null, professional/unknown production and incomplete reviews fail closed', async () => {
  for (const extra of [{ domesticCreator:false }, { domesticCreator:null }, { domesticCreator:undefined }, { domesticCreatorEvidence:[] }, { ordinaryCreator:false }, { ordinaryCreator:null }, { productionLevel:'professional' }, { productionLevel:'unknown' },
    { ordinaryCreator:undefined }, { monetizationEvidence:undefined }, { replicability:101 }, { productionEvidence:[] },
    { evidencePostUrls:['https://www.instagram.com/reel/invented/'] }]) {
    const ctx = context()
    ctx.providers.json = async () => ({ accounts:[{ username:'ordinary', accountType:'individual_creator', accountTypeEvidence:['경험 중심'], ...quality('ordinary', extra) }] })
    const result = await discoverAccounts(ctx)
    assert.equal(result.accounts.length, 0, JSON.stringify(extra))
    assert.equal(result.sourceStatus, 'no_verified_match')
  }
})
test('missing monetization evidence costs 35 points, without exclusion', async () => {
  const make = monetized => {
    const ctx = context()
    ctx.providers.json = async () => ({ accounts:[{ username:'ordinary', accountType:'individual_creator', accountTypeEvidence:['직접 경험'], categoryMatch:90,
      ...quality('ordinary', monetized ? {} : { monetizationEvidence:[], monetizationSourceUrls:[] }) }] })
    return ctx
  }
  const yes = await discoverAccounts(make(true)), no = await discoverAccounts(make(false))
  assert.equal(no.accounts.length, 1)
  assert.equal(yes.accounts[0].matchScore - no.accounts[0].matchScore, 35)
})
test('numeric hard filters survive even an approving model', async () => {
  for (const followers of [9999, 50000]) {
    const ctx = context(); ctx.job.input = { ...brief, accountSize:'10k_50k' }
    ctx.providers.publicProfiles = async () => [profile('ordinary', { followers })]
    ctx.providers.publicReels = async () => { assert.fail('out-of-range followers must not cost a reach call') }
    assert.equal((await discoverAccounts(ctx)).accounts.length, 0)
  }
  const ctx = context()
  ctx.providers.publicReels = async urls => urls.map(url => ({ input:{url}, url, user_posted:'ordinary', views:499999 }))
  ctx.providers.json = async () => { assert.fail('low reach must not cost a rank call') }
  assert.equal((await discoverAccounts(ctx)).accounts.length, 0)
})
function reviewFixture() {
  const row = normalizePublicProfiles([profile('ordinary', { posts:samplePosts('ordinary',600000) })], ['ordinary'])[0]
  const rank = { username:'ordinary', accountType:'individual_creator', accountTypeEvidence:['직접 경험'], ...quality('ordinary') }
  return reviewRecord(row, rank, brief.category)
}
test('catalog import round-trips all metrics, insights and operator evidence; unreviewed/legacy entries are rejected', () => {
  const record = reviewFixture()
  assert.equal(record.reviewedByOperator, false)
  assert.throws(() => normalizeReviewedCatalog([record]))
  Object.assign(record, { reviewedByOperator:true, reviewedBy:'operator', reviewedAt:new Date().toISOString() })
  const [stored] = normalizeReviewedCatalog([record])
  assert.equal(catalogQualityEligible(stored, brief.category), true)
  assert.deepEqual(stored.profile.accountInsights, record.profile.accountInsights)
  assert.equal(stored.profile.maxViews, 600000)
  assert.equal(stored.profile.reviewedBy, 'operator')
  for (const extra of [{ reviewedByOperator:false }, { reviewedAt:null }, { reviewedBy:'' }, { reviewedAt:'2099-01-01' }]) {
    assert.throws(() => normalizeReviewedCatalog([{ ...record, ...extra }]))
  }
  for (const extra of [{ qualityVersion:undefined }, { accountInsights:{} }, { maxViews:499999 }, { followers:9999 }, { biography:'MCN 소속' }]) {
    const mutated = { ...record, profile:{ ...record.profile, ...extra } }
    assert.throws(() => normalizeReviewedCatalog([mutated]))
    assert.equal(catalogQualityEligible({ ...stored, profile:{ ...stored.profile, ...extra } }, brief.category), false)
  }
  assert.throws(() => normalizeReviewedCatalog([{ ...record, verifiedAt:'2020-01-01' }]))
})
test('old ranking entries and unsafe/stale search or category cache entries never bypass quality', async () => {
  const ctx = context()
  const realGet = ctx.redis.get
  ctx.redis.get = async key => key.startsWith('creator:ranking:') ? JSON.stringify({ accounts:[{ username:'ordinary', accountType:'individual_creator' }] }) : realGet(key)
  assert.equal((await discoverAccounts(ctx)).accounts.length, 0)
  for (const cache of ['creator:public-search:', 'creator:verified-category-pool:']) {
    const testCtx = context(), record = reviewFixture()
    const bad = { username:'ordinary', verified_at:record.verifiedAt, last_active_at:record.lastActiveAt, profile:{ ...record.profile, biography:'MCN 소속' } }
    testCtx.redis.get = async key => key.startsWith(cache) ? JSON.stringify([bad, { ...bad, profile:record.profile, verified_at:'2020-01-01' }, null]) : null
    testCtx.providers.searchAccounts = async () => []
    testCtx.providers.publicProfiles = async () => { assert.fail('no candidate') }
    testCtx.providers.publicReels = async () => { assert.fail('cache must be rejected before reach') }
    assert.deepEqual(await publicAccountCandidates(testCtx, new Set()), [])
  }
})
const seedEnv = { CREATOR_CATALOG_SEARCH_USD:'0.01', CREATOR_CATALOG_PROFILE_USD:'0.02', CREATOR_CATALOG_REEL_USD:'0.03', CREATOR_CATALOG_RANK_USD:'0.1' }
test('paid seeding requires a matching displayed plan and explicit execute; invalid cost config fails closed', () => {
  const plan = seedPlan([brief.category], seedEnv)
  assert.ok(plan.scenarios[0].estimatedCalls > 0); assert.ok(plan.scenarios[0].estimatedUsd > 0)
  assert.throws(() => requireSeedApproval(['--execute'], plan))
  assert.throws(() => requireSeedApproval([`--approve=${plan.approval}`], plan))
  assert.doesNotThrow(() => requireSeedApproval(['--execute', `--approve=${plan.approval}`], plan))
  assert.throws(() => requireSeedApproval(['--execute', `--approve=${plan.approval}`], seedPlan([brief.category], { ...seedEnv, CREATOR_CATALOG_CATEGORY_MAX_USD:'1' })))
  for (const value of ['0','-1','NaN','Infinity']) assert.throws(() => seedPlan([brief.category], { ...seedEnv, CREATOR_CATALOG_CATEGORY_MAX_USD:value }))
  assert.throws(() => seedPlan([brief.category], {}))
})
test('category budgets reserve batch cost before requests and stop at call/cost limits', async () => {
  const plan = seedPlan([brief.category], { ...seedEnv, CREATOR_CATALOG_CATEGORY_MAX_USD:'0.2', CREATOR_CATALOG_CATEGORY_MAX_CALLS:'2' })
  const budget = createSeedBudget(plan)
  budget.beforeCall({ provider:'brightdata', operation:'profiles-trigger', units:10 })
  assert.throws(() => budget.beforeCall({ provider:'brightdata', operation:'profiles-progress' }), { code:'SEED_BUDGET' })
  assert.deepEqual(budget.summary(), { calls:1, reservedUsd:0.2 })
  const calls = createSeedBudget({ ...plan, maxUsdPerCategory:10 })
  calls.beforeCall({ provider:'brightdata', operation:'account-search' })
  calls.beforeCall({ provider:'brightdata', operation:'account-search' })
  assert.throws(() => calls.beforeCall({ provider:'brightdata', operation:'account-search' }), { code:'SEED_BUDGET' })
  for (const code of ['SEED_BUDGET', 'PROVIDER_BUDGET', 'PROVIDER_CIRCUIT_OPEN']) {
    const ctx = context(); let requests = 0
    ctx.providers.searchAccounts = async () => { requests += 1; throw Object.assign(new Error('stop'), { code }) }
    await assert.rejects(discoverAccounts(ctx), { code }); assert.equal(requests, 1)
  }
})
test('seed reservations compose with existing provider daily limit and circuit breaker', async () => {
  let requested = 0, guarded = 0
  const setup = (circuit, daily) => createProviders({ job:{id:null}, db:{ from:() => ({ insert:async () => ({error:null}) }) },
    redis:{ get:async()=>circuit, incr:async()=>daily, expire:async()=>{}, del:async()=>{} },
    beforeCall:() => { guarded += 1; throw Object.assign(new Error('cap'), { code:'SEED_BUDGET' }) } })
  for (const [circuit, daily, code] of [[5, 1, 'PROVIDER_CIRCUIT_OPEN'], [0, 1e9, 'PROVIDER_BUDGET'], [0, 1, 'SEED_BUDGET']]) {
    await assert.rejects(setup(circuit, daily).call('brightdata', 'account-search', async () => { requested += 1 }), { code })
  }
  assert.equal(guarded, 1); assert.equal(requested, 0)
})

test('live discovery never writes catalog, and legacy/unreviewed catalog rows cannot suppress live search', async () => {
  const ctx = context(); let writes = 0
  const record = reviewFixture()
  const legacy = Array.from({length:5}, (_, i) => ({ username:`old${i}`, active:true, professional:true,
    verified_at:record.verifiedAt, last_active_at:record.lastActiveAt, profile:{ ...record.profile, reviewedByOperator:false } }))
  ctx.db = { from(table) {
    if (table === 'creator_account_preferences') return { select(){ return { eq:async()=>({data:[],error:null}) } } }
    return { select(){return this}, eq(){return this}, gte(){return this}, order(){return this}, limit:async()=>({data:legacy,error:null}),
      upsert:async()=>{ writes += 1; return {data:[],error:null} } }
  } }
  const result = await discoverAccounts(ctx)
  assert.deepEqual(result.accounts.map(row => row.username), ['ordinary'])
  assert.ok(ctx.calls.some(call => call[0] === 'search'))
  assert.equal(writes, 0)
})
test('valid raw Redis evidence still requires current quality review; false ordinary is never cached approval', async () => {
  const ctx = context(), record = reviewFixture()
  const row = { username:'ordinary', verified_at:record.verifiedAt, last_active_at:record.lastActiveAt, profile:record.profile }
  ctx.redis.get = async key => key.startsWith('creator:public-search:') ? JSON.stringify([row]) : null
  ctx.providers.searchAccounts = async () => assert.fail('valid evidence avoids search')
  let reviews = 0
  ctx.providers.json = async () => { reviews += 1; return { accounts:[{ ...record.profile.accountInsights[brief.category], ordinaryCreator:false }] } }
  assert.equal((await discoverAccounts(ctx)).accounts.length, 0)
  assert.equal(reviews, 1)
})
test('guard errors during reach and ranking are not converted to empty success', async () => {
  for (const operation of ['publicReels', 'json']) {
    const ctx = context()
    ctx.providers[operation] = async () => { throw Object.assign(new Error('stop'), {code:'SEED_BUDGET'}) }
    await assert.rejects(discoverAccounts(ctx), {code:'SEED_BUDGET'})
  }
})

test('live profile/reel adapters use the documented request when projection is rejected by the provider', async () => {
  const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = await import('undici')
  const previous = getGlobalDispatcher(), agent = new MockAgent()
  const savedKey = process.env.BRIGHT_DATA_API_KEY
  process.env.BRIGHT_DATA_API_KEY = 'test-only-key'
  agent.disableNetConnect(); setGlobalDispatcher(agent)
  const seen = []
  const pool = agent.get('https://api.brightdata.com')
  for (const dataset of ['gd_l1vikfch901nx3by4','gd_lyclm20il4r5helnj']) {
    pool.intercept({ method:'POST', path:path => {
      const url = new URL(path, 'https://api.brightdata.com')
      if (url.pathname !== '/datasets/v3/trigger' || url.searchParams.get('dataset_id') !== dataset) return false
      if (url.searchParams.has('custom_output_fields')) return false
      seen.push(dataset); return true
    } }).reply(200, {snapshot_id:`sd_${dataset}`})
    pool.intercept({method:'GET',path:`/datasets/v3/progress/sd_${dataset}`}).reply(200,{status:'ready'})
    pool.intercept({method:'GET',path:`/datasets/v3/snapshot/sd_${dataset}?format=json`}).reply(200,[])
  }
  const providers = createProviders({ job:{id:null}, db:{from:()=>({insert:async()=>({error:null})})},
    redis:{get:async()=>0,incr:async()=>1,expire:async()=>{},del:async()=>{}} })
  try {
    const checkpoint = async (_key, fn) => fn()
    await providers.publicProfiles(['ordinary'], checkpoint)
    await providers.publicReels(['https://www.instagram.com/reel/ordinary12/'], checkpoint)
    agent.assertNoPendingInterceptors()
    assert.ok(seen.includes('gd_l1vikfch901nx3by4') && seen.includes('gd_lyclm20il4r5helnj'))
  } finally {
    setGlobalDispatcher(previous); await agent.close()
    if (savedKey === undefined) delete process.env.BRIGHT_DATA_API_KEY
    else process.env.BRIGHT_DATA_API_KEY = savedKey
  }
})
test('seeding configuration failures abort rather than searching more pages', async () => {
  const ctx = context(); let calls = 0
  ctx.providers.publicProfiles = async () => { calls += 1; throw Object.assign(new Error('bad projection'), {code:'SEED_PROVIDER_CONFIG'}) }
  await assert.rejects(discoverAccounts(ctx), {code:'SEED_PROVIDER_CONFIG'})
  assert.equal(calls, 1)
})


test('operator exclusions apply before paid profiles and also reject old catalog/cache evidence', async () => {
  const ctx = context()
  ctx.providers.searchAccounts = async () => ['karennppo', 'love1004kgj']
  ctx.providers.publicProfiles = async () => assert.fail('operator exclusions must not cost a profile request')
  assert.deepEqual(await publicAccountCandidates(ctx, new Set()), [])
  for (const name of ['karennppo', 'love1004kgj']) assert.equal(obviousNonReferenceAccount({}, name), true)
})
test('reference search is Korean targeted even for a legacy GLOBAL request', async () => {
  assert.ok(accountSearchQueries(brief).every(q => q.includes('한국') && !q.includes('sponsored')))
  const ctx = context(); ctx.job.input = { ...brief, region:'GLOBAL' }
  ctx.providers.searchAccounts = async (_q, region) => { assert.equal(region, 'KR'); return [] }
  assert.deepEqual(await publicAccountCandidates(ctx, new Set()), [])
})
test('recent twelve median prevents a single viral outlier from qualifying, with inclusive 10000 boundary', () => {
  const row = normalizePublicProfiles([profile('ordinary', { posts:samplePosts('ordinary', 9999).map((p,i) => ({ ...p, views:i ? 9999 : 900000 })) })], ['ordinary'])[0]
  assert.equal(referencePerformance(row.profile).medianViews, 9999)
  assert.equal(hardReferenceMetrics(row.profile), false)
  row.profile.recentReels = row.profile.recentReels.map((p,i) => ({ ...p, views:i ? 10000 : 900000 }))
  assert.equal(referencePerformance(row.profile).medianViews, 10000)
  assert.equal(hardReferenceMetrics(row.profile), true)
  row.profile.recentReels[1].views = null
  assert.equal(referencePerformance(row.profile).medianViews, null)
  assert.equal(hardReferenceMetrics(row.profile), false)
})
test('performance uses dates and distinct reels, includes zero and excludes a thirteenth older hit', () => {
  const recentReels = samplePosts('ordinary', 0).map(p => ({ permalink:p.url, timestamp:p.datetime, views:p.views }))
  const old = { permalink:'https://www.instagram.com/reel/old/', timestamp:'2025-01-01', views:9999999 }
  assert.equal(referencePerformance({recentReels:[old,...recentReels].reverse()}).medianViews,0)
  assert.equal(referencePerformance({recentReels:[...recentReels.slice(0,11),recentReels[0]]}).status,'insufficient_data')
})
test('reel collection retains all twelve measurements and filters low baseline before LLM', async () => {
  const ctx = context()
  const evidence = []
  ctx.reviewEvidence = async rows => evidence.push(...rows)
  ctx.providers.publicReels = async urls => urls.map((url,i) => ({input:{url},url,user_posted:'ordinary',views:i ? 100 : 900000}))
  ctx.providers.json = async () => assert.fail('a one-hit account must not cost a model call')
  assert.equal((await discoverAccounts(ctx)).accounts.length,0)
  const latest = evidence.at(-1)
  assert.equal(referencePerformance(latest.profile).medianViews,100)
  assert.equal(reviewRecord(latest, null, brief.category).automaticDecision,'rejected_or_unknown')
})

test('previous catalog approval cannot bypass domestic evidence or revised median requirement', () => {
  const record = reviewFixture()
  Object.assign(record, {reviewedByOperator:true, reviewedBy:'operator', reviewedAt:new Date().toISOString()})
  for (const profile of [
    {...record.profile, qualityVersion:1},
    {...record.profile, recentReels:record.profile.recentReels.map((p,i) => ({...p,views:i ? 100 : 600000}))},
    {...record.profile, accountInsights:{[brief.category]:{...record.profile.accountInsights[brief.category], domesticCreator:null}}},
  ]) assert.throws(() => normalizeReviewedCatalog([{...record,profile}]))
})

test('known low median and insufficient reel samples do not spend on extra reach requests', async () => {
  for (const posts of [samplePosts('ordinary',100),samplePosts('ordinary').slice(0,11)]) {
    const ctx = context()
    ctx.providers.publicProfiles = async () => [profile('ordinary',{posts})]
    ctx.providers.publicReels = async () => assert.fail('known low or insufficient sample must not cost another request')
    assert.equal((await discoverAccounts(ctx)).accounts.length,0)
  }
})

test('bounded recent-reel discovery requests twenty-four per profile without unsupported date filters', async () => {
  const calls=[]
  await collectDataset({input:[{url:'https://www.instagram.com/ordinary/'}],dataset:'gd_lyclm20il4r5helnj',discoveryBy:'url_all_reels',receiptKey:'recent',
    checkpoint:async(_key,fn)=>fn(),request:async(op,path,options)=>{calls.push({op,path,options});return op==='trigger'?{snapshot_id:'recent12'}:op==='progress'?{status:'ready'}:[]}})
  assert.match(calls[0].path,/type=discover_new&discover_by=url_all_reels/)
  assert.deepEqual(JSON.parse(calls[0].options.body),{input:[{url:'https://www.instagram.com/ordinary/',num_of_posts:24}],limit_per_input:24})
})
const discoveredReels = (name='ordinary',views=20000) => Array.from({length:12},(_,i)=>({
  url:`https://www.instagram.com/reel/${name}recent${i}/`,user_posted:name,input:{url:`https://www.instagram.com/${name}/`},
  description:'집에서 직접 사용하는 살림용품',views:i ? views : 600000,date_posted:new Date(now - i*86400000).toISOString(),
}))
test('provider recent selection requires publication dates and never invents timestamps', () => {
  const [evidence]=normalizeRecentPublicReels(discoveredReels(),['ordinary'])
  const row=normalizePublicProfiles([profile('ordinary')],['ordinary'])[0]
  const enriched=mergeRecentPublicReels(row,evidence)
  const stats=referencePerformance(enriched.profile)
  assert.equal(stats.medianViews,20000);assert.equal(stats.selection,'provider_recent_reels')
  assert.ok(stats.samples.every(s=>s.timestamp !== null))
  assert.equal(referencePerformance({...enriched.profile,recentReels:enriched.profile.recentReels.map(s=>({...s,timestamp:null}))}).status,'insufficient_data')
  assert.equal(hardReferenceMetrics(enriched.profile),true)
  assert.equal(hardReferenceMetrics({...enriched.profile,recentReelsSelection:{...enriched.profile.recentReelsSelection,requestedCount:12}}),false)
  assert.equal(hardReferenceMetrics({...enriched.profile,recentReels:enriched.profile.recentReels.slice(0,11)}),false)
})
test('recent-reel discovery rejects unsolicited owners, mismatched inputs and oversized responses', () => {
  assert.deepEqual(normalizeRecentPublicReels(discoveredReels('someone_else'),['ordinary']),[])
  assert.deepEqual(normalizeRecentPublicReels(discoveredReels().map(r=>({...r,input:{url:'https://www.instagram.com/elsewhere/'}})),['ordinary']),[])
  assert.throws(()=>normalizeRecentPublicReels(Array.from({length:25},(_,i)=>({...discoveredReels()[0],url:`https://www.instagram.com/reel/extra${i}/`})),['ordinary']),{code:'PROFILE_REELS_LIMIT'})
})
test('mixed profile posts fall back to bounded recent-reel discovery and keep all view evidence for review', async () => {
  const ctx=context();const seen=[]
  ctx.providers.publicProfiles=async()=>[profile('ordinary',{posts:samplePosts('ordinary').slice(0,3)})]
  ctx.providers.recentPublicReels=async names=>{assert.deepEqual(names,['ordinary']);return discoveredReels()}
  ctx.providers.publicReels=async()=>assert.fail('must not use a partial mixed-feed sample')
  ctx.reviewEvidence=async rows=>seen.push(...rows)
  const result=await publicAccountCandidates(ctx,new Set())
  assert.equal(result.length,1)
  assert.equal(referencePerformance(result[0].profile).medianViews,20000)
  assert.equal(seen.at(-1).profile.recentReels.length,12)
})
test('recent-reel discovery reserves twenty-four billable records per account before sending a request', async () => {
  const previous=process.env.BRIGHT_DATA_API_KEY
  process.env.BRIGHT_DATA_API_KEY='test-only'
  let reserved
  try {
    const providers=createProviders({db:{},job:{id:null},redis:{get:async()=>null,incr:async()=>1,expire:async()=>{}},
      beforeCall:async info=>{reserved=info;throw Object.assign(new Error('stop before network'),{code:'SEED_BUDGET'})}})
    await assert.rejects(providers.recentPublicReels(['one','two'],async(_name,fn)=>fn()),{code:'SEED_BUDGET'})
    assert.equal(reserved.units,48)
    assert.equal(reserved.operation,'account-reels-trigger')
  } finally {
    if(previous===undefined)delete process.env.BRIGHT_DATA_API_KEY;else process.env.BRIGHT_DATA_API_KEY=previous
  }
})

test('old pinned viral reels do not inflate the latest twelve median', () => {
  const recent=discoveredReels().map(r=>({...r,views:9000}))
  const pinned=[0,1,2].map(i=>({...recent[0],url:`https://www.instagram.com/reel/pinned${i}/`,date_posted:'2024-01-01',views:2000000}))
  const [evidence]=normalizeRecentPublicReels([...pinned,...recent],['ordinary'])
  const row=normalizePublicProfiles([profile('ordinary')],['ordinary'])[0]
  const enriched=mergeRecentPublicReels(row,evidence)
  const stats=referencePerformance(enriched.profile)
  assert.equal(stats.medianViews,9000)
  assert.equal(stats.samples.some(s=>s.permalink.includes('pinned')),false)
  assert.equal(hardReferenceMetrics(enriched.profile),false)
})

test('any follower range excludes sub-10k live and cached accounts before paid reach checks', async () => {
  const ctx = context()
  ctx.providers.publicProfiles = async () => [profile('ordinary', {followers:9999})]
  ctx.providers.publicReels = async () => assert.fail('sub-10k account must not cost a reach call')
  assert.equal((await discoverAccounts(ctx)).accounts.length, 0)
  for (const cache of ['creator:public-search:', 'creator:verified-category-pool:']) {
    const cached = context(), record = reviewFixture()
    cached.redis.get = async key => key.startsWith(cache) ? JSON.stringify([{username:record.username, verified_at:record.verifiedAt,
      last_active_at:record.lastActiveAt, profile:{...record.profile, followers:9999}}]) : null
    cached.providers.searchAccounts = async () => []
    cached.providers.publicReels = async () => assert.fail('sub-10k cache must not cost a reach call')
    assert.deepEqual(await publicAccountCandidates(cached, new Set()), [])
  }
  const allowed = context()
  allowed.providers.publicProfiles = async () => [profile('ordinary', {followers:10000})]
  assert.equal((await discoverAccounts(allowed)).accounts.length, 1)
})

test('reference seed polling intervals are bounded before any provider access', () => {
  for (const referencePollMs of [0, 9999, 60001, NaN, 10000.5]) {
    assert.throws(() => createProviders({referencePollMs}), /polling interval/)
  }
  assert.doesNotThrow(() => createProviders({referencePollMs:30000}))
})

// Shared policy must not inject the home-category pilot into unrelated searches.
test('reference searches keep the selected category without a home pilot keyword', () => {
  for (const category of ['뷰티/스킨케어', '운동/피트니스', '요리/레시피', '테크/가젯']) {
    const queries = accountSearchQueries({ ...brief, category })
    assert.ok(queries.every(query => query.includes(category.replaceAll('/', ' '))))
    assert.ok(queries.every(query => query.includes('한국') && !query.includes('살림')))
  }
})
