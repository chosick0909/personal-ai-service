import { fail, stableHash } from './domain.js'
import { referencePerformance, obviousNonReferenceAccount, publicEvidenceEligible, hardReferenceMetrics, rethrowReferenceStop } from './reference-quality.js'
export { obviousNonReferenceAccount } from './reference-quality.js'

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
export function accountSearchQueries(input) {
  const category = searchWords(input.category)
  const format = { talking:'말하는', tutorial:'사용법', vlog:'브이로그', before_after:'비포애프터', review:'리뷰', text:'정보' }[input.contentFormat] || ''
  const size = { '10k_50k':'팔로워 1만 5만', '50k_200k':'팔로워 5만 20만', over_200k:'팔로워 20만 이상' }[input.accountSize] || ''
  return [...new Set([`${category} 공동구매 내돈내산 ${size}`, `${category} 체험단 협찬 ${size}`, `${category} ${format} 사용후기 릴스 ${size}`, `${category} 스마트스토어 클래스 일상`, `${category} 한국 일상 제품 리뷰 ${size}`]
    .map(value => `site:instagram.com 한국 ${value.replace(/\s+/g, ' ').trim()} -inurl:reel -inurl:reels -inurl:p/ -inurl:explore`))]
}
export function searchProfiles(response) {
  // Some SERP configurations wrap the parsed JSON in a body field.
  let data = response?.body ?? response
  if (typeof data === 'string') { try { data = JSON.parse(data) } catch { fail('SEARCH_INVALID_RESPONSE', '계정 검색 결과를 읽지 못했습니다.', 502) } }
  if (!Array.isArray(data?.organic)) fail('SEARCH_INVALID_RESPONSE', '계정 검색 결과를 읽지 못했습니다.', 502)
  return [...new Set(data.organic.filter(item => !obviousNonReferenceAccount({ full_name:item.title, biography:item.description || item.snippet }, profileUsername(item.link)))
    .map(item => profileUsername(item.link)).filter(Boolean))]
}
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null
const short = (value, max) => typeof value === 'string' ? value.slice(0, max) : ''
const accountSizeMatches = (followers, choice) => {
  if (!Number.isSafeInteger(followers) || followers < 10000) return false
  return choice === 'any' ? true : choice === '10k_50k' ? followers < 50000
    : choice === '50k_200k' ? followers >= 50000 && followers < 200000
      : choice === 'over_200k' && followers >= 200000
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
    if (obviousNonReferenceAccount(record, name)) return []
    seen.add(name)
    const posts = (Array.isArray(record.posts) ? record.posts : []).flatMap(post => {
      const permalink = postUrl(post.url)
      return permalink ? [{ permalink, caption: short(post.caption, 1200), timestamp: date(post.datetime, now), likes: count(post.likes), comments: count(post.comments),
        views: [count(post.video_play_count), count(post.video_view_count), count(post.views)].filter(Number.isFinite).sort((a,b) => b-a)[0] ?? null,
        imageUrl: typeof post.image_url === 'string' && /^https:\/\//.test(post.image_url) ? post.image_url : null,
        contentType: short(post.content_type, 50) || null }] : []
    }).sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0))
    const viralMedia = posts.filter(post => Number.isFinite(post.views)).sort((a,b) => b.views-a.views)[0]
    return [{ username: name, verified_at: new Date(now).toISOString(), last_active_at: posts.find(p => p.timestamp)?.timestamp || null,
      source: 'Bright Data 공개 프로필 · Google 검색', profile: { biography: short(record.biography, 2000),
        displayName: short(record.full_name || record.profile_name, 150), followers: count(record.followers),
        postsCount: count(record.posts_count), isProfessional: record.is_professional_account === true ? true : null,
        isBusiness: record.is_business_account === true ? true : null,
        categoryName: short(record.category_name, 150), businessCategoryName: short(record.business_category_name, 150),
        externalUrl: typeof record.external_url === 'string' && /^https:\/\//.test(record.external_url) ? short(record.external_url, 1000) : null,
        isVerified: record.is_verified === true ? true : null,
        recentReels: posts.filter(p => /\/reels?\//.test(p.permalink) || /^(video|reel|reels)$/i.test(p.contentType || '')).slice(0, 12),
        exampleMedia: posts.slice(0, 12), engagementScore: null, maxViews: viralMedia?.views ?? null,
        viralMedia: viralMedia ? { permalink:viralMedia.permalink, views:viralMedia.views } : null } }]
  })
}

