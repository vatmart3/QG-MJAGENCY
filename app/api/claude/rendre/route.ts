import { rendreTache } from "@/engine/claude-worker";
import { claudeCtx } from "@/engine/claude-server";

export const dynamic = "force-dynamic";

/** Claude Code rend une tâche qu'il ne peut pas finir maintenant. Body : { id, raison }. */
export async function POST(request: Request) {
  const c = await claudeCtx(request);
  if (!c.ok) return c.res;
  const { id, raison } = (await request.json().catch(() => ({}))) as { id?: string; raison?: string };
  if (!id) return Response.json({ erreur: "id manquant" }, { status: 400 });
  await rendreTache(c.db, id, raison ?? "Sans raison");
  return Response.json({ ok: true });
}
