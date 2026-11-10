-- LE PORT — Phase 7 : prospection (Google Places, scoring, messages) et pipeline commercial.

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  place_id text unique,
  nom text not null check (length(trim(nom)) between 1 and 200),
  metier text,
  ville text,
  adresse text,
  telephone text,
  site text,
  email text,
  instagram text,
  note_google numeric(2, 1),
  nb_avis integer,
  maps_url text,
  score smallint not null default 0 check (score between 0 and 100),
  angle text,
  diagnostic text,
  dm_instagram text,
  statut text not null default 'nouveau' check (statut in ('nouveau', 'a_contacter', 'contacte', 'repondu', 'converti', 'ecarte')),
  source text not null default 'places' check (source in ('places', 'manuel', 'demo')),
  demo boolean not null default false,
  notes text,
  client_id uuid references public.clients (id) on delete set null,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index if not exists leads_score on public.leads (statut, score desc);

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads (id) on delete set null,
  client_id uuid references public.clients (id) on delete set null,
  titre text not null check (length(trim(titre)) between 1 and 200),
  montant numeric(12, 2),
  etape text not null default 'nouveau' check (etape in ('nouveau', 'contacte', 'rdv', 'devis', 'signe', 'perdu')),
  prochaine_action text,
  echeance date,
  rdv_le timestamptz,
  quote_id uuid references public.quotes (id) on delete set null,
  notes text,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index if not exists opportunities_etape on public.opportunities (etape, maj_le desc);

alter table public.quotes add column if not exists relances jsonb not null default '[]'::jsonb;

alter table public.settings
  add column if not exists prospection jsonb not null default
  '{"metiers": ["restaurant", "boulangerie", "coiffeur", "institut de beauté", "fleuriste", "garage automobile", "artisan du bâtiment", "caviste", "boutique de vêtements", "salle de sport"], "zones": ["Sète", "Frontignan", "Balaruc-les-Bains", "Mèze", "Marseillan", "Montpellier"], "par_jour": 10}'::jsonb;

-- maj_le automatique
create or replace function public.maj_le_auto()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.maj_le := now();
  return new;
end;
$$;
drop trigger if exists leads_maj on public.leads;
create trigger leads_maj before update on public.leads for each row execute function public.maj_le_auto();
drop trigger if exists opportunities_maj on public.opportunities;
create trigger opportunities_maj before update on public.opportunities for each row execute function public.maj_le_auto();

-- le pipeline suit le devis : envoyé → « devis », accepté → « signé », refusé ou expiré → « perdu »
create or replace function public.devis_vers_pipeline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.statut is distinct from old.statut then
    update public.opportunities set etape = case
      when new.statut = 'accepte' then 'signe'
      when new.statut in ('refuse', 'expire') then 'perdu'
      when new.statut in ('emis', 'envoye') and etape in ('nouveau', 'contacte', 'rdv') then 'devis'
      else etape end,
      montant = coalesce(montant, new.total)
    where quote_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.devis_vers_pipeline() from public, anon, authenticated;
drop trigger if exists quotes_pipeline on public.quotes;
create trigger quotes_pipeline after update on public.quotes for each row execute function public.devis_vers_pipeline();

do $$
declare t text;
begin
  foreach t in array array['leads', 'opportunities'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists acces_fondateurs on public.%I', t);
    execute format('create policy acces_fondateurs on public.%I for all to authenticated using (public.is_allowed()) with check (public.is_allowed())', t);
  end loop;
end $$;

-- routines : Hugo cherche et Inès note chaque matin de semaine (sans IA) ; Margaux relance les devis (sans IA)
update public.routines set prompt_tache = 'Trouve de nouveaux commerces locaux (Google Places), analyse leur site et leur fiche, note-les et propose l''angle d''attaque. Sans IA : les messages sont écrits par Sacha à la demande.' where id = 'rt_leads';

update public.agents set outils = array_append(outils, 'update_lead') where id = 'sacha' and not ('update_lead' = any(outils));
update public.agents set outils = array_append(outils, 'search_leads') where id in ('margaux', 'victor') and not ('search_leads' = any(outils));
update public.agents set outils = array_append(outils, 'update_opportunity_stage') where id = 'victor' and not ('update_opportunity_stage' = any(outils));

-- temps réel (Supabase) : le pipeline et les prospects se mettent à jour sur tous les écrans
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'leads') then
    alter publication supabase_realtime add table public.leads, public.opportunities;
  end if;
end $$;
