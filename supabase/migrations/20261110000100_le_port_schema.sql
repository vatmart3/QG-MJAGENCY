-- LE PORT — schéma principal (Phase 2)
-- Identifiants des pôles et agents = slugs texte (« marius », « finance »…), lisibles dans les logs et le seed.
-- Les tables métier (clients, leads, devis, factures…) arrivent avec leurs phases (6 et 7),
-- car elles demandent des contraintes spécifiques (numérotation continue, verrouillage, avoirs).

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ utilitaires
create or replace function public.touch_maj_le()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.maj_le := now();
  return new;
end;
$$;

-- ------------------------------------------------------------------ réglages (ligne unique)
create table if not exists public.settings (
  id smallint primary key default 1 check (id = 1),
  budget_jour numeric(10, 2) not null default 3 check (budget_jour >= 0),
  budget_mois numeric(10, 2) not null default 60 check (budget_mois >= 0),
  allowlist_emails text[] not null default '{}',
  recap_destinataires text[] not null default '{}',
  signataire text not null default 'L''équipe MJAGENCY'
    check (signataire in ('Jérémy', 'Matheis', 'L''équipe MJAGENCY')),
  bavardage_actif boolean not null default true,
  contraintes_agenda jsonb not null default '{"jeremy": "", "matheis": ""}'::jsonb,
  maj_le timestamptz not null default now()
);

-- ------------------------------------------------------------------ pôles et lieux communs
create table if not exists public.poles (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  nom text not null check (length(nom) between 1 and 80),
  court text not null default '',
  icone text not null default '🏢',
  couleur text not null default '#888888' check (couleur ~ '^#[0-9a-fA-F]{6}$'),
  sol text not null default '#eeeeee' check (sol ~ '^#[0-9a-fA-F]{6}$'),
  description text not null default '',
  missions text[] not null default '{}',
  type text not null default 'pole' check (type in ('pole', 'lieu')),
  position_grille text not null check (position_grille ~ '^c[1-5]r[1-5]$'),
  style text not null default 'muret' check (style in ('muret', 'verre', 'douane', 'back')),
  ordre integer not null default 0,
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create unique index if not exists poles_position_actif on public.poles (position_grille) where actif;

-- ------------------------------------------------------------------ agents
create table if not exists public.agents (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  pole_id text not null references public.poles (id) on update cascade on delete restrict,
  nom text not null check (length(nom) between 1 and 40),
  role text not null default '',
  personnalite text not null default '',
  prompt_systeme text not null default '',
  modele text not null default 'worker' check (modele in ('planner', 'worker', 'light')),
  outils text[] not null default '{}',
  autonomie jsonb not null default '{"niveau": 0}'::jsonb,
  apparence_seed text not null default '',
  critique boolean not null default false,
  responsable boolean not null default false,
  sortant boolean not null default false,
  taches_exemple text[] not null default '{}',
  -- état réel, écrit par le moteur (Phase 3) et diffusé en temps réel
  etat text not null default 'idle'
    check (etat in ('idle', 'working', 'talking', 'meeting', 'waiting_approval', 'done', 'offline')),
  offline_raison text check (offline_raison in ('nuit', 'budget')),
  interlocuteur text references public.agents (id) on update cascade on delete set null,
  tache_courante_id uuid,
  position_x integer,
  position_y integer,
  bulle text,
  ordre integer not null default 0,
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index if not exists agents_pole on public.agents (pole_id);

-- ------------------------------------------------------------------ missions des fondateurs
create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  demandeur text not null,
  texte text not null check (length(texte) between 1 and 4000),
  cible text references public.agents (id) on update cascade on delete set null,
  plan jsonb not null default '[]'::jsonb,
  statut text not null default 'nouvelle'
    check (statut in ('nouvelle', 'planification', 'en_cours', 'terminee', 'annulee')),
  synthese text,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);

-- ------------------------------------------------------------------ tâches et exécutions
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.tasks (id) on delete set null,
  mission_id uuid references public.missions (id) on delete set null,
  agent_id text references public.agents (id) on update cascade on delete set null,
  cree_par text not null default 'systeme',
  titre text not null check (length(titre) between 1 and 300),
  description text not null default '',
  statut text not null default 'queued'
    check (statut in ('queued', 'running', 'waiting_tool', 'waiting_approval', 'waiting_founder', 'done', 'failed', 'cancelled')),
  priorite smallint not null default 2 check (priorite between 0 and 5),
  etapes jsonb not null default '[]'::jsonb,
  echeance timestamptz,
  resultat jsonb,
  profondeur smallint not null default 0 check (profondeur between 0 and 3),
  locked_until timestamptz,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index if not exists tasks_statut on public.tasks (statut, priorite desc, cree_le);
create index if not exists tasks_agent on public.tasks (agent_id, cree_le desc);

alter table public.agents
  drop constraint if exists agents_tache_courante_fk,
  add constraint agents_tache_courante_fk foreign key (tache_courante_id) references public.tasks (id) on delete set null;

create table if not exists public.task_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  messages jsonb not null default '[]'::jsonb,
  iterations integer not null default 0,
  cout numeric(10, 4) not null default 0,
  erreur text,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index if not exists task_runs_task on public.task_runs (task_id);

-- ------------------------------------------------------------------ échanges entre agents
create table if not exists public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid,
  from_agent text references public.agents (id) on update cascade on delete set null,
  to_agent text references public.agents (id) on update cascade on delete set null,
  task_id uuid references public.tasks (id) on delete set null,
  type text not null default 'question' check (type in ('question', 'reponse', 'delegation', 'bavardage')),
  contenu text not null default '',
  resume_bulle text check (resume_bulle is null or length(resume_bulle) <= 90),
  cree_le timestamptz not null default now()
);
create index if not exists agent_messages_conv on public.agent_messages (conversation_id, cree_le);

