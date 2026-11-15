-- LE PORT — le calendrier des fondateurs : tout ce qu'il y a à faire dans la semaine (posts TikTok / Instagram,
-- appels, rendez-vous, relances, admin…). Rempli par les agents (create_founder_todo, appels du pilote commercial,
-- réponses de prospects) ou à la main ; statut « à faire / en cours / fait », comme un tableau Monday.

create table if not exists public.calendrier (
  id uuid primary key default gen_random_uuid(),
  titre text not null check (length(trim(titre)) between 1 and 200),
  details text,
  categorie text not null default 'autre' check (categorie in ('contenu', 'appel', 'rdv', 'prospection', 'client', 'finance', 'admin', 'autre')),
  canal text check (canal is null or length(canal) <= 30),
  jour date not null,
  heure time,
  duree_min integer check (duree_min is null or duree_min between 5 and 600),
  statut text not null default 'a_faire' check (statut in ('a_faire', 'en_cours', 'fait')),
  priorite smallint not null default 1 check (priorite between 0 and 3),
  -- prénom du fondateur concerné, null = les deux
  pour text check (pour is null or length(pour) <= 60),
  agent_id text references public.agents (id) on update cascade on delete set null,
  opportunity_id uuid references public.opportunities (id) on delete set null,
  lien text check (lien is null or length(lien) <= 500),
  -- clé de dédoublonnage des tâches créées automatiquement (ex. appel:<affaire>:<jour>)
  cle text unique,
  cree_par text not null default 'fondateur',
  fait_le timestamptz,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index if not exists calendrier_jour on public.calendrier (jour, heure);

alter table public.calendrier enable row level security;
revoke all on public.calendrier from anon;
drop policy if exists acces_fondateurs on public.calendrier;
create policy acces_fondateurs on public.calendrier for all to authenticated using (public.is_allowed()) with check (public.is_allowed());

-- l'écran se met à jour tout seul quand un agent ajoute une tâche
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'calendrier') then
    alter publication supabase_realtime add table public.calendrier;
  end if;
end $$;

-- les agents qui remplissent le calendrier
update public.agents set outils = array_append(outils, 'create_founder_todo')
  where id in ('marius', 'chloe', 'lina', 'gabin', 'sacha', 'theo', 'noe', 'victor', 'celeste', 'margaux', 'remi')
    and not ('create_founder_todo' = any(outils));

-- Chloé : chaque post prévu va dans le calendrier, avec le jour et l'heure de publication conseillés
update public.routines set prompt_tache = prompt_tache || ' Pour CHAQUE post et le carrousel, ajoute une tâche au calendrier des fondateurs avec create_founder_todo : catégorie « contenu », canal (tiktok, instagram, linkedin ou facebook), jour et heure de publication conseillés cette semaine, et le texte complet à publier dans « details ».'
  where id = 'rt_plan_contenu' and position('create_founder_todo' in prompt_tache) = 0;
