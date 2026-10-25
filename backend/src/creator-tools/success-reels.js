import { fail } from './domain.js'
import { query } from './store.js'
import { SUCCESS_REEL_CATEGORIES } from './categories.js'
import { obviousNonReferenceAccount } from './reference-quality.js'
import { playbackUrl } from './reference-playback.js'

// Success reels: public Instagram reels with 500k+ views uploaded in the last 3 months,
// from individual creators whose production is reproducible at home. Domestic and overseas.
export const SUCCESS_REEL_MIN_VIEWS = 500000
export const SUCCESS_REEL_MAX_AGE_DAYS = 90
export const SUCCESS_REEL_REVIEW_VERSION = 2
export const SUCCESS_REEL_REVIEW_DAYS = 30
// Accounts this large are celebrities or media, never reproducible ordinary creators.
export const SUCCESS_REEL_MAX_FOLLOWERS = 5000000
export const THUMBNAIL_BUCKET = 'creator-reel-thumbnails'
const DAY = 86400000
// Instagram media ids embed the upload time: (id >> 23) ms after this epoch.
const INSTAGRAM_EPOCH = 1314220021721
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function shortcodePostedAt(shortcode) {
  if (typeof shortcode !== 'string' || !/^[A-Za-z0-9_-]{5,40}$/.test(shortcode)) return null
  const id = [...shortcode].reduce((value, char) => value * 64n + BigInt(ALPHABET.indexOf(char)), 0n)
  const time = Number(id >> 23n) + INSTAGRAM_EPOCH
  return Number.isFinite(time) && time > INSTAGRAM_EPOCH ? new Date(time) : null
}

const text = (value, max) => typeof value === 'string' ? value.normalize('NFC').slice(0, max) : ''
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null
const cdnUrl = value => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.endsWith('.cdninstagram.com') ? url.href : null
  } catch { return null }
}

// The collector is trusted to authenticate, never to judge. Every field is re-validated.
export function normalizeIngest(body, now = Date.now()) {
  const account = body?.account
  const username = typeof account?.username === 'string' ? account.username.toLowerCase() : ''
  if (!/^[a-z0-9_.]{1,30}$/.test(username)) fail('INVALID_ACCOUNT', '계정 아이디를 확인해주세요.')
  if (account.isPrivate === true) fail('PRIVATE_ACCOUNT', '비공개 계정은 수집하지 않습니다.')
  if (!Array.isArray(body.reels) || body.reels.length > 120) fail('INVALID_REELS', '릴스 목록을 확인해주세요.')
  const seen = new Set()
  const reels = body.reels.flatMap(reel => {
    const postedAt = shortcodePostedAt(reel?.shortcode)
    const views = count(reel?.views)
    if (!postedAt || postedAt.getTime() > now + DAY || views === null || seen.has(reel.shortcode)) return []
    seen.add(reel.shortcode)
    return [{ shortcode: reel.shortcode, views, likes: count(reel.likes), comments: count(reel.comments),
      postedAt: postedAt.toISOString(), caption: text(reel.caption, 2000), audio: text(reel.audio, 200) || null,
      thumbnailUrl: cdnUrl(reel.thumbnailUrl), videoUrl: playbackUrl(reel.videoUrl) }]
  })
  return {
    username,
    profile: { username, fullName: text(account.fullName, 150), biography: text(account.biography, 2000),
      followers: count(account.followers), externalUrl: /^https?:\/\//.test(account.externalUrl || '') ? text(account.externalUrl, 500) : null,
      categoryName: text(account.categoryName, 150), isVerified: account.isVerified === true },
    reels,
    source: text(body.source, 120) || null,
  }
}

export function qualifyingReels(reels, now = Date.now()) {
  return reels.filter(reel => reel.views >= SUCCESS_REEL_MIN_VIEWS
    && Date.parse(reel.postedAt) >= now - SUCCESS_REEL_MAX_AGE_DAYS * DAY)
}

