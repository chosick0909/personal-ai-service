-- 추천 릴스와 함께 받은 성공 커버(썸네일) 문구. 썸네일 카피를 쓸 때 성공 사례로 참고한다.
alter table public.creator_success_reels add column if not exists cover_title text;
