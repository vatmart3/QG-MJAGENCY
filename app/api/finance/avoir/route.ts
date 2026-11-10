import { archiverPdf } from "@/finance/emit";
import { erreur, financeCtx } from "@/finance/server";

export const dynamic = "force-dynamic";

/** Avoir (total) sur une facture émise : numéro A-AAAA-NNNN, PDF archivé. Seule façon de corriger une facture. */
export async function POST(request: Request) {
  const c = await financeCtx(request);
  if (!c.ok) return c.res;
  try {
    const { id, motif } = (await request.json()) as { id: string; motif: string };
    if (!motif?.trim()) return erreur("Indique le motif de l'avoir.");
    const avoirId = await c.f.avoir(id, motif.trim());
    return Response.json(await archiverPdf(c.f, c.services.documents, "facture", avoirId));
  } catch (e) {
    return erreur(e);
  }
}
