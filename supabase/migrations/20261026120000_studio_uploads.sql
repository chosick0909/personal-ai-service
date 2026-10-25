-- Student-added references: an Instagram link, an uploaded video or a pasted script.
-- They live beside collected reels; only public links that meet the archive rules become visible to everyone.
alter table public.creator_success_reels
  add column owner_user_id uuid references auth.users(id) on delete set null,
  add column title text,
  add column source_path text,
  add column source_text text;
create index creator_success_reels_owner on public.creator_success_reels(owner_user_id, first_collected_at desc);
