import { query } from './store.js'
import { stableHash, fail } from './domain.js'
import { publicAccountCandidates } from './public-discovery.js'

export function verifiedAccount(row, now = Date.now()) {
  return row.active && row.professional && new Date(row.verified_at).getTime() > now - 30 * 86400000
    && new Date(row.last_active_at).getTime() > now - 90 * 86400000
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
  if (choice === 'any') return true
  if (!Number.isFinite(followers)) return null
  return choice === 'under_10k' ? followers < 10000 : choice === '10k_50k' ? followers >= 10000 && followers < 50000
    : choice === '50k_200k' ? followers >= 50000 && followers < 200000 : followers >= 200000
}
const activityMatches = (lastActiveAt, choice) => {
  if (choice === 'any') return true
  const days = { '7d': 7, '30d': 30, '90d': 90 }[choice], time = Date.parse(lastActiveAt)
  return Number.isFinite(time) ? Date.now() - time <= days * 86400000 : null
}
const labels = {
  faceVisibility: { visible:'얼굴 자주 등장', hidden:'얼굴 비공개', mixed:'얼굴 일부 등장' },
  contentFormat: { talking:'말하는 영상', tutorial:'사용법·시연', vlog:'브이로그', before_after:'전후 비교', review:'제품 리뷰', text:'텍스트 중심' },
  accountSize: { under_10k:'팔로워 1만 미만', '10k_50k':'팔로워 1만~5만', '50k_200k':'팔로워 5만~20만', over_200k:'팔로워 20만 이상' },
  recentActivity: { '7d':'최근 7일 활동', '30d':'최근 30일 활동', '90d':'최근 90일 활동' },
  contentLanguage: { ko:'한국어', en:'영어', ja:'일본어' },
}
export async function discoverAccounts(ctx) {
  const { db, job, providers, stage, redis } = ctx
  const input = job.input
  await stage('finding_accounts')
  const preferences = await query(db.from('creator_account_preferences').select('username,preference').eq('user_id', job.user_id))
  const excluded = new Set([...input.excludeAccounts, ...preferences.filter((p) => p.preference === 'excluded').map((p) => p.username)])
  const catalog = (await publicAccountCandidates(ctx, excluded)).filter(row =>
    sizeMatches(row.profile.followers, input.accountSize) === true
    && Number.isFinite(row.profile.maxViews) && row.profile.maxViews >= 500000
    && row.profile.viralMedia?.permalink)
  if (!catalog.length) return { accounts: [], sourceStatus: 'no_verified_match',
    message: '선택한 팔로워 범위와 50만 이상 조회 콘텐츠 보유 조건을 모두 공개 데이터로 확인한 계정이 없습니다.', metricsAsOf: null }
  await stage('ranking_accounts')
  const rankKey = `creator:ranking:v2:${stableHash([job.user_id, input, catalog])}`
  const cachedRanking = await redis.get(rankKey)
  const frameSources = catalog.slice(0, 8).flatMap(row => row.profile.exampleMedia.filter(media => media.imageUrl).slice(0, 1)
    .map(media => ({ url: media.imageUrl, label: `@${row.username} 최근 공개 게시물 이미지 · ${media.permalink}` }))).slice(0, 8)
  const frames = (await Promise.all(frameSources.map(async frame => {
    try { return { ...frame, url: await providers.image(frame.url) } } catch { return null }
  }))).filter(Boolean)
  let ranking = cachedRanking ? JSON.parse(cachedRanking) : { accounts: [] }
  if (!cachedRanking) {
    try {
      ranking = await providers.json('rank-accounts',
        '선택 카테고리와 실제 공개 프로필·최근 게시물 캡션·첨부 이미지 표본만 평가하고 모든 후보를 반환하세요. accountType은 한 개인의 이름·얼굴·경험·관점이 콘텐츠의 중심이라고 공개 근거로 확인될 때만 individual_creator입니다. 제품 브랜드·공식몰·상점·회사·기관·미디어·출판사·에이전시·팀은 brand 또는 organization, 근거가 부족하면 unknown입니다. 프로페셔널/비즈니스 계정 설정만으로 개인이라고 판단하지 마세요. 얼굴은 이미지에서 직접 확인된 경우에만 visible, 얼굴이 없는 표본만 확인되면 hidden, 섞이면 mixed, 판단 불가면 unknown입니다. reasons에는 이 계정에서 관찰된 주제·전달 방식의 특징을 쓰고, referencePoints에는 이용자가 자신의 경험과 주제로 독립적인 콘텐츠를 기획할 때 확인할 질문이나 관점을 쓰세요. 원문 표현·사례·구성을 따라 하거나 복제하도록 제안하지 마세요. JSON {accounts:[{username,accountType:"individual_creator|brand|organization|unknown",accountTypeEvidence:[한국어],categoryMatch:0..100,faceVisibility:"visible|hidden|mixed|unknown",contentFormats:["talking|tutorial|vlog|before_after|review|text"],language:"ko|en|ja|unknown",reasons:[한국어],referencePoints:[한국어]}]}. 수치나 신원을 만들지 마세요.',
        { selection: input, candidates: catalog.map(r => ({ username:r.username, biography:r.profile.biography, followers:r.profile.followers,
          displayName:r.profile.displayName, categoryName:r.profile.categoryName, businessCategoryName:r.profile.businessCategoryName,
          externalUrl:r.profile.externalUrl, isBusiness:r.profile.isBusiness, isVerified:r.profile.isVerified,
          postsCount:r.profile.postsCount, recentPosts:r.profile.exampleMedia.map(p => ({ permalink:p.permalink, caption:p.caption, timestamp:p.timestamp, contentType:p.contentType })) })) }, frames)
      if (!Array.isArray(ranking.accounts)) ranking = { accounts: [] }
    } catch { ranking = { accounts: [] } }
    await redis.set(rankKey, JSON.stringify(ranking), 'EX', 21600)
  }
  const ranked = new Map(ranking.accounts.filter(Boolean).map(item => [item.username, item]))
  const accounts = catalog.flatMap((row) => {
    const rank = ranked.get(row.username) || {}
    if (rank.accountType !== 'individual_creator') return []
    const checks = {
      faceVisibility: input.faceVisibility === 'any' ? true : rank.faceVisibility === input.faceVisibility,
      contentFormat: input.contentFormat === 'any' ? true : Array.isArray(rank.contentFormats) ? rank.contentFormats.includes(input.contentFormat) : null,
      accountSize: sizeMatches(row.profile.followers, input.accountSize), recentActivity: activityMatches(row.last_active_at, input.recentActivity),
      contentLanguage: input.contentLanguage === 'any' ? true : rank.language ? rank.language === input.contentLanguage : null,
    }
    const requested = Object.entries(checks).filter(([key]) => input[key] !== 'any')
    const preferenceScore = requested.length ? requested.reduce((sum, [,value]) => sum + (value === true ? 100 : value === null ? 45 : 10), 0) / requested.length : 75
    const matchScore = weightedScore({ category: Number.isFinite(rank.categoryMatch) ? rank.categoryMatch : 55, preferences: preferenceScore,
      activity: Math.max(0, 100 - (Date.now() - Date.parse(row.last_active_at)) / 86400000) }, { category: 55, preferences: 35, activity: 10 })
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
      saved: preferences.some((p) => p.username === row.username && p.preference === 'saved') }]
  }).sort((a, b) => b.matchScore - a.matchScore).slice(0, 12)
  if (!accounts.length) return { accounts: [], sourceStatus: 'no_verified_match',
    message: '팔로워·조회수 조건을 충족하면서 개인 크리에이터로 확인된 계정이 없습니다.', metricsAsOf: null }
  return { accounts, sourceStatus: 'public_search',
    message: '개인 크리에이터 여부, 선택한 팔로워 범위, 50만 이상 조회 콘텐츠 보유를 공개 데이터로 확인한 계정만 표시합니다.' }
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
