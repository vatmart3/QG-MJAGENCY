-- LE PORT — Phase 8 : Atelier Tech (santé des sites clients, audits), Boutique (Shopify), notifications push.

create table if not exists public.sites_monitored (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete set null,
  nom text not null check (length(trim(nom)) between 1 and 200),
  url text not null unique check (url ~* '^https?://'),
  actif boolean not null default true,
  ok boolean,
  dernier_statut integer,
  temps_ms integer,
  ssl_expire_le timestamptz,
  ssl_valide boolean,
  domaine_expire_le date,
  dernier_check timestamptz,
  controle_complet_le timestamptz,
  echecs integer not null default 0,
  erreur text,
  alerte text,
  alerte_le timestamptz,
  historique jsonb not null default '[]'::jsonb,
  audit jsonb,
  audit_le timestamptz,
  cree_le timestamptz not null default now()
);
create index if not exists sites_monitored_check on public.sites_monitored (actif, dernier_check nulls first);

-- abonnements aux notifications push (téléphone des fondateurs) : nouvelles demandes en Douane, alertes
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  email text not null,
  cree_le timestamptz not null default now()
);

alter table public.settings
  add column if not exists boutique jsonb not null default '{"seuil_stock": 3, "delai_expedition_h": 48}'::jsonb;

do $$
declare t text;
begin
  foreach t in array array['sites_monitored', 'push_subscriptions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists acces_fondateurs on public.%I', t);
    execute format('create policy acces_fondateurs on public.%I for all to authenticated using (public.is_allowed()) with check (public.is_allowed())', t);
  end loop;
end $$;

-- routines : Jade contrôle les sites toutes les heures (sans IA) ; Yanis surveille la boutique (sans IA)
update public.routines set mode = 'intervalle', intervalle_minutes = 60, plage_debut = '06:00', plage_fin = '23:00',
  prompt_tache = 'Contrôle les sites clients (HTTP, temps de réponse, certificat SSL, expiration du domaine) et alerte en cas de souci. Sans IA.'
  where id = 'rt_sante_sites';
insert into public.routines (id, nom, agent_id, mode, heure, intervalle_minutes, plage_debut, plage_fin, prompt_tache, actif)
values ('rt_boutique', 'Surveillance de la boutique', 'yanis', 'intervalle', '09:00', 120, '08:00', '21:00',
  'Nouvelles commandes, commandes en retard d''expédition, stocks bas : alertes dans le Journal. Sans IA.', true)
on conflict (id) do nothing;

-- outils de la phase 8
update public.agents set outils = array_append(outils, 'check_site_health') where id in ('axel', 'oscar') and not ('check_site_health' = any(outils));
update public.agents set outils = array_append(outils, 'web_search') where id in ('rose', 'capucine', 'elsa', 'tom', 'chloe') and not ('web_search' = any(outils));
update public.agents set outils = array_append(outils, 'get_kpis') where id in ('diane', 'marius', 'clemence') and not ('get_kpis' = any(outils));
update public.agents set outils = array_append(outils, 'shopify_orders') where id in ('yanis', 'iris', 'lou') and not ('shopify_orders' = any(outils));
update public.agents set outils = array_append(outils, 'shopify_products') where id in ('yanis', 'lou', 'iris') and not ('shopify_products' = any(outils));
update public.agents set outils = array_append(outils, 'shopify_update') where id in ('yanis', 'lou') and not ('shopify_update' = any(outils));
update public.agents set outils = array_append(outils, 'audit_url') where id in ('rose', 'axel') and not ('audit_url' = any(outils));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'sites_monitored') then
    alter publication supabase_realtime add table public.sites_monitored;
  end if;
end $$;
