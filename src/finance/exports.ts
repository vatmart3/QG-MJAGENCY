import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { toCsv } from "./csv";
import { EMETTEUR, dateFr, eur, num, type Invoice } from "./types";

/** Exports comptables : livre des recettes (CSV / PDF), registre des factures (CSV). */

export interface LigneRecette {
  date_encaissement: string;
  piece: string | null;
  client: string | null;
  nature: string | null;
  montant: number;
  mode_reglement: string;
  activite: string;
}

const MODE: Record<string, string> = { virement: "Virement", carte: "Carte", especes: "Espèces", cheque: "Chèque", prelevement: "Prélèvement", autre: "Autre" };

export function livreCsv(rows: LigneRecette[]): string {
  return toCsv(
    ["Date d'encaissement", "Référence de la facture", "Client", "Nature de la prestation", "Montant (€)", "Mode de règlement"],
    rows.map((r) => [dateFr(r.date_encaissement), r.piece ?? "", r.client ?? "", r.nature ?? "", num(r.montant), MODE[r.mode_reglement] ?? r.mode_reglement]),
  );
}

export function facturesCsv(list: Invoice[], regle: Map<string, number>): string {
  return toCsv(
    ["Numéro", "Type", "Date", "Échéance", "Client", "SIRET client", "Objet", "Total (€)", "Encaissé (€)", "Statut", "Payée le", "Empreinte SHA-256"],
    list.map((i) => [i.numero ?? "", i.type, dateFr(i.emis_le), dateFr(i.echeance), i.client_snapshot?.nom ?? "", i.client_snapshot?.siret ?? "", i.objet, num(i.total), regle.get(i.id) ?? 0, i.statut, dateFr(i.paye_le), i.pdf_sha256 ?? ""]),
  );
}

/** Livre des recettes en PDF (registre chronologique des encaissements, obligatoire en micro-entreprise). */
export async function livrePdf(rows: LigneRecette[], periode: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 841.89;
  const H = 595.28;
  const M = 36;
  const cols = [M, M + 80, M + 185, M + 360, M + 600, M + 690];
  const clean = (s: string) => s.replace(/[ ]/g, " ").replace(/[^\x20-\x7e -ÿ€–—’]/g, "");
  let page = doc.addPage([W, H]);
  let y = H - M;
  const head = () => {
    page.drawText(clean(`Livre des recettes — ${EMETTEUR.nom} — ${periode}`), { x: M, y, size: 14, font: bold });
    page.drawText(clean(`${EMETTEUR.dirigeants} · SIRET ${EMETTEUR.siret} · ${EMETTEUR.tva}`), { x: M, y: y - 16, size: 8, font, color: rgb(0.4, 0.4, 0.45) });
    y -= 40;
    ["Date", "Facture", "Client", "Nature", "Montant", "Règlement"].forEach((t, i) => page.drawText(t, { x: cols[i]!, y, size: 9, font: bold }));
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8 });
    y -= 14;
  };
  head();
  let total = 0;
  for (const r of rows) {
    if (y < M + 30) {
      page = doc.addPage([W, H]);
      y = H - M;
      head();
    }
    const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
    const cells = [dateFr(r.date_encaissement), r.piece ?? "", cut(r.client ?? "", 34), cut(r.nature ?? "", 48), eur(num(r.montant)), MODE[r.mode_reglement] ?? r.mode_reglement];
    cells.forEach((t, i) => page.drawText(clean(t), { x: cols[i]!, y, size: 8.5, font }));
    total += num(r.montant);
    y -= 13;
  }
  y -= 6;
  page.drawLine({ start: { x: M, y: y + 10 }, end: { x: W - M, y: y + 10 }, thickness: 0.8 });
  page.drawText(clean(`Total encaissé : ${eur(total)} (${rows.length} encaissement${rows.length > 1 ? "s" : ""})`), { x: M, y: y - 4, size: 10, font: bold });
  return doc.save();
}
