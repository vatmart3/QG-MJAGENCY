-- LE PORT — missions envoyées depuis WhatsApp, et plus de nuit : les agents restent au port 24 h/24.

-- numéros WhatsApp des fondateurs autorisés à envoyer des missions (numéro international sans + → e-mail)
alter table public.settings
  add column if not exists whatsapp jsonb not null default '{"numeros": {}}'::jsonb;

-- une mission venue de WhatsApp : on y renvoie le résultat ; l'id du message évite les doublons
alter table public.missions
  add column if not exists whatsapp text,
  add column if not exists whatsapp_msg_id text,
  add column if not exists whatsapp_envoye_le timestamptz;
create unique index if not exists missions_whatsapp_msg on public.missions (whatsapp_msg_id) where whatsapp_msg_id is not null;

-- plus de nuit : la routine « Nuit au port » est coupée, tout le monde revient, le tri des mails tourne jour et nuit
update public.routines set actif = false where id = 'rt_nuit';
update public.agents set etat = 'idle', offline_raison = null where etat = 'offline' and offline_raison = 'nuit';
update public.routines set plage_debut = '00:00', plage_fin = '23:59' where id = 'rt_tri_mails';

-- pilote automatique 24 h/24 (Supabase uniquement : pg_cron)
do $$
begin
  if to_regclass('cron.job') is not null then
    execute $q$select cron.alter_job(jobid, schedule := '* * * * *') from cron.job where jobname = 'le-port-moteur'$q$;
  end if;
end $$;
