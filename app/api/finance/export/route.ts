import { facturesCsv, livreCsv, livrePdf, type LigneRecette } from "@/finance/exports";
import { archiverPdf } from "@/finance/emit";
import { erreur, financeCtx } from "@/finance/server";
import { num, type Invoice } from "@/finance/types";
import { adminSupabase } from "@/lib/supabase/server";
import { makeZip } from "@/lib/zip";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const fin = (mois: string) => {
  const [y, m] = mois.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

const fichier = (bytes: Uint8Array | string, nom: string, type: string) =>
  new Response(typeof bytes === "string" ? bytes : (bytes.slice().buffer as ArrayBuffer), { headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${nom}"`, "Cache-Control": "private, no-store" } });

/**
 * Exports comptables :
 * - kind=livre&format=csv|pdf&du=AAAA-MM-JJ&au=AAAA-MM-JJ : livre des recettes ;
 * - kind=factures&annee=AAAA : registre CSV des factures et avoirs ;
 * - kind=zip&mois=AAAA-MM : paquet mensuel pour l'expert-comptable (PDF des pièces + CSV).
 */
export async function GET(request: Request) {
  const c = await financeCtx(request);
  if (!c.ok) return c.res;
  const admin = adminSupabase()!;
  const u = new URL(request.url);
  const kind = u.searchParams.get("kind");
  try {
    const livre = async (du: string, au: string) => {
      const { data, error } = await admin.from("livre_recettes").select("*").gte("date_encaissement", du).lte("date_encaissement", au).eq("activite", "agence").order("date_encaissement");
      if (error) throw new Error(error.message);
      return (data ?? []) as LigneRecette[];
    };
    const factures = async (du: string, au: string) => {
      const { data, error } = await admin.from("invoices").select("*").neq("statut", "brouillon").gte("emis_le", du).lte("emis_le", au).order("numero");
      if (error) throw new Error(error.message);
      const list = ((data ?? []) as Invoice[]).map((i) => ({ ...i, total: num(i.total) }));
      const { data: pays } = await admin.from("payments").select("invoice_id, montant").in("invoice_id", list.map((i) => i.id).length ? list.map((i) => i.id) : ["00000000-0000-0000-0000-000000000000"]);
      const regle = new Map<string, number>();
      for (const p of pays ?? []) regle.set(p.invoice_id as string, (regle.get(p.invoice_id as string) ?? 0) + num(p.montant));
      return { list, regle };
    };

    if (kind === "livre") {
      const du = u.searchParams.get("du") ?? `${new Date().getFullYear()}-01-01`;
      const au = u.searchParams.get("au") ?? new Date().toISOString().slice(0, 10);
      const rows = await livre(du, au);
      if (u.searchParams.get("format") === "pdf") return fichier(await livrePdf(rows, `du ${du.split("-").reverse().join("/")} au ${au.split("-").reverse().join("/")}`), `livre-des-recettes_${du}_${au}.pdf`, "application/pdf");
      return fichier(livreCsv(rows), `livre-des-recettes_${du}_${au}.csv`, "text/csv; charset=utf-8");
    }
    if (kind === "factures") {
      const annee = u.searchParams.get("annee") ?? String(new Date().getFullYear());
      const { list, regle } = await factures(`${annee}-01-01`, `${annee}-12-31`);
      return fichier(facturesCsv(list, regle), `factures_${annee}.csv`, "text/csv; charset=utf-8");
    }
    if (kind === "zip") {
      const mois = u.searchParams.get("mois") ?? new Date().toISOString().slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(mois)) return erreur("Mois invalide.");
      const du = `${mois}-01`;
      const au = fin(mois);
      const [rows, { list, regle }] = await Promise.all([livre(du, au), factures(du, au)]);
      const files: { name: string; content: string | Uint8Array }[] = [
        { name: `MJAGENCY_${mois}/livre-des-recettes_${mois}.csv`, content: livreCsv(rows) },
        { name: `MJAGENCY_${mois}/livre-des-recettes_${mois}.pdf`, content: await livrePdf(rows, mois) },
        { name: `MJAGENCY_${mois}/factures_${mois}.csv`, content: facturesCsv(list, regle) },
      ];
      for (const i of list) {
        if (i.importee && !i.pdf_path) continue;
        const { pdf_path } = await archiverPdf(c.f, c.services.documents, "facture", i.id);
        const bytes = await c.services.documents.lire(pdf_path);
        if (bytes) files.push({ name: `MJAGENCY_${mois}/pieces/${i.numero}.pdf`, content: bytes });
      }
      return fichier(makeZip(files), `MJAGENCY_compta_${mois}.zip`, "application/zip");
    }
    return erreur("Export inconnu.");
  } catch (e) {
    return erreur(e);
  }
}
