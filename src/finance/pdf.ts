import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { EMETTEUR, type ClientSnapshot, type FinanceSettings, type Ligne, dateFr, eur, num } from "./types";

/**
 * PDF des factures, devis et avoirs (A4), avec les mentions obligatoires d'une micro-entreprise.
 * Polices standard (aucun fichier externe) : le texte est ramené au jeu de caractères WinAnsi.
 */

export interface PieceInput {
  kind: "facture" | "devis" | "avoir";
  numero: string | null;
  emis_le: string | null;
  echeance?: string | null;
  valable_jusqu?: string | null;
  client: ClientSnapshot;
  objet: string;
  lignes: Ligne[];
  total: number;
  notes?: string | null;
  conditions?: string | null;
  avoirDe?: string | null;
  /** aperçu d'un brouillon (filigrane) */
  apercu?: boolean;
}

const INK = rgb(0.16, 0.13, 0.25);
const SOFT = rgb(0.42, 0.4, 0.5);
const EDGE = rgb(0.88, 0.85, 0.79);
const PAPER = rgb(0.985, 0.965, 0.93);
const ACCENT = rgb(0.18, 0.62, 0.38);

/** Remplace les caractères absents de WinAnsi (espaces fines, emoji…). */
const clean = (s: string) =>
  s
    .replace(/[  ​]/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-‒]/g, "-")
    .replace(/[^\x09\x0a\x0d\x20-\x7e -ÿ€–—…Œœ•]/g, "");

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(t, size) > width && line) {
        out.push(line);
        line = word;
      } else line = t;
    }
    out.push(line);
  }
  return out;
}