export const successReelReviewPrompt = `인스타그램 공개 계정과 그 계정의 터진 릴스를 심사하세요. 제공된 공개 프로필·캡션·이미지에만 근거하고 추측하지 마세요. 국내·해외 계정 모두 대상입니다.
한 개인의 이름·얼굴·경험·관점이 중심일 때만 accountType=individual_creator. 브랜드·쇼핑몰·상점·회사·기관은 brand/organization, 미디어·매거진·뉴스·큐레이션·리포스트는 organization입니다.
ordinaryCreator는 연예인 여부만 봅니다. 연예인·방송인·아이돌·배우·가수·개그맨·프로선수·전업모델 출신, 연예 소속사·MCN 소속이 확인되면 false입니다. 그런 근거가 없는 개인 크리에이터는 true입니다. 의사·약사·변호사 같은 전문직, 자기 사업을 하는 대표, 광고·협찬·공동구매 이력, 인증 배지, 비즈니스 문의 이메일, 팔로워 수는 false의 근거가 아닙니다. 판단할 정보가 전혀 없을 때만 null입니다.
집·주방·욕실·동네에서 스마트폰으로 재현 가능한 촬영은 personal, 소규모 보조 제작은 semi_pro, 전문 스튜디오·편집팀·고비용 제작은 professional, 근거 부족은 unknown입니다. 외모의 아름다움·평범함·매력을 절대 평가하지 마세요.
monetizationEvidence는 확인된 쇼핑몰/제휴 링크, 공동구매·체험단, #광고/#협찬/#유료광고 협업, 자체 제품·클래스 판매만 적으세요. 링크 내용이 제공되지 않았다면 확인했다고 추측하지 마세요. 없으면 []입니다.
replicability는 일상 공간·스마트폰·일반인 경험으로 수강생이 비슷하게 만들 수 있는 정도 0~100입니다.
category는 특정 상품이나 영상 한 편이 아니라 최근 콘텐츠 전반의 주제로 고르세요. 맞는 분야가 없으면 기타입니다. 부업은 돈 버는 방법·N잡·수익 자체를 다룰 때만이며, 제품 공동구매·협찬 영상은 그 제품의 분야(옷·가방이면 패션, 청소용품·가전이면 살림, 식품·조리도구면 요리, 아이 용품이면 육아)입니다.
분야 구분: 피부는 스킨케어·피부 고민·성분·피부과 시술, 뷰티는 메이크업·헤어·네일·향수·뷰티템입니다. 먹방은 먹는 장면·맛집, 요리는 레시피·조리 과정입니다. 일상은 브이로그·일상 기록, 부업은 부업·N잡·온라인 수익, 부동산은 매매·청약·임대, 재테크는 저축·투자·절약입니다.
region은 한국 이용자 대상 국내 활동 계정이면 domestic, 해외 이용자 대상이면 overseas, 근거 부족이면 unknown입니다. 한국어 사용만으로 단정하지 마세요.
reels에는 제공된 터진 릴스 각각에 대해 faceVisibility(이미지에서 크리에이터 얼굴이 대부분 보이면 visible, 일부만 mixed, 손·제품·화면만 hidden, 판단 불가 unknown), captionKo(캡션이 한국어가 아니면 첫 문장을 자연스러운 한국어로 번역, 한국어면 빈 문자열), category(그 릴스 한 편의 주제 분야. 계정 분야와 달라도 캡션·썸네일이 말하는 그 릴스의 주제를 따릅니다. 예: 피부 계정이 올린 운동 영상은 다이어트·운동)를 반환하세요.
각 판정의 근거는 관찰한 사실로 짧게 적으세요.`
const list = { type: 'array', items: { type: 'string' } }
export const successReelReviewSchema = { type: 'object', additionalProperties: false,
  required: ['accountType', 'accountTypeEvidence', 'ordinaryCreator', 'ordinaryCreatorEvidence', 'productionLevel', 'productionEvidence',
    'monetizationEvidence', 'replicability', 'replicabilityEvidence', 'category', 'region', 'regionEvidence', 'language', 'reels'],
  properties: {
    accountType: { type: 'string', enum: ['individual_creator', 'brand', 'organization', 'unknown'] }, accountTypeEvidence: list,
    ordinaryCreator: { type: ['boolean', 'null'] }, ordinaryCreatorEvidence: list,
    productionLevel: { type: 'string', enum: ['personal', 'semi_pro', 'professional', 'unknown'] }, productionEvidence: list,
    monetizationEvidence: list, replicability: { type: 'number', minimum: 0, maximum: 100 }, replicabilityEvidence: list,
    category: { type: 'string', enum: SUCCESS_REEL_CATEGORIES }, region: { type: 'string', enum: ['domestic', 'overseas', 'unknown'] }, regionEvidence: list,
    language: { type: 'string', enum: ['ko', 'en', 'ja', 'other', 'unknown'] },
    reels: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['shortcode', 'faceVisibility', 'captionKo', 'category'], properties: {
      shortcode: { type: 'string' }, faceVisibility: { type: 'string', enum: ['visible', 'hidden', 'mixed', 'unknown'] }, captionKo: { type: 'string' }, category: { type: 'string', enum: SUCCESS_REEL_CATEGORIES } } } },
  } }

