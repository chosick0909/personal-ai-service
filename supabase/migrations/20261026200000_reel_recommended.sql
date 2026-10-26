-- 추천 릴스: 지영·클라이언트가 직접 고른 릴스. 조회수·기간 기준과 무관하게 성공 릴스에 보이고 '추천' 태그가 붙는다.
alter table public.creator_success_reels add column if not exists recommended boolean not null default false;
create index if not exists creator_success_reels_recommended_idx on public.creator_success_reels (recommended) where recommended;
