-- AiraAI accesses application data through server-side Prisma using DATABASE_URL.
-- The Supabase Data API is not an application data path, so client roles must
-- not receive direct access to tables in the exposed public schema.
--
-- The database owner continues to access these tables normally. RLS is not
-- forced, which preserves Prisma access while providing defense in depth.

begin;

do $$
declare
  target_table record;
begin
  for target_table in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format(
      'alter table public.%I enable row level security',
      target_table.tablename
    );

    execute format(
      'drop policy if exists "deny_direct_data_api_access" on public.%I',
      target_table.tablename
    );

    execute format(
      'create policy "deny_direct_data_api_access" on public.%I for all to anon, authenticated using (false) with check (false)',
      target_table.tablename
    );
  end loop;
end
$$;

revoke all privileges on all tables in schema public
  from anon, authenticated, service_role;
revoke all privileges on all sequences in schema public
  from anon, authenticated, service_role;
revoke execute on all functions in schema public
  from anon, authenticated, service_role, public;

-- Prevent Prisma/postgres-owned objects created by future migrations from
-- automatically becoming reachable through the Data API.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role, public;

notify pgrst, 'reload schema';

commit;
