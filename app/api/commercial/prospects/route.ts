import { trouverProspects } from "@/commercial/prospection";
import { commercialCtx } from "@/commercial/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** « Trouver des prospects » : Hugo cherche, Inès analyse et note (sans IA). */
export async function POST(request: Request) {
  const c = await commercialCtx(request);
  if (!c.ok) return c.res;
  try {
    const { max } = (await request.json().catch(() => ({}))) as { max?: number };
    const cfg = await c.db.commercial.prospection();
    return Response.json(await trouverProspects(c.db, await c.services.places(), cfg, Math.min(20, Math.max(1, max ?? cfg.par_jour))));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
