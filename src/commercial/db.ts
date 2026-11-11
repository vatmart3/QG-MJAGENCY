import type { SupabaseClient } from "@supabase/supabase-js";
import { num, type Ligne, type Quote } from "@/finance/types";
import { lirePilote, type Pilote } from "./pilote-reglages";
import { lireProspection, type Prospection } from "./prospection";

export type LeadStatut = "nouveau" | "a_contacter" | "contacte" | "repondu" | "converti" | "ecarte";
export type Etape = "nouveau" | "contacte" | "rdv" | "devis" | "signe" | "perdu";

export interface Lead {
  id: string;
  place_id: string | null;
  nom: string;
  metier: string | null;
  ville: string | null;
  adresse: string | null;
  telephone: string | null;
  site: string | null;
  email: string | null;
  instagram: string | null;
  note_google: number | null;
  nb_avis: number | null;
  maps_url: string | null;
  score: number;
  angle: string | null;
  diagnostic: string | null;
  dm_instagram: string | null;
  statut: LeadStatut;
  source: "places" | "manuel" | "demo";
  demo: boolean;
  notes: string | null;
  client_id: string | null;
  cree_le: string;
  /** pilote commercial : date du premier mail, de la relance */
  contacte_le?: string | null;
  relance_le?: string | null;
}

export interface Opportunity {
  id: string;
  lead_id: string | null;
  client_id: string | null;
  titre: string;
  montant: number | null;
  etape: Etape;
  prochaine_action: string | null;
  echeance: string | null;
  rdv_le: string | null;
  quote_id: string | null;
  notes: string | null;
  cree_le: string;
  maj_le: string;
}

export type NewLead = Omit<Lead, "id" | "statut" | "dm_instagram" | "notes" | "client_id" | "cree_le"> & Partial<Pick<Lead, "statut" | "notes">>;

export interface CommercialDb {
  prospection(): Promise<Prospection>;
  knownPlaces(ids: string[]): Promise<string[]>;
  insertLead(row: Partial<NewLead> & { nom: string }): Promise<boolean>;
  lead(id: string): Promise<Lead | null>;
  findLeads(ref: string): Promise<Lead[]>;
  searchLeads(o: { recherche?: string; statut?: LeadStatut; scoreMin?: number; max: number }): Promise<Lead[]>;
  updateLead(id: string, patch: Partial<Lead>): Promise<void>;
  insertOpportunity(row: Partial<Opportunity> & { titre: string }): Promise<Opportunity>;
  findOpportunities(ref: string): Promise<Opportunity[]>;
  updateOpportunity(id: string, patch: Partial<Opportunity>): Promise<void>;
  quotesEnAttente(): Promise<Quote[]>;
  markQuoteRelance(id: string, niveau: number, le: string): Promise<void>;
  /** pilote commercial (réglages) */
  pilote(): Promise<Pilote>;
  /** envois du pilote : combien créés depuis une date, et l'heure du dernier envoi programmé */
  envoisPilote(depuisIso: string): Promise<{ aujourdhui: number; dernier: string | null }>;
  leadsAProspecter(scoreMin: number, max: number): Promise<Lead[]>;
  leadsARelancer(avantIso: string, max: number): Promise<Lead[]>;
  leadParEmail(email: string): Promise<Lead | null>;
  estDesinscrit(email: string): Promise<boolean>;
  desinscrire(email: string, source: string): Promise<void>;
  /** premier mail de prospection réellement envoyé à un prospect (objet, fil Gmail) */
  premierEnvoiProspection(leadId: string): Promise<{ objet: string; threadId: string | null } | null>;
  /** chiffres pour les KPIs de Diane : prospects par statut, pipeline par étape */
  stats(): Promise<{ leads: Record<string, number>; pipeline: { etape: Etape; n: number; montant: number; maj_le: string }[] }>;
}

const nLead = (r: Record<string, unknown>): Lead => ({ ...(r as unknown as Lead), note_google: r.note_google === null || r.note_google === undefined ? null : num(r.note_google), score: num(r.score) });
const nOpp = (r: Record<string, unknown>): Opportunity => ({ ...(r as unknown as Opportunity), montant: r.montant === null || r.montant === undefined ? null : num(r.montant) });
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const like = (s: string) => `%${s.replace(/[%_,()]/g, " ").trim()}%`;

