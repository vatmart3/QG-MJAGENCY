import { archiverPdf, emettrePiece } from "@/finance/emit";
import { messageFacture } from "@/finance/automations";
import { erreur, financeCtx } from "@/finance/server";
import { adminSupabase } from "@/lib/supabase/server";
import { eur } from "@/finance/types";

export const dynamic = "force-dynamic";

/** Un fondateur envoie lui-même une pièce au client (PDF joint) : pas besoin de Douane, c'est sa décision. */
export async function POST(request: Request) {
  const c = await financeCtx(request);
  if (!c.ok) return c.res;
  try {
    const { kind, id, a, message } = (await request.json()) as { kind: "facture" | "devis"; id: string; a?: string; message?: string };
    let piece = kind === "facture" ? await c.f.invoice(id) : await c.f.quote(id);
    if (!piece) return erreur("Pièce introuvable.", 404);
    const r = piece.statut === "brouillon" ? await emettrePiece(c.f, c.services.documents, kind, id) : await archiverPdf(c.f, c.services.documents, kind, id);
    piece = kind === "facture" ? await c.f.invoice(id) : await c.f.quote(id);
    const dest = (a ?? piece?.client_snapshot?.email ?? "").trim();
    if (!dest) return erreur("Le client n'a pas d'adresse e-mail.");
    const pdf = await c.services.documents.lire(r.pdf_path);
    if (!pdf || !piece) return erreur("PDF introuvable.");
    const mb = await c.services.mailbox();
    const corps = (message?.trim() || (kind === "facture" ? messageFacture(piece.client_snapshot?.nom ?? "", piece.objet, piece.total) : `Bonjour,\n\nVeuillez trouver ci-joint notre devis ${r.numero} pour : ${piece.objet} (${eur(piece.total)}).\n\nNous restons à votre disposition,`)) + "\n\n--\nL'équipe MJAGENCY\nmjagency.eu";
    await mb.send({ a: dest, objet: `${kind === "facture" ? "Facture" : "Devis"} ${r.numero} — MJAGENCY`, corps, pieces: [{ nom: `${r.numero}.pdf`, mime: "application/pdf", data: pdf }] });
    if (kind === "facture" && piece.statut === "emise") await c.f.updateInvoice(id, { statut: "envoyee" });
    if (kind === "devis" && piece.statut === "emis") await c.f.updateQuote(id, { statut: "envoye" });
    await adminSupabase()?.from("journal").insert({ type: "validation", titre: `🧾 ${kind === "facture" ? "Facture" : "Devis"} ${r.numero} envoyé(e) à ${dest}${mb.kind === "demo" ? " (simulé, DÉMO)" : ""}`, contenu: `Par ${c.email}`, pole_id: "finance" });
    return Response.json({ ok: true, numero: r.numero, demo: mb.kind === "demo" });
  } catch (e) {
    return erreur(e);
  }
}
