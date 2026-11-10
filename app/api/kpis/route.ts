import { commercialCtx } from "@/commercial/server";
import { kpis } from "@/engine/kpis";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Tableau de bord de Diane (sans IA). */
export async function GET(request: Request) {
  const c = await commercialCtx(request);
  if (!c.ok) return c.res;
  try {
    return Response.json(await kpis(c.db, c.services));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
