import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";
import { moisDecale, resumeFinance } from "@/finance/calc";
import { archiverPdf, emettrePiece } from "@/finance/emit";
import { calendrierFiscal } from "@/finance/fiscal";
import { dateFr, eur, type Client, type Invoice, type Quote } from "@/finance/types";
import { withSignature } from "./mail_common";
import type { ToolCtx } from "./types";
import { defineTool } from "./types";

/** Outils finance : brouillons, émission (numéro + PDF archivé), envoi via La Douane, paiements, synthèses. */

const ligne = z.object({
  designation: z.string().min(1).max(300),
  quantite: z.number().positive().max(100000),
  prix_unitaire: z.number().min(-1_000_000).max(1_000_000).describe("prix unitaire en euros (TVA non applicable)"),
});
const nouveauClient = z
  .object({
    nom: z.string().min(1).max(200),
    email: z.string().max(200).optional(),
    adresse: z.string().max(300).optional(),
    code_postal: z.string().max(10).optional(),
    ville: z.string().max(100).optional(),
    siret: z.string().max(20).optional(),
    contact: z.string().max(120).optional(),
    type: z.enum(["pro", "particulier"]).optional(),
  })
  .describe("à remplir seulement si le client n'existe pas encore (vérifie avec get_client)");

const today = (ctx: ToolCtx) => formatInTimeZone(ctx.now, "Europe/Paris", "yyyy-MM-dd");

async function resolveClient(ctx: ToolCtx, ref: string | undefined, nouveau: z.infer<typeof nouveauClient> | undefined): Promise<Client | string> {
  const f = ctx.db.finance;
  if (ref) {
    if (/^[0-9a-f-]{36}$/i.test(ref)) {
      const c = await f.client(ref);
      if (c) return c;
    }
    const list = await f.clients(ref);
    const exact = list.find((c) => c.nom.toLowerCase() === ref.toLowerCase());
    if (exact) return exact;
    if (list.length === 1) return list[0]!;
    if (list.length > 1) return `Plusieurs clients correspondent à « ${ref} » : ${list.slice(0, 6).map((c) => `${c.nom} (id ${c.id})`).join(", ")}. Précise l'id.`;
  }
  if (nouveau) return f.insertClient({ ...nouveau, type: nouveau.type ?? "pro" });
  return `Client introuvable${ref ? ` : « ${ref} »` : ""}. Cherche-le avec get_client ou crée-le avec client_nouveau.`;
}

async function findPiece(ctx: ToolCtx, type: "facture" | "devis", ref: string): Promise<Invoice | Quote | null> {
  const f = ctx.db.finance;
  if (/^[0-9a-f-]{36}$/i.test(ref)) return type === "facture" ? f.invoice(ref) : f.quote(ref);
  return type === "facture" ? f.invoiceByNumero(ref) : f.quoteByNumero(ref);
}

const descLignes = (l: { designation: string; quantite: number; prix_unitaire: number }[]) => l.map((x) => `  - ${x.designation} : ${x.quantite} × ${eur(x.prix_unitaire)}`).join("\n");

export const getClient = defineTool({
  name: "get_client",
  description: "Cherche un client de l'agence par nom (coordonnées, SIRET, e-mail) et ses dernières factures.",
  schema: z.object({ recherche: z.string().min(1).max(120) }),
  async run(ctx, input) {
    const list = await ctx.db.finance.clients(input.recherche);
    if (!list.length) return { content: `Aucun client trouvé pour « ${input.recherche} ».` };
    return {
      content: list
        .slice(0, 8)
        .map((c) => `- ${c.nom} (id ${c.id}) · ${c.type} · ${c.email ?? "pas d'e-mail"} · ${[c.adresse, c.code_postal, c.ville].filter(Boolean).join(" ") || "adresse inconnue"}${c.siret ? ` · SIRET ${c.siret}` : ""}`)
        .join("\n"),
      etape: "Cherche un client",
    };
  },
});

