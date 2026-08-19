-- Saleslab lecture coupon prepared for use from 2026-08-21.
-- Each account can redeem it once for three months of student access.

insert into public.coupons (
  code,
  type,
  active,
  max_redemptions,
  expires_at
)
values (
  'WELCOME2SALESLAB_0821',
  'student',
  true,
  null,
  null
)
on conflict (code) do update set
  type = excluded.type,
  active = excluded.active,
  max_redemptions = excluded.max_redemptions,
  expires_at = excluded.expires_at;