-- ------------------------------------------------------------------ La Douane (validation humaine)
create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  agent_id text references public.agents (id) on update cascade on delete set null,
  task_id uuid references public.tasks (id) on delete set null,
  type_action text not null check (type_action in ('email', 'facture', 'devis', 'relance', 'rdv', 'question', 'memoire', 'autre')),
  titre text not null default '',
  destinataire text,
  objet text,
  payload jsonb not null default '{}'::jsonb,
  apercu text not null default '',
  statut text not null default 'en_attente' check (statut in ('en_attente', 'approuve', 'modifie', 'refuse')),
  motif text,
  decide_par text,
  decide_le timestamptz,
  cree_le timestamptz not null default now()
);
create index if not exists approvals_attente on public.approvals (statut, cree_le);

create table if not exists public.autonomy_rules (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references public.agents (id) on update cascade on delete cascade,
  type_action text not null,
  condition jsonb not null default '{}'::jsonb,
  actif boolean not null default true,
  cree_par text,
  cree_le timestamptz not null default now()
);

-- ------------------------------------------------------------------ journal
create table if not exists public.journal (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'action' check (type in ('action', 'echange', 'decision', 'mission', 'alerte', 'validation', 'recap')),
  pole_id text references public.poles (id) on update cascade on delete set null,
  agent_id text references public.agents (id) on update cascade on delete set null,
  titre text not null check (length(titre) between 1 and 300),
  contenu text,
  lien text,
  cree_le timestamptz not null default now()
);
create index if not exists journal_date on public.journal (cree_le desc);

-- ------------------------------------------------------------------ routines (exécutées en Phase 5)
create table if not exists public.routines (
  id text primary key check (id ~ '^[a-z0-9_-]{2,60}$'),
  nom text not null check (length(nom) between 1 and 120),
  agent_id text references public.agents (id) on update cascade on delete set null,
  mode text not null default 'fixe' check (mode in ('fixe', 'intervalle')),
  heure time not null default '08:00',
  intervalle_minutes integer not null default 15 check (intervalle_minutes between 5 and 1440),
  plage_debut time not null default '08:00',
  plage_fin time not null default '20:00',
  jours smallint[] not null default '{}', -- 1 = lundi … 7 = dimanche, vide = tous les jours
  jour_du_mois smallint check (jour_du_mois between 1 and 28),
  fuseau text not null default 'Europe/Paris',
  prompt_tache text not null default '',
  actif boolean not null default true,
  derniere_execution timestamptz,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);

-- ------------------------------------------------------------------ mémoire
create table if not exists public.company_memory (
  id text primary key,
  cle text not null unique check (length(cle) between 1 and 80),
  contenu text not null default '',
  maj_le timestamptz not null default now()
);

create table if not exists public.agent_notes (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references public.agents (id) on update cascade on delete cascade,
  contenu text not null,
  cree_le timestamptz not null default now()
);

-- ------------------------------------------------------------------ coûts
create table if not exists public.usage (
  id uuid primary key default gen_random_uuid(),
  agent_id text references public.agents (id) on update cascade on delete set null,
  modele text not null,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cout_estime numeric(10, 5) not null default 0,
  date date not null default (now() at time zone 'Europe/Paris')::date,
  cree_le timestamptz not null default now()
);
create index if not exists usage_jour on public.usage (date, agent_id);

-- ------------------------------------------------------------------ déclencheurs maj_le
do $$
declare t text;
begin
  foreach t in array array['settings', 'poles', 'agents', 'missions', 'tasks', 'task_runs', 'routines', 'company_memory'] loop
    execute format('drop trigger if exists touch_maj_le on public.%I', t);
    execute format('create trigger touch_maj_le before update on public.%I for each row execute function public.touch_maj_le()', t);
  end loop;
end;
$$;
