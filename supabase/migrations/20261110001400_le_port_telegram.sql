-- LE PORT — bot Telegram (gratuit) : missions depuis le téléphone et notifications « quel agent fait quoi ».

-- chats Telegram reliés (chat id → e-mail du fondateur) et codes d'appairage temporaires
alter table public.settings
  add column if not exists telegram jsonb not null default '{"chats": {}, "appairages": {}}'::jsonb,
  -- « tout » : chaque action des agents (groupée) ; « important » : Douane, alertes, missions terminées
  add column if not exists notifications jsonb not null default '{"niveau": "tout"}'::jsonb;

alter table public.missions
  add column if not exists telegram text,
  add column if not exists telegram_msg_id text,
  add column if not exists telegram_envoye_le timestamptz;
create unique index if not exists missions_telegram_msg on public.missions (telegram_msg_id) where telegram_msg_id is not null;
