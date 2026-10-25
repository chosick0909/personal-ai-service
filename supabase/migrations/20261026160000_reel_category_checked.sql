-- Per-reel categories were guessed from the account profile while captions were still empty.
-- Rows with a caption but no check are re-classified from the caption, a batch per collector run.
alter table public.creator_success_reels add column if not exists category_checked_at timestamptz;
create index if not exists creator_success_reels_category_check on public.creator_success_reels(visible, category_checked_at) where caption <> '';
