-- Guest ratings complete and current (property ratings, 20261022500000). The first live run read Hostaway's first 1,000
-- reviews, oldest first, so most properties had no recent reviews. The Worker now asks Hostaway for guest reviews only
-- (type guest-to-host), newest first (sortBy id, sortOrder desc), and each hourly run reads ten pages of 100:
--  * the first three pages every run (the newest 300 reviews, so new ones and late ratings come in within the hour);
--  * the next seven pages of a sweep through the rest, from where the last run stopped. When a page comes back short the
--    sweep has reached the oldest review: that is a full pass, and the next run starts again just after the first three
--    pages. A catalogue of N reviews is read in full every (N - 300) / 700 hours.
-- The run is in lib/hostaway-sync.ts runHostawayReviews and lib/hostaway-reviews-policy.ts sweepReviews.
--  * private.workspace_hostaway_review_state gets sweep_offset (where the next run's sweep starts), passes (full passes
--    finished) and last_pass_at (when the last one finished).
--  * private.workspace_hostaway_reviews_sweep(jsonb), service role only: {} returns {offset, passes, lastPassAt}; after a
--    run's last batch is stored, {nextOffset, wrapped} records where the next run starts and, when wrapped, a full pass.
--    Nothing is recorded while the Hostaway sync is paused. One run at a time (the reviews' own advisory lock).
-- Nothing is removed or hidden by a sweep: workspace_hostaway_reviews_ingest only inserts or updates, and `complete` (now
-- "a full pass has finished") only changes the note on the Ratings report. Ratings count a review only once it has a
-- rating (stars not null), as before, and the host's reviews of guests are never stored.
-- New: columns on private.workspace_hostaway_review_state; private.workspace_hostaway_reviews_sweep(jsonb) and
--   public.workspace_hostaway_reviews_sweep(jsonb) (service role only).
-- No existing function is changed. No DROP, no DELETE. Safe to run twice.

alter table private.workspace_hostaway_review_state add column if not exists sweep_offset integer not null default 0 check(sweep_offset between 0 and 1000000);
alter table private.workspace_hostaway_review_state add column if not exists passes integer not null default 0 check(passes>=0);
alter table private.workspace_hostaway_review_state add column if not exists last_pass_at timestamptz;

create or replace function private.workspace_hostaway_reviews_sweep(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare s private.workspace_hostaway_review_state;
begin
 if jsonb_typeof(input) is distinct from 'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('nextOffset','wrapped'))
  or (input ? 'nextOffset') is distinct from (input ? 'wrapped')
  or (input ? 'nextOffset' and (jsonb_typeof(input->'nextOffset') is distinct from 'number' or (input->>'nextOffset')!~'^\d{1,7}$'
   or (input->>'nextOffset')::integer>1000000 or jsonb_typeof(input->'wrapped') is distinct from 'boolean'))
  then raise exception 'Invalid review sweep' using errcode='22023';end if;
 if input ? 'nextOffset' and not (select paused from private.workspace_hostaway_sync_state where singleton) then
  perform pg_advisory_xact_lock(hashtextextended('hostaway-reviews',0));
  update private.workspace_hostaway_review_state set sweep_offset=(input->>'nextOffset')::integer,
   passes=passes+case when (input->>'wrapped')::boolean then 1 else 0 end,
   last_pass_at=case when (input->>'wrapped')::boolean then now() else last_pass_at end where singleton;
 end if;
 select * into s from private.workspace_hostaway_review_state where singleton;
 return jsonb_build_object('offset',coalesce(s.sweep_offset,0),'passes',coalesce(s.passes,0),'lastPassAt',s.last_pass_at);
end $fn$;

create or replace function public.workspace_hostaway_reviews_sweep(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_hostaway_reviews_sweep(input);$$;
revoke all on function private.workspace_hostaway_reviews_sweep(jsonb),public.workspace_hostaway_reviews_sweep(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_hostaway_reviews_sweep(jsonb),public.workspace_hostaway_reviews_sweep(jsonb) to service_role;
