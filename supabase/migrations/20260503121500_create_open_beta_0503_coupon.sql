insert into public.coupons (code, type, active, max_redemptions, expires_at)
values (
  'WELCOME2OPENBETA_0503',
  'open_beta',
  true,
  null,
  '2026-05-11 00:00:00+09'::timestamptz
)
on conflict (code) do update set
  type = excluded.type,
  active = excluded.active,
  max_redemptions = excluded.max_redemptions,
  expires_at = excluded.expires_at;
