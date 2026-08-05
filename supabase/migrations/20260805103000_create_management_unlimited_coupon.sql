-- Management coupon: unlimited usage and no entitlement expiration.

alter table public.coupons
  drop constraint if exists coupons_type_check;

alter table public.coupons
  add constraint coupons_type_check
  check (type in ('open_beta', 'student', 'challenge', 'admin'));

insert into public.coupons (
  code,
  type,
  active,
  max_redemptions,
  expires_at
)
values (
  'HOOK_AI_MANAGE',
  'admin',
  true,
  null,
  null
)
on conflict (code) do update set
  type = excluded.type,
  active = excluded.active,
  max_redemptions = excluded.max_redemptions,
  expires_at = excluded.expires_at;

create or replace function public.enforce_management_coupon_entitlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.coupons
    where id = new.coupon_id
      and code = 'HOOK_AI_MANAGE'
  ) then
    new.plan_type := 'paid';
    new.status := 'active';
    new.starts_at := now();
    new.ends_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists user_entitlements_management_coupon
  on public.user_entitlements;

create trigger user_entitlements_management_coupon
before insert or update of coupon_id
on public.user_entitlements
for each row
execute function public.enforce_management_coupon_entitlement();

