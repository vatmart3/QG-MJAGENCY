-- LE PORT — ville agrandie et vivante : 6e colonne d'emplacements, restaurant, médiathèque, salle de sport,
-- navigateur pour tous les agents, mails en temps réel (notification à l'écran).

alter table public.poles drop constraint if exists poles_position_grille_check;
alter table public.poles add constraint poles_position_grille_check check (position_grille ~ '^c[1-6]r[1-5]$');

insert into public.poles (id, nom, court, icone, couleur, sol, description, missions, type, position_grille, style, ordre, actif) values
  ('restaurant', 'Restaurant La Tielle', 'La Tielle', '🍽️', '#c8553d', '#f6e6dc', 'La cantine du port : tielles, poisson du jour et grandes tablées à midi.', '{}', 'lieu', 'c4r5', 'muret', 105, true),
  ('mediatheque', 'La Médiathèque', 'Médiathèque', '📚', '#4a6fa5', '#e3ebf6', 'Livres, veille et postes de lecture : on y étudie les sites et les tendances.', '{}', 'lieu', 'c5r3', 'verre', 106, true),
  ('sport', 'Le Club', 'Sport', '🏋️', '#2e9d8f', '#dcf1ee', 'Tapis de course, haltères et ping-pong pour se dégourdir les jambes.', '{}', 'lieu', 'c5r5', 'muret', 107, true)
on conflict (id) do nothing;

-- le navigateur (browse_site) est donné à tous les agents
update public.agents set outils = array_append(outils, 'browse_site') where not ('browse_site' = any(outils));

-- mails en temps réel : « Vous avez reçu un mail » s'affiche dès l'arrivée
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'emails') then
    alter publication supabase_realtime add table public.emails;
  end if;
end $$;
