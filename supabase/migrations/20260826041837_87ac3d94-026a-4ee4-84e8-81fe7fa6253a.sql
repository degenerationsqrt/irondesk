-- bootstrap_current_user must be callable only by signed-in users. It derives
-- the target account from auth.uid() and is idempotent, so authenticated
-- EXECUTE is intentional; anon/public access is revoked.
revoke all on function public.bootstrap_current_user(text) from public;
revoke all on function public.bootstrap_current_user(text) from anon;
grant execute on function public.bootstrap_current_user(text) to authenticated;