export function normalizePublicReels(records, owners) {
  if (!Array.isArray(records)) fail('PROFILE_REELS_INVALID_RESPONSE', '공개 릴스 조회수를 읽지 못했습니다.', 502)
  const best = new Map(), reels = new Map()
  for (const record of records) {
    if (!record || record.error || record.error_code) continue
    const requestedPermalink = postUrl(record.input?.url || record.url)
    const permalink = postUrl(record.url || record.input?.url)
    const expected = requestedPermalink && owners.get(requestedPermalink)
    const actual = typeof record.user_posted === 'string' ? record.user_posted.replace(/^@/, '').toLowerCase() : null
    const views = [count(record.video_play_count), count(record.views)].filter(Number.isFinite).sort((a,b) => b-a)[0]
    if (!expected || actual !== expected || !Number.isFinite(views)) continue
    if (!reels.has(expected)) reels.set(expected, new Map())
    reels.get(expected).set(requestedPermalink, { requestedPermalink, permalink, views })
    const current = best.get(expected)
    if (!current || views > current.views) best.set(expected, { permalink, views })
  }
  return [...best.entries()].map(([username, media]) => ({ username, ...media, reels:[...reels.get(username).values()] }))
}

// The discovery endpoint selects recent reels directly, rather than a mixed profile feed.
export function normalizeRecentPublicReels(records, requested, now = Date.now()) {
  if (!Array.isArray(records)) fail('PROFILE_REELS_INVALID_RESPONSE', '공개 릴스 조회수를 읽지 못했습니다.', 502)
  const allowed = new Set(requested), groups = new Map()
  for (const record of records) {
    if (!record || record.error || record.error_code) continue
    const owner = typeof record.user_posted === 'string' ? record.user_posted.replace(/^@/,'').toLowerCase() : null
    const inputOwner = profileUsername(record.input?.url || record.discovery_input?.url)
    const permalink = postUrl(record.url)
    if (!allowed.has(owner) || (inputOwner && inputOwner !== owner) || !permalink) continue
    if (!groups.has(owner)) groups.set(owner, new Map())
    groups.get(owner).set(permalink, {owner,permalink,caption:short(record.description,1200),timestamp:date(record.date_posted,now),
      views:[count(record.video_play_count),count(record.views)].filter(Number.isFinite).sort((a,b)=>b-a)[0] ?? null,
      likes:count(record.likes),comments:count(record.num_comments),imageUrl:typeof record.thumbnail === 'string' && record.thumbnail.startsWith('https://') ? record.thumbnail : null,contentType:'Video'})
  }
  if ([...groups.values()].some(media => media.size > 24)) fail('PROFILE_REELS_LIMIT', '최근 릴스 수집 상한을 초과한 응답입니다.', 502)
  return [...groups].map(([username,media]) => ({username, recentReels:[...media.values()],
    recentReelsSelection:{method:'provider_recent_reels',requestedCount:24,profileUrl:`https://www.instagram.com/${username}/`,collectedAt:new Date(now).toISOString()} }))
}
export function mergeRecentPublicReels(row, evidence) {
  const reels=evidence.recentReels
  const best=reels.filter(p=>Number.isFinite(p.views)).sort((a,b)=>b.views-a.views)[0]
  return {...row,profile:{...row.profile,recentReels:reels,recentReelsSelection:evidence.recentReelsSelection,
    exampleMedia:[...reels].sort((a,b)=>(Date.parse(b.timestamp)||0)-(Date.parse(a.timestamp)||0)).slice(0,12),maxViews:best?.views ?? null,viralMedia:best ? {permalink:best.permalink,views:best.views} : null}}
}

