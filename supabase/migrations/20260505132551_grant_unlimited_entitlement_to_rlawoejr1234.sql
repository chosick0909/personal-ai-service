-- Grant rlawoejr1234@gmail.com unlimited paid access without an expiration date.

do $$
declare
  v_user_id uuid;
  v_entitlement_id uuid;
begin
  select id
    into v_user_id
  from auth.users
  where lower(email) = 'rlawoejr1234@gmail.com'
  order by created_at asc
  limit 1;

  if v_user_id is null then
    raise notice 'Skipped unlimited entitlement grant: auth user rlawoejr1234@gmail.com not found.';
    return;
  end if;

  select id
    into v_entitlement_id
  from public.user_entitlements
  where user_id = v_user_id
    and plan_type = 'paid'
    and status = 'active'
    and ends_at is null
  order by created_at desc
  limit 1;

  if v_entitlement_id is null then
    insert into public.user_entitlements (
      user_id,
      coupon_id,
      plan_type,
      status,
      starts_at,
      ends_at
    )
    values (
      v_user_id,
      null,
      'paid',
      'active',
      now(),
      null
    )
    returning id into v_entitlement_id;
  end if;

  insert into public.entitlement_limits (
    entitlement_id,
    monthly_reference_limit,
    per_reference_copilot_limit,
    per_reference_feedback_limit
  )
  values (
    v_entitlement_id,
    null,
    null,
    null
  )
  on conflict (entitlement_id) do update set
    monthly_reference_limit = excluded.monthly_reference_limit,
    per_reference_copilot_limit = excluded.per_reference_copilot_limit,
    per_reference_feedback_limit = excluded.per_reference_feedback_limit;
end $$;
