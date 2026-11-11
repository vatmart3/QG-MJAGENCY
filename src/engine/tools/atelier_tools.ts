import { z } from "zod";
import { euros, statutFr, type ModifBoutique } from "@/boutique/shopify";
import { auditTexte, auditUrl } from "@/tech/audit";
import { normUrl } from "@/tech/db";
import { checkSite, resumeSante } from "@/tech/monitoring";
import { naviguer, naviguerTexte } from "@/tech/navigateur";
import { controlerSite } from "@/tech/surveillance";
import { costEur, COUT_RECHERCHE_EUR } from "../config";
import { kpis, kpisTexte } from "../kpis";
import { externe } from "../prompts";
import { defineTool } from "./types";

/** Phase 8 : Atelier Tech (Jade, Oscar, Axel), Veille (Gabin, Rose), Data (Diane), Boutique (Yanis, Lou, Iris). */

export const checkSiteHealth = defineTool({
  name: "check_site_health",
  description:
    "Contrôle un site (adresse ou nom d'un site suivi) : réponse HTTP, temps de réponse, HTTPS, certificat SSL, expiration du domaine. suivre=true l'ajoute à la surveillance horaire de Jade. Sans adresse : état de tous les sites suivis.",
  schema: z.object({
    site: z.string().max(300).optional().describe("adresse (monsite.fr) ou nom d'un site suivi ; vide = tous les sites suivis"),
    suivre: z.boolean().optional(),
    nom: z.string().max(200).optional().describe("nom du site ou du client, si suivre=true"),
  }),
  async run(ctx, input) {
    if (!input.site) {
      const sites = await ctx.db.tech.sites(true);
      if (!sites.length) return { content: "Aucun site suivi pour l'instant (Atelier Tech → Sites, ou check_site_health avec suivre=true)." };
      return {
        content: sites.map((s) => `- ${s.nom} (${s.url}) : ${s.ok === null ? "pas encore contrôlé" : s.ok ? `OK, ${s.temps_ms} ms` : `EN PANNE (${s.erreur})`}${s.alerte ? ` · ⚠️ ${s.alerte}` : ""}${s.dernier_check ? ` · contrôlé le ${new Date(s.dernier_check).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}` : ""}`).join("\n"),
        etape: "Regarde l'état des sites",
      };
    }
    const [suivi] = await ctx.db.tech.findSites(input.site);
    if (suivi && !input.site.includes(".")) {
      await controlerSite(ctx.db, suivi, ctx.now, true);
      const [s] = await ctx.db.tech.findSites(suivi.id);
      return { content: `${s!.nom} (${s!.url}) : ${s!.ok ? `répond en ${s!.temps_ms} ms` : `ne répond pas (${s!.erreur})`}${s!.ssl_expire_le ? ` · SSL jusqu'au ${s!.ssl_expire_le.slice(0, 10)}` : ""}${s!.domaine_expire_le ? ` · domaine jusqu'au ${s!.domaine_expire_le}` : ""}${s!.alerte ? ` · ⚠️ ${s!.alerte}` : " · aucun problème"}`, etape: `Contrôle ${s!.nom}` };
    }
    const url = normUrl(input.site);
    if (!url) return { content: "Adresse invalide.", isError: true };
    const r = await checkSite(url, true, ctx.now);
    let suite = "";
    if (input.suivre) {
      const ajoute = await ctx.db.tech.insertSite({ nom: input.nom ?? new URL(url).hostname.replace(/^www\./, ""), url });
      suite = ajoute ? " Site ajouté à la surveillance (contrôle toutes les heures)." : " Ce site était déjà surveillé.";
    }
    return { content: `${url} : ${resumeSante(r, ctx.now)}.${suite}`, etape: `Contrôle ${new URL(url).hostname}` };
  },
});

export const auditUrlTool = defineTool({
  name: "audit_url",
  description: "Audit d'une page sans IA : SEO de base (titre, description, H1, sitemap, indexation, données structurées), mobile, HTTPS, vitesse, partage sur les réseaux, accessibilité. Note sur 100 et liste des corrections par priorité.",
  schema: z.object({ url: z.string().min(3).max(300) }),
  async run(ctx, input) {
    const a = await auditUrl(input.url, ctx.now);
    // mémorise l'audit sur le site suivi correspondant
    const url = normUrl(input.url);
    if (url && !a.erreur) {
      const [s] = (await ctx.db.tech.findSites(new URL(url).hostname)).filter((x) => new URL(x.url).hostname === new URL(url).hostname);
      if (s) await ctx.db.tech.updateSite(s.id, { audit: a, audit_le: a.le });
    }
    return { content: externe(a.url, auditTexte(a)), etape: `Audite ${a.url.replace(/^https?:\/\//, "").slice(0, 40)}` };
  },
});

