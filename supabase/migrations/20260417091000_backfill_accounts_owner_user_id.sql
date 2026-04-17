do $$
declare
  v_user_count integer;
  v_owner_user_id uuid;
begin
  select count(*) into v_user_count from auth.users;

  if v_user_count = 1 then
    select id into v_owner_user_id from auth.users limit 1;

    update public.accounts
    set owner_user_id = v_owner_user_id
    where owner_user_id is null;
  else
    raise notice 'Skipped owner_user_id backfill: auth.users count is %, expected 1.', v_user_count;
  end if;
end $$;

