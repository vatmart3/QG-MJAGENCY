import { prendreTaches } from "@/engine/claude-worker";
import { claudeCtx } from "@/engine/claude-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Claude Code réserve des tâches (consigne, personnage, historique, outils). Body : { max?: number }. */
export async function POST(request: Request) {
  const c = await claudeCtx(request);
  if (!c.ok) return c.res;
  const { max } = (await request.json().catch(() => ({}))) as { max?: number };
  const taches = await prendreTaches(c.db, c.services, Math.max(1, Math.min(5, Number(max) || 3)));
  return Response.json({ taches, consigne: taches.length ? "Pour chaque tâche : incarne l'agent (systeme), lis l'historique, appelle les outils avec POST /api/claude/pas, termine avec finish_task." : "Aucune tâche pour toi : le port tourne tout seul." });
}
