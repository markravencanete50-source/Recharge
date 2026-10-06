import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const file=process.argv[2]||'supabase/migrations/20261005065933_business_workspace.sql';
const match=/^supabase\/migrations\/(\d{14})_(business_[a-z_]+)\.sql$/.exec(file);
if(!match)throw Error('Choose a checked-in business migration');
const [,version,name]=match;
const sql=await fs.readFile(file,'utf8');
const delimiter=`$recharge_business_${version}$`;
if(sql.includes(delimiter))throw Error('SQL delimiter collision');
const activation=`begin;
select pg_advisory_xact_lock(61005065933);
do $$ begin
  if exists(select 1 from supabase_migrations.schema_migrations where version='${version}') then raise exception 'Business migration already installed. Do not replay it.'; end if;
  if (select count(*) from supabase_migrations.schema_migrations where version in ('20261003120633','20261003151028','20261003162617','20261004083809'))<>4 then raise exception 'Required security migrations missing'; end if;
end $$;
${sql}
insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[${delimiter}${sql}${delimiter}]);
commit;
select 'Recorded business migration' check_name,(select count(*) from supabase_migrations.schema_migrations where version='${version}')::text result
union all select 'Fixed feature catalogue',(select count(*) from public.workspace_features)::text
union all select 'Live properties',(select count(*) from public.workspace_properties)::text
union all select 'Live work items',(select count(*) from public.workspace_work_items)::text
union all select 'Registered Auth users',(select count(*) from auth.users)::text
union all select 'Public privileged functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef)::text;
`;
await fs.mkdir('.audit/business-activation',{recursive:true});
await fs.writeFile('.audit/business-activation/apply.sql',activation);
await fs.writeFile(`.audit/business-activation/${version}.apply.sql`,activation);
console.log(JSON.stringify({file,sha256:createHash('sha256').update(sql).digest('hex'),activationBytes:activation.length}));
