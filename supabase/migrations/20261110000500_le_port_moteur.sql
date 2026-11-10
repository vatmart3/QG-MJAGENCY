-- LE PORT — Phase 3 : le moteur d'agents.

-- Dépendances entre sous-tâches d'une mission, et heure avant laquelle une tâche ne démarre pas
-- (laisse le temps à la réunion dans La Criée d'être jouée dans la ville).
alter table public.tasks
  add column if not exists depend_de uuid[] not null default '{}',
  add column if not exists pas_avant timestamptz;

-- Une seule exécution (boucle d'agent) par tâche ; « attente » = outils dont le résultat n'est pas encore là.
alter table public.task_runs
  add column if not exists attente jsonb not null default '[]'::jsonb,
  add column if not exists resultats_en_suspens jsonb not null default '[]'::jsonb;
create unique index if not exists task_runs_une_par_tache on public.task_runs (task_id);

-- Réservation atomique des tâches prêtes : deux « tick » ne prennent jamais la même tâche.
create or replace function public.claim_tasks(p_limit integer, p_lock_seconds integer)
returns setof public.tasks
language sql
security invoker
set search_path = ''
as $$
  with pretes as (
    select t.id
    from public.tasks t
    where t.statut in ('queued', 'running')
      and (t.locked_until is null or t.locked_until < now())
      and (t.pas_avant is null or t.pas_avant <= now())
      and not exists (
        select 1 from public.tasks d
        where d.id = any (t.depend_de) and d.statut not in ('done', 'failed', 'cancelled')
      )
    order by t.priorite desc, t.cree_le
    limit p_limit
    for update skip locked
  )
  update public.tasks t
  set locked_until = now() + make_interval(secs => p_lock_seconds), statut = 'running'
  from pretes
  where t.id = pretes.id
  returning t.*;
$$;

revoke all on function public.claim_tasks(integer, integer) from public, anon, authenticated;

-- Chat direct avec un agent (fiche agent).
create table if not exists public.agent_chats (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references public.agents (id) on update cascade on delete cascade,
  role text not null check (role in ('fondateur', 'agent')),
  auteur text,
  contenu text not null check (length(contenu) between 1 and 8000),
  cree_le timestamptz not null default now()
);
create index if not exists agent_chats_agent on public.agent_chats (agent_id, cree_le);

alter table public.agent_chats enable row level security;
revoke all on public.agent_chats from anon;
drop policy if exists acces_fondateurs on public.agent_chats;
create policy acces_fondateurs on public.agent_chats for all to authenticated
  using (public.is_allowed()) with check (public.is_allowed());
