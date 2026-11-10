import type { SupabaseClient } from "@supabase/supabase-js";
import { lireFinance, type Client, type FinanceSettings, type Invoice, type Ligne, type Payment, type Quote, type Subscription, num } from "./types";

/** Accès aux données finance (Supabase côté serveur/moteur ; une implémentation Postgres sert aux tests). */
export interface FinanceDb {
  settings(): Promise<FinanceSettings>;
  clients(recherche?: string): Promise<Client[]>;
  client(id: string): Promise<Client | null>;
  insertClient(c: Partial<Client> & { nom: string }): Promise<Client>;
  invoice(id: string): Promise<Invoice | null>;
  invoiceByNumero(numero: string): Promise<Invoice | null>;
  quote(id: string): Promise<Quote | null>;
  quoteByNumero(numero: string): Promise<Quote | null>;
  insertInvoice(row: { client_id: string; objet: string; lignes: Ligne[]; delai_jours?: number; quote_id?: string | null; abonnement_id?: string | null; notes?: string | null; cree_par?: string; activite?: "agence" | "ecomm" }): Promise<Invoice>;
  insertQuote(row: { client_id: string; objet: string; lignes: Ligne[]; conditions?: string | null; notes?: string | null; cree_par?: string }): Promise<Quote>;
  updateInvoice(id: string, patch: Partial<Invoice>): Promise<void>;
  updateQuote(id: string, patch: Partial<Quote>): Promise<void>;
  emettre(kind: "facture" | "devis", id: string): Promise<string>;
  avoir(factureId: string, motif: string): Promise<string>;
  insertPayment(p: { invoice_id: string; montant: number; date: string; moyen: Payment["moyen"]; note?: string | null; cree_par?: string }): Promise<void>;
  /** factures non brouillon (agence + e-comm) depuis une date */
  invoicesSince(date: string): Promise<Invoice[]>;
  openInvoices(): Promise<Invoice[]>;
  payments(since: string): Promise<Payment[]>;
  paymentsOf(invoiceId: string): Promise<Payment[]>;
  subscriptions(): Promise<Subscription[]>;
  markSubscription(id: string, mois: string): Promise<boolean>;
}

const normInvoice = (r: Record<string, unknown>): Invoice => ({ ...(r as unknown as Invoice), total: num(r.total), lignes: (r.lignes as Ligne[]) ?? [] });
const normQuote = (r: Record<string, unknown>): Quote => ({ ...(r as unknown as Quote), total: num(r.total), lignes: (r.lignes as Ligne[]) ?? [] });

function ok<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export function supabaseFinanceDb(sb: SupabaseClient): FinanceDb {
  return {
    async settings() {
      const s = ok(await sb.from("settings").select("finance").eq("id", 1).maybeSingle());
      return lireFinance(s?.finance);
    },
    async clients(recherche) {
      let q = sb.from("clients").select("*").order("nom").limit(200);
      if (recherche) q = q.ilike("nom", `%${recherche.replace(/[%_,()]/g, " ")}%`);
      return (ok(await q) ?? []) as Client[];
    },
    async client(id) {
      return ok(await sb.from("clients").select("*").eq("id", id).maybeSingle()) as Client | null;
    },
    async insertClient(c) {
      return ok(await sb.from("clients").insert(c).select("*").single()) as Client;
    },
    async invoice(id) {
      const r = ok(await sb.from("invoices").select("*").eq("id", id).maybeSingle());
      return r ? normInvoice(r) : null;
    },
    async invoiceByNumero(numero) {
      const r = ok(await sb.from("invoices").select("*").eq("numero", numero).maybeSingle());
      return r ? normInvoice(r) : null;
    },
    async quote(id) {
      const r = ok(await sb.from("quotes").select("*").eq("id", id).maybeSingle());
      return r ? normQuote(r) : null;
    },
    async quoteByNumero(numero) {
      const r = ok(await sb.from("quotes").select("*").eq("numero", numero).maybeSingle());
      return r ? normQuote(r) : null;
    },
    async insertInvoice(row) {
      return normInvoice(ok(await sb.from("invoices").insert(row).select("*").single()) as Record<string, unknown>);
    },
    async insertQuote(row) {
      return normQuote(ok(await sb.from("quotes").insert(row).select("*").single()) as Record<string, unknown>);
    },
    async updateInvoice(id, patch) {
      ok(await sb.from("invoices").update(patch).eq("id", id));
    },
    async updateQuote(id, patch) {
      ok(await sb.from("quotes").update(patch).eq("id", id));
    },
    async emettre(kind, id) {
      return String(ok(await sb.rpc(kind === "facture" ? "emettre_facture" : "emettre_devis", { p_id: id })));
    },
    async avoir(factureId, motif) {
      return String(ok(await sb.rpc("creer_avoir", { p_facture: factureId, p_motif: motif, p_lignes: null })));
    },
    async insertPayment(p) {
      ok(await sb.from("payments").insert(p));
    },
    async invoicesSince(date) {
      return (ok(await sb.from("invoices").select("*").neq("statut", "brouillon").gte("emis_le", date).order("emis_le").limit(2000)) ?? []).map(normInvoice);
    },
    async openInvoices() {
      return (ok(await sb.from("invoices").select("*").eq("type", "facture").in("statut", ["emise", "envoyee"]).order("echeance").limit(500)) ?? []).map(normInvoice);
    },
    async payments(since) {
      return ((ok(await sb.from("payments").select("*").gte("date", since).order("date").limit(5000)) ?? []) as Payment[]).map((p) => ({ ...p, montant: num(p.montant) }));
    },
    async paymentsOf(invoiceId) {
      return ((ok(await sb.from("payments").select("*").eq("invoice_id", invoiceId)) ?? []) as Payment[]).map((p) => ({ ...p, montant: num(p.montant) }));
    },
    async subscriptions() {
      return ((ok(await sb.from("subscriptions").select("*").order("libelle")) ?? []) as Subscription[]).map((s) => ({ ...s, montant: num(s.montant) }));
    },
    async markSubscription(id, mois) {
      const r = ok(await sb.from("subscriptions").update({ dernier_mois: mois }).eq("id", id).or(`dernier_mois.is.null,dernier_mois.lt.${mois}`).select("id"));
      return (r ?? []).length > 0;
    },
  };
}
