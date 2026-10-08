-- Portfolio insights for the team: each owner and their properties, and the last 12 months of the
-- portfolio (properties added, properties gone live, nights booked, live properties).
create function private.workspace_portfolio_insights() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();this_month date:=date_trunc('month',(now() at time zone 'Europe/London'))::date;begin
 if actor not in ('admin','super_admin','stays') or not private.has_workspace_module('property-database') then raise exception 'Portfolio access denied' using errcode='42501';end if;
 return jsonb_build_object(
  'owners',coalesce((select jsonb_agg(o order by o->>'name') from (
    select jsonb_build_object('clientId',pr.user_id,'name',pr.full_name,'propertyIds',jsonb_agg(p.id order by p.name)) o
    from public.workspace_properties p
    join public.workspace_property_assignments a on a.property_id=p.id and a.assignment='client'
    join public.workspace_profiles pr on pr.user_id=a.user_id
    where p.status<>'archived' and private.workspace_can_property(p.id,'property-database')
    group by pr.user_id,pr.full_name) x),'[]'),
  'trend',(select jsonb_agg(jsonb_build_object('month',to_char(m,'YYYY-MM'),
     'added',(select count(*) from public.workspace_properties p where private.workspace_can_property(p.id,'property-database') and p.created_at>=m and p.created_at<(m+interval '1 month')),
     'wentLive',(select count(distinct a.property_id) from public.workspace_activity a where a.event_type='journey.makeLive' and a.created_at>=m and a.created_at<(m+interval '1 month') and private.workspace_can_property(a.property_id,'property-database')),
     'bookedNights',(select coalesce(sum(greatest(0,least(r.check_out,(m+interval '1 month')::date)-greatest(r.check_in,m::date))),0) from private.workspace_reservations r
        where r.status='confirmed' and r.check_in<(m+interval '1 month')::date and r.check_out>m::date and private.workspace_can_property(r.property_id,'property-database')),
     'liveProperties',(select count(*) from public.workspace_properties p where p.status='active' and p.created_at<(m+interval '1 month') and private.workspace_can_property(p.id,'property-database')))
    order by m) from generate_series(this_month-interval '11 months',this_month::timestamp,interval '1 month') m));
end $$;
revoke all on function private.workspace_portfolio_insights() from public,anon,authenticated;

do $$
declare definition text;
 anchor constant text:=$q$ elsif section='bookingPolicy' then$q$;
begin
 definition:=pg_get_functiondef('private.workspace_portfolio_read(text,uuid,date,date)'::regprocedure);
 if position('workspace_portfolio_insights' in definition)>0 then return; end if;
 if position(anchor in definition)=0 then raise exception 'Patch anchor missing: portfolio insights'; end if;
 execute replace(definition,anchor,$q$ elsif section='insights' then result:=private.workspace_portfolio_insights();$q$||anchor);
end $$;
