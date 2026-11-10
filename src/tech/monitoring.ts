import tls from "node:tls";
import { urlPublique } from "@/commercial/prospection";

/**
 * Santé d'un site client, sans IA : réponse HTTP et temps de réponse, certificat SSL (date d'expiration,
 * validité), expiration du nom de domaine (RDAP, registre public). Les domaines .example sont des sites
 * de DÉMONSTRATION : résultat simulé, jamais de requête.
 */

export interface Sante {
  ok: boolean;
  statut: number | null;
  ms: number | null;
  https: boolean;
  erreur: string | null;
  /** contrôle complet seulement (SSL + domaine, une fois par jour) */
  ssl_expire_le?: string | null;
  ssl_valide?: boolean | null;
  domaine_expire_le?: string | null;
}

export const SEUILS = { lentMs: 3000, sslJours: 14, domaineJours: 30 };

const JOUR = 86400_000;

function demo(url: URL, complet: boolean, now: Date): Sante {
  const h = [...url.hostname].reduce((s, c) => s + c.charCodeAt(0), 0);
  const panne = url.hostname.startsWith("panne");
  return {
    ok: !panne,
    statut: panne ? 503 : 200,
    ms: 180 + (h % 9) * 140,
    https: url.protocol === "https:",
    erreur: panne ? "Service indisponible (site de démonstration)" : null,
    ...(complet ? { ssl_expire_le: new Date(now.getTime() + (url.hostname.startsWith("ssl") ? 6 : 40 + (h % 50)) * JOUR).toISOString(), ssl_valide: true, domaine_expire_le: new Date(now.getTime() + (200 + (h % 150)) * JOUR).toISOString().slice(0, 10) } : {}),
  };
}

/** Réponse HTTP (suit les redirections, 10 s max) ; le corps n'est pas téléchargé. */
async function http(url: URL): Promise<Pick<Sante, "ok" | "statut" | "ms" | "erreur"> & { finale: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Mozilla/5.0 (compatible; LEPORT-Monitoring/1.0)", Accept: "text/html,*/*" } });
    const ms = Date.now() - t0;
    void res.body?.cancel().catch(() => undefined);
    return { ok: res.status < 400, statut: res.status, ms, erreur: res.status < 400 ? null : `Erreur HTTP ${res.status}`, finale: res.url || url.toString() };
  } catch (e) {
    const c = (e as { cause?: { code?: unknown } }).cause?.code;
    const cause = c === undefined || c === null ? "" : String(c);
    const msg = (e as Error).name === "TimeoutError" ? "Pas de réponse en 10 s" : cause === "ENOTFOUND" ? "Nom de domaine introuvable (DNS)" : cause === "ECONNREFUSED" ? "Connexion refusée" : cause.startsWith("CERT") || cause.includes("SSL") ? "Certificat SSL refusé par le navigateur" : `Injoignable${cause ? ` (${cause})` : ""}`;
    return { ok: false, statut: null, ms: null, erreur: msg, finale: url.toString() };
  }
}

/** Certificat présenté par le serveur (port 443) : date d'expiration et validité. */
export function certificat(host: string): Promise<{ expire: string; valide: boolean } | null> {
  return new Promise((resolve) => {
    let fini = false;
    const done = (v: { expire: string; valide: boolean } | null) => {
      if (fini) return;
      fini = true;
      resolve(v);
      sock.destroy();
    };
    const sock = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 6000 }, () => {
      const c = sock.getPeerCertificate();
      done(c?.valid_to ? { expire: new Date(c.valid_to).toISOString(), valide: sock.authorized } : null);
    });
    sock.on("error", () => done(null));
    sock.on("timeout", () => done(null));
  });
}

const DEUX_NIVEAUX = /\.(co|com|org|net|gouv|asso|nom)\.[a-z]{2}$/;
export function domaineRacine(host: string): string {
  const p = host.replace(/^www\./, "").split(".");
  return p.slice(DEUX_NIVEAUX.test(host) ? -3 : -2).join(".");
}

