-- LE PORT — pilote commercial automatique : Sacha écrit tout seul aux meilleurs prospects (étalé, plafonné),
-- relance unique à J+5, réponses et « STOP » traités sans IA ; création de contenu et veille chaque semaine.

alter table public.settings
  add column if not exists pilote_commercial jsonb not null default
  '{"actif": true, "mails_par_jour": 10, "score_min": 55, "relance_jours": 5, "debut": "09:00", "fin": "18:00", "ecart_minutes": 12}'::jsonb;

alter table public.leads
  add column if not exists contacte_le timestamptz,
  add column if not exists relance_le timestamptz;

-- adresses qui ne veulent plus être contactées (lien de désinscription ou réponse « STOP ») : jamais réécrites
create table if not exists public.desinscrits (
  email text primary key check (email = lower(email)),
  source text not null default '',
  le timestamptz not null default now()
);
alter table public.desinscrits enable row level security;
revoke all on public.desinscrits from anon;
drop policy if exists acces_fondateurs on public.desinscrits;
create policy acces_fondateurs on public.desinscrits for all to authenticated using (public.is_allowed()) with check (public.is_allowed());

insert into public.routines (id, nom, agent_id, mode, heure, jours, prompt_tache, actif) values
  ('rt_prospection_auto', 'Prospection automatique', 'sacha', 'fixe', '10:30', '{1,2,3,4,5}',
   'Écris aux meilleurs prospects du jour (score, e-mail public) : mails personnalisés envoyés tout seuls, étalés dans la journée, plafond quotidien.', true),
  ('rt_relances_prospects', 'Relance des prospects sans réponse', 'sacha', 'fixe', '15:00', '{1,2,3,4,5}',
   'Relance unique, sans IA, des prospects contactés il y a quelques jours et restés sans réponse.', true),
  ('rt_veille_hebdo', 'Veille de la semaine', 'gabin', 'fixe', '09:00', '{1}',
   'Veille de la semaine pour une agence web de Sète : tendances du web et du référencement local, nouveautés utiles aux commerces, ce que font les agences concurrentes de l''Hérault. 3 recherches au plus, compte rendu court avec les idées actionnables.', true),
  ('rt_article', 'Article de blog de la semaine', 'lina', 'fixe', '09:30', '{3}',
   'Écris un article de blog prêt à publier pour le site de MJAGENCY (SEO local : Sète, bassin de Thau) sur un sujet utile aux commerçants (avis Google, site vitrine, réseaux sociaux…). Titre, chapô, 4 à 6 intertitres, conclusion avec appel à l''action ; joins le texte en Markdown.', true)
on conflict (id) do nothing;

update public.routines set actif = true,
  prompt_tache = 'Prépare les publications de la semaine prêtes à poster (Instagram, LinkedIn, TikTok) : 3 posts avec le texte complet, l''idée de visuel et les hashtags, plus une idée de vidéo courte. Joins-les en Markdown.'
  where id = 'rt_plan_contenu';

update public.agents set outils = array_append(outils, 'update_lead') where id = 'sacha' and not ('update_lead' = any(outils));
update public.agents set outils = array_append(outils, 'send_email') where id = 'sacha' and not ('send_email' = any(outils));
