-- 편집 is its own formula kind, separate from 촬영 (subtitle style, cuts, effects, sound).
alter table public.studio_formulas drop constraint if exists studio_formulas_kind_check;
alter table public.studio_formulas add constraint studio_formulas_kind_check check (kind in ('hook', 'structure', 'filming', 'editing', 'caption'));
