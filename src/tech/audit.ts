import { urlPublique } from "@/commercial/prospection";

/**
 * Audit d'une page (Oscar), sans IA : référencement de base, mobile, sécurité, performance, partage
 * sur les réseaux. Chaque point donne un conseil concret ; la note sur 100 retire des points par défaut.
 */

export interface PointAudit {
  ok: boolean;
  categorie: "SEO" | "Mobile" | "Sécurité" | "Performance" | "Réseaux" | "Accessibilité";
  label: string;
  conseil?: string;
  poids: number;
}

export interface Audit {
  url: string;
  note: number;
  le: string;
  ms: number | null;
  poids_ko: number | null;
  titre: string | null;
  points: PointAudit[];
  demo?: boolean;
  erreur?: string;
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
function meta(h: string, key: string): string | undefined {
  for (const m of h.matchAll(/<meta\b[^>]*>/gi)) {
    const t = m[0];
    if ((attr(t, "name") ?? attr(t, "property"))?.toLowerCase() === key) return attr(t, "content");
  }
  return undefined;
}
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

async function existe(base: URL, chemin: string): Promise<boolean> {
  try {
    const r = await fetch(new URL(chemin, base), { redirect: "follow", signal: AbortSignal.timeout(5000), headers: { "User-Agent": "Mozilla/5.0 (compatible; LEPORT-Audit/1.0)" } });
    void r.body?.cancel().catch(() => undefined);
    return r.ok;
  } catch {
    return false;
  }
}

const DEMO_HTML = `<!doctype html><html><head><title>Boulangerie du Port — Sète</title><meta name="viewport" content="width=device-width"><meta name="description" content="Pains et viennoiseries."></head><body><h1>Bienvenue</h1><h1>Nos pains</h1><img src="a.jpg"><img src="b.jpg" alt="Pain"></body></html>`;

/** Analyse le HTML d'une page déjà récupérée (exporté pour les tests). */
export function analyser(html: string, o: { url: string; https: boolean; ms: number | null; robots: boolean; sitemap: boolean }): Omit<Audit, "le"> {
  const head = html.slice(0, 200_000);
  const titre = head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  const t = titre ? decode(titre) : "";
  const desc = decode(meta(head, "description") ?? "");
  const h1 = (html.match(/<h1\b/gi) ?? []).length;
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const sansAlt = imgs.filter((i) => attr(i, "alt") === undefined).length;
  const robotsMeta = (meta(head, "robots") ?? "").toLowerCase();
  const poids = Math.round(Buffer.byteLength(html) / 1024);
  const scripts = (html.match(/<script\b[^>]*src=/gi) ?? []).length;
  const P = (ok: boolean, categorie: PointAudit["categorie"], label: string, conseil: string, poids: number): PointAudit => ({ ok, categorie, label, conseil: ok ? undefined : conseil, poids });
  const points: PointAudit[] = [
    P(o.https, "Sécurité", "Site en HTTPS", "Activer le HTTPS (certificat gratuit Let's Encrypt) : Google et les navigateurs pénalisent les sites « non sécurisés ».", 15),
    P(!!t && t.length >= 10 && t.length <= 65, "SEO", t ? `Titre de page (${t.length} caractères)` : "Titre de page", t ? "Viser 30 à 60 caractères avec le métier et la ville (ex. « Boulangerie artisanale à Sète — Maison X »)." : "Ajouter une balise <title> avec le métier et la ville.", 10),
    P(desc.length >= 50 && desc.length <= 170, "SEO", desc ? `Description (${desc.length} caractères)` : "Méta-description", desc ? "Viser 120 à 160 caractères : c'est le texte affiché sous le lien dans Google." : "Ajouter une méta-description de 120 à 160 caractères qui donne envie de cliquer.", 8),
    P(h1 === 1, "SEO", `Titre principal H1 (${h1})`, h1 === 0 ? "Ajouter un titre H1 unique qui dit ce que fait le commerce et où." : "Garder un seul H1 par page (les autres en H2).", 6),
    P(!robotsMeta.includes("noindex"), "SEO", "Page indexable par Google", "La page demande à Google de ne pas l'indexer (noindex) : à retirer si elle doit être trouvée.", 15),
    P(/<link\b[^>]*rel=["']canonical["']/i.test(head), "SEO", "Adresse canonique", "Ajouter <link rel=\"canonical\"> pour éviter le contenu en double.", 3),
    P(/<html\b[^>]*\blang=/i.test(head), "Accessibilité", "Langue déclarée", "Ajouter lang=\"fr\" sur la balise <html>.", 2),
    P(/application\/ld\+json/i.test(html), "SEO", "Données structurées (fiche entreprise)", "Ajouter un bloc LocalBusiness (horaires, adresse, téléphone) : aide à apparaître dans Google Maps et les résultats locaux.", 5),
    P(o.robots, "SEO", "Fichier robots.txt", "Ajouter un robots.txt qui indique le sitemap.", 2),
    P(o.sitemap, "SEO", "Plan du site (sitemap.xml)", "Générer un sitemap.xml et le déclarer dans la Search Console.", 4),
    P(/<meta\b[^>]*name=["']viewport["']/i.test(head), "Mobile", "Adapté au mobile (viewport)", "Ajouter la balise viewport : sans elle, le site est illisible sur téléphone.", 12),
    P(sansAlt === 0, "Accessibilité", imgs.length ? `Textes alternatifs des images (${imgs.length - sansAlt}/${imgs.length})` : "Images", `${sansAlt} image(s) sans texte alternatif (alt) : à décrire, c'est utile pour Google Images et l'accessibilité.`, 4),
    P(o.ms !== null && o.ms <= 2500, "Performance", o.ms !== null ? `Temps de réponse (${(o.ms / 1000).toFixed(1).replace(".", ",")} s)` : "Temps de réponse", "Le serveur répond lentement : hébergement, cache ou images trop lourdes à revoir.", 8),
    P(poids <= 500, "Performance", `Poids du HTML (${poids} Ko)`, "Page très lourde : alléger le code, éviter le contenu dupliqué dans la page.", 3),
    P(scripts <= 25, "Performance", `Scripts externes (${scripts})`, "Beaucoup de scripts : retirer les extensions et traqueurs inutiles.", 3),
    P(!!meta(head, "og:title") && !!meta(head, "og:image"), "Réseaux", "Aperçu lors du partage (Open Graph)", "Ajouter og:title et og:image : le lien partagé sur Facebook, WhatsApp ou Instagram aura une belle vignette.", 4),
    P(/<link\b[^>]*rel=["'][^"']*icon/i.test(head), "Réseaux", "Icône du site (favicon)", "Ajouter une favicon (le logo dans l'onglet et les favoris).", 2),
  ];
  const total = points.reduce((s, p) => s + p.poids, 0);
  const perdu = points.filter((p) => !p.ok).reduce((s, p) => s + p.poids, 0);
  return { url: o.url, note: Math.round(100 * (1 - perdu / total)), ms: o.ms, poids_ko: poids, titre: t || null, points };
}

export async function auditUrl(u: string, now = new Date()): Promise<Audit> {
  const url = urlPublique(u.includes("://") ? u : `https://${u}`);
  const le = now.toISOString();
  if (!url) return { url: u, note: 0, le, ms: null, poids_ko: null, titre: null, points: [], erreur: "Adresse invalide ou non publique" };
  if (url.hostname.endsWith(".example")) return { ...analyser(DEMO_HTML, { url: url.toString(), https: url.protocol === "https:", ms: 640, robots: false, sitemap: false }), le, demo: true };
  const t0 = Date.now();
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Mozilla/5.0 (compatible; LEPORT-Audit/1.0)", Accept: "text/html" } });
    const ms = Date.now() - t0;
    if (!res.ok) return { url: url.toString(), note: 0, le, ms, poids_ko: null, titre: null, points: [], erreur: `La page répond HTTP ${res.status}` };
    const reader = res.body?.getReader();
    let html = "";
    if (reader) {
      const dec = new TextDecoder();
      while (html.length < 1_500_000) {
        const { done, value } = await reader.read();
        if (done) break;
        html += dec.decode(value, { stream: true });
      }
      void reader.cancel().catch(() => undefined);
    }
    const finale = new URL(res.url || url.toString());
    const [robots, sitemap] = await Promise.all([existe(finale, "/robots.txt"), existe(finale, "/sitemap.xml")]);
    return { ...analyser(html, { url: finale.toString(), https: finale.protocol === "https:", ms, robots, sitemap }), le };
  } catch (e) {
    return { url: url.toString(), note: 0, le, ms: null, poids_ko: null, titre: null, points: [], erreur: (e as Error).name === "TimeoutError" ? "Pas de réponse en 10 s" : "Page injoignable" };
  }
}

export function auditTexte(a: Audit): string {
  if (a.erreur) return `Audit impossible pour ${a.url} : ${a.erreur}.`;
  const ko = a.points.filter((p) => !p.ok).sort((x, y) => y.poids - x.poids);
  return [
    `Audit de ${a.url}${a.demo ? " (DÉMO)" : ""} : ${a.note}/100${a.titre ? ` — « ${a.titre} »` : ""}.`,
    ko.length ? `À corriger (du plus important au moins important) :\n${ko.map((p) => `- [${p.categorie}] ${p.label} : ${p.conseil}`).join("\n")}` : "Rien à corriger sur les points contrôlés. 👏",
    `Déjà bien : ${a.points.filter((p) => p.ok).map((p) => p.label).join(", ") || "—"}.`,
  ].join("\n");
}
