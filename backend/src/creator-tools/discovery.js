import { query } from './store.js'
import { stableHash } from './domain.js'
import { publicAccountCandidates } from './public-discovery.js'
import { referencePerformance, catalogQualityEligible, publicEvidenceEligible, hardReferenceMetrics, referenceQualityEligible, referenceQualityScore, referenceReviewPrompt, referenceReviewSchema, rethrowReferenceStop } from './reference-quality.js'

export function verifiedAccount(row, now = Date.now()) {
  return Boolean(row?.active && row.professional && publicEvidenceEligible(row, now)
    && row.profile.categories?.some(category => catalogQualityEligible(row, category, now)))
}
export function weightedScore(values, weights) {
  const available = Object.entries(weights).filter(([key]) => Number.isFinite(values[key]))
  const total = available.reduce((sum, [, weight]) => sum + weight, 0)
  return total ? Math.round(available.reduce((sum, [key, weight]) => sum + Math.max(0, Math.min(100, values[key])) * weight, 0) / total) : null
}
export function keywordResult(candidate, activity, now) {
  return { keyword: candidate.keyword, purpose: typeof candidate.purpose === 'string' ? candidate.purpose.slice(0, 500) : '', relatedKeywords: strings(candidate.relatedKeywords),
    postCount: null, countStatus: 'unavailable', trendScore: null, trendDirection: 'unavailable',
    source: activity?.status === 'available' ? 'Meta Instagram recent_media (sample only)' : 'AI keyword candidate; no verified trend data',
    sourceUrl: activity?.media?.[0]?.permalink || null,
    measuredAt: activity?.status === 'available' ? now : null,
    sampleSize: activity?.media?.length || 0, sourceStatus: activity?.status || 'not_connected' }
}
function strings(values) { return Array.isArray(values) ? values.filter((value) => typeof value === 'string').slice(0, 5).map((value) => value.slice(0, 500)) : [] }
const sizeMatches = (followers, choice) => {
  if (!Number.isSafeInteger(followers) || followers < 10000) return false
  return choice === 'any' ? true : choice === '10k_50k' ? followers < 50000
    : choice === '50k_200k' ? followers >= 50000 && followers < 200000
      : choice === 'over_200k' && followers >= 200000
}
const labels = {
  faceVisibility: { visible:'얼굴 자주 등장', hidden:'얼굴 비공개', mixed:'얼굴 일부 등장' },
  accountSize: { '10k_50k':'팔로워 1만~5만', '50k_200k':'팔로워 5만~20만', over_200k:'팔로워 20만 이상' },
  contentLanguage: { ko:'한국어', en:'영어', ja:'일본어' },
}
export async function discoverAccounts(ctx) {
  const { db, job, providers, stage, redis } = ctx
  const input = job.input
  await stage('finding_accounts')
  const preferences = await query(db.from('creator_account_preferences').select('username,preference').eq('user_id', job.user_id))
  const excluded = new Set([...(input.excludeAccounts || []), ...preferences.filter((p) => p.preference === 'excluded').map((p) => p.username)])
  let preparedRows = []
  try {
    const rows = await query(db.from('creator_reference_catalog').select('*').eq('active', true).eq('professional', true)
      .gte('verified_at', new Date(Date.now() - 30 * 86400000).toISOString()).order('verified_at', { ascending:false }).limit(200))
    preparedRows = rows.filter(row => verifiedAccount(row) && !excluded.has(row.username)
      && catalogQualityEligible(row, input.category))
      .map(row => ({ username:row.username, verified_at:row.verified_at, last_active_at:row.last_active_at,
        source:'사전 검증된 공개 계정 풀', profile:row.profile }))
  } catch { preparedRows = [] }
  const prepared = preparedRows.filter(row => sizeMatches(row.profile.followers, input.accountSize) === true
    && hardReferenceMetrics(row.profile))
  const reviewedPoolOnly = input.category === '살림/인테리어' && preparedRows.length > 0
  const discovered = prepared.length >= 5 || reviewedPoolOnly ? [] : await publicAccountCandidates(ctx, new Set([...excluded, ...prepared.map(row => row.username)]))
  const catalog = [...prepared, ...discovered].filter(row => publicEvidenceEligible(row)
    && sizeMatches(row.profile.followers, input.accountSize) === true
    && hardReferenceMetrics(row.profile))
  if (!catalog.length) return { accounts: [], sourceStatus: 'no_verified_match',
    message: '팔로워 범위·50만 이상 조회 콘텐츠·최근 릴스 12개 중앙값 1만 이상 조건을 확인한 계정이 없습니다.', metricsAsOf: null }
  await stage('ranking_accounts')
  const rankKey = `creator:ranking:v5:${stableHash([job.user_id, input, catalog])}`
  const cachedRanking = await redis.get(rankKey)
  const preparedRanking = prepared.flatMap(row => {
    const insight = row.profile?.accountInsights?.[input.category]
    return referenceQualityEligible(insight, row.profile) ? [{ ...insight, username:row.username }] : []
  })
  let ranking = null
  try { ranking = JSON.parse(cachedRanking || 'null') } catch { /* Re-rank malformed cache. */ }
  if (!Array.isArray(ranking?.accounts)) {
    const rankedNames = new Set(preparedRanking.map(item => item.username))
    const unrankedCatalog = catalog.filter(row => !rankedNames.has(row.username))
    const frameSources = unrankedCatalog.slice(0, 8).flatMap(row => row.profile.exampleMedia.filter(media => media.imageUrl).slice(0, 1)
      .map(media => ({ url: media.imageUrl, label: `@${row.username} 최근 공개 게시물 이미지 · ${media.permalink}` }))).slice(0, 8)
    const frames = (await Promise.all(frameSources.map(async frame => {
      try { return { ...frame, url: await providers.image(frame.url) } } catch { return null }
    }))).filter(Boolean)
    try {
      const freshRanking = unrankedCatalog.length ? await providers.json('rank-accounts',
        referenceReviewPrompt,
        { selection: input, candidates: unrankedCatalog.map(r => ({ username:r.username, biography:r.profile.biography, followers:r.profile.followers,
          displayName:r.profile.displayName, categoryName:r.profile.categoryName, businessCategoryName:r.profile.businessCategoryName,
          performance:referencePerformance(r.profile), maxViews:r.profile.maxViews, viralMedia:r.profile.viralMedia, externalUrl:r.profile.externalUrl, isBusiness:r.profile.isBusiness, isVerified:r.profile.isVerified,
          postsCount:r.profile.postsCount, recentPosts:r.profile.exampleMedia.map(p => ({ permalink:p.permalink, caption:p.caption, timestamp:p.timestamp, contentType:p.contentType })) })) }, frames, referenceReviewSchema) : { accounts:[] }
      ranking = { accounts:[...preparedRanking, ...(Array.isArray(freshRanking.accounts) ? freshRanking.accounts : [])] }
    } catch (error) { rethrowReferenceStop(error); ranking = { accounts: preparedRanking } }
    await redis.set(rankKey, JSON.stringify(ranking), 'EX', 21600)
  }
  const ranked = new Map(ranking.accounts.filter(Boolean).map(item => [item.username, item]))
  await ctx.reviewCandidates?.(catalog, ranked)
  const accounts = catalog.flatMap((row) => {
    const rank = ranked.get(row.username) || {}
    if (!referenceQualityEligible(rank, row.profile)) return []
    const checks = {
      faceVisibility: input.faceVisibility === 'any' ? true : rank.faceVisibility === input.faceVisibility,
      accountSize: sizeMatches(row.profile.followers, input.accountSize),
      contentLanguage: input.contentLanguage === 'any' ? true : rank.language ? rank.language === input.contentLanguage : null,
    }
    const requested = Object.entries(checks).filter(([key]) => input[key] !== 'any')
    const preferenceScore = requested.length ? requested.reduce((sum, [,value]) => sum + (value === true ? 100 : value === null ? 45 : 10), 0) / requested.length : 75
    const baseScore = weightedScore({ category: Number.isFinite(rank.categoryMatch) ? rank.categoryMatch : 55, preferences: preferenceScore,
      activity: Math.max(0, 100 - (Date.now() - Date.parse(row.last_active_at)) / 86400000) }, { category: 55, preferences: 35, activity: 10 })
    const matchScore = referenceQualityScore(baseScore, rank, row.profile)
    const relaxedConditions = requested.filter(([,value]) => value !== true).map(([key,value]) => `${labels[key]?.[input[key]] || key}: ${value === null ? '확인되지 않음' : '조건과 다름'}`)
    return [{ username: row.username, profileUrl: `https://www.instagram.com/${row.username}/`, matchScore,
      reasons: strings(rank.reasons).slice(0, 3).length ? strings(rank.reasons).slice(0, 3) : [`${input.category} 카테고리 상위 공개 검색 결과에서 확인된 계정입니다.`],
      referencePoints: strings(rank.referencePoints).slice(0, 3), relaxedConditions,
      faceVisibility: rank.faceVisibility || 'unknown', contentFormats: strings(rank.contentFormats), contentLanguage: rank.language || 'unknown',
      exampleMedia: (row.profile.exampleMedia || []).slice(0, 3).map(({ permalink, caption, timestamp, likes, comments }) => ({ permalink, caption, timestamp, likes, comments })), metricsAsOf: row.verified_at,
      engagementAvailable: Number.isFinite(row.profile.engagementScore),
      lastActiveAt: row.last_active_at, source: row.source, followers: row.profile.followers, postsCount: row.profile.postsCount,
      maxViews: row.profile.maxViews, viralMedia: row.profile.viralMedia, accountType: 'individual_creator',
      accountTypeEvidence: strings(rank.accountTypeEvidence).slice(0, 2),
      domesticCreator:rank.domesticCreator, domesticCreatorEvidence:strings(rank.domesticCreatorEvidence),
      performance:referencePerformance(row.profile), ordinaryCreator:rank.ordinaryCreator, ordinaryCreatorEvidence:strings(rank.ordinaryCreatorEvidence),
      monetizationEvidence:strings(rank.monetizationEvidence), monetizationSourceUrls:rank.monetizationSourceUrls,
      productionLevel:rank.productionLevel, productionEvidence:strings(rank.productionEvidence),
      replicability:rank.replicability, replicabilityEvidence:strings(rank.replicabilityEvidence), evidencePostUrls:rank.evidencePostUrls,
      saved: preferences.some((p) => p.username === row.username && p.preference === 'saved') }]
  }).sort((a, b) => b.matchScore - a.matchScore).slice(0, 12)
  if (!accounts.length) return { accounts: [], sourceStatus: 'no_verified_match',
    message: '국내 활동·최근 릴스 조회수·일반인·제작 수준·재현 가능성 심사 기준을 모두 확인한 계정이 없습니다.', metricsAsOf: null }
  // Catalog writes are exclusively an explicit operator import.
  return { accounts, sourceStatus: 'public_search',
    message: prepared.length ? '사전 검증된 계정 풀을 우선 사용했습니다. 개인 크리에이터 여부, 팔로워 범위, 50만 이상 조회 콘텐츠 보유를 공개 데이터로 확인한 계정만 표시합니다.'
      : '개인 크리에이터 여부, 선택한 팔로워 범위, 50만 이상 조회 콘텐츠 보유를 공개 데이터로 확인한 계정만 표시합니다.' }
}

