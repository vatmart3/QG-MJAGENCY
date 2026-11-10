-- LE PORT — temps réel : la ville se met à jour dès qu'une ligne change.
do $$
declare t text;
begin
  foreach t in array array['agents', 'agent_messages', 'approvals', 'journal', 'tasks', 'missions'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