// Same exclusion policy as the account recommendations; undecidable accounts never pass.
export function reviewDecision(review, profile) {
  if (profile.followers >= SUCCESS_REEL_MAX_FOLLOWERS) return { eligible: false, reason: '초대형 계정(유명인)' }
  if (obviousNonReferenceAccount({ full_name: profile.fullName, biography: profile.biography, category_name: profile.categoryName }, profile.username)) return { eligible: false, reason: '브랜드·미디어·유명인 신호' }
  if (review?.accountType !== 'individual_creator') return { eligible: false, reason: '개인 크리에이터 아님' }
  // Only confirmed celebrities are excluded; a missing signal is not evidence of fame.
  if (review.ordinaryCreator === false) return { eligible: false, reason: '연예인·소속사 등 제외 대상' }
  if (!['personal', 'semi_pro'].includes(review.productionLevel)) return { eligible: false, reason: review.productionLevel === 'professional' ? '전문·고비용 제작' : '제작 수준 판단 불가' }
  return { eligible: true, reason: null }
}

const reviewFresh = (row, now) => row?.review && row.review_version === SUCCESS_REEL_REVIEW_VERSION
  && Date.parse(row.reviewed_at) > now - SUCCESS_REEL_REVIEW_DAYS * DAY

// deps: { db, providers, readImage(url) -> data URL, now }
export async function ingestAccount(deps, body) {
  const { db, providers, readImage } = deps
  const now = deps.now ?? Date.now()
  const input = normalizeIngest(body, now)
  const qualified = qualifyingReels(input.reels, now)
  const existing = await query(db.from('creator_reel_accounts').select('*').eq('username', input.username).maybeSingle())
  await query(db.from('creator_reel_accounts').upsert({ username: input.username, profile: { ...input.profile, recentReels: input.reels.slice(0, 24) },
    last_seen_at: new Date(now).toISOString() }, { onConflict: 'username', ignoreDuplicates: false }))
  if (!qualified.length) return { username: input.username, qualified: 0, saved: 0, eligible: existing?.eligible ?? null }
  // Celebrity-size accounts are rejected before any AI review or thumbnail download.
  const early = reviewDecision({}, input.profile)
  if (early.reason === '초대형 계정(유명인)') {
    await query(db.from('creator_reel_accounts').update({ eligible: false, reject_reason: early.reason }).eq('username', input.username))
    return { username: input.username, qualified: qualified.length, saved: 0, eligible: false, reason: early.reason }
  }

  // Thumbnails expire within hours, so they are read immediately and reused as review images.
  const images = new Map()
  for (const reel of [...qualified, ...input.reels.filter(r => !qualified.includes(r))].slice(0, 8)) {
    if (!reel.thumbnailUrl) continue
    try { images.set(reel.shortcode, await readImage(reel.thumbnailUrl)) } catch { /* Expired or unavailable thumbnail. */ }
  }
  let review = reviewFresh(existing, now) ? existing.review : null
  const missingReels = review ? qualified.filter(reel => !review.reels?.some(r => r.shortcode === reel.shortcode)) : qualified
  if (!review || missingReels.length) {
    const frames = [...images].map(([shortcode, url]) => ({ url, label: `릴스 ${shortcode} 썸네일${qualified.some(r => r.shortcode === shortcode) ? ' (터진 릴스)' : ''}` }))
    const fresh = await providers.json('success-reel-review', successReelReviewPrompt, {
      profile: input.profile,
      successReels: qualified.map(({ shortcode, views, caption, postedAt }) => ({ shortcode, views, caption, postedAt })),
      recentReels: input.reels.slice(0, 12).map(({ shortcode, views, caption }) => ({ shortcode, views, caption })),
    }, frames, successReelReviewSchema)
    review = review ? { ...review, reels: [...(review.reels || []), ...fresh.reels] } : fresh
  }
  // 계정 추천 catalog accounts were vetted by hand; the AI review only classifies their reels.
  const vetted = await query(db.from('creator_reference_catalog').select('username').eq('username', input.username).eq('active', true).maybeSingle())
  const decision = vetted && input.profile.followers < SUCCESS_REEL_MAX_FOLLOWERS ? { eligible: true, reason: null } : reviewDecision(review, input.profile)
  await query(db.from('creator_reel_accounts').update({ review, review_version: SUCCESS_REEL_REVIEW_VERSION, eligible: decision.eligible,
    reject_reason: decision.reason, reviewed_at: reviewFresh(existing, now) && !missingReels.length ? existing.reviewed_at : new Date(now).toISOString() })
    .eq('username', input.username))

  let saved = 0
  for (const reel of qualified) {
    const judged = review.reels?.find(r => r.shortcode === reel.shortcode)
    const current = await query(db.from('creator_success_reels').select('thumbnail_path,visible,analysis_status,caption').eq('shortcode', reel.shortcode).maybeSingle())
    // A reel a student saved or analyzed stays listed even if its account is later rejected.
    const kept = current?.visible && (current.analysis_status !== 'none'
      || (await query(db.from('creator_reel_saves').select('shortcode').eq('shortcode', reel.shortcode).limit(1))).length > 0)
    let thumbnailPath = current?.thumbnail_path || null
    const image = images.get(reel.shortcode)
    if (!thumbnailPath && image) {
      const [, type, data] = image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/) || []
      if (type) {
        const path = `${reel.shortcode}.${type.split('/')[1].replace('jpeg', 'jpg')}`
        const { error } = await db.storage.from(THUMBNAIL_BUCKET).upload(path, Buffer.from(data, 'base64'), { contentType: type, upsert: true })
        if (!error) thumbnailPath = path
      }
    }
    await query(db.from('creator_success_reels').upsert({ shortcode: reel.shortcode, username: input.username, views: reel.views,
      likes: reel.likes, comments: reel.comments, posted_at: reel.postedAt,
      // The reels tab never carries captions; a caption read from the reel page earlier must survive revisits.
      caption: reel.caption || current?.caption || '', caption_ko: judged?.captionKo?.trim() || null, language: review.language, region: review.region === 'unknown' ? null : review.region,
      audio: reel.audio, category: SUCCESS_REEL_CATEGORIES.includes(judged?.category) ? judged.category : review.category, face_visibility: judged?.faceVisibility || 'unknown', thumbnail_path: thumbnailPath,
      source: input.source, visible: Boolean(kept) || (decision.eligible && Boolean(thumbnailPath)), last_collected_at: new Date(now).toISOString(),
      ...(reel.caption ? { category_checked_at: new Date(now).toISOString() } : {}) }, { onConflict: 'shortcode' }))
    if (reel.videoUrl) await cacheVideoUrl(deps.redis, reel.shortcode, reel.videoUrl, now)
    saved += 1
  }
  return { username: input.username, qualified: qualified.length, saved, eligible: decision.eligible, reason: decision.reason }
}

