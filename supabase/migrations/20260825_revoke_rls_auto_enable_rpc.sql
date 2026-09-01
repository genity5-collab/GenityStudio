begin;

-- This function is an event-trigger helper, not an application RPC. Keeping it
-- executable by browser roles exposes an unnecessary SECURITY DEFINER endpoint.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

commit;