export async function discoverKeywords(ctx) {
  const { job, providers, redis, stage } = ctx
  await stage('expanding_keywords')
  const selectionLabels = {
    trendGoal:{education:'정보 전달',problem_solving:'문제 해결',comparison:'비교',review:'후기',purchase:'구매 검토',news:'새 소식'},
    audienceLevel:{beginner:'입문자',experienced:'경험자',ready_to_buy:'구매 직전'}, keywordScope:{broad:'넓은 키워드',balanced:'넓은·구체 혼합',specific:'구체 키워드'},
    contentStructure:{howto:'사용법',checklist:'체크리스트',mistakes:'실수·주의점',comparison:'비교',review:'후기',case_study:'사례'}, contentLanguage:{ko:'한국어',en:'영어',ja:'일본어'} }
  const selection = Object.fromEntries(Object.entries(job.input).map(([key,value]) => [key, selectionLabels[key]?.[value] || value]))
  const raw = await providers.json('keyword-candidates',
    '선택된 카테고리·목적·시청자 단계·범위·구성·언어에 맞는 Instagram 릴스 검색용 1~3단어 키워드를 최대 8개 제안하세요. 카테고리 밖의 키워드, 브랜드명, 문장, 중복 표현은 제외하세요. 실제 인기·상승세·게시물 수는 추측하지 마세요. JSON {keywords:[{keyword,purpose,relatedKeywords:[string]}]}. 선택 언어로 작성하세요.', selection)
  const seen = new Set()
  const candidates = (Array.isArray(raw.keywords) ? raw.keywords : []).filter(Boolean).filter((item) => {
    const key = typeof item.keyword === 'string' ? item.keyword.trim() : ''
    if (!key || key.length > 30 || key.split(/\s+/).length > 3 || !/^[\p{L}\p{N} ]+$/u.test(key) || seen.has(key)) return false
    seen.add(key); item.keyword = key; return true
  }).slice(0, 8)
  const auth = await providers.connection()
  await stage('checking_official_sources')
  const keywords = []
  for (const candidate of candidates) {
    const key = `creator:keyword:${stableHash([job.user_id, candidate.keyword, job.input.region])}`
    let activity = null
    const cached = await redis.get(key)
    if (cached) activity = JSON.parse(cached)
    else if (auth) {
      try { activity = { ...await providers.hashtag(candidate.keyword.replace(/\s/g, ''), auth), measuredAt: new Date().toISOString() } }
      catch { activity = { status: 'provider_unavailable', media: [] } }
      if (activity.status === 'available') await redis.set(key, JSON.stringify(activity), 'EX', 21600)
    }
    keywords.push(keywordResult(candidate, activity, activity?.measuredAt))
  }
  return { keywords, region: job.input.region, selection: job.input, googleTrendsStatus: 'provider_unavailable',
    message: '선택 조건에 맞춘 키워드 후보입니다. 전체 게시물 수와 상승세가 공식 확인되지 않은 항목은 후보로만 표시합니다.' }
}
