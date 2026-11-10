# ⚓ LE PORT — Quartier Général IA de MJAGENCY

Une petite île-port sétoise en pixel art isométrique, vivante, où chaque pôle de l'agence est un bureau
et chaque agent IA un petit bonhomme qui travaille, va au café, rejoint La Criée et parle avec les autres.
Ce qu'on voit dans la ville est le reflet de l'état réel des agents.

> **État : Phase 1 terminée — la ville vivante (mode démo, sans aucune clé).**

## Démarrer

```bash
npm install
npm run dev        # http://localhost:3000
```

Autres commandes : `npm run build`, `npm run lint`, `npm run typecheck`.

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

## Architecture

```
app/(port)/layout.tsx         la ville + barres (reste montée entre les onglets)
app/(port)/{equipe,taches,douane,journal,finances,reglages}/page.tsx   fiches des onglets
app/(auth)/login              écran de connexion (Phase 2)
src/data/                     seed (pôles, agents, mémoire), contenu de démo
src/store/world.ts            état « réel » (agents, bulles, Douane, journal, tâches, missions)
src/sim/director.ts           directeur de démo = moteur simulé (remplacé en Phase 3 par /api/engine/tick + Realtime)
src/world/                    PixiJS : Game, layout de l'île, ciel, ambiance, couche DOM (étiquettes & bulles)
src/world/sprites/            raster pixel art, atlas, bonshommes, mobilier, sol
src/world/agents/             A*, contrôleur visuel des bonshommes
src/ui/                       composants maison (fiches papier, barres, mini-carte, panneaux)
```

Principe clé : **la ville ne décide de rien**. Elle lit `worldStore`. En Phase 1, c'est le directeur de démo qui l'alimente ;
à partir de la Phase 2, ce sera Supabase Realtime (tables `agents`, `agent_messages`, `approvals`, `journal`, `tasks`).

## Ce qu'il faudra me fournir (phases suivantes)

| Phase | À fournir |
|---|---|
| 2 | Projet Supabase (URL, clé anon, clé service_role), e-mail de Matheis pour l'allowlist |
| 3 | `ANTHROPIC_API_KEY` |
| 4 | Client OAuth Google (Gmail + Agenda) autorisé sur `mjagency.officiel@gmail.com` |
| 7 | `GOOGLE_PLACES_API_KEY` (Places API New) |
| 8 | Domaine Shopify + token Admin API (custom app) |

Toutes les variables sont listées dans `.env.example`. `MOCK_MODE=true` : tout fonctionne en démo sans clé.

## Feuille de route

- [x] **Phase 1** — La ville vivante (mock)
- [ ] Phase 2 — Supabase + Auth + temps réel
- [ ] Phase 3 — Le moteur d'agents
- [ ] Phase 4 — La Douane + Gmail + Agenda
- [ ] Phase 5 — Routines + récap quotidien
- [ ] Phase 6 — Finance
- [ ] Phase 7 — Prospection & Commercial
- [ ] Phase 8 — Les autres pôles + finitions