export const createQuote = defineTool({
  name: "create_quote",
  description: "Prépare un devis en BROUILLON (lignes, quantités, prix unitaires ; TVA non applicable). Utilise la grille tarifaire de la mémoire d'entreprise. Ensuite : render_pdf pour l'émettre (numéro définitif), send_document pour l'envoyer via La Douane.",
  schema: z.object({
    client: z.string().max(200).optional().describe("nom ou id d'un client existant"),
    client_nouveau: nouveauClient.optional(),
    objet: z.string().min(1).max(300),
    lignes: z.array(ligne).min(1).max(40),
    conditions: z.string().max(2000).optional().describe("modalités : acompte, délais, abonnement…"),
    notes: z.string().max(1000).optional(),
  }),
  async run(ctx, input) {
    const c = await resolveClient(ctx, input.client, input.client_nouveau);
    if (typeof c === "string") return { content: c, isError: true };
    const q = await ctx.db.finance.insertQuote({ client_id: c.id, objet: input.objet, lignes: input.lignes, conditions: input.conditions ?? null, notes: input.notes ?? null, cree_par: ctx.agent.id });
    await ctx.db.insertJournal({ type: "action", titre: `📝 ${ctx.agent.nom} a préparé un devis (brouillon) : ${c.nom} — ${eur(q.total)}`, agent_id: ctx.agent.id, pole_id: ctx.agent.pole_id });
    return { content: `Devis brouillon créé (id ${q.id}) pour ${c.nom} : total ${eur(q.total)}.\n${descLignes(input.lignes)}\nÀ émettre avec render_pdf (type devis) quand il est prêt.`, etape: "Prépare un devis" };
  },
});

export const createInvoice = defineTool({
  name: "create_invoice",
  description: "Prépare une facture en BROUILLON, soit à partir d'un devis accepté (devis = son numéro), soit avec des lignes. Ensuite : render_pdf pour l'émettre (numéro définitif, verrouillée), send_document pour l'envoyer via La Douane.",
  schema: z.object({
    client: z.string().max(200).optional(),
    client_nouveau: nouveauClient.optional(),
    devis: z.string().max(40).optional().describe("numéro du devis à facturer (D-2026-0001)"),
    objet: z.string().max(300).optional(),
    lignes: z.array(ligne).max(40).optional(),
    delai_jours: z.number().int().min(0).max(60).optional().describe("délai de paiement (défaut : Réglages)"),
    notes: z.string().max(1000).optional(),
  }),
  async run(ctx, input) {
    const f = ctx.db.finance;
    const devis = input.devis ? await f.quoteByNumero(input.devis) : null;
    if (input.devis && !devis) return { content: `Devis introuvable : ${input.devis}.`, isError: true };
    const c = devis?.client_id ? ((await f.client(devis.client_id)) ?? "Client du devis introuvable.") : await resolveClient(ctx, input.client, input.client_nouveau);
    if (typeof c === "string") return { content: c, isError: true };
    const lignes = input.lignes?.length ? input.lignes : (devis?.lignes ?? []);
    if (!lignes.length) return { content: "Il faut des lignes (ou un devis).", isError: true };
    const inv = await f.insertInvoice({
      client_id: c.id,
      objet: input.objet ?? devis?.objet ?? "Prestation",
      lignes,
      quote_id: devis?.id ?? null,
      delai_jours: input.delai_jours ?? (await f.settings()).delai_paiement,
      notes: input.notes ?? null,
      cree_par: ctx.agent.id,
    });
    if (devis && devis.statut !== "accepte") await f.updateQuote(devis.id, { statut: "accepte" }).catch(() => undefined);
    await ctx.db.insertJournal({ type: "action", titre: `🧾 ${ctx.agent.nom} a préparé une facture (brouillon) : ${c.nom} — ${eur(inv.total)}`, agent_id: ctx.agent.id, pole_id: ctx.agent.pole_id });
    return { content: `Facture brouillon créée (id ${inv.id}) pour ${c.nom} : total ${eur(inv.total)}.\n${descLignes(lignes)}\nÀ émettre avec render_pdf (type facture) : le numéro sera définitif et la facture verrouillée.`, etape: "Prépare une facture" };
  },
});

