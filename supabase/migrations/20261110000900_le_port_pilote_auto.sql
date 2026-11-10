-- LE PORT — pilote automatique (Supabase uniquement : pg_cron + pg_net + Vault).
-- Chaque minute, la base appelle /api/engine/tick avec un jeton généré ici, jamais affiché :
-- les agents trient, répondent et envoient même quand aucune page n'est ouverte.
-- Le serveur vérifie le jeton via public.le_port_cron_token() (réservée à service_role).

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'le_port_cron_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'le_port_cron_token', 'Jeton du pilote automatique LE PORT (pg_cron → /api/engine/tick)');
  end if;
end $$;

create or replace function public.le_port_cron_token()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'le_port_cron_token' limit 1;
$$;
revoke all on function public.le_port_cron_token() from public, anon, authenticated;
grant execute on function public.le_port_cron_token() to service_role;

-- adresse de l'application (modifiable : update engine_kv set valeur = '{"url": "…"}' where cle = 'pilote')
insert into public.engine_kv (cle, valeur) values ('pilote', '{"url": "https://qg-mjagency.vercel.app"}')
on conflict (cle) do nothing;

create or replace function public.le_port_battement()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_tok text;
begin
  select valeur ->> 'url' into v_url from public.engine_kv where cle = 'pilote';
  if v_url is null or v_url = '' then
    return;
  end if;
  select decrypted_secret into v_tok from vault.decrypted_secrets where name = 'le_port_cron_token' limit 1;
  perform net.http_post(
    url := v_url || '/api/engine/tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-le-port-cron', v_tok),
    body := '{}'::jsonb,
    timeout_milliseconds := 58000
  );
end;
$$;
revoke all on function public.le_port_battement() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'le-port-moteur';
-- chaque minute de 6 h à 20 h 59 UTC (7 h–22 h à Paris en hiver, 8 h–23 h en été) : pg_net échoue parfois en HTTP/2
-- avec Vercel, on garde ainsi un passage au moins toutes les 2 min ; la nuit, rien ne tourne (quota Vercel ménagé).
select cron.schedule('le-port-moteur', '* 6-20 * * *', 'select public.le_port_battement()');
