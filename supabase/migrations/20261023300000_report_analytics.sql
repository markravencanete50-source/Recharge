-- Report analytics (Lee: "Every reporting should have an analytics. Make sure the analytics is professional, think like a
-- data analyst, structure the graphs, lines etc"). Every report page now opens with headline figures against the previous
-- period and charts (lib/report-analytics.ts, mobile/src/AnalyticsKit.tsx). Almost all of it is drawn from what the reports
-- already read; four reports need a little more from the database, added here to the functions that already answer them:
--  * Reports > Ratings: the portfolio read (no property chosen) also answers 'points': for each property, every day with
--    reviews as [day, stars rounded to a whole star from 1 to 5, reviews, sum of their stars]. That is enough to work out
--    any period's average, the star mix, each property's rating in the dates and the monthly line, and it holds no review
--    text, guest or reference. The same reviews the report already counts (the same visible properties and the same
--    rules); a review with no day is left out of the points only. The property read (a property chosen) is unchanged
--    apart from 'points' being null.
--  * Reports > Repairs and spend: 'byDay', each UK day in the dates with repairs raised and repairs finished.
--  * Reports > To-dos: 'byDay', each due day in the dates with the to-dos due, done, done late and overdue (to-dos with no
--    due day are left out of byDay only, as they have no day to sit on).
--  * Reports > Time worked: 'byDay', each UK day in the dates with paid minutes, people and shifts, by the day the shift
--    started, as the totals.
-- Who can read what is unchanged: the role checks at the top of both functions are not touched, so owners are still
-- refused ratings and the business reports stay with admin and super admin. No new function and no grant change.
-- Patched by anchor (each anchor must occur exactly once; each patch is skipped once its sentinel is present):
--   private.workspace_property_ratings(uuid) (points),
--   private.workspace_business_report(text,date,date) (repairs, to-dos and time byDay; three patches).
-- No DROP, no DELETE. Safe to run twice.

do $patch$
declare
 fixes constant text[][] := array[
  -- Ratings: the review points, on the portfolio read only.
  ['private.workspace_property_ratings(uuid)',
   $q$'properties',coalesce((select jsonb_agg(jsonb_build_object('propertyId',f.id,$q$,
   $q$'points',case when target_property is null then coalesce((select jsonb_object_agg(g.property_id::text,g.pts) from (select q.property_id,jsonb_agg(jsonb_build_array(q.on_day,q.star,q.n,q.total) order by q.on_day,q.star) as pts from (select r.property_id,r.reviewed_on as on_day,greatest(1,least(5,round(r.stars)))::int as star,count(*)::int as n,round(sum(r.stars),2) as total from reviews r where r.reviewed_on is not null and r.property_id is not null group by r.property_id,r.reviewed_on,greatest(1,least(5,round(r.stars)))::int) q group by q.property_id) g),'{}'::jsonb) end/* report analytics ratings: 20261023300000 */,
  'properties',coalesce((select jsonb_agg(jsonb_build_object('propertyId',f.id,$q$,
   $q$/* report analytics ratings: 20261023300000 */$q$],
  -- Repairs: raised and finished by day.
  ['private.workspace_business_report(text,date,date)',
   $q$'raised',(select count(*) from r),'completed',(select count(*) from done),$q$,
   $q$'raised',(select count(*) from r),'completed',(select count(*) from done),
   'byDay',coalesce((select jsonb_agg(jsonb_build_object('day',b.on_day,'raised',b.raised,'completed',b.finished) order by b.on_day) from (select y.on_day,count(*) filter(where y.k='r')::int as raised,count(*) filter(where y.k='c')::int as finished from (select (r.created_at at time zone 'Europe/London')::date as on_day,'r' as k from r union all select (w.completed_at at time zone 'Europe/London')::date,'c' from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id and d.kind='maintenance' where w.completed_at>=lower_at and w.completed_at<upper_at) y group by y.on_day) b),'[]')/* report analytics repairs: 20261023300000 */,$q$,
   $q$/* report analytics repairs: 20261023300000 */$q$],
  -- To-dos: due, done, done late and overdue by due day.
  ['private.workspace_business_report(text,date,date)',
   $q$'total',(select count(*) from s),'done',$q$,
   $q$'byDay',coalesce((select jsonb_agg(jsonb_build_object('day',b.on_day,'total',b.total,'done',b.done,'doneLate',b.late,'overdue',b.overdue) order by b.on_day) from (select s.due_on as on_day,count(*)::int as total,count(*) filter(where s.is_done)::int as done,count(*) filter(where s.done_late)::int as late,count(*) filter(where s.overdue)::int as overdue from s where s.due_on is not null group by s.due_on) b),'[]')/* report analytics todos: 20261023300000 */,
   'total',(select count(*) from s),'done',$q$,
   $q$/* report analytics todos: 20261023300000 */$q$],
  -- Time worked: paid minutes, people and shifts by the day the shift started.
  ['private.workspace_business_report(text,date,date)',
   $q$'minutes',(select coalesce(round(sum(total-unpaid)),0)::int from h),$q$,
   $q$'byDay',coalesce((select jsonb_agg(jsonb_build_object('day',b.on_day,'minutes',b.minutes,'people',b.people,'shifts',b.shifts) order by b.on_day) from (select h.d as on_day,round(sum(h.total-h.unpaid))::int as minutes,count(distinct h.user_id)::int as people,count(*)::int as shifts from h group by h.d) b),'[]')/* report analytics time: 20261023300000 */,
   'minutes',(select coalesce(round(sum(total-unpaid)),0)::int from h),$q$,
   $q$/* report analytics time: 20261023300000 */$q$]
 ];
 definition text;hits integer;
begin
 for i in 1..array_length(fixes,1) loop
  definition:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition)=0 then
   hits:=(length(definition)-length(replace(definition,fixes[i][2],'')))/length(fixes[i][2]);
   if hits<>1 then raise exception 'Patch anchor found % times in % (patch %)',hits,fixes[i][1],i;end if;
   execute replace(definition,fixes[i][2],fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure))=0 then raise exception 'Patch did not take in % (patch %)',fixes[i][1],i;end if;
  end if;
 end loop;
end $patch$;
