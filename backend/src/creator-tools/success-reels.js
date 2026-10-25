import { fail } from './domain.js'
import { query } from './store.js'
import { CREATOR_CATEGORIES } from './categories.js'
import { obviousNonReferenceAccount } from './reference-quality.js'

// Success reels: public Instagram reels with 500k+ views uploaded in the last 3 months,
// from individual creators whose production is reproducible at home. Domestic and overseas.
export const SUCCESS_REEL_MIN_VIEWS = 500000
export const SUCCESS_REEL_MAX_AGE_DAYS = 90
export const SUCCESS_REEL_REVIEW_VERSION = 1
export const SUCCESS_REEL_REVIEW_DAYS = 30
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
  if (!Array.isArray(body.reels) || body.reels.length > 48) fail('INVALID_REELS', '릴스 목록을 확인해주세요.')
  const seen = new Set()
  const reels = body.reels.flatMap(reel => {
    const postedAt = shortcodePostedAt(reel?.shortcode)
    const views = count(reel?.views)
    if (!postedAt || postedAt.getTime() > now + DAY || views === null || seen.has(reel.shortcode)) return []
    seen.add(reel.shortcode)
    return [{ shortcode: reel.shortcode, views, likes: count(reel.likes), comments: count(reel.comments),
      postedAt: postedAt.toISOString(), caption: text(reel.caption, 2000), audio: text(reel.audio, 200) || null,
      thumbnailUrl: cdnUrl(reel.thumbnailUrl) }]
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
연예인·방송인·아이돌·배우·가수·개그맨·프로선수·전업모델 출신, MCN·소속사·에이전시 소속(비즈니스 문의처 포함)은 ordinaryCreator=false입니다. 일반인임을 판단할 근거가 부족하면 null입니다. 팔로워 수만으로 판단하지 마세요.
집·주방·욕실·동네에서 스마트폰으로 재현 가능한 촬영은 personal, 소규모 보조 제작은 semi_pro, 전문 스튜디오·편집팀·고비용 제작은 professional, 근거 부족은 unknown입니다. 외모의 아름다움·평범함·매력을 절대 평가하지 마세요.
monetizationEvidence는 확인된 쇼핑몰/제휴 링크, 공동구매·체험단, #광고/#협찬/#유료광고 협업, 자체 제품·클래스 판매만 적으세요. 링크 내용이 제공되지 않았다면 확인했다고 추측하지 마세요. 없으면 []입니다.
replicability는 일상 공간·스마트폰·일반인 경험으로 수강생이 비슷하게 만들 수 있는 정도 0~100입니다.
category는 특정 상품이나 영상 한 편이 아니라 최근 콘텐츠 전반의 주제로 고르세요. 맞는 분야가 없으면 기타입니다.
region은 한국 이용자 대상 국내 활동 계정이면 domestic, 해외 이용자 대상이면 overseas, 근거 부족이면 unknown입니다. 한국어 사용만으로 단정하지 마세요.
reels에는 제공된 터진 릴스 각각에 대해 faceVisibility(이미지에서 크리에이터 얼굴이 대부분 보이면 visible, 일부만 mixed, 손·제품·화면만 hidden, 판단 불가 unknown)와 captionKo(캡션이 한국어가 아니면 첫 문장을 자연스러운 한국어로 번역, 한국어면 빈 문자열)를 반환하세요.
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
    category: { type: 'string', enum: CREATOR_CATEGORIES }, region: { type: 'string', enum: ['domestic', 'overseas', 'unknown'] }, regionEvidence: list,
    language: { type: 'string', enum: ['ko', 'en', 'ja', 'other', 'unknown'] },
    reels: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['shortcode', 'faceVisibility', 'captionKo'], properties: {
      shortcode: { type: 'string' }, faceVisibility: { type: 'string', enum: ['visible', 'hidden', 'mixed', 'unknown'] }, captionKo: { type: 'string' } } } },
  } }