export const webSearch = defineTool({
  name: "web_search",
  description:
    "Recherche sur le web (actualités, concurrents, tendances, réglementation, prix du marché). Réponse courte et sourcée. Coûte environ 1 centime par recherche : pose UNE question précise, regroupe tes besoins.",
  schema: z.object({ question: z.string().min(5).max(400).describe("question précise, en français, avec le lieu ou la période si utile") }),
  async run(ctx, input) {
    const r = await ctx.llm.search(input.question);
    const cout = costEur(r.model, r.usage) + r.recherches * COUT_RECHERCHE_EUR;
    if (r.model !== "simulé") await ctx.db.insertUsage({ agent_id: ctx.agent.id, modele: `${r.model} + recherche web`, tokens_in: r.usage.input + r.usage.cacheRead + r.usage.cacheWrite, tokens_out: r.usage.output, cout_estime: Math.round(cout * 100_000) / 100_000 });
    return {
      content: externe("recherche web", `${r.texte}\n\nSources :\n${r.sources.map((s) => `- ${s.titre} — ${s.url}`).join("\n") || "aucune"}`),
      etape: `Cherche : ${input.question.slice(0, 50)}`,
    };
  },
});

export const getKpis = defineTool({
  name: "get_kpis",
  description: "Tableau de bord réel de l'agence : finance du mois, prospects et pipeline, santé des sites clients, boutique (7 jours), coût de l'IA. Aucun chiffre à inventer : tout vient d'ici.",
  schema: z.object({}),
  async run(ctx) {
    return { content: kpisTexte(await kpis(ctx.db, ctx.services, ctx.now)), etape: "Lit les KPIs" };
  },
});

export const shopifyOrders = defineTool({
  name: "shopify_orders",
  description: "Commandes de la boutique MJ E-comm (Shopify) : numéro, date, client, total, paiement, expédition, articles. Recherche possible par numéro (#1042), nom ou e-mail du client.",
  schema: z.object({ recherche: z.string().max(120).optional(), jours: z.number().int().min(1).max(90).optional().describe("défaut 14"), max: z.number().int().min(1).max(30).optional() }),
  async run(ctx, input) {
    const b = await ctx.services.boutique();
    const list = await b.commandes({ depuis: input.recherche ? undefined : new Date(ctx.now.getTime() - (input.jours ?? 14) * 86400_000).toISOString(), max: input.max ?? 15, recherche: input.recherche });
    return {
      content: externe(
        "Shopify",
        `${list.length} commande(s)${b.kind === "demo" ? " (DÉMO : Shopify non connecté)" : ""} :\n` +
          list.map((c) => `- ${c.nom} du ${new Date(c.cree_le).toLocaleDateString("fr-FR")} · ${c.client ?? "client"}${c.email ? ` <${c.email}>` : ""} · ${euros(c.total, c.devise)} · ${statutFr(c.paiement)} · ${statutFr(c.expedition)}${c.annulee ? " · ANNULÉE" : ""} · ${c.articles.map((a) => `${a.quantite}× ${a.titre}`).join(", ")}`).join("\n"),
      ),
      etape: input.recherche ? `Cherche la commande ${input.recherche}` : "Regarde les commandes",
    };
  },
});

export const shopifyProducts = defineTool({
  name: "shopify_products",
  description: "Produits de la boutique : statut (en ligne, brouillon), prix et stock par variante, avec leurs identifiants (pour shopify_update).",
  schema: z.object({ recherche: z.string().max(120).optional(), max: z.number().int().min(1).max(50).optional() }),
  async run(ctx, input) {
    const b = await ctx.services.boutique();
    const [list, r] = await Promise.all([b.produits({ max: input.max ?? 25, recherche: input.recherche }), ctx.db.reglagesBoutique()]);
    return {
      content:
        `${list.length} produit(s)${b.kind === "demo" ? " (DÉMO)" : ""}, seuil de stock bas : ${r.seuil_stock} :\n` +
        list
          .map((p) => `- ${p.titre} (produit ${p.id}) · ${p.statut === "ACTIVE" ? "en ligne" : p.statut === "DRAFT" ? "brouillon" : "archivé"}\n${p.variantes.map((v) => `    · ${v.titre} (variante ${v.id}${v.sku ? `, ${v.sku}` : ""}) : ${euros(v.prix)} · stock ${v.suivi ? (v.stock ?? "?") : "non suivi"}${v.suivi && v.stock !== null && v.stock <= r.seuil_stock ? " ⚠️" : ""}`).join("\n")}`)
          .join("\n"),
      etape: "Regarde le catalogue",
    };
  },
});

