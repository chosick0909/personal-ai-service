-- Reels whose views come from a character IP, a celebrity or a sponsored seeding box are poor references:
-- they stay in students' libraries but leave the 성공 릴스 list.
alter table public.creator_success_reels add column if not exists reference_fit boolean;
alter table public.creator_success_reels add column if not exists reference_fit_reason text;