// Same exclusion policy as the account recommendations; undecidable accounts never pass.
export function reviewDecision(review, profile) {
  if (obviousNonReferenceAccount({ full_name: profile.fullName, biography: profile.biography, category_name: profile.categoryName }, profile.username)) return { eligible: false, reason: '브랜드·미디어·유명인 신호' }
  if (review?.accountType !== 'individual_creator') return { eligible: false, reason: '개인 크리에이터 아님' }
  if (review.ordinaryCreator !== true) return { eligible: false, reason: review.ordinaryCreator === false ? '연예인·소속사 등 제외 대상' : '일반인 여부 판단 불가' }
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
  const decision = reviewDecision(review, input.profile)
  await query(db.from('creator_reel_accounts').update({ review, review_version: SUCCESS_REEL_REVIEW_VERSION, eligible: decision.eligible,
    reject_reason: decision.reason, reviewed_at: reviewFresh(existing, now) && !missingReels.length ? existing.reviewed_at : new Date(now).toISOString() })
    .eq('username', input.username))

  let saved = 0
  for (const reel of qualified) {
    const judged = review.reels?.find(r => r.shortcode === reel.shortcode)
    const current = await query(db.from('creator_success_reels').select('thumbnail_path').eq('shortcode', reel.shortcode).maybeSingle())
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
      likes: reel.likes, comments: reel.comments, posted_at: reel.postedAt, caption: reel.caption,
      caption_ko: judged?.captionKo?.trim() || null, language: review.language, region: review.region === 'unknown' ? null : review.region,
      audio: reel.audio, category: review.category, face_visibility: judged?.faceVisibility || 'unknown', thumbnail_path: thumbnailPath,
      source: input.source, visible: decision.eligible && Boolean(thumbnailPath), last_collected_at: new Date(now).toISOString() }, { onConflict: 'shortcode' }))
    saved += 1
  }
  return { username: input.username, qualified: qualified.length, saved, eligible: decision.eligible, reason: decision.reason }
}

const LIST_SORTS = { latest: 'posted_at', views: 'views' }
export async function listSuccessReels(db, filters = {}) {
  const sort = LIST_SORTS[filters.sort] ? filters.sort : 'latest'
  const limit = 48
  const page = Math.max(0, Math.min(50, Number.parseInt(filters.page, 10) || 0))
  let request = db.from('creator_success_reels').select('shortcode,username,views,likes,comments,posted_at,caption,caption_ko,language,region,audio,category,face_visibility,thumbnail_path')
    .eq('visible', true)
  if (CREATOR_CATEGORIES.includes(filters.category)) request = request.eq('category', filters.category)
  if (['visible', 'hidden', 'mixed'].includes(filters.face)) request = request.eq('face_visibility', filters.face)
  if (['domestic', 'overseas'].includes(filters.region)) request = request.eq('region', filters.region)
  const rows = await query(request.order(LIST_SORTS[sort], { ascending: false }).range(page * limit, page * limit + limit - 1))
  const paths = rows.map(row => row.thumbnail_path).filter(Boolean)
  const signed = paths.length ? await query(db.storage.from(THUMBNAIL_BUCKET).createSignedUrls(paths, 3600)) : []
  const urls = new Map(signed.filter(item => item.signedUrl).map(item => [item.path, item.signedUrl]))
  return { reels: rows.map(row => ({ shortcode: row.shortcode, permalink: `https://www.instagram.com/reel/${row.shortcode}/`,
    username: row.username, views: row.views, likes: row.likes, comments: row.comments, postedAt: row.posted_at,
    caption: row.caption, captionKo: row.caption_ko, language: row.language, region: row.region, audio: row.audio,
    category: row.category, faceVisibility: row.face_visibility, thumbnailUrl: urls.get(row.thumbnail_path) || null })),
  page, hasMore: rows.length === limit, sort }
}
