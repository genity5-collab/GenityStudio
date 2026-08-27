-- Remove direct browser execution of remaining security-definer functions.
-- FastAPI is the sole request entry point for protected application work.

begin;

revoke all on function public.get_friend_requests() from public, anon, authenticated;
revoke all on function public.get_friends() from public, anon, authenticated;
revoke all on function public.notify_friend_accept() from public, anon, authenticated;
revoke all on function public.notify_friend_request() from public, anon, authenticated;
revoke all on function public.retro_get_public_release_log() from public, anon, authenticated;
revoke all on function public.retrostudio_is_banned() from public, anon, authenticated;
revoke all on function public.retrostudio_my_moderation_status() from public, anon, authenticated;
revoke all on function public.retrox_bind_token_device(text) from public, anon, authenticated;
revoke all on function public.search_users(text) from public, anon, authenticated;
revoke all on function public.social_accept_friend_request(uuid) from public, anon, authenticated;
revoke all on function public.social_cancel_friend_request(uuid) from public, anon, authenticated;
revoke all on function public.social_decline_friend_request(uuid) from public, anon, authenticated;
revoke all on function public.social_get_chat_messages(uuid) from public, anon, authenticated;
revoke all on function public.social_get_friend_requests() from public, anon, authenticated;
revoke all on function public.social_get_friends() from public, anon, authenticated;
revoke all on function public.social_mark_chat_read(uuid) from public, anon, authenticated;
revoke all on function public.social_remove_friend(uuid) from public, anon, authenticated;
revoke all on function public.social_search_users(text) from public, anon, authenticated;
revoke all on function public.social_send_chat_message(uuid, text) from public, anon, authenticated;
revoke all on function public.social_send_friend_request(uuid) from public, anon, authenticated;

alter function public.search_users(text) set search_path = public, pg_temp;
alter function public.get_friends() set search_path = public, pg_temp;
alter function public.get_friend_requests() set search_path = public, pg_temp;
alter function public.notify_friend_request() set search_path = public, pg_temp;
alter function public.notify_friend_accept() set search_path = public, pg_temp;
alter function public.update_timestamp() set search_path = public, pg_temp;

commit;
