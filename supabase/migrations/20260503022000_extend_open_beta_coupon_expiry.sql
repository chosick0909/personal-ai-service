update public.coupons
set expires_at = '2026-05-11 00:00:00+09'::timestamptz
where code = 'WELCOME2OPENBETA_0425';
