import { urlPublique } from "@/commercial/prospection";

/**
 * Navigateur des agents (sans IA, gratuit) : ouvre un site, lit la page et suit quelques liens internes utiles
 * (contact, tarifs, services, à propos, menu…). Rend un résumé structuré : titre, description, titres de sections,
 * texte principal, coordonnées, réseaux sociaux, technologie, liens. Les sites .example sont des sites de DÉMO.
 */

export interface PageLue {
  url: string;
  statut: number | null;
  ms: number | null;
  titre: string | null;
  description: string | null;
  titres: string[];
  texte: string;
  emails: string[];
  telephones: string[];
  reseaux: string[];
  technologie: string | null;
  liensInternes: string[];
  liensExternes: string[];
  images: number;
  formulaires: number;
  jsSeulement: boolean;
  erreur?: string;
}

const UA = "Mozilla/5.0 (compatible; LEPORT-Navigateur/1.0; +https://qg-mjagency.vercel.app)";
const PRIORITE = /contact|tarif|prix|price|service|prestation|a-propos|about|qui-sommes|equipe|menu|carte|produit|boutique|shop|realisation|portfolio|offre|horaire|reservation|devis/i;
const RESEAUX = /(instagram\.com|facebook\.com|linkedin\.com|tiktok\.com|youtube\.com|x\.com|twitter\.com|pinterest\.[a-z]+)\/[^\s"'<>]+/gi;

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&rsquo;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&eacute;/g, "é")
    .replace(/&egrave;/g, "è")
    .replace(/&agrave;/g, "à")
    .replace(/&ccedil;/g, "ç")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const propre = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Texte lisible d'une page HTML (sans scripts, styles, menus de navigation ni pied de page). */
export function texteLisible(html: string): string {
  let h = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, " ");
  const main = h.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? h.match(/<body\b[\s\S]*?<\/body>/i)?.[0] ?? h;
  h = main.replace(/<(nav|footer|header)\b[\s\S]*?<\/\1>/gi, " ");
  h = h.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article|\/tr)\b[^>]*>/gi, "\n").replace(/<li\b[^>]*>/gi, "\n• ");
  return decode(h.replace(/<[^>]+>/g, " "))
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 1)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function analyserPage(html: string, url: string, statut: number | null, ms: number | null): PageLue {
  const base = new URL(url);
  const attr = (tag: string, n: string) => tag.match(new RegExp(`${n}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const meta = (k: string) => {
    const t = metas.find((m) => (attr(m, "name") ?? attr(m, "property"))?.toLowerCase() === k);
    return t ? decode(attr(t, "content") ?? "").trim() || null : null;
  };
  const titre = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const titres = [...html.matchAll(/<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => `${m[1]!.toUpperCase()} ${propre(m[2]!)}`).filter((t) => t.length > 3).slice(0, 25);
  const liens = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["']/gi)].map((m) => m[1]!.trim());
  const internes = new Set<string>();
  const externes = new Set<string>();
  for (const l of liens) {
    if (/^(mailto|tel|javascript):/i.test(l)) continue;
    try {
      const u = new URL(l, base);
      u.hash = "";
      if (u.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "")) internes.add(u.toString());
      else if (/^https?:$/.test(u.protocol)) externes.add(u.hostname.replace(/^www\./, ""));
    } catch {
      /* lien invalide */
    }
  }
  const texte = texteLisible(html);
  const mailto = [...html.matchAll(/mailto:([^"'?>\s]+)/gi)].map((m) => decodeURIComponent(m[1]!).toLowerCase());
  const emails = [...new Set([...mailto, ...(texte.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []).map((e) => e.toLowerCase())])].filter((e) => !/\.(png|jpg|webp|svg)$|sentry|wixpress|example\.com/.test(e)).slice(0, 5);
  const tels = [...new Set([...html.matchAll(/tel:([+\d\s.-]{8,20})/gi)].map((m) => m[1]!.trim()).concat(texte.match(/(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}/g) ?? []))].slice(0, 4);
  const reseaux = [...new Set((html.match(RESEAUX) ?? []).map((r) => r.replace(/["'<>].*$/, "").replace(/\/$/, "")))].filter((r) => !/sharer|share\?|intent|plugins|dialog/.test(r)).slice(0, 8);
  const gen = meta("generator");
  const technologie =
    gen ??
    (/wp-content|wp-includes/i.test(html) ? "WordPress" : /cdn\.shopify|Shopify\.theme/i.test(html) ? "Shopify" : /wixstatic|wix\.com/i.test(html) ? "Wix" : /squarespace/i.test(html) ? "Squarespace" : /webflow/i.test(html) ? "Webflow" : /__next|_next\/static/i.test(html) ? "Next.js" : /jimdo/i.test(html) ? "Jimdo" : null);
  const scripts = (html.match(/<script\b/gi) ?? []).length;
  return {
    url,
    statut,
    ms,
    titre: titre ? propre(titre) : null,
    description: meta("description") ?? meta("og:description"),
    titres,
    texte: texte.slice(0, 6000),
    emails,
    telephones: tels,
    reseaux,
    technologie,
    liensInternes: [...internes].slice(0, 60),
    liensExternes: [...externes].slice(0, 20),
    images: (html.match(/<img\b/gi) ?? []).length,
    formulaires: (html.match(/<form\b/gi) ?? []).length,
    jsSeulement: texte.length < 200 && scripts > 3,
  };
}

const DEMO = `<!doctype html><html lang="fr"><head><title>Le Fournil du Quai — Boulangerie à Sète</title><meta name="description" content="Pains au levain, viennoiseries et tielles maison, quai de la Marine à Sète."></head><body><main><h1>Le Fournil du Quai</h1><p>Boulangerie artisanale depuis 1998. Pains au levain, tielles sétoises le vendredi.</p><h2>Horaires</h2><p>Du mardi au dimanche, 6 h 30 – 19 h 30.</p><h2>Contact</h2><p>04 67 00 00 00 · <a href="mailto:contact@fournil-du-quai.example">contact@fournil-du-quai.example</a></p><a href="https://instagram.com/fournilduquai">Instagram</a><a href="/tarifs">Tarifs</a></main></body></html>`;

async function lire(url: URL): Promise<PageLue> {
  if (url.hostname.endsWith(".example")) return analyserPage(DEMO, url.toString(), 200, 120);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(9000), headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "fr-FR,fr;q=0.9" } });
    const ms = Date.now() - t0;
    if (!(res.headers.get("content-type") ?? "").includes("html")) {
      void res.body?.cancel().catch(() => undefined);
      return { ...analyserPage("", res.url || url.toString(), res.status, ms), erreur: `Ce n'est pas une page web (${res.headers.get("content-type") ?? "type inconnu"})` };
    }
    const reader = res.body?.getReader();
    let html = "";
    if (reader) {
      const dec = new TextDecoder();
      while (html.length < 800_000) {
        const { done, value } = await reader.read();
        if (done) break;
        html += dec.decode(value, { stream: true });
      }
      void reader.cancel().catch(() => undefined);
    }
    const p = analyserPage(html, res.url || url.toString(), res.status, ms);
    return res.ok ? p : { ...p, erreur: `La page répond HTTP ${res.status}` };
  } catch (e) {
    return { ...analyserPage("", url.toString(), null, null), erreur: (e as Error).name === "TimeoutError" ? "Pas de réponse en 9 s" : "Page injoignable" };
  }
}

