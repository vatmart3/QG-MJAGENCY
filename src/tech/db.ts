import type { SupabaseClient } from "@supabase/supabase-js";
import type { Audit } from "./audit";

export interface PointHisto {
  le: string;
  ok: boolean;
  ms: number | null;
}

export interface SiteSuivi {
  id: string;
  client_id: string | null;
  nom: string;
  url: string;
  actif: boolean;
  ok: boolean | null;
  dernier_statut: number | null;
  temps_ms: number | null;
  ssl_expire_le: string | null;
  ssl_valide: boolean | null;
  domaine_expire_le: string | null;
  dernier_check: string | null;
  controle_complet_le: string | null;
  echecs: number;
  erreur: string | null;
  alerte: string | null;
  alerte_le: string | null;
  historique: PointHisto[];
  audit: Audit | null;
  audit_le: string | null;
  cree_le: string;
}

export interface TechDb {
  sites(actifs?: boolean): Promise<SiteSuivi[]>;
  findSites(ref: string): Promise<SiteSuivi[]>;
  insertSite(row: { nom: string; url: string; client_id?: string | null }): Promise<SiteSuivi | null>;
  updateSite(id: string, patch: Partial<SiteSuivi>): Promise<void>;
}

/** Normalise une adresse saisie (« monsite.fr » → « https://monsite.fr/ »). */
export function normUrl(u: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(u.trim()) ? u.trim() : `https://${u.trim()}`);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const like = (s: string) => `%${s.replace(/[%_,()]/g, " ").trim()}%`;
function ok<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export function supabaseTechDb(sb: SupabaseClient): TechDb {
  return {
    async sites(actifs) {
      let q = sb.from("sites_monitored").select("*").order("nom");
      if (actifs) q = q.eq("actif", true);
      return (ok(await q) ?? []) as SiteSuivi[];
    },
    async findSites(ref) {
      if (isUuid(ref)) {
        const r = ok(await sb.from("sites_monitored").select("*").eq("id", ref));
        if (r?.length) return r as SiteSuivi[];
      }
      return (ok(await sb.from("sites_monitored").select("*").or(`nom.ilike.${like(ref)},url.ilike.${like(ref)}`).limit(10)) ?? []) as SiteSuivi[];
    },
    async insertSite(row) {
      const r = ok(await sb.from("sites_monitored").upsert(row, { onConflict: "url", ignoreDuplicates: true }).select("*"));
      return ((r ?? [])[0] as SiteSuivi) ?? null;
    },
    async updateSite(id, patch) {
      ok(await sb.from("sites_monitored").update(patch).eq("id", id));
    },
  };
}
