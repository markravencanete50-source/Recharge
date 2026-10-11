-- People shows who is online or offline (11 October 2026).
--
-- The People list for admins now carries when each person was last in the app, so an approved
-- account shows Online or Offline instead of Active.

do $$
declare definition text := pg_get_functiondef('private.workspace_admin_read(text)'::regprocedure);
begin
 if position('''seenAt''' in definition) = 0 then
  if position($q$'emailVerified',u.email_confirmed_at is not null,$q$ in definition) = 0 then raise exception 'Patch anchor missing in workspace_admin_read'; end if;
  execute replace(definition, $q$'emailVerified',u.email_confirmed_at is not null,$q$,
   $q$'emailVerified',u.email_confirmed_at is not null,'seenAt',(select x.seen_at from private.workspace_presence x where x.user_id=p.user_id),$q$);
 end if;
end $$;
