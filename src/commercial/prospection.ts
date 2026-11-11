import type { EngineDb } from "@/engine/db";
import type { Place, Places } from "@/integrations/places";
import type { Lead } from "./db";

/**
 * Prospection SANS IA : Hugo cherche (Google Places), Inès analyse le site et la fiche, note et choisit
 * l'angle d'attaque par des règles simples. Seule la rédaction des messages (Sacha) utilise l'IA, à la demande.
 */

export interface Prospection {
  metiers: string[];
  zones: string[];
  par_jour: number;
}
export const PROSPECTION_DEFAUT: Prospection = {
  metiers: ["restaurant", "boulangerie", "coiffeur", "institut de beauté", "fleuriste", "garage automobile", "artisan du bâtiment", "caviste", "boutique de vêtements", "salle de sport"],
  zones: ["Sète", "Frontignan", "Balaruc-les-Bains", "Mèze", "Marseillan", "Montpellier"],
  par_jour: 10,
};
export const lireProspection = (v: unknown): Prospection => ({ ...PROSPECTION_DEFAUT, ...((v && typeof v === "object" ? v : {}) as Partial<Prospection>) });

export interface SiteInfo {
  ok: boolean;
  https: boolean;
  mobile: boolean;
  generateur?: string;
  titre?: string;
  email?: string;
  instagram?: string;
  lent?: boolean;
}

const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1|\[?fc|\[?fd)/i;

/** Adresse publique http(s) uniquement (pas de réseau interne). */
export function urlPublique(u: string): URL | null {
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol) || PRIVATE.test(url.hostname) || url.hostname.endsWith(".local") || url.hostname.endsWith(".internal")) return null;
    return url;
  } catch {
    return null;
  }
}

/** Récupère une page publique (6 s, 600 Ko max). */
export async function fetchPage(u: string): Promise<{ html: string; url: string; ms: number } | null> {
  const url = urlPublique(u);
  if (!url || url.hostname.endsWith(".example")) return null;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Mozilla/5.0 (compatible; LEPORT/1.0)", Accept: "text/html" } });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    let html = "";
    const dec = new TextDecoder();
    while (html.length < 600_000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += dec.decode(value, { stream: true });
    }
    void reader.cancel().catch(() => undefined);
    return { html, url: res.url || url.toString(), ms: Date.now() - t0 };
  } catch {
    return null;
  }
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const IGNORE_EMAIL = /(\.png|\.jpg|\.jpeg|\.gif|\.webp|\.svg|sentry|wixpress|example\.com|domain\.com|email\.com|votre|your)/i;

