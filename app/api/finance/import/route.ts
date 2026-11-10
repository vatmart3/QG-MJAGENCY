import { parseDate } from "@/finance/csv";
import { erreur, financeCtx } from "@/finance/server";
import { num, type Client } from "@/finance/types";
import { adminSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Row = Record<string, string>;

/**
 * Reprise de l'existant (CSV déjà associé aux bons champs dans l'assistant d'import) :
 * - clients : nom, email, telephone, adresse, code_postal, ville, siret, contact, type ;
 * - factures : numero, date, client, objet, total, echeance, date_paiement (payée si renseignée), moyen.
 * Les anciennes factures gardent leur numéro ; la numérotation de LE PORT reprend à la suite.
 */
export async function POST(request: Request) {
  const c = await financeCtx(request);
  if (!c.ok) return c.res;
  const admin = adminSupabase()!;
  try {
    const { kind, rows } = (await request.json()) as { kind: "clients" | "factures"; rows: Row[] };
    if (!Array.isArray(rows) || !rows.length) return erreur("Aucune ligne à importer.");
    if (rows.length > 3000) return erreur("3 000 lignes maximum par import.");
    const clients = new Map<string, Client>();
    for (const cl of await c.f.clients()) clients.set(cl.nom.trim().toLowerCase(), cl);
    const clientDe = async (nom: string, extra: Partial<Client> = {}) => {
      const k = nom.trim().toLowerCase();
      if (!k) return null;
      const known = clients.get(k);
      if (known) return known;
      const created = await c.f.insertClient({ nom: nom.trim(), type: extra.type === "particulier" ? "particulier" : "pro", ...extra, importe: true } as Client);
      clients.set(k, created);
      return created;
    };

    let crees = 0;
    const ignores: string[] = [];
    if (kind === "clients") {
      for (const r of rows) {
        if (!r.nom?.trim()) continue;
        if (clients.has(r.nom.trim().toLowerCase())) {
          ignores.push(`${r.nom} (déjà présent)`);
          continue;
        }
        await clientDe(r.nom, { email: r.email || null, telephone: r.telephone || null, adresse: r.adresse || null, code_postal: r.code_postal || null, ville: r.ville || null, siret: r.siret || null, contact: r.contact || null, type: /part/i.test(r.type ?? "") ? "particulier" : "pro" });
        crees++;
      }
      return Response.json({ crees, ignores });
    }

    const max = new Map<string, number>();
    for (const r of rows) {
      const numero = r.numero?.trim();
      const date = parseDate(r.date ?? "");
      const total = num(r.total);
      if (!numero || !date || !r.client?.trim() || !total) {
        ignores.push(`${numero || "(sans numéro)"} : numéro, date, client et total sont obligatoires`);
        continue;
      }
      const { data: exist } = await admin.from("invoices").select("id").eq("numero", numero).maybeSingle();
      if (exist) {
        ignores.push(`${numero} (déjà importée)`);
        continue;
      }
      const cl = await clientDe(r.client);
      const paye = parseDate(r.date_paiement ?? "");
      const avoir = total < 0 || /^A-/i.test(numero);
      const { data: inv, error } = await admin
        .from("invoices")
        .insert({
          type: avoir ? "avoir" : "facture",
          numero,
          client_id: cl?.id ?? null,
          client_snapshot: cl ? { nom: cl.nom, email: cl.email, adresse: cl.adresse, code_postal: cl.code_postal, ville: cl.ville, siret: cl.siret, type: cl.type } : { nom: r.client },
          objet: r.objet?.trim() || "Prestation (reprise de l'existant)",
          lignes: [{ designation: r.objet?.trim() || "Prestation", quantite: 1, prix_unitaire: total }],
          statut: paye ? "payee" : "emise",
          emis_le: date,
          echeance: parseDate(r.echeance ?? "") ?? date,
          paye_le: paye,
          importee: true,
          notes: "Importée depuis l'ancien outil de facturation.",
          cree_par: c.email,
        })
        .select("id")
        .single();
      if (error || !inv) {
        ignores.push(`${numero} : ${error?.message ?? "erreur"}`);
        continue;
      }
      if (paye && !avoir) await admin.from("payments").insert({ invoice_id: inv.id, montant: total, date: paye, moyen: /cart|cb/i.test(r.moyen ?? "") ? "carte" : /esp/i.test(r.moyen ?? "") ? "especes" : /ch[eè]q/i.test(r.moyen ?? "") ? "cheque" : "virement", note: "Reprise de l'existant", cree_par: c.email });
      const m = numero.match(/^([FDA])-(\d{4})-(\d+)$/i);
      if (m) {
        const k = `${m[1]!.toUpperCase()}|${m[2]}`;
        max.set(k, Math.max(max.get(k) ?? 0, Number(m[3])));
      }
      crees++;
    }
    // la numérotation de LE PORT reprend après le dernier numéro importé (pas de doublon, pas de trou)
    for (const [k, n] of max) {
      const [prefixe, annee] = k.split("|") as [string, string];
      const { data: cur } = await admin.from("numerotation").select("dernier").eq("prefixe", prefixe).eq("annee", Number(annee)).maybeSingle();
      if ((cur?.dernier ?? 0) < n) await admin.from("numerotation").upsert({ prefixe, annee: Number(annee), dernier: n }, { onConflict: "prefixe,annee" });
    }
    await admin.from("journal").insert({ type: "action", titre: `📥 Reprise de l'existant : ${crees} facture${crees > 1 ? "s" : ""} importée${crees > 1 ? "s" : ""}`, contenu: ignores.length ? `Ignorées : ${ignores.slice(0, 20).join(" · ")}` : null, pole_id: "finance", agent_id: "bastien" });
    return Response.json({ crees, ignores });
  } catch (e) {
    return erreur(e);
  }
}