/** Date d'expiration du domaine via RDAP (annuaire public des registres : AFNIC pour .fr, Verisign pour .com…). */
export async function expirationDomaine(host: string): Promise<string | null> {
  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domaineRacine(host))}`, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/rdap+json" } });
    if (!res.ok) return null;
    const j = (await res.json()) as { events?: { eventAction?: string; eventDate?: string }[] };
    const d = j.events?.find((e) => e.eventAction === "expiration")?.eventDate;
    return d ? d.slice(0, 10) : null;
  } catch {
    return null;
  }
}

/** Contrôle d'un site. `complet` ajoute SSL et domaine (plus lent : une fois par jour suffit). */
export async function checkSite(u: string, complet: boolean, now = new Date()): Promise<Sante> {
  const url = urlPublique(u);
  if (!url) return { ok: false, statut: null, ms: null, https: false, erreur: "Adresse invalide ou non publique" };
  if (url.hostname.endsWith(".example")) return demo(url, complet, now);
  const [h, cert, dom] = await Promise.all([http(url), complet && url.protocol === "https:" ? certificat(url.hostname) : null, complet ? expirationDomaine(url.hostname) : null]);
  return {
    ok: h.ok,
    statut: h.statut,
    ms: h.ms,
    https: h.finale.startsWith("https:"),
    erreur: h.erreur,
    ...(complet ? { ssl_expire_le: cert?.expire ?? null, ssl_valide: url.protocol === "https:" ? (cert?.valide ?? null) : null, domaine_expire_le: dom } : {}),
  };
}

const jours = (d: string | null | undefined, now: Date) => (d ? Math.floor((new Date(d).getTime() - now.getTime()) / JOUR) : null);

/** Problèmes à signaler (vide = tout va bien). `echecs` : contrôles ratés d'affilée (une panne n'est signalée qu'au 2e). */
export function problemes(s: { ok: boolean | null; erreur: string | null; temps_ms: number | null; https?: boolean; ssl_expire_le: string | null; ssl_valide: boolean | null; domaine_expire_le: string | null; echecs: number }, now: Date): string[] {
  const p: string[] = [];
  if (s.ok === false && s.echecs >= 2) p.push(s.erreur ?? "Site injoignable");
  if (s.ok && s.temps_ms && s.temps_ms > SEUILS.lentMs) p.push(`Lent : ${(s.temps_ms / 1000).toFixed(1).replace(".", ",")} s`);
  if (s.ssl_valide === false) p.push("Certificat SSL invalide");
  const js = jours(s.ssl_expire_le, now);
  if (js !== null && js < SEUILS.sslJours) p.push(js < 0 ? "Certificat SSL expiré" : `Certificat SSL : expire dans ${js} j`);
  const jd = jours(s.domaine_expire_le, now);
  if (jd !== null && jd < SEUILS.domaineJours) p.push(jd < 0 ? "Nom de domaine expiré" : `Nom de domaine : expire dans ${jd} j`);
  return p;
}

export function resumeSante(s: Sante, now: Date): string {
  const l = [s.ok ? `✅ Répond (HTTP ${s.statut}) en ${s.ms} ms` : `❌ ${s.erreur ?? "Ne répond pas"}`, s.https ? "HTTPS ✓" : "⚠️ pas de HTTPS"];
  if (s.ssl_expire_le !== undefined) l.push(s.ssl_expire_le ? `certificat SSL valable jusqu'au ${s.ssl_expire_le.slice(0, 10)} (${jours(s.ssl_expire_le, now)} j)${s.ssl_valide === false ? " — INVALIDE" : ""}` : "certificat SSL : non lu");
  if (s.domaine_expire_le !== undefined) l.push(s.domaine_expire_le ? `domaine valable jusqu'au ${s.domaine_expire_le} (${jours(s.domaine_expire_le, now)} j)` : "expiration du domaine : non publiée par le registre");
  return l.join(" · ");
}