export async function scanSite(site: string): Promise<SiteInfo> {
  const page = await fetchPage(site);
  if (!page) return { ok: false, https: site.startsWith("https"), mobile: false };
  const h = page.html;
  const mailto = [...h.matchAll(/mailto:([^"'?>\s]+)/gi)].map((m) => decodeURIComponent(m[1]!));
  const emails = [...mailto, ...(h.match(EMAIL_RE) ?? [])].map((e) => e.toLowerCase()).filter((e) => !IGNORE_EMAIL.test(e));
  const insta = h.match(/instagram\.com\/([a-z0-9._]{2,30})/i)?.[1];
  const gen = h.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i)?.[1] ?? (/wix\.com|wixstatic/i.test(h) ? "Wix" : /squarespace/i.test(h) ? "Squarespace" : /jimdo/i.test(h) ? "Jimdo" : undefined);
  return {
    ok: true,
    https: page.url.startsWith("https"),
    mobile: /<meta[^>]+name=["']viewport["']/i.test(h),
    generateur: gen?.slice(0, 40),
    titre: h.match(/<title[^>]*>([^<]{1,120})/i)?.[1]?.trim(),
    email: emails[0],
    instagram: insta && !["p", "explore", "accounts", "reel", "stories"].includes(insta.toLowerCase()) ? insta : undefined,
    lent: page.ms > 3500,
  };
}

/** Note de 0 à 100 et angle d'attaque, à partir de la fiche Google et du site (règles d'Inès). */
export function noter(p: Place, s: SiteInfo | null): { score: number; angle: string; diagnostic: string } {
  let score = 20;
  const notes: string[] = [];
  // OpenStreetMap ne donne pas les avis : inconnu n'est pas « peu d'avis »
  const avisConnus = p.nb_avis !== undefined && p.nb_avis !== null;
  const avis = p.nb_avis ?? 0;
  const note = p.note ?? 0;
  if (!p.site) {
    score += 35;
    notes.push("pas de site web");
  } else if (s && !s.ok) {
    score += 25;
    notes.push("site injoignable");
  } else if (s) {
    if (!s.mobile) {
      score += 20;
      notes.push("site pas adapté au mobile");
    }
    if (!s.https) {
      score += 10;
      notes.push("site non sécurisé (http)");
    }
    if (s.lent) {
      score += 5;
      notes.push("site lent");
    }
    if (s.generateur) notes.push(`site ${s.generateur}`);
  }
  if (avisConnus && avis < 30) {
    score += 15;
    notes.push(`peu d'avis Google (${avis})`);
  } else if (avis >= 100) {
    score += 5;
    notes.push(`clientèle établie (${avis} avis)`);
  }
  if (note >= 4.5) {
    score += 10;
    notes.push(`très bien noté (${note.toFixed(1)}★)`);
  } else if (note && note < 4) notes.push(`note à améliorer (${note.toFixed(1)}★)`);
  if (p.telephone) score += 3;
  if (s?.email || p.email) score += 7;
  const angle = !p.site
    ? "Site vitrine + fiche Google optimisée (SEO local)"
    : s && (!s.ok || !s.mobile || !s.https)
      ? "Refonte du site (mobile, rapide, sécurisé) + SEO local"
      : !avisConnus || avis < 30
        ? "Cartes NFC avis Google pour multiplier les avis"
        : /restaurant|bar|café|traiteur/i.test(p.metier ?? "")
          ? "Menu digital + avis Google + réservation en ligne"
          : "Fidélité digitale sans appli + réseaux sociaux";
  return { score: Math.max(0, Math.min(100, score)), angle, diagnostic: notes.join(" · ") || "Fiche correcte, à creuser" };
}

/**
 * Hugo + Inès : trouve jusqu'à `max` nouveaux commerces (métiers × zones, en tournant d'un jour à l'autre),
 * analyse les sites, note et enregistre. Sans IA. Retourne le nombre de prospects créés.
 */
export async function trouverProspects(db: EngineDb, places: Places, cfg: Prospection, max = cfg.par_jour, budgetMs = 40_000): Promise<{ crees: number; demo: boolean; erreurs: string[]; recherches: number }> {
  if (!cfg.metiers.length || !cfg.zones.length) return { crees: 0, demo: places.kind === "demo", erreurs: [], recherches: 0 };
  const debut = Date.now();
  const erreurs: string[] = [];
  let recherches = 0;
  const combos = cfg.metiers.flatMap((m) => cfg.zones.map((z) => `${m} à ${z}`));
  const curseur = Number((await db.kvGet<{ i: number }>("prospection.curseur"))?.i ?? 0);
  let crees = 0;
  let i = curseur;
  const vus = new Set<string>();
  // le temps est compté (la page s'arrête à 60 s) : on garde ce qui est trouvé au fur et à mesure
  for (let essais = 0; essais < Math.min(combos.length, 6) && crees < max && Date.now() - debut < budgetMs; essais++, i++) {
    const requete = combos[i % combos.length]!;
    let trouves: Place[];
    try {
      trouves = await places.search(requete, 20);
      recherches++;
    } catch (e) {
      erreurs.push(`${requete} : ${e instanceof Error ? e.message : String(e)}`);
      await db.kvSet("prospection.curseur", { i: i + 1 });
      continue;
    }
    const res = trouves.filter((p) => !p.ferme && !vus.has(p.place_id));
    res.forEach((p) => vus.add(p.place_id));
    const connus = new Set(await db.commercial.knownPlaces(res.map((p) => p.place_id)));
    const nouveaux = res.filter((p) => !connus.has(p.place_id)).slice(0, max - crees);
    const infos = await Promise.all(nouveaux.map((p) => (p.site ? scanSite(p.site) : Promise.resolve(null))));
    for (const [k, p] of nouveaux.entries()) {
      const s = infos[k] ?? null;
      const n = noter(p, s);
      const ok = await db.commercial.insertLead({
        place_id: p.place_id,
        nom: p.nom,
        metier: p.metier ?? requete.split(" à ")[0]!,
        ville: p.ville ?? requete.split(" à ")[1] ?? null,
        adresse: p.adresse,
        telephone: p.telephone ?? null,
        site: p.site ?? null,
        email: p.email ?? s?.email ?? null,
        instagram: p.instagram ?? s?.instagram ?? null,
        note_google: p.note ?? null,
        nb_avis: p.nb_avis ?? null,
        maps_url: p.maps_url ?? null,
        score: n.score,
        angle: n.angle,
        diagnostic: n.diagnostic,
        source: p.demo ? "demo" : "places",
        demo: !!p.demo,
      });
      if (ok) crees++;
    }
      await db.kvSet("prospection.curseur", { i: i + 1 });
  }
  // commerces sans e-mail : une recherche de plus pour tout le lot (e-mail public, Instagram, site)
  if (places.enrichir && crees && Date.now() - debut < budgetMs - 15_000) {
    await enrichirLeads(db, places).catch((e) => erreurs.push(`coordonnées : ${e instanceof Error ? e.message : String(e)}`));
  }
  if (crees) {
    await db.insertMessage({ from_agent: "hugo", to_agent: "ines", type: "delegation", contenu: `${crees} nouveaux commerces à noter`, resume_bulle: `Inès, ${crees} nouveaux prospects pour toi !` });
    await db.insertJournal({
      type: "action",
      titre: `🔎 Hugo a trouvé ${crees} prospect${crees > 1 ? "s" : ""}${places.kind === "demo" ? " (DÉMO)" : ""}, Inès les a notés`,
      contenu: "À voir dans Commercial → Prospects. Choisis ceux à contacter : Sacha écrira le mail et le DM Instagram.",
      agent_id: "hugo",
      pole_id: "prospection",
    });
  }
  if (!crees && erreurs.length && !recherches) await db.insertJournal({ type: "alerte", titre: "⚠️ Hugo n'a pas pu chercher de prospects", contenu: erreurs.slice(0, 3).join("\n"), agent_id: "hugo", pole_id: "prospection" });
  return { crees, demo: places.kind === "demo", erreurs, recherches };
}

/** Margaux : relance des devis envoyés sans réponse (J+7 puis J+15), sans IA, en Douane avec le PDF. */
export async function relancesDevis(db: EngineDb, today: string): Promise<number> {
  let n = 0;
  for (const q of await db.commercial.quotesEnAttente()) {
    if (!q.emis_le || !q.numero) continue;
    const jours = Math.floor((Date.parse(today) - Date.parse(q.emis_le)) / 86400_000);
    if (q.valable_jusqu && q.valable_jusqu < today) {
      await db.finance.updateQuote(q.id, { statut: "expire" });
      continue;
    }
    const niveau = jours >= 15 ? 2 : jours >= 7 ? 1 : 0;
    const deja = Math.max(0, ...((q as unknown as { relances?: { niveau: number }[] }).relances ?? []).map((r) => r.niveau));
    if (niveau <= deja) continue;
    const email = q.client_snapshot?.email ?? null;
    await db.commercial.markQuoteRelance(q.id, niveau, today);
    await db.insertApproval({
      agent_id: "margaux",
      task_id: null,
      type_action: "relance",
      titre: `Relance devis ${q.numero} : ${q.client_snapshot?.nom ?? "client"}`.slice(0, 200),
      destinataire: email,
      objet: `Notre proposition ${q.numero} — ${q.objet}`.slice(0, 200),
      apercu:
        niveau === 1
          ? `Bonjour,\n\nJe me permets de revenir vers vous au sujet de notre proposition ${q.numero} (${q.objet}).\nAvez-vous eu le temps d'y jeter un œil ? Nous serions ravis d'en discuter ou de l'ajuster à vos besoins.\n\nBelle journée,`
          : `Bonjour,\n\nNous n'avons pas eu de retour sur notre proposition ${q.numero} (${q.objet}), valable jusqu'au ${q.valable_jusqu?.split("-").reverse().join("/") ?? "—"}.\nSi le projet est toujours d'actualité, un court appel suffirait pour caler les derniers détails.\n\nBien cordialement,`,
      payload: { kind: "document", doc: "devis", id: q.id, a: email, relance: niveau },
      execution_statut: "a_faire",
    });
    n++;
  }
  if (n) await db.insertJournal({ type: "action", titre: `📮 Margaux a préparé ${n} relance${n > 1 ? "s" : ""} de devis : à valider en Douane`, agent_id: "margaux", pole_id: "commercial" });
  return n;
}

/** Complète les prospects récents sans e-mail (une recherche web pour 8 commerces), puis renote ceux qui changent. */
export async function enrichirLeads(db: EngineDb, places: Places): Promise<number> {
  if (!places.enrichir) return 0;
  const sans = (await db.commercial.searchLeads({ statut: "nouveau", max: 40 })).filter((l) => !l.demo && !l.email && !(l.notes ?? "").includes("[coordonnées cherchées]")).slice(0, 8);
  if (!sans.length) return 0;
  const trouves = await places.enrichir(sans.map((l) => ({ nom: l.nom, ville: l.ville, telephone: l.telephone })));
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  let n = 0;
  for (const l of sans) {
    const t = trouves.find((x) => norm(x.nom) === norm(l.nom) || norm(l.nom).includes(norm(x.nom)) || norm(x.nom).includes(norm(l.nom)));
    const patch: Partial<Lead> = { notes: `${l.notes ?? ""} [coordonnées cherchées]`.trim() };
    if (t?.email) patch.email = t.email;
    if (t?.instagram && !l.instagram) patch.instagram = t.instagram;
    if (t?.site && !l.site) {
      patch.site = t.site;
      const s = await scanSite(t.site);
      const nn = noter({ place_id: l.place_id ?? "", nom: l.nom, adresse: l.adresse ?? "", site: t.site, telephone: l.telephone ?? undefined, metier: l.metier ?? undefined, email: patch.email ?? s.email }, s);
      Object.assign(patch, { score: nn.score, angle: nn.angle, diagnostic: nn.diagnostic, email: patch.email ?? s.email ?? undefined, instagram: patch.instagram ?? s.instagram ?? undefined });
    } else if (patch.email) {
      patch.score = Math.min(100, l.score + 7);
    }
    if (patch.email || patch.instagram || patch.site) n++;
    await db.commercial.updateLead(l.id, patch);
  }
  if (n) await db.insertJournal({ type: "action", titre: `📇 Inès a retrouvé les coordonnées de ${n} commerce${n > 1 ? "s" : ""}`, agent_id: "ines", pole_id: "prospection" });
  return n;
}