export const renderPdf = defineTool({
  name: "render_pdf",
  description: "Émet une pièce et archive son PDF : la base attribue le numéro définitif (F-/D-AAAA-NNNN, sans trou) et la pièce devient non modifiable. Pour une pièce déjà émise, renvoie simplement son numéro. N'émets qu'une pièce vérifiée.",
  schema: z.object({ type: z.enum(["facture", "devis"]), id: z.string().min(1).max(60).describe("id ou numéro de la pièce") }),
  async run(ctx, input) {
    const piece = await findPiece(ctx, input.type, input.id);
    if (!piece) return { content: "Pièce introuvable.", isError: true };
    const r = piece.statut === "brouillon" ? await emettrePiece(ctx.db.finance, ctx.services.documents, input.type, piece.id) : await archiverPdf(ctx.db.finance, ctx.services.documents, input.type, piece.id);
    await ctx.db.insertJournal({ type: "action", titre: `📄 ${input.type === "facture" ? "Facture" : "Devis"} ${r.numero} émis(e) — ${eur(piece.total)}`, agent_id: ctx.agent.id, pole_id: ctx.agent.pole_id });
    return { content: `${input.type === "facture" ? "Facture" : "Devis"} émis : ${r.numero} (PDF archivé). Pour l'envoyer au client : send_document.`, etape: `Émet ${r.numero}` };
  },
});

export const sendDocument = defineTool({
  name: "send_document",
  description: "Prépare l'envoi d'une facture ou d'un devis au client par mail, PDF joint. Passe TOUJOURS par La Douane (un fondateur valide). Si la pièce est un brouillon, elle sera émise au moment de la validation.",
  schema: z.object({
    type: z.enum(["facture", "devis"]),
    id: z.string().min(1).max(60).describe("id ou numéro"),
    message: z.string().min(1).max(4000).describe("texte du mail (vouvoiement, sans signature : elle est ajoutée)"),
    a: z.string().max(200).optional().describe("destinataire si différent de l'e-mail du client"),
  }),
  async run(ctx, input) {
    const piece = await findPiece(ctx, input.type, input.id);
    if (!piece) return { content: "Pièce introuvable.", isError: true };
    const client = piece.client_snapshot ?? (piece.client_id ? await ctx.db.finance.client(piece.client_id) : null);
    const dest = input.a ?? client?.email ?? null;
    if (!dest) return { content: "Le client n'a pas d'adresse e-mail : demande-la ou indique « a ».", isError: true };
    await ctx.db.insertApproval({
      agent_id: ctx.agent.id,
      task_id: ctx.task.id,
      type_action: input.type,
      titre: `${input.type === "facture" ? "Facture" : "Devis"} ${piece.numero ?? "(à émettre)"} : ${client?.nom ?? "client"} — ${eur(piece.total)}`.slice(0, 200),
      destinataire: dest,
      objet: `${input.type === "facture" ? "Facture" : "Devis"} ${piece.numero ?? ""} — ${piece.objet}`.replace(/\s+/g, " ").slice(0, 200),
      apercu: withSignature(input.message, ctx.settings),
      payload: { kind: "document", doc: input.type, id: piece.id, emettre: true, a: dest },
      execution_statut: "a_faire",
    });
    await ctx.db.updateAgent(ctx.agent.id, { etat: "waiting_approval", interlocuteur: null });
    return { content: `Envoi déposé en Douane (PDF joint). Il partira quand un fondateur aura validé.`, etape: "Dépose une pièce en Douane" };
  },
});

export const recordPayment = defineTool({
  name: "record_payment",
  description: "Enregistre un paiement reçu sur une facture émise (livre des recettes). La facture passe « payée » quand le total est atteint. Un paiement enregistré ne se modifie plus.",
  schema: z.object({
    facture: z.string().min(1).max(60).describe("numéro (F-2026-0001) ou id"),
    montant: z.number().positive().max(1_000_000),
    date: z.string().max(10).optional().describe("AAAA-MM-JJ, défaut aujourd'hui"),
    moyen: z.enum(["virement", "carte", "especes", "cheque", "prelevement", "autre"]).optional(),
  }),
  async run(ctx, input) {
    const inv = (await findPiece(ctx, "facture", input.facture)) as Invoice | null;
    if (!inv || inv.statut === "brouillon") return { content: "Facture introuvable ou pas encore émise.", isError: true };
    await ctx.db.finance.insertPayment({ invoice_id: inv.id, montant: input.montant, date: input.date ?? today(ctx), moyen: input.moyen ?? "virement", cree_par: ctx.agent.id });
    await ctx.db.insertJournal({ type: "action", titre: `💶 Paiement enregistré : ${inv.numero} — ${eur(input.montant)}`, agent_id: ctx.agent.id, pole_id: ctx.agent.pole_id });
    return { content: `Paiement de ${eur(input.montant)} enregistré sur ${inv.numero}.`, etape: "Enregistre un paiement" };
  },
});

