update public.user_entitlements as entitlement
set
  status = 'active',
  ends_at = greatest(
    coalesce(entitlement.ends_at, '2026-05-11 00:00:00+09'::timestamptz),
    '2026-05-11 00:00:00+09'::timestamptz
  )
from public.coupons as coupon
where entitlement.coupon_id = coupon.id
  and coupon.code = 'WELCOME2OPENBETA_0425'
  and entitlement.plan_type = 'open_beta'
  and entitlement.status in ('active', 'expired');
