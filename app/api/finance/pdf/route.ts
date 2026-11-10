import { archiverPdf, pdfDe } from "@/finance/emit";
import { erreur, financeCtx } from "@/finance/server";

export const dynamic = "force-dynamic";

/** PDF d'une pièce : l'original archivé si elle est émise, un aperçu filigrané si c'est un brouillon. */
export async function GET(request: Request) {
  const c = await financeCtx(request);
  if (!c.ok) return c.res;
  const u = new URL(request.url);
  const kind = u.searchParams.get("kind") === "devis" ? "devis" : "facture";
  const id = u.searchParams.get("id") ?? "";
  try {
    const piece = kind === "facture" ? await c.f.invoice(id) : await c.f.quote(id);
    if (!piece) return erreur("Pièce introuvable.", 404);
    let bytes: Uint8Array | null;
    if (piece.statut === "brouillon") bytes = await pdfDe(c.f, kind, piece);
    else {
      const { pdf_path } = await archiverPdf(c.f, c.services.documents, kind, id);
      bytes = await c.services.documents.lire(pdf_path);
    }
    if (!bytes) return erreur("PDF introuvable dans le coffre.", 404);
    const nom = `${piece.numero ?? `apercu-${kind}`}.pdf`;
    return new Response(bytes.slice().buffer as ArrayBuffer, {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `${u.searchParams.get("dl") ? "attachment" : "inline"}; filename="${nom}"`, "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return erreur(e);
  }
}