// A CDN video link the collector read is kept until shortly before its own expiry (capped), so hover previews and
// analysis downloads skip the extractor and Bright Data entirely.
export const VIDEO_CACHE_MAX_SECONDS = 5 * 86400
export async function cacheVideoUrl(redis, shortcode, url, now = Date.now()) {
  const link = playbackUrl(url)
  if (!redis || !link) return false
  const expires = parseInt(new URL(link).searchParams.get('oe') || '', 16) * 1000
  const ttl = Math.floor(Math.min(Number.isFinite(expires) ? expires - now - 3600000 : 3600000, VIDEO_CACHE_MAX_SECONDS * 1000) / 1000)
  if (ttl <= 60) return false
  await redis.set(`success-reel-video:${shortcode}`, link, 'EX', ttl).catch(() => {})
  return true
}

// Per-reel category from the caption. The account review guessed from the profile while captions were still empty.
export const reelCategoryPrompt = `각 릴스의 캡션(과 계정명)을 보고 그 릴스 한 편의 주제 분야를 고르세요. 계정 전체가 아니라 그 영상의 내용입니다.
분야 구분: 피부는 스킨케어·피부 고민·성분·피부과 시술, 뷰티는 메이크업·헤어·네일·향수·뷰티템, 먹방은 먹는 장면·맛집, 요리는 레시피·조리·식재료·주방 조리도구, 살림은 청소·정리·수납·인테리어·가전·생활용품·침구, 육아는 아이·이유식·육아템·가족 일상, 패션은 옷·신발·코디, 교육은 입시·대학·시험·공부, 부업은 돈 버는 방법·N잡·수익 자체를 다룰 때만(제품 공동구매 홍보 영상은 그 제품의 분야), 재테크는 투자·저축, 전문직(회사홍보)은 회사·서비스 소개, 테크 가젯은 전자기기, 일상은 특정 주제 없이 하루를 담은 브이로그. 맞는 분야가 없으면 기타.`
export const reelCategorySchema = { type: 'object', additionalProperties: false, required: ['reels'], properties: {
  reels: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['shortcode', 'category'], properties: {
    shortcode: { type: 'string' }, category: { type: 'string', enum: SUCCESS_REEL_CATEGORIES } } } } } }
