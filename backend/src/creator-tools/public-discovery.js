import { fail, stableHash } from './domain.js'

const reserved = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'direct', 'about', 'developer', 'legal', 'web', 'tv'])
export function profileUsername(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname) || url.port || url.username || url.password) return null
    const match = url.pathname.match(/^\/([a-zA-Z0-9_.]{1,30})\/?$/)
    const name = match?.[1].toLowerCase()
    return name && !reserved.has(name) ? name : null
  } catch { return null }
}
const searchWords = value => String(value || '').normalize('NFC').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().slice(0, 140)
const categoryEnglish = { '뷰티/스킨케어':'beauty skincare', '운동/피트니스':'fitness workout', '육아/가족':'parenting family', '반려동물':'pets',
  '살림/인테리어':'home organization interior', '패션':'fashion', '여행':'travel', '요리/레시피':'cooking recipes', '테크/가젯':'tech gadgets',
  '교육/공부':'education study', '자기계발/생산성':'self improvement productivity', '재테크/금융':'personal finance investing' }
export function accountSearchQueries(input) {
  const category = searchWords(input.category), english = categoryEnglish[input.category] || 'creator'
  const format = { talking:'말하는', tutorial:'사용법', vlog:'브이로그', before_after:'비포애프터', review:'리뷰', text:'정보' }[input.contentFormat] || ''
  return [...new Set([`${category} 크리에이터`, `${category} 인스타그램`, `${category} ${format} 릴스`, `${english} creator instagram`]
    .map(value => `site:instagram.com ${value.replace(/\s+/g, ' ').trim()} -inurl:reel -inurl:reels -inurl:p/ -inurl:explore`))]
}
export function searchProfiles(response) {
  // Some SERP configurations wrap the parsed JSON in a body field.
  let data = response?.body ?? response
  if (typeof data === 'string') { try { data = JSON.parse(data) } catch { fail('SEARCH_INVALID_RESPONSE', '계정 검색 결과를 읽지 못했습니다.', 502) } }
  if (!Array.isArray(data?.organic)) fail('SEARCH_INVALID_RESPONSE', '계정 검색 결과를 읽지 못했습니다.', 502)
  return [...new Set(data.organic.map(item => profileUsername(item.link)).filter(Boolean))]
}
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null
const short = (value, max) => typeof value === 'string' ? value.slice(0, max) : ''
const normalizedText = value => short(value, 2000).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
const brandUsername = /(^|[._])(official|shop|store|brand|corp|company)([._]|$)/i
const brandCategory = /(brand|product\/service|shopping\s*&\s*retail|company|corporation|local business|cosmetics store|브랜드|제품.?서비스|쇼핑.?소매|회사|기업)/i
const brandIdentity = /(공식\s*(계정|인스타그램|채널)|브랜드\s*공식|official\s*(account|instagram|channel)|주식회사|\binc\.?\b|\bcorp(?:oration)?\b|\bcompany\b)/i
export function obviousBrandAccount(record, username) {
  const category = `${normalizedText(record?.category_name)} ${normalizedText(record?.business_category_name)}`
  const identity = `${normalizedText(record?.full_name || record?.profile_name)} ${normalizedText(record?.biography)}`
  return brandUsername.test(username || '') || brandCategory.test(category) || brandIdentity.test(identity)
}
const accountSizeMatches = (followers, choice) => {
  if (choice === 'any') return Number.isFinite(followers)
  if (!Number.isFinite(followers)) return false
  return choice === 'under_10k' ? followers < 10000 : choice === '10k_50k' ? followers >= 10000 && followers < 50000
    : choice === '50k_200k' ? followers >= 50000 && followers < 200000 : followers >= 200000
}
function date(value, now) {
  const time = Date.parse(value)
  return Number.isFinite(time) && time <= now ? new Date(time).toISOString() : null
}
function postUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname) || url.port || url.username || url.password || !/^\/(p|reel|reels)\/[\w-]+\/?$/.test(url.pathname)) return null
    return `https://www.instagram.com${url.pathname}`
  } catch { return null }
}
export function normalizePublicProfiles(records, requested, now = Date.now()) {
  if (!Array.isArray(records)) fail('PROFILE_INVALID_RESPONSE', '공개 계정 정보를 읽지 못했습니다.', 502)
  const allowed = new Set(requested), seen = new Set()
  return records.flatMap(record => {
    if (!record || record.error || record.error_code || record.is_private !== false) return []
    const name = typeof record.account === 'string' ? record.account.toLowerCase() : profileUsername(record.url || record.profile_url)
    if (!allowed.has(name) || seen.has(name)) return []
    // Do not allow a different provider URL to be attributed to this username.
    if ([record.url, record.profile_url].some(url => url && profileUsername(url) !== name)) return []
    // Clear company/shop/official-account signals are rejected before paid reach checks.
    // A business-account flag alone is not sufficient because individual creators also use it.
    if (obviousBrandAccount(record, name)) return []
    seen.add(name)
    const posts = (Array.isArray(record.posts) ? record.posts : []).slice(0, 30).flatMap(post => {
      const permalink = postUrl(post.url)
      return permalink ? [{ permalink, caption: short(post.caption, 1200), timestamp: date(post.datetime, now), likes: count(post.likes), comments: count(post.comments),
        imageUrl: typeof post.image_url === 'string' && /^https:\/\//.test(post.image_url) ? post.image_url : null,
        contentType: short(post.content_type, 50) || null }] : []
    }).sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0))
    return [{ username: name, verified_at: new Date(now).toISOString(), last_active_at: posts.find(p => p.timestamp)?.timestamp || null,
      source: 'Bright Data 공개 프로필 · Google 검색', profile: { biography: short(record.biography, 2000),
        displayName: short(record.full_name || record.profile_name, 150), followers: count(record.followers),
        postsCount: count(record.posts_count), isProfessional: record.is_professional_account === true ? true : null,
        isBusiness: record.is_business_account === true ? true : null,
        categoryName: short(record.category_name, 150), businessCategoryName: short(record.business_category_name, 150),
        externalUrl: typeof record.external_url === 'string' && /^https:\/\//.test(record.external_url) ? short(record.external_url, 1000) : null,
        isVerified: record.is_verified === true ? true : null,
        exampleMedia: posts.slice(0, 12), engagementScore: null, maxViews: null, viralMedia: null } }]
  })
}

