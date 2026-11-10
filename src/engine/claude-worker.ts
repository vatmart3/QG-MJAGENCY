import type Anthropic from "@anthropic-ai/sdk";
import { timingSafeEqual } from "node:crypto";
import type { Services } from "@/integrations/types";
import { CLE_CLAUDE } from "./cerveau";
import type { ETask, EngineDb, Msg } from "./db";
import type { LLM } from "./llm";
import { appliquerReponse, preparerPas, type Shared } from "./loop";
import { systemFor } from "./prompts";
import { apiTools } from "./tools";

/**
 * Claude Code (abonnement des fondateurs) joue les agents à la place de la clé API : il prend les tâches qui
 * lui sont confiées, lit la consigne et l'historique, appelle les MÊMES outils que le moteur (Douane, factures,
 * comptes rendus…) et termine avec finish_task. Aucun appel facturé à la clé API.
 */

export const LOCK_CLAUDE_S = 30 * 60;
/** outils remplacés par ceux de Claude Code lui-même (recherche web) ou qui appelleraient la clé API */
const SANS = new Set(["web_search", "ask_agent"]);

export function autoriseClaude(entete: string | null): boolean {
  const secret = process.env.CLAUDE_WORKER_SECRET?.trim();
  const recu = entete?.replace(/^Bearer\s+/i, "").trim();
  if (!secret || secret.length < 24 || !recu) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(recu);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function contexte(db: EngineDb, services: Services, now = new Date()): Promise<Shared> {
  const [settings, team, polesList, memory] = await Promise.all([db.settings(), db.agents(), db.poles(), db.memory()]);
  return { team, poles: new Map(polesList.map((p) => [p.id, p.nom])), memory, budgetOver: false, now, settings, services };
}

/** Historique lisible d'une tâche (consigne, appels d'outils déjà faits, résultats). */
export function historiqueTexte(messages: Msg[]): string {
  const out: string[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push(m.role === "user" ? `CONSIGNE :\n${m.content}` : `TOI :\n${m.content}`);
      continue;
    }
    for (const b of m.content as Anthropic.Beta.BetaContentBlockParam[]) {
      if (b.type === "text" && b.text.trim()) out.push(m.role === "user" ? `MESSAGE :\n${b.text}` : `TOI :\n${b.text}`);
      if (b.type === "tool_use") out.push(`TU AS APPELÉ ${b.name} ${JSON.stringify(b.input)}`);
      if (b.type === "tool_result") out.push(`RÉSULTAT${b.is_error ? " (erreur)" : ""} :\n${typeof b.content === "string" ? b.content : JSON.stringify(b.content)}`);
    }
  }
  return out.join("\n\n");
}

export interface TacheClaude {
  id: string;
  titre: string;
  agent: { id: string; nom: string; role: string };
  systeme: string;
  historique: string;
  outils: { name: string; description?: string; input_schema: unknown }[];
}

/** Réserve jusqu'à `max` tâches pour Claude Code et renvoie tout ce qu'il faut pour les faire. */
export async function prendreTaches(db: EngineDb, services: Services, max: number, now = new Date()): Promise<TacheClaude[]> {
  await db.kvSet(CLE_CLAUDE, { le: now.toISOString() });
  const shared = await contexte(db, services, now);
  const out: TacheClaude[] = [];
  for (const t of await db.claimTasksClaude(max, LOCK_CLAUDE_S)) {
    const prep = await preparerPas(db, t, shared, { ignorerBudget: true });
    if ("result" in prep) continue;
    await db.updateTask(t.id, { locked_until: new Date(now.getTime() + LOCK_CLAUDE_S * 1000).toISOString() });
    out.push({
      id: t.id,
      titre: t.titre,
      agent: { id: prep.agent.id, nom: prep.agent.nom, role: prep.agent.role },
      systeme: systemFor(prep.agent, shared.team, shared.poles, shared.memory)
        .map((b) => b.text)
        .join("\n\n"),
      historique: historiqueTexte(prep.run.messages),
      outils: apiTools(prep.defs.filter((d) => !SANS.has(d.name))),
    });
  }
  return out;
}

let seq = 0;

/** Un pas joué par Claude Code : texte éventuel + appels d'outils, exécutés par le vrai moteur. */
export async function jouerPas(
  db: EngineDb,
  llm: LLM,
  services: Services,
  id: string,
  pas: { texte?: string; appels: { outil: string; input: unknown }[] },
  now = new Date(),
): Promise<{ statut: string; resultats: { outil: string; contenu: string; erreur: boolean }[] } | { erreur: string }> {
  const [t] = await db.tasks([id]);
  if (!t) return { erreur: "Tâche introuvable." };
  if ((t as ETask).executeur !== "claude" || t.statut !== "running") return { erreur: `Cette tâche n'est plus à toi (statut ${t.statut}). Passe à la suivante.` };
  const shared = await contexte(db, services, now);
  const prep = await preparerPas(db, t, shared, { ignorerBudget: true });
  if ("result" in prep) return { statut: prep.result, resultats: [] };
  const ids = pas.appels.map(() => `toolu_claude_${now.getTime().toString(36)}_${(seq++).toString(36)}`);
  const content = [
    ...(pas.texte?.trim() ? [{ type: "text", text: pas.texte.trim(), citations: null }] : []),
    ...pas.appels.map((a, i) => ({ type: "tool_use", id: ids[i], name: a.outil, input: a.input ?? {}, caller: { type: "direct" } })),
  ] as unknown as Anthropic.Beta.BetaContentBlock[];
  if (!content.length) return { erreur: "Rien à faire : envoie un texte (compte rendu) ou des appels d'outils." };
  const r = await appliquerReponse(db, llm, t, shared, prep, content, 0);
  await db.insertUsage({ agent_id: prep.agent.id, modele: "Claude Code (abonnement)", tokens_in: 0, tokens_out: 0, cout_estime: 0 });
  // la tâche continue : elle reste réservée pour Claude Code
  if (r.result === "continue") await db.updateTask(t.id, { statut: "running", locked_until: new Date(now.getTime() + LOCK_CLAUDE_S * 1000).toISOString() });
  return {
    statut: r.result,
    resultats: [
      ...r.results.map((x) => ({ outil: pas.appels[ids.indexOf(x.tool_use_id)]?.outil ?? "?", contenu: typeof x.content === "string" ? x.content : JSON.stringify(x.content), erreur: !!x.is_error })),
      ...r.attente.map((w) => ({ outil: pas.appels[ids.indexOf(w.tool_use_id)]?.outil ?? "?", contenu: w.kind === "approval" ? "En attente d'une décision des fondateurs (Douane) : la tâche reprendra plus tard." : "En attente des sous-tâches : la tâche reprendra quand elles seront finies.", erreur: false })),
    ],
  };
}

/** Claude Code n'arrive pas à faire une tâche : elle est rendue (reprise au prochain passage, ou par la clé API). */
export async function rendreTache(db: EngineDb, id: string, raison: string, now = new Date()): Promise<void> {
  const [t] = await db.tasks([id]);
  if (!t || t.statut !== "running") return;
  await db.updateTask(id, { statut: "queued", locked_until: null, pas_avant: new Date(now.getTime() + 30 * 60_000).toISOString() });
  if (t.agent_id) await db.updateAgent(t.agent_id, { etat: "idle", tache_courante_id: null });
  await db.insertJournal({ type: "action", titre: `↩️ Tâche remise à plus tard : ${t.titre}`.slice(0, 300), contenu: raison.slice(0, 1000), agent_id: t.agent_id });
}
