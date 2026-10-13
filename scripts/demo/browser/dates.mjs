// Moves every date in the demo database by whole days, so the sample business stays current: the
// browser copy is shifted from the day its dates were last set to today each time it opens. Dates
// and timestamps in every table column move, and so do ISO dates, timestamps and months ("YYYY-MM")
// written as text or inside JSON. Triggers are off while it runs (it is not business activity).
const SHIFT_FUNCTIONS = `
create schema if not exists demo_time;
create or replace function demo_time.shift_text(t text, days int) returns text language plpgsql immutable as $f$
begin
  if t ~ '^\\d{4}-\\d{2}-\\d{2}$' then return (t::date + days)::text;
  elsif t ~ '^\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}' then return (left(t, 10)::date + days)::text || substr(t, 11);
  elsif t ~ '^\\d{4}-\\d{2}$' then return to_char((t || '-15')::date + days, 'YYYY-MM');
  end if;
  return t;
exception when others then return t;
end $f$;
create or replace function demo_time.shift_json(j jsonb, days int) returns jsonb language plpgsql immutable as $f$
begin
  case jsonb_typeof(j)
    when 'object' then return (select coalesce(jsonb_object_agg(k, demo_time.shift_json(v, days)), '{}'::jsonb) from jsonb_each(j) e(k, v));
    when 'array' then return (select coalesce(jsonb_agg(demo_time.shift_json(v, days) order by o), '[]'::jsonb) from jsonb_array_elements(j) with ordinality a(v, o));
    when 'string' then return to_jsonb(demo_time.shift_text(j #>> '{}', days));
    else return j;
  end case;
end $f$;`;

const ident = name => '"' + name.replace(/"/g, '""') + '"';
// Far enough that, moved there first, no row can meet another on a unique date.
const PARK = 40000;

export async function shiftDatabaseDates(db, days) {
  if (!Number.isInteger(days) || days === 0) return;
  const columns = (await db.query(`select c.table_schema s, c.table_name t, c.column_name c, c.data_type type
    from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
    where t.table_type = 'BASE TABLE' and c.table_schema in ('public', 'private', 'auth') and c.is_generated = 'NEVER'
      and c.data_type in ('date', 'timestamp with time zone', 'timestamp without time zone', 'text', 'jsonb')
    order by 1, 2, 3`)).rows;
  const tables = new Map();
  for (const col of columns) {
    const key = `${ident(col.s)}.${ident(col.t)}`;
    tables.set(key, [...(tables.get(key) ?? []), col]);
  }
  await db.exec(SHIFT_FUNCTIONS);
  await db.transaction(async tx => {
    await tx.exec('set local session_replication_role = replica');
    for (const [table, cols] of tables) {
      const when = cols.filter(c => c.type.startsWith('date') || c.type.startsWith('timestamp'));
      const step = n => when.map(c => `${ident(c.c)} = ${ident(c.c)} + ${c.type === 'date' ? n : `make_interval(days => ${n})`}`).join(', ');
      if (when.length) {
        await tx.exec(`update ${table} set ${step(days + PARK)}`);
        await tx.exec(`update ${table} set ${step(-PARK)}`);
      }
      for (const c of cols.filter(c => c.type === 'text')) await tx.exec(`update ${table} set ${ident(c.c)} = demo_time.shift_text(${ident(c.c)}, ${days}) where ${ident(c.c)} ~ '^\\d{4}-\\d{2}(-\\d{2})?([T ]\\d{2}:\\d{2}.*)?$'`);
      for (const c of cols.filter(c => c.type === 'jsonb')) await tx.exec(`update ${table} set ${ident(c.c)} = demo_time.shift_json(${ident(c.c)}, ${days}) where ${ident(c.c)}::text ~ '"\\d{4}-\\d{2}'`);
    }
  });
}