function ok<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export function supabaseCommercialDb(sb: SupabaseClient): CommercialDb {
  return {
    async prospection() {
      const s = ok(await sb.from("settings").select("prospection").eq("id", 1).maybeSingle());
      return lireProspection(s?.prospection);
    },
    async knownPlaces(ids) {
      if (!ids.length) return [];
      return (ok(await sb.from("leads").select("place_id").in("place_id", ids)) ?? []).map((r: { place_id: string }) => r.place_id);
    },
    async insertLead(row) {
      const r = ok(await sb.from("leads").upsert(row, { onConflict: "place_id", ignoreDuplicates: true }).select("id"));
      return (r ?? []).length > 0;
    },
    async lead(id) {
      const r = ok(await sb.from("leads").select("*").eq("id", id).maybeSingle());
      return r ? nLead(r) : null;
    },
    async findLeads(ref) {
      if (isUuid(ref)) {
        const r = ok(await sb.from("leads").select("*").eq("id", ref));
        if (r?.length) return r.map(nLead);
      }
      return (ok(await sb.from("leads").select("*").ilike("nom", like(ref)).limit(10)) ?? []).map(nLead);
    },
    async searchLeads(o) {
      let q = sb.from("leads").select("*").order("score", { ascending: false }).limit(o.max);
      if (o.statut) q = q.eq("statut", o.statut);
      else q = q.neq("statut", "ecarte");
      if (o.scoreMin) q = q.gte("score", o.scoreMin);
      if (o.recherche) q = q.or(`nom.ilike.${like(o.recherche)},metier.ilike.${like(o.recherche)},ville.ilike.${like(o.recherche)}`);
      return (ok(await q) ?? []).map(nLead);
    },
    async updateLead(id, patch) {
      ok(await sb.from("leads").update(patch).eq("id", id));
    },
    async insertOpportunity(row) {
      return nOpp(ok(await sb.from("opportunities").insert(row).select("*").single()) as Record<string, unknown>);
    },
    async findOpportunities(ref) {
      if (isUuid(ref)) {
        const r = ok(await sb.from("opportunities").select("*").eq("id", ref));
        if (r?.length) return r.map(nOpp);
      }
      return (ok(await sb.from("opportunities").select("*").ilike("titre", like(ref)).limit(10)) ?? []).map(nOpp);
    },
    async updateOpportunity(id, patch) {
      ok(await sb.from("opportunities").update(patch).eq("id", id));
    },
    async quotesEnAttente() {
      return ((ok(await sb.from("quotes").select("*").in("statut", ["emis", "envoye"]).limit(500)) ?? []) as Quote[]).map((q) => ({ ...q, total: num(q.total), lignes: (q.lignes as Ligne[]) ?? [] }));
    },
    async markQuoteRelance(id, niveau, le) {
      const q = ok(await sb.from("quotes").select("relances").eq("id", id).maybeSingle());
      ok(await sb.from("quotes").update({ relances: [...((q?.relances as unknown[]) ?? []), { niveau, le }] }).eq("id", id));
    },
    async pilote() {
      const s = ok(await sb.from("settings").select("pilote_commercial").eq("id", 1).maybeSingle());
      return lirePilote(s?.pilote_commercial);
    },
    async envoisPilote(depuisIso) {
      const r = (ok(await sb.from("approvals").select("cree_le, payload").eq("decide_par", "pilote commercial").gte("cree_le", new Date(Date.now() - 3 * 86400_000).toISOString()).limit(500)) ?? []) as { cree_le: string; payload: { envoyer_apres?: string } }[];
      const dernier = r.map((x) => x.payload.envoyer_apres).filter((x): x is string => !!x).sort().pop() ?? null;
      return { aujourdhui: r.filter((x) => x.cree_le >= depuisIso).length, dernier };
    },
    async leadsAProspecter(scoreMin, max) {
      const r = ((ok(await sb.from("leads").select("*").eq("statut", "nouveau").eq("demo", false).not("email", "is", null).gte("score", scoreMin).order("score", { ascending: false }).limit(max * 3)) ?? []) as Record<string, unknown>[]).map(nLead);
      if (!r.length) return [];
      const stop = new Set(((ok(await sb.from("desinscrits").select("email").in("email", r.map((l) => (l.email ?? "").toLowerCase()))) ?? []) as { email: string }[]).map((x) => x.email));
      return r.filter((l) => !stop.has((l.email ?? "").toLowerCase())).slice(0, max);
    },
    async leadsARelancer(avantIso, max) {
      return ((ok(await sb.from("leads").select("*").eq("statut", "contacte").eq("demo", false).not("email", "is", null).lte("contacte_le", avantIso).is("relance_le", null).limit(max)) ?? []) as Record<string, unknown>[]).map(nLead);
    },
    async leadParEmail(email) {
      const r = ok(await sb.from("leads").select("*").ilike("email", email.trim().replace(/[%_,()]/g, "")).limit(1));
      return r?.[0] ? nLead(r[0] as Record<string, unknown>) : null;
    },
    async estDesinscrit(email) {
      const r = ok(await sb.from("desinscrits").select("email").eq("email", email.trim().toLowerCase()).limit(1));
      return (r ?? []).length > 0;
    },
    async desinscrire(email, source) {
      ok(await sb.from("desinscrits").upsert({ email: email.trim().toLowerCase(), source }, { onConflict: "email", ignoreDuplicates: true }));
    },
    async premierEnvoiProspection(leadId) {
      const r = (ok(await sb.from("approvals").select("objet, execution, execution_statut").eq("payload->>lead_id", leadId).eq("decide_par", "pilote commercial").eq("type_action", "email").in("execution_statut", ["fait", "simule"]).order("cree_le").limit(1)) ?? []) as { objet: string; execution: { threadId?: string } | null }[];
      return r[0] ? { objet: r[0].objet, threadId: r[0].execution?.threadId ?? null } : null;
    },
    async stats() {
      const [l, o] = await Promise.all([sb.from("leads").select("statut").limit(5000), sb.from("opportunities").select("etape, montant, maj_le").limit(5000)]);
      const leads: Record<string, number> = {};
      for (const r of (ok(l) ?? []) as { statut: string }[]) leads[r.statut] = (leads[r.statut] ?? 0) + 1;
      return { leads, pipeline: ((ok(o) ?? []) as { etape: Etape; montant: unknown; maj_le: string }[]).map((r) => ({ etape: r.etape, n: 1, montant: r.montant === null ? 0 : num(r.montant), maj_le: r.maj_le })) };
    },
  };
}
