-- Instacampus coupon issued on 2026-08-06. Each redemption grants three months.

insert into public.coupons (
  code,
  type,
  active,
  max_redemptions,
  expires_at
)
values (
  'WELCOME2INSTACAMPUS_0806',
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

