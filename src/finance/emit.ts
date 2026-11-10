import type { Documents } from "@/integrations/types";
import type { FinanceDb } from "./db";
import { piecePdf, sha256Hex } from "./pdf";
import type { Invoice, Quote } from "./types";

/**
 * Émission d'une pièce : numéro attribué par la base (sans trou), client figé, PDF généré une fois,
 * archivé dans le coffre privé, empreinte SHA-256 enregistrée. Idempotent.
 */
export async function emettrePiece(f: FinanceDb, docs: Documents, kind: "facture" | "devis", id: string): Promise<{ numero: string; pdf_path: string }> {
  await f.emettre(kind, id);
  return archiverPdf(f, docs, kind, id);
}

/** Génère et archive le PDF d'une pièce émise qui n'en a pas encore (jamais remplacé ensuite). */
export async function archiverPdf(f: FinanceDb, docs: Documents, kind: "facture" | "devis", id: string): Promise<{ numero: string; pdf_path: string }> {
  const piece = kind === "facture" ? await f.invoice(id) : await f.quote(id);
  if (!piece || !piece.numero) throw new Error("Pièce introuvable ou non émise.");
  if (piece.pdf_path) return { numero: piece.numero, pdf_path: piece.pdf_path };
  const bytes = await pdfDe(f, kind, piece);
  const annee = piece.numero.split("-")[1] ?? "pieces";
  const path = `${annee}/${piece.numero}.pdf`;
  await docs.ecrire(path, bytes);
  const sha = await sha256Hex(bytes);
  if (kind === "facture") await f.updateInvoice(id, { pdf_path: path, pdf_sha256: sha });
  else await f.updateQuote(id, { pdf_path: path, pdf_sha256: sha });
  return { numero: piece.numero, pdf_path: path };
}

/** PDF d'une pièce (aperçu en filigrane si c'est un brouillon). */
export async function pdfDe(f: FinanceDb, kind: "facture" | "devis", piece: Invoice | Quote): Promise<Uint8Array> {
  const settings = await f.settings();
  const client = piece.client_snapshot ?? (piece.client_id ? await f.client(piece.client_id) : null) ?? { nom: "—" };
  if (kind === "facture") {
    const inv = piece as Invoice;
    const origine = inv.avoir_de ? await f.invoice(inv.avoir_de) : null;
    return piecePdf(
      { kind: inv.type === "avoir" ? "avoir" : "facture", numero: inv.numero, emis_le: inv.emis_le, echeance: inv.echeance, client, objet: inv.objet, lignes: inv.lignes, total: inv.total, notes: inv.notes, avoirDe: origine?.numero, apercu: inv.statut === "brouillon" },
      settings,
    );
  }
  const q = piece as Quote;
  return piecePdf({ kind: "devis", numero: q.numero, emis_le: q.emis_le, valable_jusqu: q.valable_jusqu, client, objet: q.objet, lignes: q.lignes, total: q.total, notes: q.notes, conditions: q.conditions, apercu: q.statut === "brouillon" }, settings);
}
