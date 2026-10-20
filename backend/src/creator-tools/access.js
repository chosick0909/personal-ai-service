import { fail } from './domain.js'

// Use the redeemed entitlement's period, not the coupon's redemption deadline.
// Check all active grants. Legacy paid grants may have no coupon_id: the
// existing entitlement system uses this shape for directly granted access.
// Do not confuse a coupon registration link with the validity of the grant.
export async function assertCreatorCoupon(db, userId, now = Date.now()) {
  if (!userId) fail('UNAUTHORIZED', '로그인이 필요합니다.', 401)
  const nowIso = new Date(now).toISOString()
  const { data, error } = await db.from('user_entitlements')
    .select('id,coupon_id,plan_type,status,starts_at,ends_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .lte('starts_at', nowIso)
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
  if (error) fail('CREATOR_ACCESS_UNAVAILABLE', '쿠폰 이용기간을 확인하지 못했습니다. 잠시 후 다시 확인해주세요.', 503)
  const grants = (data || []).filter((row) =>
    (row.coupon_id || row.plan_type === 'paid') && row.status === 'active' && Date.parse(row.starts_at) <= now
    && (row.ends_at === null || Date.parse(row.ends_at) > now))
  // Longest valid grant controls the UI expiry; every API still checks the DB.
  grants.sort((a, b) => (b.ends_at === null ? Infinity : Date.parse(b.ends_at))
    - (a.ends_at === null ? Infinity : Date.parse(a.ends_at)))
  if (!grants.length) fail('CREATOR_COUPON_REQUIRED', '크리에이터스튜디오는 유효한 쿠폰 또는 지급 이용권이 있는 로그인 사용자만 이용할 수 있습니다.', 403)
  return grants[0]
}