export async function publicAccountCandidates(ctx, excluded) {
  const { providers, job, redis, checkpoint, stage } = ctx
  const input = job.input
  const cacheKey = `creator:public-search:v10:${stableHash([input, [...excluded].sort()])}`
  const poolKey = `creator:verified-category-pool:v7:KR:${input.category}`
  const cached = await redis.get(cacheKey)
  const eligible = rows => rows.filter(row => publicEvidenceEligible(row) && !excluded.has(row.username)
    && accountSizeMatches(row.profile.followers, input.accountSize))
  const parseRows = value => { try { const rows = JSON.parse(value || '[]'); return Array.isArray(rows) ? rows : [] } catch { return [] } }
  if (cached) {
    const rows = eligible(parseRows(cached)).filter(row => hardReferenceMetrics(row.profile))
    if (rows.length) return rows
  }
  const pooled = parseRows(await redis.get(poolKey)).filter(row => publicEvidenceEligible(row))
  const queries = accountSearchQueries(input)
  const profiles = new Map(pooled.map(row => [row.username, row]))
  const qualified = new Map()
  const reachChecked = new Set()
  const searchedNames = new Set(profiles.keys())
  const verifyReach = async (rows, label) => {
    const candidates = eligible(rows).filter(row => !reachChecked.has(row.username))
    for (const row of candidates) {
      const performance = referencePerformance(row.profile)
      if ((performance.sampleCount < 12 && !providers.recentPublicReels) || (performance.status === 'complete' && performance.medianViews < 10000)) {
        reachChecked.add(row.username)
        continue
      }
      if (hardReferenceMetrics(row.profile) && (!providers.recentPublicReels || row.profile.recentReelsSelection?.requestedCount === 24)) {
        qualified.set(row.username, row)
        reachChecked.add(row.username)
      }
    }
    const unresolved = candidates.filter(row => !reachChecked.has(row.username))
    for (let offset = 0; offset < unresolved.length; offset += 10) {
      const batch = unresolved.slice(offset, offset + 10)
      for (const row of batch) reachChecked.add(row.username)
      if (providers.recentPublicReels) {
        await stage('verifying_reach')
        let collected=[]
        try {
          collected=await checkpoint(`recentAccountReelsV2-${label}-${offset/10}`, async () => normalizeRecentPublicReels(
            await providers.recentPublicReels(batch.map(r=>r.username),checkpoint,`recentAccountReelsReceiptV2-${label}-${offset/10}`),batch.map(r=>r.username)))
        } catch(error) { rethrowReferenceStop(error) }
        for (const row of batch) {
          const evidence=collected.find(r=>r.username===row.username)
          if (!evidence) continue
          const enriched=mergeRecentPublicReels(row,evidence)
          profiles.set(row.username,enriched)
          await ctx.reviewEvidence?.([enriched])
          if (hardReferenceMetrics(enriched.profile)) qualified.set(row.username,enriched)
        }
        continue
      }
      const owners = new Map(batch.flatMap(row => (row.profile.recentReels || []).map(media => [media.permalink, row.username])).slice(0, 120))
      if (!owners.size) continue
      await stage('verifying_reach')
      let viral = []
      const batchKey = `${label}-${offset / 10}`
      try {
        viral = await checkpoint(`publicAccountReelsV9-${batchKey}`, async () => normalizePublicReels(
          await providers.publicReels([...owners.keys()], checkpoint, `accountReelsReceiptV9-${batchKey}`), owners))
      } catch (error) { rethrowReferenceStop(error); viral = [] }
      const viralByAccount = new Map(viral.map(item => [item.username, item]))
      for (const row of batch) {
        const media = viralByAccount.get(row.username)
        if (!media) continue
        const measured = new Map(media.reels.map(p => [p.requestedPermalink, p]))
        const profile = { ...row.profile,
          recentReels:(row.profile.recentReels || []).map(p => ({ ...p, views:measured.get(p.permalink)?.views ?? p.views })),
          maxViews:media.views, viralMedia:{ permalink:media.permalink, views:media.views } }
        profiles.set(row.username, { ...row, profile })
        await ctx.reviewEvidence?.([{ ...row, profile }])
        if (hardReferenceMetrics(profile)) qualified.set(row.username, { ...row, profile })
      }
    }
  }
  await verifyReach([...profiles.values()], 'pool')
  // Expand one page at a time and stop as soon as a useful result set is verified.
  // The hard follower/reach constraints are never relaxed and no synthetic account is added.
  for (let page = 0; page < 5 && qualified.size < 12 && searchedNames.size < 120; page += 1) {
    await stage(page ? 'expanding_account_search' : 'finding_accounts')
    const pageNames = new Set()
    for (let index = 0; index < queries.length; index += 1) {
      try {
        const found = await checkpoint(`accountSearchV9-${page}-${index}`, () => providers.searchAccounts(queries[index], 'KR', page))
        for (const name of found) if (!obviousNonReferenceAccount({}, name) && !excluded.has(name) && !searchedNames.has(name) && searchedNames.size + pageNames.size < 120) pageNames.add(name)
      } catch (error) { rethrowReferenceStop(error) /* Continue with other queries and later pages. */ }
    }
    for (const name of pageNames) searchedNames.add(name)
    const requested = [...pageNames]
    for (let offset = 0; offset < requested.length && qualified.size < 12; offset += 20) {
      const names = requested.slice(offset, offset + 20)
      await stage('verifying_public_accounts')
      let fresh = []
      const batchKey = `${page}-${offset / 20}`
      try {
        fresh = await checkpoint(`publicAccountProfilesV9-${batchKey}`, async () => normalizePublicProfiles(
          await providers.publicProfiles(names, checkpoint, `accountProfilesReceiptV9-${batchKey}`), names))
      } catch (error) { rethrowReferenceStop(error); fresh = [] }
      for (const row of fresh) profiles.set(row.username, row)
      await ctx.reviewEvidence?.(fresh)
      await verifyReach(fresh, `page-${batchKey}`)
    }
  }
  if (profiles.size) await redis.set(poolKey, JSON.stringify([...profiles.values()].slice(0, 200)), 'EX', 604800)
  const rows = [...qualified.values()]
  // Only public profile evidence is cached. User uploads/transcripts never enter this path.
  await redis.set(cacheKey, JSON.stringify(rows), 'EX', 900)
  return rows.filter(row => !excluded.has(row.username))
}
