-- LE PORT — « cerveau » mélangé : l'urgent passe par la clé API (rapide), le reste est fait par Claude Code
-- sur l'abonnement des fondateurs (tâche programmée qui passe régulièrement).

-- qui fait la tâche : 'api' (moteur sur Vercel, clé API) ou 'claude' (Claude Code sur l'abonnement)
alter table public.tasks
  add column if not exists executeur text not null default 'api' check (executeur in ('api', 'claude'));
create index if not exists tasks_executeur on public.tasks (executeur, statut) where executeur = 'claude';

-- mode : 'api' (tout par la clé), 'mixte' (urgent par la clé, le reste sur l'abonnement), 'abonnement' (tout sur l'abonnement)
alter table public.settings
  add column if not exists ia jsonb not null default '{"mode": "mixte"}'::jsonb;

-- le moteur sur Vercel ne prend que les tâches de la clé API
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
      and t.executeur = 'api'
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

-- les tâches confiées à Claude (abonnement), réservées le temps que Claude les fasse
create or replace function public.claim_tasks_claude(p_limit integer, p_lock_seconds integer)
returns setof public.tasks
language sql
security invoker
set search_path = ''
as $$
  with pretes as (
    select t.id
    from public.tasks t
    where t.statut in ('queued', 'running')
      and t.executeur = 'claude'
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
revoke all on function public.claim_tasks_claude(integer, integer) from public, anon, authenticated;
