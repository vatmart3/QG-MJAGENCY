import { shopifyConfigure } from "@/boutique/shopify";
import { commercialCtx } from "@/commercial/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Boutique MJ E-comm : commandes des 30 derniers jours et catalogue (lecture seule, Shopify ou DÉMO). */
export async function GET(request: Request) {
  const c = await commercialCtx(request);
  if (!c.ok) return c.res;
  try {
    const b = await c.services.boutique();
    const [commandes, produits, reglages] = await Promise.all([b.commandes({ depuis: new Date(Date.now() - 30 * 86400_000).toISOString(), max: 50 }), b.produits({ max: 100 }), c.db.reglagesBoutique()]);
    return Response.json({ kind: b.kind, domaine: b.domaine, configure: shopifyConfigure(), commandes, produits, reglages });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e), kind: "shopify", configure: shopifyConfigure() }, { status: 502 });
  }
}
