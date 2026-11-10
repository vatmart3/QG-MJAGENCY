import { emettrePiece } from "@/finance/emit";
import { erreur, financeCtx } from "@/finance/server";

export const dynamic = "force-dynamic";

/** Émettre une facture ou un devis : numéro définitif, PDF archivé (SHA-256). */
export async function POST(request: Request) {
  const c = await financeCtx(request);
  if (!c.ok) return c.res;
  try {
    const { kind, id } = (await request.json()) as { kind: "facture" | "devis"; id: string };
    if (kind !== "facture" && kind !== "devis") return erreur("Type inconnu.");
    return Response.json(await emettrePiece(c.f, c.services.documents, kind, id));
  } catch (e) {
    return erreur(e);
  }
}
