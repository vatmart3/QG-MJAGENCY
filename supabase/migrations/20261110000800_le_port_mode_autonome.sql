-- LE PORT — mode autonome : les agents envoient sans attendre la Douane (envoi différé, annulable),
-- dans des limites fixées par les fondateurs. Les cas « jamais automatiques » restent en Douane.
alter table public.settings
  add column if not exists autonomie jsonb not null
  default '{"actif": false, "types": ["email", "relance", "rdv"], "delai_minutes": 5, "plafond_jour": 30}'::jsonb;
