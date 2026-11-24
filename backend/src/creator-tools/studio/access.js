import { isDemoUser } from '../demo-access.js'

// Creator Studio 2 is open to every student (2026-10-27); the coupon check in front of /creator-tools still decides
// who may use it. CREATOR_STUDIO2_ENABLED=false closes it again to the listed users and client trial accounts.
const DEFAULT_PREVIEW_USER_IDS = ['15c6e788-7d77-4954-be5d-200c2c410dad'] // pizzab4@g.hongik.ac.kr

export function studio2Enabled(userId, env = process.env) {
  if (env.CREATOR_STUDIO2_ENABLED !== 'false' || isDemoUser(userId)) return true
  const listed = String(env.CREATOR_STUDIO2_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean)
  return (listed.length ? listed : DEFAULT_PREVIEW_USER_IDS).includes(userId)
}

// Who may mark reels as 추천 (links 지영 or the client hand over). Defaults to 지영's account.
export function canRecommend(userId, env = process.env) {
  const listed = String(env.CREATOR_RECOMMENDER_IDS || '').split(',').map(id => id.trim()).filter(Boolean)
  return (listed.length ? listed : DEFAULT_PREVIEW_USER_IDS).includes(userId)
}

// 캐러셀 만들기 is used inside the team first (quality is tuned before students see it): 지영's account by default,
// plus the accounts listed in CREATOR_CAROUSEL_MAKER_IDS. 'all' opens it to everyone who has the studio.
export function carouselMakerEnabled(userId, env = process.env) {
  const value = String(env.CREATOR_CAROUSEL_MAKER_IDS || '').trim()
  if (value === 'all') return studio2Enabled(userId, env)
  const listed = value.split(',').map(id => id.trim()).filter(Boolean)
  return [...DEFAULT_PREVIEW_USER_IDS, ...listed].includes(userId)
}
