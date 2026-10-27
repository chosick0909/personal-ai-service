-- 내 레퍼런스: a free note under each saved reel, written by the student.
alter table public.creator_reel_user_analyses add column if not exists memo text not null default '' check (char_length(memo) <= 2000);
