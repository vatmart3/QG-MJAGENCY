# ⚓ LE PORT — Quartier Général IA de MJAGENCY

Une petite île-port sétoise en pixel art isométrique, vivante, où chaque pôle de l'agence est un bureau
et chaque agent IA un petit bonhomme qui travaille, va au café, rejoint La Criée et parle avec les autres.
Ce qu'on voit dans la ville est le reflet de l'état réel des agents.

> **État : Phase 3 terminée — le moteur d'agents (Marius planifie, les agents se parlent et livrent).**
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
| 8 | Domaine Shopify + token Admin API (custom app) |

Toutes les variables sont listées dans `.env.example`. `MOCK_MODE=true` : tout fonctionne en démo sans clé.

## Feuille de route

- [x] **Phase 1** — La ville vivante (mock)
- [x] Phase 2 — Supabase + Auth + temps réel
- [x] Phase 3 — Le moteur d'agents
- [ ] Phase 4 — La Douane + Gmail + Agenda
- [ ] Phase 5 — Routines + récap quotidien
- [ ] Phase 6 — Finance
- [ ] Phase 7 — Prospection & Commercial
- [ ] Phase 8 — Les autres pôles + finitions