export async function classifyReelCategories(db, providers, rows, now = Date.now()) {
  const input = rows.filter(r => text(r.caption, 1).trim()).map(r => ({ shortcode: r.shortcode, username: r.username, caption: text(r.caption, 700) }))
  if (!input.length) return 0
  const judged = await providers.json('success-reel-category', reelCategoryPrompt, { reels: input }, [], reelCategorySchema)
  let changed = 0
  for (const row of input) {
    const category = judged?.reels?.find(j => j.shortcode === row.shortcode)?.category
    const patch = { category_checked_at: new Date(now).toISOString() }
    if (SUCCESS_REEL_CATEGORIES.includes(category)) { patch.category = category; changed += 1 }
    await query(db.from('creator_success_reels').update(patch).eq('shortcode', row.shortcode))
  }
  return changed
}
// Listed reels whose category was set before their caption was known, most watched first.
export async function reelsNeedingCategory(db, limit = 30) {
  const rows = await query(db.from('creator_success_reels').select('shortcode,username,caption,source').eq('visible', true).neq('caption', '').is('category_checked_at', null).order('views', { ascending: false }).limit(limit * 2))
  return rows.filter(row => !String(row.source || '').startsWith('upload-')).slice(0, limit)
}

// Captions read from reel pages, for rows the reels tab left empty. Only filled captions are stored.
export function normalizeCaptions(body) {
  if (!Array.isArray(body?.captions) || body.captions.length > 200) fail('INVALID_CAPTIONS', '캡션 목록을 확인해주세요.')
  const seen = new Set()
  return body.captions.flatMap(item => {
    const caption = text(item?.caption, 2000).trim(), videoUrl = playbackUrl(item?.videoUrl), views = count(item?.views)
    if (!shortcodePostedAt(item?.shortcode) || (!caption && !videoUrl && !views) || seen.has(item.shortcode)) return []
    seen.add(item.shortcode)
    return [{ shortcode: item.shortcode, caption, videoUrl, views, likes: count(item?.likes), comments: count(item?.comments), thumbnailUrl: cdnUrl(item?.thumbnailUrl) }]
  })
}
// An analysis made while the caption was still empty described a captionless reel; it is redone once the caption lands.
export async function storeReelCaptions(db, body, redis = null, { readImage = null, now = Date.now() } = {}) {
  const captions = normalizeCaptions(body)
  const reanalyze = [], filled = []
  let saved = 0
  for (const item of captions) {
    const { shortcode, caption, videoUrl } = item
    const row = await query(db.from('creator_success_reels').select('shortcode,username,caption,analysis_status,source,views,thumbnail_path,visible,posted_at').eq('shortcode', shortcode).maybeSingle())
    if (!row) continue
    saved += 1
    if (videoUrl) await cacheVideoUrl(redis, shortcode, videoUrl, now)
    const patch = {}
    // Counts read from the reel page are the real ones; link uploads start at 0 when Bright Data had none.
    if (item.views) { patch.views = item.views; if (item.likes !== null) patch.likes = item.likes; if (item.comments !== null) patch.comments = item.comments }
    if (!row.thumbnail_path && item.thumbnailUrl && readImage) {
      const image = await readImage(item.thumbnailUrl).catch(() => null)
      const [, type, data] = String(image || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/) || []
      if (type) {
        const path = `${shortcode}.${type.split('/')[1].replace('jpeg', 'jpg')}`
        const { error } = await db.storage.from(THUMBNAIL_BUCKET).upload(path, Buffer.from(data, 'base64'), { contentType: type, upsert: true })
        if (!error) patch.thumbnail_path = path
      }
    }
    if (caption && !row.caption) {
      patch.caption = caption
      if (row.analysis_status === 'ready') { patch.analysis_status = 'none'; reanalyze.push(shortcode) }
      filled.push({ shortcode, username: row.username, caption })
    }
    // A student's link that turns out to be a success reel joins the archive like a collected one.
    if (row.source === 'upload-link' && !row.visible && (patch.views ?? row.views) >= SUCCESS_REEL_MIN_VIEWS
      && Date.parse(row.posted_at) >= now - SUCCESS_REEL_MAX_AGE_DAYS * DAY && (patch.thumbnail_path || row.thumbnail_path)) patch.visible = true
    if (Object.keys(patch).length) await query(db.from('creator_success_reels').update(patch).eq('shortcode', shortcode))
  }
  return { saved, reanalyze, filled }
}
// Listed reels still missing a caption, most watched first, for the collector to read from their pages.
// Reel pages worth a visit: students' Instagram links first (their counts and cover come from the page), then
// listed reels still missing a caption or a cached video link, most watched first.
export async function reelsMissingCaptions(db, limit = 40, redis = null) {
  const links = await query(db.from('creator_success_reels').select('shortcode,views,thumbnail_path,first_collected_at').eq('source', 'upload-link').order('first_collected_at', { ascending: false }).limit(60))
  const out = links.filter(row => !row.views || !row.thumbnail_path).map(row => row.shortcode).slice(0, limit)
  const rows = (await query(db.from('creator_success_reels').select('shortcode,source,caption').eq('visible', true).order('views', { ascending: false }).limit(400)))
    .filter(row => !String(row.source || '').startsWith('upload-'))
  for (const row of rows) {
    if (out.length >= limit) break
    const cached = row.caption && redis ? await redis.exists(`success-reel-video:${row.shortcode}`).catch(() => 1) : 0
    if (!row.caption || !cached) out.push(row.shortcode)
  }
  return out
}