export const listUnpaidInvoices = defineTool({
  name: "list_unpaid_invoices",
  description: "Liste les factures émises non réglées (reste à payer, échéance, retard, relances déjà faites).",
  schema: z.object({}),
  async run(ctx) {
    const f = ctx.db.finance;
    const t = today(ctx);
    const list = await f.openInvoices();
    if (!list.length) return { content: "Aucune facture en attente de paiement." };
    const lines = await Promise.all(
      list.map(async (i) => {
        const reste = i.total - (await f.paymentsOf(i.id)).reduce((s, p) => s + p.montant, 0);
        const retard = i.echeance ? Math.floor((Date.parse(t) - Date.parse(i.echeance)) / 86400_000) : 0;
        return `- ${i.numero} · ${i.client_snapshot?.nom ?? "?"} · reste ${eur(reste)} · échéance ${dateFr(i.echeance)}${retard > 0 ? ` · ${retard} j de retard` : ""}${i.relances?.length ? ` · relances : ${i.relances.map((r) => `niveau ${r.niveau} le ${dateFr(r.le)}`).join(", ")}` : ""}`;
      }),
    );
    return { content: lines.join("\n"), etape: "Liste les impayés" };
  },
});

export const getFinanceSummary = defineTool({
  name: "get_finance_summary",
  description: "Chiffres réels de l'agence : facturé et encaissé du mois, objectif, reste à encaisser, impayés, cotisations estimées, seuil de TVA, prévision 3 mois, historique 12 mois.",
  schema: z.object({ mois: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("AAAA-MM, défaut : mois en cours") }),
  async run(ctx, input) {
    const f = ctx.db.finance;
    const t = today(ctx);
    const mois = input.mois ?? t.slice(0, 7);
    const debut = `${moisDecale(mois, -12)}-01`;
    const [invoices, payments, subscriptions, settings] = await Promise.all([f.invoicesSince(debut), f.payments(`${mois.slice(0, 4)}-01-01` < debut ? `${mois.slice(0, 4)}-01-01` : debut), f.subscriptions(), f.settings()]);
    const r = resumeFinance({ invoices, payments, subscriptions, settings, mois, aujourdhui: t });
    return {
      content: [
        `Mois ${mois} — facturé ${eur(r.factureMois)}, encaissé ${eur(r.encaisseMois)} (${r.pctObjectif} % de l'objectif de ${eur(r.objectif, 0)}).`,
        `Reste à encaisser : ${eur(r.aEncaisser)} · Impayés en retard : ${r.impayes.length} (${eur(r.totalImpayes)})`,
        ...r.impayes.slice(0, 8).map((x) => `  - ${x.numero} ${x.client} : ${eur(x.reste)}, ${x.retardJours} j de retard`),
        `Cotisations estimées sur l'encaissé du mois : ${eur(r.cotisationsMois)} (taux ${Math.round(settings.taux_cotisations * 1000) / 10} %).`,
        `CA encaissé depuis janvier : ${eur(r.caAnnuelEncaisse)} (${r.pctSeuilTva} % du seuil de franchise de TVA de ${eur(r.seuilTva, 0)}).`,
        `Abonnements actifs : ${eur(r.abonnementsMensuels)} par mois.`,
        `Prévision : ${r.prevision.map((p) => `${p.mois} ≈ ${eur(p.montant, 0)}`).join(" · ")}`,
        `Historique (encaissé) : ${r.historique.map((h) => `${h.mois} ${eur(h.encaisse, 0)}`).join(" · ")}`,
      ].join("\n"),
      etape: "Lit les chiffres",
    };
  },
});

export const getTaxCalendar = defineTool({
  name: "get_tax_calendar",
  description: "Prochaines échéances fiscales et sociales (URSSAF, CFE, impôt) d'une micro-entreprise, avec les cotisations estimées. Dates usuelles, à vérifier sur les sites officiels.",
  schema: z.object({ jours: z.number().int().min(7).max(366).optional() }),
  async run(ctx, input) {
    const settings = await ctx.db.finance.settings();
    const list = calendrierFiscal(today(ctx), settings, input.jours ?? 120);
    return { content: list.map((e) => `- ${dateFr(e.date)} : ${e.titre}. ${e.detail}`).join("\n") || "Aucune échéance sur la période.", etape: "Consulte le calendrier fiscal" };
  },
});

export const FINANCE_TOOLS = [getClient, createQuote, createInvoice, renderPdf, sendDocument, recordPayment, listUnpaidInvoices, getFinanceSummary, getTaxCalendar];
