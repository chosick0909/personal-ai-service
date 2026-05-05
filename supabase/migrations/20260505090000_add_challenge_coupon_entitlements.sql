-- Add the 1-month unlimited challenge coupon and allow challenge entitlements.

alter table public.coupons
  drop constraint if exists coupons_type_check;

alter table public.coupons
  add constraint coupons_type_check
  check (type in ('open_beta', 'student', 'challenge'));

alter table public.user_entitlements
  drop constraint if exists user_entitlements_plan_type_check;

alter table public.user_entitlements
  add constraint user_entitlements_plan_type_check
  check (plan_type in ('open_beta', 'student', 'challenge', 'paid'));

insert into public.coupons (code, type, active, max_redemptions)
values ('CHEER_TO_CHALLENGE', 'challenge', true, null)
on conflict (code) do update set
  type = excluded.type,
  active = excluded.active,
  max_redemptions = excluded.max_redemptions;