export async function piecePdf(p: PieceInput, s: FinanceSettings): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${p.kind === "facture" ? "Facture" : p.kind === "avoir" ? "Avoir" : "Devis"} ${p.numero ?? "brouillon"} — MJAGENCY`);
  doc.setAuthor("MJAGENCY");
  doc.setCreator("LE PORT");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28;
  const H = 841.89;
  const M = 48;
  let page = doc.addPage([W, H]);
  let y = H - M;

  const text = (pg: PDFPage, t: string, x: number, yy: number, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}) =>
    pg.drawText(clean(t), { x, y: yy, size: o.size ?? 9.5, font: o.font ?? regular, color: o.color ?? INK });
  const right = (pg: PDFPage, t: string, xr: number, yy: number, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}) => {
    const f = o.font ?? regular;
    const sz = o.size ?? 9.5;
    text(pg, t, xr - f.widthOfTextAtSize(clean(t), sz), yy, o);
  };

  const filigrane = (pg: PDFPage) => {
    if (!p.apercu) return;
    pg.drawText("APERÇU — NON ÉMIS", { x: 120, y: 360, size: 46, font: bold, color: rgb(0.85, 0.3, 0.25), opacity: 0.12, rotate: { type: "degrees" as never, angle: 30 } as never });
  };
  filigrane(page);

  // ---- en-tête : émetteur
  text(page, EMETTEUR.nom, M, y - 6, { size: 20, font: bold });
  text(page, "Agence web & marketing digital", M, y - 22, { size: 9, color: SOFT });
  const coord = [EMETTEUR.dirigeants, EMETTEUR.adresse, EMETTEUR.ville, `SIRET ${EMETTEUR.siret}`, `${EMETTEUR.email} · ${EMETTEUR.telephone}`, EMETTEUR.site];
  coord.forEach((l, i) => text(page, l, M, y - 40 - i * 12, { size: 8.5, color: SOFT }));

  // ---- titre et références (à droite)
  const titre = p.kind === "facture" ? "FACTURE" : p.kind === "avoir" ? "AVOIR" : "DEVIS";
  right(page, titre, W - M, y - 8, { size: 22, font: bold, color: p.kind === "avoir" ? rgb(0.75, 0.25, 0.2) : INK });
  right(page, `N° ${p.numero ?? "— (brouillon)"}`, W - M, y - 26, { size: 11, font: bold });
  const refs: string[] = [`Date : ${dateFr(p.emis_le)}`];
  if (p.kind === "facture") refs.push(`Échéance : ${dateFr(p.echeance)}`);
  if (p.kind === "devis") refs.push(`Valable jusqu'au : ${dateFr(p.valable_jusqu)}`);
  if (p.kind === "avoir" && p.avoirDe) refs.push(`Sur la facture : ${p.avoirDe}`);
  refs.forEach((l, i) => right(page, l, W - M, y - 42 - i * 12, { size: 9 }));

  // ---- client
  y -= 130;
  const bx = W / 2 + 10;
  const cl = [p.client.nom, p.client.contact ?? "", p.client.adresse ?? "", [p.client.code_postal, p.client.ville].filter(Boolean).join(" "), p.client.siret ? `SIRET ${p.client.siret}` : "", p.client.email ?? ""].filter(Boolean);
  page.drawRectangle({ x: bx - 10, y: y - cl.length * 12 - 14, width: W - M - bx + 10, height: cl.length * 12 + 30, color: PAPER, borderColor: EDGE, borderWidth: 0.8 });
  text(page, p.kind === "devis" ? "DESTINATAIRE" : "CLIENT", bx, y + 4, { size: 7.5, font: bold, color: SOFT });
  cl.forEach((l, i) => text(page, l, bx, y - 10 - i * 12, { size: 9.5, font: i === 0 ? bold : regular }));

  // ---- objet
  y -= Math.max(70, cl.length * 12 + 40);
  if (p.objet) {
    text(page, "Objet :", M, y, { size: 10, font: bold });
    wrap(p.objet, regular, 10, W - 2 * M - 45).forEach((l, i) => text(page, l, M + 42, y - i * 13, { size: 10 }));
    y -= 26;
  }

  // ---- tableau des lignes
  const cols = { d: M + 8, q: W - M - 190, pu: W - M - 85, t: W - M - 8 };
  const header = (pg: PDFPage, yy: number) => {
    pg.drawRectangle({ x: M, y: yy - 6, width: W - 2 * M, height: 20, color: INK });
    text(pg, "Désignation", cols.d, yy, { size: 8.5, font: bold, color: rgb(1, 1, 1) });
    right(pg, "Qté", cols.q + 25, yy, { size: 8.5, font: bold, color: rgb(1, 1, 1) });
    right(pg, "Prix unitaire", cols.pu + 20, yy, { size: 8.5, font: bold, color: rgb(1, 1, 1) });
    right(pg, "Total", cols.t, yy, { size: 8.5, font: bold, color: rgb(1, 1, 1) });
  };
  header(page, y);
  y -= 22;
  for (const l of p.lignes) {
    const lines = wrap(l.designation || "—", regular, 9.5, cols.q - cols.d - 40);
    const h = lines.length * 12 + 8;
    if (y - h < 190) {
      page = doc.addPage([W, H]);
      filigrane(page);
      y = H - M;
      header(page, y);
      y -= 22;
    }
    lines.forEach((t, i) => text(page, t, cols.d, y - i * 12));
    const qte = num(l.quantite);
    right(page, Number.isInteger(qte) ? String(qte) : qte.toLocaleString("fr-FR"), cols.q + 25, y);
    right(page, eur(num(l.prix_unitaire)), cols.pu + 20, y);
    right(page, eur(qte * num(l.prix_unitaire)), cols.t, y, { font: bold });
    const sep = y - (lines.length - 1) * 12 - 7;
    page.drawLine({ start: { x: M, y: sep }, end: { x: W - M, y: sep }, thickness: 0.5, color: EDGE });
    y = sep - 14;
  }

  // ---- total
  y -= 4;
  page.drawRectangle({ x: W - M - 200, y: y - 30, width: 200, height: 34, color: PAPER, borderColor: EDGE, borderWidth: 0.8 });
  text(page, p.kind === "avoir" ? "Total de l'avoir" : "Total à payer", W - M - 190, y - 17, { size: 10, font: bold });
  right(page, eur(num(p.total)), W - M - 10, y - 18, { size: 13, font: bold, color: p.kind === "avoir" ? rgb(0.75, 0.25, 0.2) : ACCENT });
  text(page, EMETTEUR.tva, M, y - 14, { size: 9, font: bold });
  y -= 52;

  // ---- notes / conditions
  const extra = [p.notes, p.kind === "devis" ? p.conditions : null].filter(Boolean).join("\n");
  if (extra) {
    wrap(extra, regular, 9, W - 2 * M).forEach((l) => {
      text(page, l, M, y, { size: 9 });
      y -= 12;
    });
    y -= 6;
  }

  // ---- mentions légales (bas de page)
  const pro = p.client.type !== "particulier";
  const mentions: string[] =
    p.kind === "devis"
      ? [
          `Devis valable jusqu'au ${dateFr(p.valable_jusqu)}. Prix en euros. ${EMETTEUR.tva}.`,
          "Pour accepter : retourner ce devis daté et signé avec la mention « Bon pour accord », ou répondre par écrit.",
        ]
      : [
          p.kind === "facture" ? `Paiement à réception, au plus tard le ${dateFr(p.echeance)}. Pas d'escompte pour paiement anticipé.` : "Avoir à déduire ou à rembourser selon accord.",
          ...(p.kind === "facture"
            ? [
                "En cas de retard de paiement : pénalités au taux de 3 fois le taux d'intérêt légal, exigibles dès le lendemain de l'échéance.",
                ...(pro ? ["Indemnité forfaitaire pour frais de recouvrement : 40 € (art. L441-10 et D441-5 du Code de commerce)."] : []),
                ...(s.iban ? [`Règlement par virement : IBAN ${s.iban}`] : []),
              ]
            : []),
        ];
  let my = 120;
  if (p.kind === "devis") {
    page.drawRectangle({ x: W - M - 200, y: 140, width: 200, height: 60, borderColor: EDGE, borderWidth: 0.8 });
    text(page, "Bon pour accord (date et signature) :", W - M - 192, 188, { size: 8, color: SOFT });
  }
  page.drawLine({ start: { x: M, y: my + 14 }, end: { x: W - M, y: my + 14 }, thickness: 0.6, color: EDGE });
  for (const m of mentions)
    for (const l of wrap(m, regular, 7.8, W - 2 * M)) {
      text(page, l, M, my, { size: 7.8, color: SOFT });
      my -= 10;
    }
  text(page, `${EMETTEUR.nom} · ${EMETTEUR.adresse}, ${EMETTEUR.ville} · SIRET ${EMETTEUR.siret} · ${EMETTEUR.tva}`, M, 36, { size: 7.2, color: SOFT });

  const pages = doc.getPages();
  pages.forEach((pg, i) => right(pg, `${i + 1}/${pages.length}`, W - M, 36, { size: 7.2, color: SOFT }));
  return doc.save();
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(h))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