const LIST_SORTS = { latest: 'posted_at', views: 'views', popular: 'analysis_requests' }
// Free-text search over stored fields only. Characters that carry meaning in a
// PostgREST filter (commas, parentheses, wildcards, quotes, backslashes) are dropped.
export function searchTerm(value) {
  if (typeof value !== 'string') return ''
  return value.normalize('NFC').replace(/[^\p{L}\p{N}\s._#@-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
}
export async function listSuccessReels(db, filters = {}, userId = null) {
  const sort = LIST_SORTS[filters.sort] ? filters.sort : 'latest'
  const limit = 48
  const page = Math.max(0, Math.min(50, Number.parseInt(filters.page, 10) || 0))
  let request = db.from('creator_success_reels').select('shortcode,username,views,likes,comments,posted_at,caption,caption_ko,language,region,audio,category,face_visibility,thumbnail_path,analysis_status,analysis_requests')
    .eq('visible', true)
  if (SUCCESS_REEL_CATEGORIES.includes(filters.category)) request = request.eq('category', filters.category)
  if (['visible', 'hidden', 'mixed'].includes(filters.face)) request = request.eq('face_visibility', filters.face)
  if (['domestic', 'overseas'].includes(filters.region)) request = request.eq('region', filters.region)
  const saves = userId ? await query(db.from('creator_reel_saves').select('shortcode').eq('user_id', userId).limit(5000)) : []
  const savedCodes = new Set(saves.map(row => row.shortcode))
  if (filters.saved === '1') {
    if (!savedCodes.size) return { lastUpdatedAt: null, reels: [], page, hasMore: false, sort, q: searchTerm(filters.q) }
    request = request.in('shortcode', [...savedCodes])
  }
  // Analyses are shared, but a student only sees "분석됨" on reels they analyzed themselves.
  const mine = userId ? await query(db.from('creator_reel_user_analyses').select('shortcode').eq('user_id', userId).limit(5000)) : []
  const analyzedCodes = new Set(mine.map(row => row.shortcode))
  if (filters.analyzed === '1') {
    if (!analyzedCodes.size) return { lastUpdatedAt: null, reels: [], page, hasMore: false, sort, q: searchTerm(filters.q) }
    request = request.in('shortcode', [...analyzedCodes])
  }
  const q = searchTerm(filters.q)
  if (q) request = request.or(['caption', 'caption_ko', 'username', 'audio'].map(field => `${field}.ilike.%${q}%`).join(','))
  if (sort === 'popular') request = request.order('analysis_requests', { ascending: false })
  const rows = await query(request.order(sort === 'popular' ? 'views' : LIST_SORTS[sort], { ascending: false }).range(page * limit, page * limit + limit - 1))
  const paths = rows.map(row => row.thumbnail_path).filter(Boolean)
  const signed = paths.length ? await query(db.storage.from(THUMBNAIL_BUCKET).createSignedUrls(paths, 3600)) : []
  const urls = new Map(signed.filter(item => item.signedUrl).map(item => [item.path, item.signedUrl]))
  // Shown as "업데이트 ..." on the screen: when the last daily collection finished.
  const lastRun = page === 0 ? await query(db.from('creator_reel_ingest_runs').select('finished_at')
    .order('finished_at', { ascending: false, nullsFirst: false }).limit(1)) : []
  return { lastUpdatedAt: lastRun[0]?.finished_at || null, reels: rows.map(row => ({ shortcode: row.shortcode, permalink: `https://www.instagram.com/reel/${row.shortcode}/`,
    username: row.username, views: row.views, likes: row.likes, comments: row.comments, postedAt: row.posted_at,
    caption: row.caption, captionKo: row.caption_ko, language: row.language, region: row.region, audio: row.audio,
    category: row.category, faceVisibility: row.face_visibility, thumbnailUrl: urls.get(row.thumbnail_path) || null,
    analysisStatus: analyzedCodes.has(row.shortcode) ? row.analysis_status || 'none' : 'none', analysisRequests: row.analysis_requests || 0, saved: savedCodes.has(row.shortcode) })),
  page, hasMore: rows.length === limit, sort, q }
}
