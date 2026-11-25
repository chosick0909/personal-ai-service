-- Standing coupon created on 2026-11-25 (applied to production the same day from the SQL editor).
-- Each account can redeem it once; it grants one month counted from the day it is redeemed ('challenge' plan).
-- No redemption deadline and no redemption cap. An active student entitlement is moved to after this month.

insert into public.coupons (
  code,
  type,
  active,
  max_redemptions,
  expires_at
)
values (
  'WELCOME2HOOKAI_1M',
  'challenge',
  true,
  null,
  null
)
on conflict (code) do nothing;
