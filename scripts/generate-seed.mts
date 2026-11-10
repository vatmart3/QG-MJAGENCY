/**
 * Génère supabase/seed.sql à partir de src/data/seed.ts (source unique du seed).
 * Usage : npm run db:seed
 * Le seed est idempotent (on conflict do nothing) : il ne réécrase jamais ce qui a été modifié dans Réglages.
 */
import { writeFileSync } from "node:fs";
import { AGENTS, DEFAULT_SETTINGS, LIEUX, MEMORY, POLES, ROUTINES } from "../src/data/seed.ts";

const q = (s: string | null | undefined): string => (s === null || s === undefined ? "null" : `'${String(s).replace(/'/g, "''")}'`);
const arr = (a: readonly (string | number)[], type = "text"): string =>
  a.length ? `array[${a.map((x) => (typeof x === "number" ? String(x) : q(x))).join(", ")}]::${type}[]` : `'{}'::${type}[]`;
const b = (v: boolean | undefined): string => (v ? "true" : "false");

const out: string[] = [];
out.push("-- LE PORT — seed initial (généré par scripts/generate-seed.mts, ne pas éditer à la main)");
out.push("-- Idempotent : relançable sans écraser les modifications faites dans Réglages.");
out.push("");
out.push("insert into public.settings (id, budget_jour, budget_mois, allowlist_emails, recap_destinataires, signataire, bavardage_actif, contraintes_agenda) values");
out.push(
  `  (1, ${DEFAULT_SETTINGS.budgetJour}, ${DEFAULT_SETTINGS.budgetMois}, ${arr(DEFAULT_SETTINGS.allowlistEmails)}, ${arr(DEFAULT_SETTINGS.recapDestinataires)}, ${q(DEFAULT_SETTINGS.signataire)}, ${b(DEFAULT_SETTINGS.bavardageActif)}, ${q(JSON.stringify(DEFAULT_SETTINGS.contraintesAgenda))}::jsonb)`,
);
out.push("on conflict (id) do nothing;");
out.push("");

out.push("insert into public.poles (id, nom, court, icone, couleur, sol, description, missions, type, position_grille, style, ordre, actif) values");
out.push(
  [...POLES, ...LIEUX]
    .map((p) => `  (${q(p.id)}, ${q(p.nom)}, ${q(p.court)}, ${q(p.icone)}, ${q(p.couleur)}, ${q(p.sol)}, ${q(p.description)}, ${arr(p.missions)}, ${q(p.kind)}, ${q(p.position)}, ${q(p.style)}, ${p.ordre}, ${b(p.actif)})`)
    .join(",\n"),
);
out.push("on conflict (id) do nothing;");
out.push("");

out.push("insert into public.agents (id, pole_id, nom, role, personnalite, prompt_systeme, modele, outils, autonomie, apparence_seed, critique, responsable, sortant, taches_exemple, ordre, actif) values");
out.push(
  AGENTS.map(
    (a) =>
      `  (${q(a.id)}, ${q(a.pole)}, ${q(a.nom)}, ${q(a.role)}, ${q(a.personnalite)}, ${q(a.promptSysteme)}, ${q(a.modele)}, ${arr(a.outils)}, '{"niveau": ${a.autonomie}}'::jsonb, ${q(a.apparenceSeed)}, ${b(a.critique)}, ${b(a.responsable)}, ${b(a.sortant)}, ${arr(a.taches)}, ${a.ordre}, ${b(a.actif)})`,
  ).join(",\n"),
);
out.push("on conflict (id) do nothing;");
out.push("");

out.push("insert into public.company_memory (id, cle, contenu) values");
out.push(MEMORY.map((m) => `  (${q(m.id)}, ${q(m.cle)}, ${q(m.contenu)})`).join(",\n"));
out.push("on conflict (id) do nothing;");
out.push("");

out.push("insert into public.routines (id, nom, agent_id, mode, heure, intervalle_minutes, plage_debut, plage_fin, jours, jour_du_mois, prompt_tache, actif) values");
out.push(
  ROUTINES.map(
    (r) =>
      `  (${q(r.id)}, ${q(r.nom)}, ${q(r.agentId)}, ${q(r.mode)}, ${q(r.heure)}, ${r.intervalleMinutes}, ${q(r.plageDebut)}, ${q(r.plageFin)}, ${arr(r.jours, "smallint")}, ${r.jourDuMois ?? "null"}, ${q(r.promptTache)}, ${b(r.actif)})`,
  ).join(",\n"),
);
out.push("on conflict (id) do nothing;");
out.push("");
out.push("insert into public.journal (type, pole_id, agent_id, titre, contenu)");
out.push("select 'decision', 'direction', 'marius', 'LE PORT ouvre ses portes', 'Base de données initialisée : pôles, agents, mémoire d''entreprise et routines.'");
out.push("where not exists (select 1 from public.journal where titre = 'LE PORT ouvre ses portes');");
out.push("");

writeFileSync(new URL("../supabase/seed.sql", import.meta.url), out.join("\n"));
console.log(`supabase/seed.sql : ${POLES.length + LIEUX.length} pôles/lieux, ${AGENTS.length} agents, ${MEMORY.length} entrées de mémoire, ${ROUTINES.length} routines`);
