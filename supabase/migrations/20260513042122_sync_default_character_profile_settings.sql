-- Keep the default character in lockstep with account-level settings.
-- The current settings UI edits account_profiles only; default characters are
-- an implementation detail for generation context and should not carry stale
-- category/persona values that override the account profile.

update public.characters as c
set
  settings = ap.settings,
  updated_at = timezone('utc'::text, now())
from public.account_profiles as ap
where c.account_id = ap.account_id
  and c.is_default = true
  and coalesce(ap.settings, '{}'::jsonb) <> '{}'::jsonb
  and c.settings is distinct from ap.settings;
