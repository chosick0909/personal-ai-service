-- Keep coupon usage counters and persisted entitlement statuses consistent.

create or replace function public.update_coupon_redemption_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.coupon_id is not null then
      update public.coupons
      set redeemed_count = redeemed_count + 1
      where id = new.coupon_id
        and (
          max_redemptions is null
          or max_redemptions <= 0
          or redeemed_count < max_redemptions
        );

      if not found then
        raise exception 'coupon redemption limit reached'
          using errcode = 'P0001';
      end if;
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.coupon_id is not null then
      update public.coupons
      set redeemed_count = greatest(redeemed_count - 1, 0)
      where id = old.coupon_id;
    end if;

    return old;
  end if;

  if old.coupon_id is distinct from new.coupon_id then
    if old.coupon_id is not null then
      update public.coupons
      set redeemed_count = greatest(redeemed_count - 1, 0)
      where id = old.coupon_id;
    end if;

    if new.coupon_id is not null then
      update public.coupons
      set redeemed_count = redeemed_count + 1
      where id = new.coupon_id
        and (
          max_redemptions is null
          or max_redemptions <= 0
          or redeemed_count < max_redemptions
        );

      if not found then
        raise exception 'coupon redemption limit reached'
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists user_entitlements_coupon_redemption_count
  on public.user_entitlements;

create trigger user_entitlements_coupon_redemption_count
before insert or delete or update of coupon_id
on public.user_entitlements
for each row
execute function public.update_coupon_redemption_count();

-- Reconcile historical rows created before the trigger existed.
update public.coupons as coupon
set redeemed_count = (
  select count(*)::integer
  from public.user_entitlements as entitlement
  where entitlement.coupon_id = coupon.id
);

update public.user_entitlements
set status = 'expired'
where status = 'active'
  and ends_at is not null
  and ends_at <= now();

