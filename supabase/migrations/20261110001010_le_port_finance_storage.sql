-- LE PORT — Phase 6 (Supabase uniquement) : coffre privé des PDF (factures, devis, avoirs) et temps réel.
insert into storage.buckets (id, name, public) values ('factures', 'factures', false) on conflict (id) do nothing;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'invoices') then
    alter publication supabase_realtime add table public.invoices, public.quotes, public.payments;
  end if;
end $$;
