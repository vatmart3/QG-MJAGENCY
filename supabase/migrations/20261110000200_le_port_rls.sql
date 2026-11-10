-- LE PORT — sécurité : accès réservé aux e-mails de l'allowlist (settings.allowlist_emails).
-- Le moteur d'agents (Phase 3) utilise la clé service_role, qui contourne la RLS.

create or replace function public.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select lower(coalesce(auth.jwt() ->> 'email', '')) = any (
        select lower(e) from unnest(s.allowlist_emails) as e
      )
      from public.settings s
      where s.id = 1
    ),
    false
  );
$$;

revoke all on function public.is_allowed() from public;
grant execute on function public.is_allowed() to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'settings', 'poles', 'agents', 'missions', 'tasks', 'task_runs', 'agent_messages', 'approvals',
    'autonomy_rules', 'journal', 'routines', 'company_memory', 'agent_notes', 'usage'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists acces_fondateurs on public.%I', t);
    execute format(
      'create policy acces_fondateurs on public.%I for all to authenticated using (public.is_allowed()) with check (public.is_allowed())',
      t
    );
  end loop;
end;
$$;

-- Garde-fou : l'allowlist ne peut jamais être vidée (sinon plus personne n'entre).
create or replace function public.settings_garde_fou()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(array_length(new.allowlist_emails, 1), 0) = 0 then
    raise exception 'L''allowlist ne peut pas être vide';
  end if;
  new.allowlist_emails := array(select distinct lower(trim(e)) from unnest(new.allowlist_emails) as e where trim(e) <> '');
  return new;
end;
$$;

drop trigger if exists settings_garde_fou on public.settings;
create trigger settings_garde_fou before insert or update on public.settings
  for each row execute function public.settings_garde_fou();

-- Une validation déjà décidée ne revient pas en attente.
create or replace function public.approvals_garde_fou()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.statut <> 'en_attente' and new.statut = 'en_attente' then
    raise exception 'Une validation décidée ne peut pas revenir en attente';
  end if;
  return new;
end;
$$;

drop trigger if exists approvals_garde_fou on public.approvals;
create trigger approvals_garde_fou before update on public.approvals
  for each row execute function public.approvals_garde_fou();
