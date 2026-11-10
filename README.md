# ⚓ LE PORT — Quartier Général IA de MJAGENCY

Une petite île-port sétoise en pixel art isométrique, vivante, où chaque pôle de l'agence est un bureau
et chaque agent IA un petit bonhomme qui travaille, va au café, rejoint La Criée et parle avec les autres.
Ce qu'on voit dans la ville est le reflet de l'état réel des agents.

> **État : les 8 phases sont terminées — Atelier Tech (santé des sites, audits), boutique Shopify, recherche web, KPIs, application installable, notifications et sons.**
> Sans variables Supabase, tout tourne en **mode démo** (local), exactement comme en Phase 1.
> 📄 Compte rendu à télécharger : [`docs/compte-rendu.pdf`](docs/compte-rendu.pdf) (source : `docs/compte-rendu.html`, mis à jour à chaque phase).

## Démarrer

```bash
npm install
npm run dev        # http://localhost:3000
```

Autres commandes : `npm run build`, `npm run lint`, `npm run typecheck`, `npm run db:seed` (régénère `supabase/seed.sql`),
`npm run test:moteur` (test d'intégration du moteur sur un Postgres local, voir plus bas).

## Brancher Supabase (Phase 2)

1. **Projet** : crée un projet Supabase (région UE, ex. `eu-west-3` Paris) ou réutilise-en un.
2. **Schéma** : applique dans l'ordre les fichiers de `supabase/migrations/` puis `supabase/seed.sql`, soit via le **SQL Editor** (copier-coller), soit avec la CLI :
   ```bash
   npx supabase link --project-ref <ref-du-projet>
   npx supabase db push
   psql "<chaîne de connexion>" -f supabase/seed.sql
   ```
   Le seed est rejouable : il n'écrase jamais ce que tu as modifié dans Réglages.
3. **Auth** (Authentication → URL Configuration) : *Site URL* = `APP_URL`, *Redirect URLs* += `APP_URL/auth/callback`
   (et `http://localhost:3000/auth/callback` pour le dev).
   Avec `SUPABASE_SERVICE_ROLE_KEY` renseignée, **désactive « Allow new users to sign up »** : les comptes de l'allowlist sont créés par le serveur.
4. **Variables** : copie `.env.example` en `.env.local` et remplis `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`.
5. Va sur `/login`, entre ton e-mail, clique le lien reçu : tu arrives dans la ville, badge **EN DIRECT** sous le logo.
6. Réglages → **Affichage & tests** → *Banc d'essai temps réel* : change l'état d'un agent, dépose un élément en Douane,
   lance une conversation… Ouvre LE PORT sur ton téléphone en même temps : les deux écrans bougent ensemble.

### Sécurité
- **RLS sur toutes les tables** : un utilisateur connecté ne voit et n'écrit rien si son e-mail n'est pas dans `settings.allowlist_emails`
  (fonction `is_allowed()`, insensible à la casse). Le rôle `anon` n'a aucun accès.
- Le lien magique n'est envoyé qu'aux adresses de l'allowlist, avec la même réponse pour une adresse inconnue (on ne révèle pas qui a accès).
- Garde-fous en base : l'allowlist ne peut pas être vidée, une validation décidée ne revient pas en attente,
  deux pôles actifs ne peuvent pas occuper le même emplacement, un pôle qui a des agents ne peut pas être supprimé.
- Ces règles sont testées sur un Postgres 16 local (avec une simulation du schéma `auth` de Supabase).

Astuces de démo :
- `/?heure=22` (ou 6.3, 8.48, 18.5…) force l'heure de la ville (nuit, aube, stand-up, coucher). Aussi dans **Réglages**.
- Tape une mission dans la barre du bas : « Prépare une offre de lancement pour les cartes NFC » → Marius planifie,
  réunit Elsa, Mila et Victor dans La Criée, ils travaillent, puis la synthèse arrive dans le **Journal** (~2 min).
- `@Bastien relance les impayés` confie la mission directement à un agent.
- Console : `window.__LE_PORT__.flyToAgent("marius")`.

## Ce qu'il y a dans la Phase 1

- **Île isométrique 2:1** (grille 58×58, tuiles 32×16) rendue avec PixiJS v8. Elle comprend une falaise de terre en strates, un **canal** en diagonale avec cascade, 2 ponts, des quais pavés (bittes, caisses, lampadaires), un **phare** et un ponton de départ.
- Elle compte **15 pôles + 5 lieux communs** : La Criée, Le Quai (café avec terrasse), La Douane (avec une pile de colis qui grossit), Les Archives et la zone détente. Les pôles sont des bureaux à murets colorés et la Direction est une verrière.
- **39 agents** dessinés procéduralement, en 16×24 px avec 21 poses : marche en 4 directions, tape au clavier, parle, boit un café, dort, célèbre. Chaque apparence est unique et fixe (seed = id).
- **Pathfinding A\*** (les allées coûtent moins cher que l'herbe) et réservation des places : chaises, café, Criée, Douane.
- **Comportements liés à l'état** (cf. §4 du cahier des charges) :

  | État | Ce qu'on voit |
  |---|---|
  | `working` | Tape à son bureau |
  | `idle` | Flâne, va au Quai ou en détente |
  | `talking` | Rejoint son interlocuteur, bulles alternées |
  | `meeting` | Va à La Criée |
  | `waiting_approval` | Dépose une enveloppe à La Douane, puis revient avec ⏳ |
  | `done` | Saute, avec des confettis |
  | `offline` | Rentre par le ponton ; Lucie et Jade restent de garde la nuit |

- **Cycle jour/nuit sur l'heure de Paris** : aube rose, jour lavande, coucher orangé, nuit étoilée avec lampadaires, écrans allumés et faisceau du phare. Le phare clignote plus vite quand des éléments attendent en Douane.
- **Décor** : ciel en dégradé, montagnes violettes, étang avec reflet de l'île, nuages en parallaxe sur 3 couches (la plus proche est floue), léger tilt à la souris ou au gyroscope, barques sur le canal, mouettes, reflets sur l'eau, vapeur de la cafetière.
- **Caméra** : pan, inertie et pinch (`pixi-viewport`). Le zoom se fait par paliers pour que chaque pixel d'art couvre un nombre entier de pixels physiques ; la translation est alignée sur la grille de pixels.
- **Interface** (la ville est l'interface, en français) :
  - barre haute en pill : Ville · Équipe · Tâches · Douane · Finances · Journal · Réglages, recherche d'agent (la caméra vole jusqu'à lui) et « ● N en ligne » ;
  - barre de commande vers Marius, avec autocomplétion `@agent` et dictée vocale FR (Web Speech API) ;
  - mini-carte iso cliquable ;
  - fiches papier inclinées. **Fiche agent** : portrait, personnalité, tâche en direct avec étapes, historique, outils, autonomie, chat direct. **Fiche pôle** : missions, agents, KPIs ;
  - **Douane** : Envoyer / Modifier / Refuser avec motif / Toujours autoriser.
  - Sur mobile, les fiches deviennent des bottom sheets.
- **Aucune image externe** : tous les sprites (sol, mobilier, bonshommes, phare, barques…) sont dessinés par le code dans un **atlas unique**, soit un seul lot de rendu. Les polices sont auto-hébergées via `@fontsource` : Pixelify Sans, Silkscreen, Space Grotesk, Caveat.

## Le moteur d'agents (Phase 3)

Tout travail est une **tâche** exécutée par une **boucle d'agent** : appel à Claude avec le prompt de l'agent (règles communes,
identité, équipe, mémoire d'entreprise — mis en cache), ses outils autorisés et l'historique de la tâche ; l'agent appelle des outils ;
les résultats repartent au modèle ; jusqu'à `finish_task`.

- **Par pas** : chaque appel à `/api/engine/tick` exécute au plus 8 pas (40 s max) ; l'historique est enregistré dans `task_runs`,
  une tâche peut donc durer plusieurs ticks. Réservation atomique (`claim_tasks`, `FOR UPDATE SKIP LOCKED`) : deux ticks ne prennent
  jamais la même tâche. Limites : 12 itérations d'outils par tâche, délégation sur 3 niveaux, 24 h maximum.
- **Marius orchestre** : une mission arrive → il la découpe avec `plan_mission` (sous-tâches, agents, dépendances), le plan s'affiche dans
  la fiche de la mission, les agents se retrouvent dans La Criée, chacun part sur sa sous-tâche, puis Marius reprend la main avec tous
  les livrables et écrit la synthèse (Journal + fiche de la mission).
- **Les agents se parlent** : `ask_agent` (question → réponse immédiate du collègue), `delegate_task` (confie une tâche, attend ou non
  son livrable), `request_meeting`. Chaque échange est enregistré dans `agent_messages` et joué en bulles dans la ville.
- **Les fondateurs restent maîtres** : `ask_founder` dépose une question en Douane, la tâche reprend avec la réponse ;
  `propose_company_memory_update` ne s'applique qu'une fois validé en Douane.
- **Modèles** : Opus 5.5 pour Marius, Sonnet 5.5 pour la rédaction, Haiku 5.5 pour le tri ; réflexion adaptative, effort par niveau,
  cache de prompt. Pour Opus et Sonnet, le **repli côté serveur en cas de refus** est activé (`fallbacks: "default"`) : si le modèle
  décline une requête, l'API la rejoue sur un modèle adapté dans le même appel.
- **Budget** : chaque appel est compté dans `usage` (€). À 80 % du budget du jour : alerte dans le Journal. À 100 % : seuls Lucie,
  Diane, Rémi (et les agents marqués « critiques ») continuent, les autres rentrent chez eux.
- **Sécurité** : mails, pages et documents lus sont encadrés dans `<contenu_externe>` — des données, jamais des ordres ; un agent
  qui y trouve des instructions les signale au Journal et n'agit pas.
- **Sans clé API Anthropic**, le moteur tourne en **mode simulé** : même circuit (plan, réunion, échanges, livrables, synthèse),
  textes marqués « simulé », coût nul. Pratique pour tester la Phase 3 sans dépenser.

**Qui fait tourner le moteur ?** En attendant `pg_cron` (Phase 5) : l'onglet ouvert le relance toutes les 20 s tant qu'il y a du travail,
l'envoi d'une mission le déclenche aussitôt, et le bouton *Faire avancer le moteur* (Réglages → Affichage & tests) le lance à la main.
Un cron Vercel quotidien (`vercel.json`) sert de filet de sécurité. `/api/engine/tick` accepte `Authorization: Bearer CRON_SECRET`
ou la session d'un fondateur.

**Test d'intégration** (Postgres local avec les migrations et le seed appliqués) :
```bash
DATABASE_URL=postgres://utilisateur@localhost/leport npm run test:moteur
```
Il vérifie la mission « offre de lancement des cartes NFC » de bout en bout (Marius → Elsa, Mila, Victor → échanges → synthèse),
la question aux fondateurs via la Douane, le plafond de budget, et deux ticks simultanés.

## Telegram (gratuit) : missions et « quel agent fait quoi » sur le téléphone

- Une seule variable, `TELEGRAM_BOT_TOKEN` (bot créé avec @BotFather). Réglages → Connexions → Telegram :
  « Brancher le bot » (webhook `/api/telegram`, secret dérivé du jeton, vérifié à chaque message) puis
  « Relier mon téléphone » (lien d'appairage valable 10 min, un compte par fondateur).
- **Notifications** : chaque action des agents, groupée par passage (« **Noé** (Accueil) — ▶️ commence : Répondre… »,
  « **Bastien** — 🧾 facture préparée… »), sans sonnerie ; Douane, alertes et missions terminées avec sonnerie.
  `/tout` ou `/calme` (seulement l'important) dans le bot. Même contenu en notification push (réglage général).
- **Missions** : on écrit au bot (« @victor … » pour un agent précis), `/point`, `/douane`, `/aide` ; résultat et
  questions des agents renvoyés dans la conversation. Migration `…1400`.

## Missions par WhatsApp, port ouvert 24 h/24

- **WhatsApp Business (API Cloud de Meta)** : un fondateur écrit une mission au numéro du port → Marius (ou « @victor … »,
  « Céleste : … ») la prend ; « point », « douane », « aide » répondent tout de suite, sans IA. Le **résultat de la
  mission revient dans la conversation**, et une question d'un agent pendant la mission y est signalée.
  Webhook `/api/whatsapp` (signature `X-Hub-Signature-256` vérifiée, doublons ignorés), numéros autorisés dans
  Réglages → Connexions → WhatsApp. Variables : `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`,
  `WHATSAPP_VERIFY_TOKEN`. Les vocaux ne sont pas encore compris.
- **Plus de nuit** : la routine `rt_nuit` est coupée (réactivable dans Réglages → Routines), le pilote automatique tourne
  toutes les minutes 24 h/24 et le tri des mails jour et nuit. Un passage sans travail ne consomme aucun crédit.
- Migration `…1300`.

## Atelier, boutique, veille et finitions (Phase 8)

Onglet **Atelier** : sites clients, boutique, chiffres. Tout ce qui suit tourne **sans IA** sauf la recherche web.

- **Jade — santé des sites clients** (routine `rt_sante_sites`, toutes les heures de 6 h à 23 h) : réponse HTTP et
  temps de réponse à chaque passage ; certificat SSL (date, validité) et expiration du nom de domaine (RDAP, registres
  publics) une fois par jour. Alerte au Journal une seule fois (panne confirmée au 2e échec, SSL < 14 j, domaine < 30 j,
  lenteur > 3 s), puis « tout est rentré dans l'ordre ». Historique des 48 derniers contrôles (`src/tech/`).
- **Oscar — `audit_url`** : SEO de base (titre, description, H1, indexation, canonique, sitemap, robots, données
  structurées), mobile, HTTPS, vitesse, poids, Open Graph, favicon, textes alternatifs ; note sur 100 et corrections par
  priorité. Aussi pour le site d'un prospect (« Auditer seulement »).
- **Boutique MJ E-comm (Shopify)** : commandes, catalogue, stocks (Admin GraphQL `2026-10`). **Yanis** (routine
  `rt_boutique`, toutes les 2 h) signale nouvelles commandes, commandes payées non expédiées après 48 h, stocks bas et
  ruptures. **Iris** répond au SAV (mails « commande / colis » triés vers elle). **Toute modification** (stock, prix,
  mise en ligne) passe par **La Douane** (`shopify_update`). Sans clés : boutique DÉMO.
  Connexion : application du **Dev Dashboard** installée sur la boutique → `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`,
  `SHOPIFY_CLIENT_SECRET` (jeton de 24 h renouvelé tout seul) ; ou ancien jeton `SHOPIFY_ADMIN_TOKEN` (shpat_…).
- **Gabin, Rose, Lina, Elsa, Tom, Capucine, Chloé — `web_search`** : outil de recherche web d'Anthropic, uniquement
  quand une tâche le demande (Haiku d'abord, 3 recherches max, ≈ 1 centime la recherche, compté dans le budget).
- **Diane — `get_kpis`** et onglet Atelier → Chiffres : finance du mois, prospects et pipeline, sites, boutique, coût IA.
- **Application installable** (manifeste, icônes pixel art générées en code, service worker) et **notifications
  push** : nouvelles demandes en Douane et alertes, groupées, une seule fois (Réglages → Connexions → Téléphone ; clés
  VAPID créées dans le navigateur, à mettre dans Vercel : `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`).
- **Sons discrets** (Web Audio, aucun fichier, désactivables) et **célébrations** : nouvelle commande, facture payée,
  affaire signée, site rétabli.
- Migration `…1200` : `sites_monitored`, `push_subscriptions`, réglages boutique, routines et outils.

## Prospection & commercial (Phase 7)

- **Hugo + Inès, sans IA** (routine `rt_leads`, 10 h en semaine, ou « Trouver des prospects ») : recherche Google Places
  (API New, `GOOGLE_PLACES_API_KEY` ; sans clé : commerces DÉMO), métiers × zones de Réglages en tournant d'un jour à
  l'autre, doublons ignorés (`place_id`). Le site est lu (https, mobile, générateur, lenteur, e-mail et Instagram trouvés
  sur la page) puis le commerce est **noté sur 100** avec un **angle d'attaque** et un diagnostic (`src/commercial/prospection.ts`).
- **Sacha, à la demande** (case à cocher + « Faire écrire Sacha ») : le **DM Instagram** (à copier et envoyer à la main,
  jamais d'envoi automatique) et le **mail de prospection** (Douane : adresse jamais vue) ; une seule tâche pour tout le lot.
- **Pipeline kanban** (nouveau → contacté → RDV → devis envoyé → signé / perdu) : la carte suit le devis lié par
  déclencheur (envoyé → devis, accepté → signé, refusé/expiré → perdu). **Victor** prépare le devis (brouillon émis,
  relu avant envoi), **Théo** la fiche RDV (questions, objections, offre). **Margaux** relance les devis sans réponse à
  J+7 et J+15 (modèles, PDF joint, Douane, sans IA ; routine `rt_relances_devis`).
- Outils : `places_search`, `create_lead`, `update_lead`, `search_leads`, `fetch_url_summary` (pages publiques uniquement,
  adresses internes refusées), `create_opportunity`, `update_opportunity_stage`. Migration `…1100`.
- **La nuit au port** (routine `rt_nuit`, 20 h → 8 h, réglable) : les agents sans tâche rentrent par le ponton, Lucie et
  Jade restent de garde ; une tâche réveille l'agent concerné.

## Finance (Phase 6)

- **Pièces conformes** : devis `D-AAAA-NNNN`, factures `F-AAAA-NNNN`, avoirs `A-AAAA-NNNN`. Numérotation **continue et sans
  trou** attribuée par la base (`prochain_numero`, verrou de ligne) au moment de l'**émission** (`emettre_facture`,
  `emettre_devis`, `creer_avoir`). Une pièce naît en brouillon ; émise, elle est **verrouillée** par déclencheur
  (ni modification ni suppression : correction par avoir uniquement). Les paiements sont figés (livre des recettes).
- **PDF** (`src/finance/pdf.ts`, pdf-lib, polices standard) avec toutes les mentions : émetteur et SIRET, client figé à
  l'émission, désignations, quantités, prix, total, échéance, « TVA non applicable, art. 293 B du CGI », pénalités de
  retard, indemnité de 40 € (clients pros), IBAN. Archivé une seule fois dans **Supabase Storage** (bucket privé
  `factures`) avec son **SHA-256** en base. Brouillon = aperçu filigrané.
- **Écran Finances** : tableau de bord (encaissé / objectif, facturé, reste à encaisser, impayés, cotisations estimées,
  12 mois, prévision 3 mois, seuil de TVA), factures et devis (édition, émission, PDF, envoi par mail avec PDF joint,
  encaissement, avoir, devis → facture), clients, abonnements, exports & import, fiscal & réglages, MJ E-comm (séparé).
- **Exports** : livre des recettes CSV/PDF, registre CSV des factures, **ZIP mensuel** pour l'expert-comptable (PDF + CSV).
  **Import CSV** de l'existant (clients, anciennes factures avec leur numéro et leur paiement) avec association des colonnes ;
  la numérotation reprend après le dernier numéro importé.
- **Automatismes sans IA (zéro crédit)** : 1er du mois → factures des abonnements préparées par Bastien (émises et envoyées
  après validation en Douane) ; chaque matin → relances graduées de Rémi (J+3 courtoise, J+10 ferme, J+30 mise en demeure,
  PDF joint, jamais automatiques) ; 1er du mois → clôture d'Héloïse et Agathe au Journal ; alertes fiscales à 7 jours et
  au seuil de TVA (Agathe). Calendrier URSSAF/CFE indicatif (`src/finance/fiscal.ts`).
- **Outils des agents** : `get_client`, `create_quote`, `create_invoice`, `render_pdf` (émission), `send_document`
  (Douane, PDF joint), `record_payment`, `list_unpaid_invoices`, `get_finance_summary`, `get_tax_calendar`.
- Sécurité : RLS fondateurs sur toutes les tables finance ; fonctions d'émission refusées à tout compte hors allowlist
  (`exiger_fondateur`). Structure prête pour la facture électronique (`invoices.facturx`). Migrations `…1000` à `…1020`.

## Pilote automatique, routines et économies (Phase 5)

- **Pilote automatique** : `pg_cron` appelle chaque minute, de 7 h à 22 h (heure de Paris en hiver), `public.le_port_battement()` (pg_net échoue parfois en HTTP/2 vers Vercel : au moins un passage toutes les 2 min ; rien la nuit), qui envoie (pg_net) un POST
  à `/api/engine/tick` avec l'en-tête `x-le-port-cron`. Le jeton est généré dans **Supabase Vault** et vérifié par le
  serveur via `public.le_port_cron_token()` (réservée à `service_role`) : aucun secret à copier. Adresse de l'app dans
  `engine_kv` (clé `pilote`). État visible dans Réglages → Affichage & tests. Migration `…0900` (Supabase uniquement).
- **Routines** (`src/engine/routines.ts`) : à chaque tick, celles qui sont dues sont réservées atomiquement
  (`derniere_execution`) puis lancées ; une routine « fixe » manquée est rattrapée pendant 6 h, pas au-delà.
  Tri des mails (15 min, 8 h–20 h) et relances (14 h) tournent seuls. Récap, stand-up, point de 18 h, rapport hebdo et plan
  de contenu sont **désactivés par défaut** : on les lance **à la demande** (▶ dans Réglages → Routines, ou « Demander un
  récap » dans Rapports) ; activés, le récap et le rapport hebdo partent par mail HTML aux destinataires du récap.
  Les récaps reçoivent les **vraies données** du port (Douane, agenda, mails importants, travail des agents, budget).
- Routines qui attendent une phase suivante (santé des sites, factures échues, leads, relances de devis, clôture) : rien
  n'est lancé, pour ne pas inventer de travail.
- **Économies** : tri des mails limité à l'onglet *Principal* de Gmail, notifications/newsletters rangées **sans IA** ;
  Marius sur Sonnet par défaut (`MODEL_PLANNER=claude-opus-5-5` pour revenir à Opus), réflexion réduite
  (`EFFORT_PLANNER`, `EFFORT_WORKER`), réponses plafonnées à 8 000 jetons ; un tick sans travail ne coûte rien.

## La Douane + Gmail + Agenda (Phase 4)

- **Connexion Google** (Réglages → *Connexions & règles* → « Connecter Google ») : OAuth 2.0, scopes minimaux
  `gmail.modify`, `gmail.send`, `calendar.events` (+ `openid email`). Le refresh token est **chiffré AES-256-GCM**
  (`ENCRYPTION_KEY`) dans `integrations`, table illisible depuis le navigateur. Déconnexion = révocation chez Google.
  Boîte prévue : `AGENCY_MAILBOX` (mjagency.officiel@gmail.com). Architecture multi-comptes, une seule boîte active.
- **Sans Google** : boîte et agenda de **DÉMO** (adresses fictives `.example`, tout est marqué DÉMO, rien ne part).
- **Lucie** trie toutes les 15 min de 8 h à 20 h (routine `rt_tri_mails`) : les nouveaux mails non lus arrivent dans
  `emails`, elle les classe avec `label_email` (catégorie, résumé, urgence, libellé « LE PORT/… » dans Gmail) et crée
  la tâche pour le bon agent (réponse → Noé). Mail urgent → alerte au Journal ; mail piégé → spam, signalé.
- **Noé** répond (`read_email` → `send_email`, dans le fil d'origine) ; **Firmin** relance à 14 h en semaine les mails
  envoyés restés sans réponse depuis 3 jours (`rt_relances_mails`) ; **Céleste** lit l'agenda, trouve des créneaux
  (en tenant compte des contraintes fixes de Réglages) et crée les RDV — en Douane s'il y a des invités extérieurs.
- **La Douane envoie vraiment** : « Envoyer » / « Modifier » (texte et objet) → le moteur envoie via Gmail au passage
  suivant (lancé aussitôt), avec réservation atomique (jamais deux envois). Suivi dans « Décidé récemment » : envoyé,
  simulé, échec. « Refuser » : le motif est gardé en note par l'agent. Signature MJAGENCY automatique (Réglages).
- **Mode autonome** (Réglages → *Connexions & règles*) : les réponses aux mails, relances et invitations partent seules,
  après un délai réglable (5 min par défaut) pendant lequel un fondateur peut **bloquer** l'envoi depuis la Douane, avec un
  maximum d'envois automatiques par jour. Restent toujours en Douane : prix/devis/contrats/paiements/factures (détectés dans
  le texte ou marqués `sensible` par l'agent), adresses jamais vues, réponses à un mail classé spam. Migration `…0800`.
- **Règles d'autonomie** (« Toujours autoriser ce type ») : listées et révocables dans Réglages ; un envoi
  automatique n'a lieu que vers une adresse déjà connue de la boîte, jamais vers une adresse jamais vue.
- Migration `…0700_le_port_google.sql` : `integrations`, `emails`, `engine_kv`, suivi d'exécution des validations.

### Créer le client Google (une fois, avec mjagency.officiel@gmail.com)
1. [console.cloud.google.com](https://console.cloud.google.com) → nouveau projet « LE PORT ».
2. *API et services → Bibliothèque* : activer **Gmail API** et **Google Calendar API**.
3. *Google Auth Platform* (écran de consentement) : type **Externe**, nom « LE PORT », e-mail d'assistance ; ajouter
   mjagency.officiel@gmail.com comme utilisateur test, puis **Publier l'application** (sinon l'accès expire tous les 7 jours ;
   Google affichera « application non validée » : *Paramètres avancés → Accéder à LE PORT*).
4. *Clients → Créer un client* : **Application Web**, URI de redirection autorisée :
   `https://qg-mjagency.vercel.app/api/integrations/google/callback` (et `http://localhost:3000/...` pour le dev).
5. Vercel → *Environment Variables* : `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ENCRYPTION_KEY` (bouton « Générer »
   dans Réglages, ou `openssl rand -base64 32`) → **Redeploy** → Réglages → *Connexions & règles* → « Connecter Google ».

## Comptes rendus et flux entre agents

- **Comptes rendus rangés** : chaque agent termine sa tâche avec un compte rendu structuré (`finish_task`) — résumé, sections en
  Markdown, points clés, prochaines étapes (qui, quand) et **fichiers joints** prêts à l'emploi (.md, .csv, .txt, .html, .json).
  Stocké dans `tasks.resultat.rapport` (schéma partagé : `src/lib/rapport.ts`). Le texte complet remonte tel quel à l'agent qui l'attend.
- **Onglet Rapports** : tous les comptes rendus par jour, recherche, filtre « Synthèses de mission ». Chaque compte rendu se lit dans
  la fiche et se télécharge : **PDF** (page mise en forme + impression « Enregistrer au format PDF »), **.zip** (compte rendu .html + .md
  + fichiers), **.md**, ou un fichier joint seul. Liens depuis la fiche agent (Historique) et l'onglet Tâches.
- **Onglet Flux** : en direct, qui parle à qui (mission, délégation, question, réponse, livrable, Douane) ; par mission, un **schéma
  des échanges** (un couloir par agent, une flèche par échange, clic = détail) et « Qui fait quoi » avec l'état de chaque sous-tâche.
- **Dans la ville** : chaque échange trace une **liaison animée** entre les deux bonshommes (couleur et étiquette selon le type).
- Base : migration `…0600_le_port_livrables.sql` (type d'échange « livrable », index par tâche et par mission).

## Ce qu'apporte la Phase 2

- **Base Supabase** : 14 tables (pôles, agents, missions, tâches + exécutions, échanges entre agents, Douane, règles d'autonomie,
  journal, routines, mémoire d'entreprise, notes d'agents, coûts, réglages), migrations versionnées, seed généré depuis `src/data/seed.ts`.
  Les tables métier (clients, leads, devis, factures…) arrivent avec les phases 6 et 7, avec leurs contraintes propres.
- **Connexion par lien magique** réservée à l'allowlist, middleware qui protège toutes les pages.
- **Temps réel** sur `agents`, `agent_messages`, `approvals`, `journal`, `tasks`, `missions` : un changement d'état en base fait bouger
  le bonhomme, un message entre agents devient une bulle, un élément en Douane fait grossir la pile et clignoter le phare.
- **Réglages éditables** sans toucher au code : agents (apparence, pôle, rôle, personnalité, consignes, modèle, outils, autonomie…),
  pôles (couleurs, emplacement sur l'île, murs), routines (heure fixe ou intervalle, jours), mémoire d'entreprise, allowlist, budget,
  signature, destinataires du récap, contraintes d'agenda. **La ville se redessine** dès qu'on ajoute un agent ou qu'on déplace un pôle.
- Missions et décisions de la Douane écrites en base (Marius les traitera avec le moteur en Phase 3 ; l'envoi réel des mails arrive en Phase 4).

## Architecture

```
app/(port)/layout.tsx         la ville + barres (reste montée entre les onglets)
app/(port)/{equipe,taches,douane,journal,finances,reglages}/page.tsx   fiches des onglets
app/(auth)/login              connexion par lien magique
app/api/auth, app/auth        lien magique (allowlist), retour du lien, déconnexion ; middleware.ts protège le reste
supabase/migrations, seed.sql schéma, RLS, temps réel, seed
src/data/                     seed, catalogue vivant (catalog.ts), dépôt démo/Supabase (repo.ts), contenu de démo
src/lib/supabase/             clients navigateur / serveur / service_role, lignes ↔ objets
src/sync/live.ts              chargement initial + abonnements Realtime + banc d'essai
src/store/world.ts            état « réel » (agents, bulles, Douane, journal, tâches, missions)
src/sim/director.ts           démo locale (sans Supabase) · en direct : joue les bulles, écrit missions et décisions
src/engine/                   moteur d'agents : tick, boucle par pas, prompts, modèles et coûts, accès base (Supabase / Postgres)
src/engine/tools/             un fichier par outil (schéma zod + exécution)
app/api/engine/tick           exécution des pas (CRON_SECRET ou session) · app/api/cron/daily : filet quotidien
app/api/agents/[id]/chat      chat direct avec un agent
app/api/integrations/google   connexion OAuth (connect, callback, status, disconnect)
src/integrations/             Gmail + Agenda (REST), boîte/agenda DÉMO, services du moteur (jetons déchiffrés côté serveur)
src/engine/douane.ts          exécution des envois validés · src/engine/courrier.ts : tri (Lucie) et relances (Firmin)
src/world/                    PixiJS : Game, layout de l'île, ciel, ambiance, couche DOM (étiquettes & bulles)
src/world/sprites/            raster pixel art, atlas, bonshommes, mobilier, sol
src/world/agents/             A*, contrôleur visuel des bonshommes
src/ui/                       composants maison (fiches papier, barres, mini-carte, panneaux)
```

Principe clé : **la ville ne décide de rien**. Elle lit `worldStore`. En démo, c'est le directeur simulé qui l'alimente ;
en direct, c'est Supabase Realtime. En Phase 3, le moteur d'agents (`/api/engine/tick`, clé service_role) écrira dans ces mêmes tables.

## Ce qu'il faudra me fournir (phases suivantes)

| Phase | À fournir |
|---|---|
| 2 | Projet Supabase (URL, clé anon, clé service_role), e-mail de Matheis pour l'allowlist (ajout possible dans Réglages) |
| 3 | `ANTHROPIC_API_KEY` (sans clé : moteur simulé) et un `CRON_SECRET` (chaîne aléatoire) |
| 4 | Client OAuth Google (Gmail + Agenda) autorisé sur `mjagency.officiel@gmail.com` |
| 7 | `GOOGLE_PLACES_API_KEY` (Places API New) |
| 8 | Shopify : `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` (Dev Dashboard) ; notifications : clés VAPID (Réglages → Téléphone) |

Toutes les variables sont listées dans `.env.example`. `MOCK_MODE=true` : tout fonctionne en démo sans clé.

## Feuille de route

- [x] **Phase 1** — La ville vivante (mock)
- [x] Phase 2 — Supabase + Auth + temps réel
- [x] Phase 3 — Le moteur d'agents
- [x] Phase 4 — La Douane + Gmail + Agenda
- [x] Phase 5 — Pilote automatique + routines + récaps (à la demande)
- [x] Phase 6 — Finance
- [x] Phase 7 — Prospection & Commercial
- [x] Phase 8 — Les autres pôles + finitions
