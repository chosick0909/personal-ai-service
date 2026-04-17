alter table public.accounts
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

create index if not exists accounts_owner_user_id_idx
  on public.accounts (owner_user_id);

