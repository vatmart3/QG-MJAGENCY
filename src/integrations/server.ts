import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt, hasEncryptionKey } from "@/lib/crypto";
import { demoCalendar, demoMailbox } from "./demo";
import { boutiqueDepuisEnv } from "@/boutique/shopify";
import { envoyerPush } from "@/lib/push";
import { envoyerTelegram, tgConfigure } from "./telegram";
import { envoyerWhatsApp, waConfigure } from "./whatsapp";
import { costEur, COUT_RECHERCHE_EUR } from "@/engine/config";
import { llmFromEnv } from "@/engine/llm";
import { googlePlaces, osmPlaces, webPlaces } from "./places";
import { GoogleAuthError, GoogleClient, gmailMailbox, googleCalendar, hasGoogleOAuth } from "./google";
import type { Calendar, Documents, Mailbox, Services } from "./types";

export interface IntegrationRow {
  id: string;
  type: "google";
  compte: string;
  tokens_chiffres: string;
  scopes: string[];
  statut: "connecte" | "erreur";
  erreur: string | null;
  connecte_par: string | null;
  maj_le: string;
}

export const AGENCY = (process.env.AGENCY_MAILBOX ?? "mjagency.officiel@gmail.com").toLowerCase();

export async function googleIntegration(admin: SupabaseClient): Promise<IntegrationRow | null> {
  const { data } = await admin.from("integrations").select("*").eq("type", "google").order("maj_le", { ascending: false });
  const list = (data ?? []) as IntegrationRow[];
  return list.find((r) => r.compte === AGENCY) ?? list[0] ?? null;
}

export async function saveGoogleIntegration(admin: SupabaseClient, row: { compte: string; refreshToken: string; scopes: string[]; par: string }): Promise<void> {
  const tokens_chiffres = encrypt(JSON.stringify({ refresh_token: row.refreshToken }));
  // une seule boîte active pour l'instant (l'architecture permet d'en ajouter plus tard)
  await admin.from("integrations").delete().eq("type", "google").neq("compte", row.compte);
  const { error } = await admin
    .from("integrations")
    .upsert({ type: "google", compte: row.compte, tokens_chiffres, scopes: row.scopes, statut: "connecte", erreur: null, connecte_par: row.par, maj_le: new Date().toISOString() }, { onConflict: "type,compte" });
  if (error) throw new Error(error.message);
}

export function refreshTokenOf(row: IntegrationRow): string {
  return (JSON.parse(decrypt(row.tokens_chiffres)) as { refresh_token: string }).refresh_token;
}

/**
 * Services du moteur : Gmail + Agenda si Google est connecté (et la clé de chiffrement présente),
 * sinon boîte et agenda de DÉMO. Une erreur d'accès Google est notée sur l'intégration.
 */
export async function engineServices(admin: SupabaseClient): Promise<Services> {
  let client: GoogleClient | null | undefined;
  const getClient = async (): Promise<GoogleClient | null> => {
    if (client !== undefined) return client;
    client = null;
    if (!hasGoogleOAuth() || !hasEncryptionKey()) return null;
    const row = await googleIntegration(admin);
    if (!row || row.statut !== "connecte") return null;
    try {
      client = new GoogleClient(row.compte, refreshTokenOf(row));
    } catch (e) {
      await admin.from("integrations").update({ statut: "erreur", erreur: e instanceof Error ? e.message : String(e) }).eq("id", row.id);
    }
    return client;
  };
  const guard = <T extends object>(obj: T, rowCompte: () => Promise<void>): T =>
    new Proxy(obj, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (typeof v !== "function") return v;
        return async (...args: unknown[]) => {
          try {
            return await (v as (...a: unknown[]) => unknown).apply(target, args);
          } catch (e) {
            if (e instanceof GoogleAuthError) await rowCompte();
            throw e;
          }
        };
      },
    });
  const markError = async () => {
    const row = await googleIntegration(admin);
    if (row) await admin.from("integrations").update({ statut: "erreur", erreur: "Accès Google retiré ou expiré : reconnecte Google dans Réglages." }).eq("id", row.id);
  };
  return {
    documents: storageDocuments(admin),
    // Google Places si une clé est configurée (avec les avis) ; sinon Hugo cherche sur Internet (recherche web de
    // Claude, ≈ 1 centime) ; OpenStreetMap en dernier recours (ses serveurs refusent souvent les hébergeurs cloud)
    places: async () => {
      const llm = llmFromEnv();
      const web =
        llm.kind === "anthropic"
          ? webPlaces(async (q, o) => {
              const r = await llm.search(q, o);
              const cout = costEur(r.model, r.usage) + r.recherches * COUT_RECHERCHE_EUR;
              await admin.from("usage").insert({ agent_id: "hugo", modele: `${r.model} + recherche web`, tokens_in: r.usage.input + r.usage.cacheRead + r.usage.cacheWrite, tokens_out: r.usage.output, cout_estime: Math.round(cout * 100_000) / 100_000 });
              return r;
            })
          : null;
      // Google Maps pour trouver (avec notes et avis) ; la recherche web retrouve les e-mails manquants
      if (process.env.GOOGLE_PLACES_API_KEY) return { ...googlePlaces(process.env.GOOGLE_PLACES_API_KEY), ...(web?.enrichir ? { enrichir: web.enrichir } : {}) };
      return web ?? osmPlaces();
    },
    boutique: async () => boutiqueDepuisEnv(),
    notifier: (n) => envoyerPush(admin, n),
    ...(waConfigure() ? { whatsapp: (a: string, t: string) => envoyerWhatsApp(a, t) } : {}),
    ...(tgConfigure() ? { telegram: (c: string, t: string, s: boolean) => envoyerTelegram(c, t, s) } : {}),
    async mailbox(): Promise<Mailbox> {
      const c = await getClient();
      return c ? guard(gmailMailbox(c), markError) : demoMailbox();
    },
    async calendar(): Promise<Calendar> {
      const c = await getClient();
      return c ? guard(googleCalendar(c), markError) : demoCalendar();
    },
  };
}

/** Coffre privé des PDF : Supabase Storage, bucket « factures » (jamais d'écrasement). */
export function storageDocuments(admin: SupabaseClient): Documents {
  return {
    async ecrire(path, bytes) {
      const { error } = await admin.storage.from("factures").upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (error) throw new Error(`Archivage du PDF impossible : ${error.message}`);
    },
    async lire(path) {
      const { data, error } = await admin.storage.from("factures").download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}