export function normalizePublicReels(records, owners) {
  if (!Array.isArray(records)) fail('PROFILE_REELS_INVALID_RESPONSE', '공개 릴스 조회수를 읽지 못했습니다.', 502)
  const best = new Map()
  for (const record of records) {
    if (!record || record.error || record.error_code) continue
    const requestedPermalink = postUrl(record.input?.url || record.url)
    const permalink = postUrl(record.url || record.input?.url)
    const expected = requestedPermalink && owners.get(requestedPermalink)
    const actual = typeof record.user_posted === 'string' ? record.user_posted.replace(/^@/, '').toLowerCase() : null
    const views = [count(record.video_play_count), count(record.views)].filter(Number.isFinite).sort((a,b) => b-a)[0]
    if (!expected || actual !== expected || !Number.isFinite(views)) continue
    const current = best.get(expected)
    if (!current || views > current.views) best.set(expected, { permalink, views })
  }
  return [...best.entries()].map(([username, media]) => ({ username, ...media }))
}

export async function publicAccountCandidates(ctx, excluded) {
  const { providers, job, redis, checkpoint, stage } = ctx
  const input = job.input
  const cacheKey = `creator:public-search:v6:${stableHash([input, [...excluded].sort()])}`
  const poolKey = `creator:verified-category-pool:v3:${input.region}:${input.category}`
  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached).filter(row => !excluded.has(row.username))
  const pooled = JSON.parse(await redis.get(poolKey) || '[]')
  const names = new Set()
  if (pooled.length < 5) {
    const queries = accountSearchQueries(input)
    for (let index = 0; index < queries.length; index += 1) {
      try {
        const found = await checkpoint(`accountSearch${index}`, () => providers.searchAccounts(queries[index], input.region, 0))
        for (const name of found) if (!excluded.has(name)) names.add(name)
      } catch { /* Keep other top-result queries and the verified category pool available. */ }
    }
  }
  const requested = [...names].slice(0, 20)
  let fresh = []
  if (requested.length) {
    await stage('verifying_public_accounts')
    try { fresh = await checkpoint('publicAccountCandidates', async () => normalizePublicProfiles(await providers.publicProfiles(requested, checkpoint), requested)) }
    catch { fresh = [] }
  }
  const merged = new Map([...pooled, ...fresh].map(row => [row.username, row]))
  const candidates = [...merged.values()].filter(row => !excluded.has(row.username)
    && !obviousBrandAccount({ full_name:row.profile.displayName, biography:row.profile.biography,
      category_name:row.profile.categoryName, business_category_name:row.profile.businessCategoryName }, row.username)
    && accountSizeMatches(row.profile.followers, input.accountSize))
  const owners = new Map(candidates.flatMap(row => row.profile.exampleMedia.map(media => [media.permalink, row.username])).slice(0, 120))
  let viral = []
  if (owners.size) {
    await stage('verifying_reach')
    try {
      viral = await checkpoint('publicAccountReels', async () => normalizePublicReels(
        await providers.publicReels([...owners.keys()], checkpoint), owners))
    } catch { viral = [] }
  }
  const viralByAccount = new Map(viral.map(item => [item.username, item]))
  const qualified = candidates.flatMap(row => {
    const media = viralByAccount.get(row.username)
    if (!media || media.views < 500000) return []
    return [{ ...row, profile: { ...row.profile, maxViews: media.views, viralMedia: media } }]
  })
  if (fresh.length) await redis.set(poolKey, JSON.stringify([...merged.values()].slice(0, 100)), 'EX', 604800)
  // Only public profile evidence is cached. User uploads/transcripts never enter this path.
  await redis.set(cacheKey, JSON.stringify(qualified), 'EX', 900)
  return qualified.filter(row => !excluded.has(row.username))
}
