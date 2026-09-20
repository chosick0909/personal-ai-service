// Shared fail-closed policy for live reviews, Redis evidence and operator catalog imports.
export const REFERENCE_QUALITY_VERSION = 3
// Explicit operator rejections, 2026-09-19: persist across search, cache and catalog reads.
export const REFERENCE_REJECTED_ACCOUNTS = Object.freeze(['karennppo', 'love1004kgj'])
const texts = (value, nonempty = true) => Array.isArray(value) && (!nonempty || value.length > 0)
  && value.every(item => typeof item === 'string' && item.trim().length > 0)
const fresh = (value, days, now) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= now
  && Date.parse(value) > now - days * 86400000
const normalizedText = value => typeof value === 'string' ? value.slice(0, 4000).normalize('NFKC').toLowerCase() : ''
const brandUsername = /(^|[._])(official|shop|store|brand|corp|company|magazine|news|agency|mcn)([._]|$)/i
const brandCategory = /(brand|product\/service|shopping\s*&\s*retail|company|corporation|local business|cosmetics store|브랜드|제품.?서비스|쇼핑.?소매|회사|기업|기관|쇼핑몰|상점)/i
const brandIdentity = /(공식\s*(계정|인스타그램|채널)|브랜드\s*공식|official\s*(account|instagram|channel)|주식회사|\binc\.?\b|\bcorp(?:oration)?\b|\bcompany\b)/i
const nonCreator = /(연예인|방송인|아이돌|개그맨|코미디언|프로\s*(운동선수|선수)|전업\s*모델|패션\s*모델|소속사|소속\s*[:：]|에이전시|엔터테인먼트|매니지먼트|데뷔|출연작|\b(actor|actress|singer|comedian|celebrity|idol|agency|mcn|entertainment|management|professional athlete|fashion model|full.time model|represented by)\b)/i
const publicFigureRole = /(?:^|[\s·|,/])(배우|가수|모델|actor|actress|singer|model|athlete)(?=$|[\s·|,/:：])/i
const mediaIdentity = /(미디어|매거진|뉴스|큐레이션|리포스트|편집팀|제작팀|전문\s*스튜디오|\b(media|magazine|news|curation|repost|production team|production studio)\b)/i
export function obviousNonReferenceAccount(record, username) {
  const category = `${normalizedText(record?.category_name ?? record?.categoryName)} ${normalizedText(record?.business_category_name ?? record?.businessCategoryName)}`
  const identity = `${normalizedText(record?.full_name || record?.profile_name || record?.displayName)} ${normalizedText(record?.biography)}`
  return REFERENCE_REJECTED_ACCOUNTS.includes(String(username || '').toLowerCase()) || brandUsername.test(username || '') || brandCategory.test(category) || brandIdentity.test(identity)
    || publicFigureRole.test(`${category} ${identity}`) || nonCreator.test(`${category} ${identity}`) || mediaIdentity.test(`${category} ${identity}`)
}
export function instagramPostUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && ['instagram.com', 'www.instagram.com'].includes(url.hostname)
      && !url.port && !url.username && !url.password && /^\/(p|reel|reels)\/[\w-]+\/?$/.test(url.pathname)
      ? `https://www.instagram.com${url.pathname.replace(/\/?$/, '/')}` : null
  } catch { return null }
}
export function publicEvidenceEligible(row, now = Date.now()) {
  const p = row?.profile
  return Boolean(p && /^[a-zA-Z0-9_.]{1,30}$/.test(row.username || '')
    && Number.isSafeInteger(p.followers) && p.followers >= 10000
    && fresh(row.verified_at, 30, now) && fresh(row.last_active_at, 90, now)
    && Array.isArray(p.exampleMedia) && p.exampleMedia.every(media => media && instagramPostUrl(media.permalink))
    && (!p.recentReelsSelection || p.recentReelsSelection.profileUrl === `https://www.instagram.com/${row.username}/`)
    && !obviousNonReferenceAccount(p, row.username))
}
// Use chronological, unique reels, never the highest-view subset. Missing views stay missing.
export function referencePerformance(profile, now = Date.now()) {
  const seen = new Set(), raw = Array.isArray(profile?.recentReels) ? profile.recentReels : []
  const selection=profile?.recentReelsSelection
  const owner=selection?.profileUrl?.match(/^https:\/\/www\.instagram\.com\/([a-zA-Z0-9_.]{1,30})\/$/)?.[1]
  const providerSelected=Boolean(selection?.method === 'provider_recent_reels' && selection.requestedCount === 24
    && fresh(selection.collectedAt,30,now) && owner && raw.length >= 12 && raw.length <= 24 && raw.every(p=>p?.owner === owner && instagramPostUrl(p.permalink) && Number.isFinite(Date.parse(p.timestamp)) && Date.parse(p.timestamp) <= now))
  const samples = raw
    .filter(p => p && instagramPostUrl(p.permalink) && (providerSelected || (Number.isFinite(Date.parse(p.timestamp)) && Date.parse(p.timestamp) <= now)))
    .sort((a,b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .filter(p => { const key = instagramPostUrl(p.permalink); if (seen.has(key)) return false; seen.add(key); return true })
    .slice(0, 12).map(({ permalink, timestamp, views }) => ({ permalink, timestamp,
      views:Number.isSafeInteger(views) && views >= 0 ? views : null }))
  const measured = samples.map(p => p.views).filter(Number.isFinite).sort((a,b) => a-b)
  const complete = samples.length === 12 && measured.length === 12 && (!selection || providerSelected)
  return { selection:providerSelected ? 'provider_recent_reels' : 'dated_reels', requiredSamples:12, sampleCount:samples.length, measuredCount:measured.length,
    medianViews:complete ? (measured[5] + measured[6]) / 2 : null,
    minimumViews:complete ? measured[0] : null, maximumViews:complete ? measured[11] : null,
    minimumMedianViews:10000, status:complete ? 'complete' : 'insufficient_data', samples }
}
export function referencePerformanceEligible(profile) {
  const stats = referencePerformance(profile)
  return stats.status === 'complete' && stats.medianViews >= stats.minimumMedianViews
}
export function hardReferenceMetrics(profile) {
  return Boolean(profile && Number.isSafeInteger(profile.followers) && profile.followers >= 10000
    && Number.isSafeInteger(profile.maxViews) && profile.maxViews >= 500000
    && Number.isSafeInteger(profile.viralMedia?.views) && profile.viralMedia.views === profile.maxViews
    && instagramPostUrl(profile.viralMedia?.permalink) && referencePerformanceEligible(profile))
}
export function referenceQualityEligible(rank, profile) {
  const knownPosts = new Set((Array.isArray(profile?.exampleMedia) ? profile.exampleMedia : []).map(p => instagramPostUrl(p?.permalink)).filter(Boolean))
  const knownSources = new Set([...knownPosts, profile?.externalUrl].filter(Boolean))
  return Boolean(rank?.accountType === 'individual_creator' && rank.ordinaryCreator === true
    && rank.domesticCreator === true && texts(rank.domesticCreatorEvidence)
    && ['personal', 'semi_pro'].includes(rank.productionLevel)
    && Number.isFinite(rank.replicability) && rank.replicability >= 0 && rank.replicability <= 100
    && texts(rank.accountTypeEvidence) && texts(rank.ordinaryCreatorEvidence) && texts(rank.productionEvidence)
    && texts(rank.replicabilityEvidence) && texts(rank.monetizationEvidence, false)
    && texts(rank.evidencePostUrls) && rank.evidencePostUrls.every(url => knownPosts.has(instagramPostUrl(url)))
    && texts(rank.monetizationSourceUrls, false)
    && (!rank.monetizationEvidence.length || rank.monetizationSourceUrls.length > 0)
    && rank.monetizationSourceUrls.every(url => knownSources.has(instagramPostUrl(url) || url)))
}
export function operatorReviewEligible(profile, now = Date.now()) {
  return Boolean(profile?.qualityVersion === REFERENCE_QUALITY_VERSION && profile.reviewedByOperator === true
    && typeof profile.reviewedBy === 'string' && profile.reviewedBy.trim()
    && fresh(profile.reviewedAt, 30, now))
}
export function catalogQualityEligible(row, category, now = Date.now()) {
  return publicEvidenceEligible(row, now) && hardReferenceMetrics(row.profile) && operatorReviewEligible(row.profile, now)
    && Date.parse(row.profile.reviewedAt) >= Date.parse(row.verified_at)
    && row.profile.accountType === 'individual_creator' && Array.isArray(row.profile.categories)
    && row.profile.categories.includes(category) && referenceQualityEligible(row.profile.accountInsights?.[category], row.profile)
}
export function referenceQualityScore(base, rank, profile) {
  const median = referencePerformance(profile).medianViews
  const reach = profile.followers > 0 && median !== null ? Math.min(100, median / profile.followers * 10) : 0
  const score = Math.round(base * 0.65 + rank.replicability * 0.25 + reach * 0.1)
  return Math.max(0, score - (rank.monetizationEvidence.length ? 0 : 35))
}
// Do not swallow terminal guards in best-effort search/ranking fallbacks.
export function rethrowReferenceStop(error) {
  if (['SEED_BUDGET', 'SEED_CANCELLED', 'SEED_PROVIDER_CONFIG', 'PROVIDER_BUDGET', 'PROVIDER_CIRCUIT_OPEN'].includes(error?.code)) throw error
}
export const referenceReviewPrompt = `교육생이 실제 재현 가능한 일반인 1인 크리에이터를 심사하세요. 제공된 공개 프로필·캡션·이미지에 근거하고 추측하지 마세요.
국내에서 활동하며 한국 이용자를 대상으로 하는 계정만 domesticCreator=true로 판정하고 공개 근거를 domesticCreatorEvidence에 적으세요. 한국어·한국 이름만으로 국내 활동을 단정하지 마세요. 해외 활동 계정은 false, 국내 활동 근거 부족은 null입니다.
최근 릴스 12개 조회수의 중앙값 1만 이상이 필수입니다. 최고 조회수 한 편을 계정 전반의 성과로 해석하지 말고 제공된 performance.samples의 전체 분포를 참고하세요.
선택 카테고리 적합도는 최근 게시물 전반의 주제·전달 방식을 기준으로 0~100으로 평가하세요. 프로필 분야명·상품 하나·흥행 한 편으로 높게 판단하지 말고 다른 분야 중심 또는 반복 게시 편중이면 reasons에 구체적으로 적으세요.
한 개인의 이름·얼굴·경험·관점이 중심일 때만 accountType=individual_creator. 브랜드·쇼핑몰·상점·회사·기관은 brand/organization, 미디어·매거진·뉴스·큐레이션·리포스트는 organization입니다.
연예인·방송인·아이돌·배우·가수·개그맨·프로선수·전업모델 출신, MCN·소속사·에이전시 소속(비즈니스 문의처 포함)은 ordinaryCreator=false입니다. 일반인임을 판단할 근거가 부족하면 null입니다. 프로 계정 설정·팔로워 수만으로 판단하지 마세요.
집·주방·욕실·동네에서 스마트폰으로 재현 가능한 촬영은 personal, 소규모 보조 제작은 semi_pro, 전문 스튜디오·편집팀·고비용 제작은 professional, 근거 부족은 unknown입니다. 외모의 아름다움·평범함·매력을 절대 평가하지 마세요.
monetizationEvidence는 확인된 스마트스토어/쇼핑몰/제휴 링크, 공동구매·체험단, #광고/#협찬/#유료광고 협업, 자체 제품·클래스·전자책·상담 판매만 적으세요. 링크 내용이 제공되지 않았다면 확인했다고 추측하지 마세요. 없으면 []이며 제외 사유가 아니라 큰 감점입니다.
replicability는 일상 공간·스마트폰·일반인 경험으로 재현 가능한 정도 0~100입니다. 경험담·리뷰·사용법·전후비교 등 신뢰 기반 콘텐츠를 우대하고 팔로워 대비 조회수를 참고하세요. 각 판정의 구체적인 근거를 반환하세요. evidencePostUrls는 반드시 제공된 최근 게시물 URL만, monetizationSourceUrls는 제공된 게시물 URL 또는 externalUrl만 사용하세요.
얼굴 노출은 이미지에서 직접 확인할 때만 visible/hidden/mixed, 아니면 unknown. reasons는 관찰된 특징, referencePoints는 자신의 주제로 독립적으로 기획할 질문을 한국어로 적으세요. 복제 제안은 금지합니다. 모든 후보를 반환하세요.`
const list = { type:'array', items:{ type:'string' } }
const props = {
  username:{ type:'string' }, accountType:{ type:'string', enum:['individual_creator','brand','organization','unknown'] }, accountTypeEvidence:list,
  domesticCreator:{ type:['boolean','null'] }, domesticCreatorEvidence:list,
  ordinaryCreator:{ type:['boolean','null'] }, ordinaryCreatorEvidence:list, monetizationEvidence:list, monetizationSourceUrls:list,
  productionLevel:{ type:'string', enum:['personal','semi_pro','professional','unknown'] }, productionEvidence:list,
  replicability:{ type:'number', minimum:0, maximum:100 }, replicabilityEvidence:list, evidencePostUrls:list,
  categoryMatch:{ type:'number', minimum:0, maximum:100 }, faceVisibility:{ type:'string', enum:['visible','hidden','mixed','unknown'] },
  contentFormats:{ type:'array', items:{ type:'string', enum:['talking','tutorial','vlog','before_after','review','text'] } },
  language:{ type:'string', enum:['ko','en','ja','unknown'] }, reasons:list, referencePoints:list,
}
export const referenceReviewSchema = { type:'object', additionalProperties:false, required:['accounts'], properties:{
  accounts:{ type:'array', items:{ type:'object', additionalProperties:false, required:Object.keys(props), properties:props } },
} }
