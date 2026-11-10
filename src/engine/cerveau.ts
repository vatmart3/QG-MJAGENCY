import type { EAgent, ETask, EngineDb } from "./db";

/**
 * « Cerveau » des agents :
 *  - api : tout par la clé API (rapide, payant à l'usage) ;
 *  - mixte : l'urgent par la clé API (réponses aux clients, SAV, tri du courrier), le reste par Claude Code sur
 *    l'abonnement des fondateurs (tâche programmée qui passe régulièrement) ;
 *  - abonnement : tout par Claude Code.
 * Sécurité : tant que Claude Code n'est pas passé depuis 3 h, tout reste (ou revient) sur la clé API.
 */

export type ModeIa = "api" | "mixte" | "abonnement";
export const lireModeIa = (v: unknown): ModeIa => {
  const m = (v as { mode?: string } | null)?.mode;
  return m === "api" || m === "abonnement" ? m : "mixte";
};

export const CLE_CLAUDE = "claude.dernier";
export const CLAUDE_VIVANT_MS = 3 * 3600_000;

/** Tâche qui ne peut pas attendre le prochain passage de Claude Code. */
export function urgente(task: Pick<ETask, "titre" | "priorite">, agent: Pick<EAgent, "id">): boolean {
  return agent.id === "lucie" || agent.id === "iris" || task.priorite >= 5 || /^(Répondre|Tri des mails)/.test(task.titre);
}

export function versAbonnement(mode: ModeIa, task: Pick<ETask, "titre" | "priorite">, agent: Pick<EAgent, "id">): boolean {
  if (mode === "api") return false;
  if (mode === "abonnement") return true;
  return !urgente(task, agent);
}

/** Claude Code est-il passé récemment (sinon on ne lui confie rien) ? */
export async function claudeVivant(db: EngineDb, now: Date): Promise<boolean> {
  const k = await db.kvGet<{ le?: string }>(CLE_CLAUDE);
  return !!k?.le && now.getTime() - new Date(k.le).getTime() < CLAUDE_VIVANT_MS;
}
