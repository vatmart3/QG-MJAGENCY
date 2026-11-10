-- LE PORT — Phase 4 : Google (Gmail + Agenda), tri des mails, exécution des envois validés en Douane.

-- ------------------------------------------------------------------ comptes connectés (jetons chiffrés AES-GCM)
create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('google')),
  compte text not null,
  tokens_chiffres text not null,
  scopes text[] not null default '{}',
  statut text not null default 'connecte' check (statut in ('connecte', 'erreur')),
  erreur text,
  connecte_par text,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  unique (type, compte)
);
-- aucune lecture côté navigateur : seuls le serveur (service_role) et les routes protégées y touchent
alter table public.integrations enable row level security;
revoke all on public.integrations from anon, authenticated;

-- ------------------------------------------------------------------ petit état persistant du moteur (dernier tri, relances du jour…)
create table if not exists public.engine_kv (
  cle text primary key,
  valeur jsonb not null default '{}'::jsonb,
  maj_le timestamptz not null default now()
);
alter table public.engine_kv enable row level security;
revoke all on public.engine_kv from anon, authenticated;

-- ------------------------------------------------------------------ mails vus par Lucie
create table if not exists public.emails (
  id text primary key,
  thread_id text,
  compte text not null,
  de text not null default '',
  a text not null default '',
  objet text not null default '',
  extrait text not null default '',
  recu_le timestamptz,
  categorie text check (categorie in ('client', 'prospect', 'fournisseur', 'admin', 'spam', 'perso', 'autre')),
  resume text,
  urgence smallint not null default 0 check (urgence between 0 and 2),
  statut text not null default 'a_trier' check (statut in ('a_trier', 'trie', 'traite')),
  task_id uuid references public.tasks (id) on delete set null,
  demo boolean not null default false,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index if not exists emails_recu on public.emails (recu_le desc);
alter table public.emails enable row level security;
revoke all on public.emails from anon;
drop policy if exists acces_fondateurs on public.emails;
create policy acces_fondateurs on public.emails for all to authenticated using (public.is_allowed()) with check (public.is_allowed());

-- ------------------------------------------------------------------ Douane : exécution des envois validés
alter table public.approvals
  add column if not exists execution_statut text check (execution_statut in ('a_faire', 'en_cours', 'fait', 'echec', 'simule', 'annule')),
  add column if not exists execution jsonb,
  add column if not exists execute_le timestamptz;
create index if not exists approvals_execution on public.approvals (execution_statut) where execution_statut in ('a_faire', 'en_cours');

-- un envoi validé ne peut plus être modifié par le navigateur (seul le moteur le passe à « fait » / « échec »)
create or replace function public.approvals_garde_execution()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and new.execution_statut is distinct from old.execution_statut then
    -- un fondateur peut seulement annuler un envoi qui n'est pas encore parti
    if not (old.execution_statut = 'a_faire' and new.execution_statut = 'annule' and old.statut = 'en_attente') then
      new.execution_statut := old.execution_statut;
    end if;
  end if;
  if current_user = 'authenticated' then
    new.execution := old.execution;
    new.execute_le := old.execute_le;
  end if;
  return new;
end;
$$;
drop trigger if exists approvals_garde_execution on public.approvals;
create trigger approvals_garde_execution before update on public.approvals
  for each row execute function public.approvals_garde_execution();