export const shopifyUpdate = defineTool({
  name: "shopify_update",
  description: "Propose une modification de la boutique : stock d'une variante, prix d'une variante, ou mise en ligne / retrait d'un produit. Rien n'est changé avant la validation d'un fondateur en Douane.",
  schema: z.object({
    action: z.enum(["stock", "prix", "statut"]),
    produit_id: z.string().max(120),
    variante_id: z.string().max(120).optional().describe("obligatoire pour stock et prix"),
    quantite: z.number().int().min(0).max(100000).optional().describe("nouveau stock disponible"),
    prix: z.number().min(0).max(100000).optional().describe("nouveau prix TTC en euros"),
    statut: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).optional(),
    raison: z.string().min(3).max(300),
  }),
  async run(ctx, input) {
    const b = await ctx.services.boutique();
    const p = (await b.produits({ max: 100 })).find((x) => x.id === input.produit_id);
    if (!p) return { content: "Produit introuvable : utilise shopify_products pour l'identifiant exact.", isError: true };
    const v = p.variantes.find((x) => x.id === input.variante_id) ?? (p.variantes.length === 1 ? p.variantes[0] : undefined);
    const nom = `${p.titre}${v && p.variantes.length > 1 ? ` (${v.titre})` : ""}`;
    let m: ModifBoutique;
    let resume: string;
    if (input.action === "stock") {
      if (!v?.inventory_item_id || input.quantite === undefined) return { content: "Pour le stock : variante_id et quantite sont nécessaires.", isError: true };
      m = { op: "stock", inventory_item_id: v.inventory_item_id, quantite: input.quantite, avant: v.stock, libelle: nom };
      resume = `Stock de ${nom} : ${v.stock ?? "?"} → ${input.quantite}`;
    } else if (input.action === "prix") {
      if (!v || input.prix === undefined) return { content: "Pour le prix : variante_id et prix sont nécessaires.", isError: true };
      m = { op: "prix", produit_id: p.id, variante_id: v.id, prix: input.prix, libelle: nom };
      resume = `Prix de ${nom} : ${euros(v.prix)} → ${euros(input.prix)}`;
    } else {
      if (!input.statut) return { content: "Indique le statut (ACTIVE, DRAFT ou ARCHIVED).", isError: true };
      m = { op: "statut", produit_id: p.id, statut: input.statut, libelle: p.titre };
      resume = `${p.titre} : ${input.statut === "ACTIVE" ? "mise en ligne" : input.statut === "DRAFT" ? "retrait de la vente (brouillon)" : "archivage"}`;
    }
    await ctx.db.insertApproval({
      agent_id: ctx.agent.id,
      task_id: ctx.task.id,
      type_action: "autre",
      titre: `🛍️ Boutique — ${resume}`.slice(0, 200),
      objet: resume.slice(0, 200),
      apercu: `${resume}\n\nRaison : ${input.raison}${b.kind === "demo" ? "\n\n(DÉMO : aucune boutique connectée, rien ne sera modifié.)" : ""}`,
      payload: { kind: "shopify", modif: m },
      execution_statut: "a_faire",
    });
    return { content: `Modification déposée en Douane : « ${resume} ». Elle sera appliquée dans Shopify après validation d'un fondateur.`, etape: "Dépose une modif boutique en Douane" };
  },
});

export const browseSite = defineTool({
  name: "browse_site",
  description:
    "Navigateur : ouvre un site web et le lit comme un visiteur (gratuit). Rend le titre, la description, les sections, le texte, les coordonnées, les réseaux sociaux, la technologie et les liens, et suit jusqu'à 5 pages internes utiles (contact, tarifs, services, à propos…). Pour étudier le site d'un client, d'un prospect ou d'un concurrent.",
  schema: z.object({
    url: z.string().min(3).max(500).describe("adresse du site ou d'une page (ex. monsite.fr ou https://monsite.fr/contact)"),
    pages: z.number().int().min(1).max(6).optional().describe("nombre de pages à lire (défaut 3)"),
  }),
  async run(ctx, input) {
    const pages = await naviguer(input.url, input.pages ?? 3);
    const host = (() => {
      try {
        return new URL(pages[0]!.url).hostname.replace(/^www\./, "");
      } catch {
        return input.url;
      }
    })();
    return { content: externe(host, naviguerTexte(pages)), etape: `Navigue sur ${host.slice(0, 40)}` };
  },
});

export const ATELIER_TOOLS = [checkSiteHealth, auditUrlTool, webSearch, getKpis, shopifyOrders, shopifyProducts, shopifyUpdate, browseSite];
