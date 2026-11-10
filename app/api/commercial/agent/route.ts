import { tacheSacha, tacheTheo, tacheVictor } from "@/commercial/taches";
import { commercialCtx } from "@/commercial/server";

export const dynamic = "force-dynamic";

/** Tâches à la demande : messages de Sacha, fiche RDV de Théo, devis de Victor. */
export async function POST(request: Request) {
  const c = await commercialCtx(request);
  if (!c.ok) return c.res;
  try {
    const { agent, leads, opportunite } = (await request.json()) as { agent: "sacha" | "theo" | "victor"; leads?: string[]; opportunite?: string };
    const id =
      agent === "sacha" ? await tacheSacha(c.db, leads ?? [], c.email) : agent === "theo" && opportunite ? await tacheTheo(c.db, opportunite, c.email) : agent === "victor" && opportunite ? await tacheVictor(c.db, opportunite, c.email) : null;
    if (!id) return Response.json({ error: "Rien à faire (sélection vide ?)" }, { status: 400 });
    return Response.json({ ok: true, task: id });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
