-- Chat notices, one per message (Lee, round 5): every new message in a chat tells everyone who hears that chat, not once per
-- conversation until it is opened (20261014320000). Who hears a chat is unchanged (private.chat_audience: the members; for an
-- owner's conversation the owner and the team that answers owners; for a team channel its department, admins only Management and
-- Everyone). The sender is never told, a person who blocked the sender is never told, and nobody outside the audience is told.
-- Email and push still go only for notices under 24 hours old (integration_claim_notifications), so a busy chat now pushes on
-- every message.
-- The send branch tells everyone due by private.chat_notice_due (20261014320000); from here everyone is due. Replaced whole (only
-- 20261014320000 defines it). private.chat_notified keeps recording when each person was last told; nothing reads it now.
create or replace function private.chat_notice_due(target uuid,subject uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select true
$fn$;
revoke all on function private.chat_notice_due(uuid,uuid) from public,anon,authenticated;