/** Ouvre un site et lit jusqu'à `pages` pages (la première + les liens internes les plus utiles). */
export async function naviguer(adresse: string, pages = 3): Promise<PageLue[]> {
  const u = urlPublique(/^https?:\/\//i.test(adresse.trim()) ? adresse.trim() : `https://${adresse.trim()}`);
  if (!u) return [{ ...analyserPage("", adresse, null, null), erreur: "Adresse invalide ou non publique" }];
  const premiere = await lire(u);
  const max = Math.max(1, Math.min(6, pages));
  if (max === 1 || premiere.erreur) return [premiere];
  const suivantes = premiere.liensInternes
    .filter((l) => l !== premiere.url && !/\.(pdf|jpe?g|png|webp|zip|docx?)$/i.test(l) && !/(login|connexion|panier|cart|account|wp-admin|feed)/i.test(l))
    .sort((a, b) => Number(PRIORITE.test(b)) - Number(PRIORITE.test(a)) || a.length - b.length)
    .slice(0, max - 1);
  const autres = await Promise.all(suivantes.map((l) => urlPublique(l)).filter((x): x is URL => !!x).map(lire));
  return [premiere, ...autres];
}

export function naviguerTexte(pages: PageLue[]): string {
  return pages
    .map((p, i) => {
      if (p.erreur && !p.texte) return `PAGE ${i + 1} — ${p.url}\n⚠️ ${p.erreur}`;
      return [
        `PAGE ${i + 1} — ${p.url}${p.statut ? ` (HTTP ${p.statut}, ${p.ms} ms)` : ""}`,
        p.titre ? `Titre : ${p.titre}` : "",
        p.description ? `Description : ${p.description}` : "",
        p.technologie ? `Technologie : ${p.technologie}` : "",
        p.titres.length ? `Sections : ${p.titres.join(" · ")}` : "",
        p.emails.length || p.telephones.length ? `Coordonnées : ${[...p.emails, ...p.telephones].join(" · ")}` : "",
        p.reseaux.length ? `Réseaux : ${p.reseaux.join(" · ")}` : "",
        `${p.images} image(s), ${p.formulaires} formulaire(s), ${p.liensInternes.length} lien(s) interne(s)${p.liensExternes.length ? `, liens vers : ${p.liensExternes.slice(0, 8).join(", ")}` : ""}`,
        p.jsSeulement ? "⚠️ Site construit en JavaScript : le texte visible n'a pas pu être entièrement lu." : "",
        `Texte :\n${p.texte.slice(0, i === 0 ? 3500 : 1800)}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n————————\n\n");
}
