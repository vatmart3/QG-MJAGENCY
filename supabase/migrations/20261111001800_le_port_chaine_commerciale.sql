-- LE PORT — la chaîne commerciale complète : étude et offre chiffrée (Carte des offres MJ), affaire dans le
-- pipeline, mail automatique ou créneau d'appel dans l'agenda, fiche RDV à la réponse, optimisation par Marius
-- chaque vendredi, contenus de Chloé deux fois par semaine (carrousels en images).

-- la Carte des offres MJ remplace l'ancienne grille dans la mémoire de l'entreprise
update public.company_memory set contenu = 'Carte des offres MJ (prix HT, TVA non applicable). Sites : Essentiel 890 € (one-page, 7 j ; ou 390 € + 59 €/mois hybride, ou 190 € + 65 €/mois abonnement) ; Vitrine Pro 1 690 € (5-7 pages, élément 3D ; ou 790 € + 105 €/mois, ou 290 € + 119 €/mois) — l''offre principale ; Signature dès 3 200 € (DA complète, 3D poussée, réservation/boutique ; ou 1 490 € + 169 €/mois, ou 490 € + 199 €/mois). Maintenance 29/49/69 €/mois. Mensuels : Fiche Google suivie 39 €, community management Présence 290 € / Croissance 490 € / Domination 790 €, pub 250 €. Modules : NFC avis 149 € + 19 €/mois, fidélité 190 € + 39 €/mois, agent IA 490 € + 49 €/mois, Vitrine Vivante, borne. Options : page 150 €, réservation 290 €, e-commerce 690 €, anglais 290 €, logo 290 €, identité 690 €, fiche Google 149 €, article 90 €. Packs : Démarrage 990 € + 45 €/mois, Visibilité 1 590 € + 329 €/mois, Tout-en-un 3 190 € + 569 €/mois. Remises : −10 % asso/commerce de moins d''un an, −20 % 3 premiers clients vitrine, parrainage 1 mois offert.', maj_le = now() where cle = 'offres';

insert into public.routines (id, nom, agent_id, mode, heure, jours, prompt_tache, actif) values
  ('rt_optimisation', 'Optimisation de la semaine', 'marius', 'fixe', '16:30', '{5}',
   'Analyse les résultats de la prospection et le coût de l''IA, puis ajuste la semaine suivante (métiers, villes, rythme).', true)
on conflict (id) do nothing;

update public.routines set nom = 'Étude et approche des prospects',
  prompt_tache = 'Étudie les meilleurs prospects du jour, choisis l''offre adaptée (prix calculé selon la Carte des offres), crée l''affaire ; mail automatique s''il a un e-mail, sinon créneau d''appel avec script dans l''agenda des fondateurs.'
  where id = 'rt_prospection_auto';

update public.routines set jours = '{1,4}', actif = true,
  prompt_tache = 'Crée les contenus des réseaux de MJAGENCY : 2 posts prêts à publier (texte complet, hashtags) et UN carrousel de 5 à 7 diapositives. Joins le carrousel en fichier JSON nommé « carrousel-<sujet>.json » au format {"format":"carrousel","theme":"bleu","slides":[{"titre":"","texte":"","emoji":""}]} (titres courts et forts, textes de 2 lignes maximum, dernière diapositive = appel à l''action vers mjagency.eu) : il sera transformé en images prêtes à poster. Sujets : conseils concrets aux commerçants de Sète, avant/après, coulisses de l''agence, offres du moment.'
  where id = 'rt_plan_contenu';

update public.agents set outils = array_append(outils, 'plan_prospect') where id in ('sacha', 'theo') and not ('plan_prospect' = any(outils));
update public.agents set outils = array_append(outils, 'ajuster_prospection') where id = 'marius' and not ('ajuster_prospection' = any(outils));
update public.agents set outils = array_append(outils, 'search_leads') where id = 'marius' and not ('search_leads' = any(outils));
