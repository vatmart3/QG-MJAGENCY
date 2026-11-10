import type { EngineDb } from "@/engine/db";
import { checkSite, problemes } from "./monitoring";
import type { SiteSuivi } from "./db";

/** Contrôle complet (SSL + domaine) au plus une fois toutes les 20 h ; HTTP à chaque passage. */
const COMPLET_MS = 20 * 3600_000;
const PAR_PASSAGE = 25;

/**
 * Routine de Jade (rt_sante_sites), sans IA : contrôle les sites suivis, garde un historique court et
 * publie une alerte dans le Journal quand un problème apparaît (une seule fois), puis quand il est réglé.
 */
export async function surveillerSites(db: EngineDb, now = new Date()): Promise<{ controles: number; alertes: number }> {
  const sites = (await db.tech.sites(true)).sort((a, b) => (a.dernier_check ?? "").localeCompare(b.dernier_check ?? "")).slice(0, PAR_PASSAGE);
  let alertes = 0;
  await Promise.all(
    sites.map(async (s) => {
      if (await controlerSite(db, s, now)) alertes++;
    }),
  );
  return { controles: sites.length, alertes };
}

/** Contrôle un site, enregistre le résultat ; renvoie true si une nouvelle alerte a été publiée. */
export async function controlerSite(db: EngineDb, s: SiteSuivi, now: Date, forcerComplet = false): Promise<boolean> {
  const complet = forcerComplet || !s.controle_complet_le || now.getTime() - new Date(s.controle_complet_le).getTime() > COMPLET_MS;
  const r = await checkSite(s.url, complet, now);
  const echecs = r.ok ? 0 : s.echecs + 1;
  const etat = {
    ok: r.ok,
    erreur: r.erreur,
    temps_ms: r.ms,
    echecs,
    ssl_expire_le: complet ? (r.ssl_expire_le ?? null) : s.ssl_expire_le,
    ssl_valide: complet ? (r.ssl_valide ?? null) : s.ssl_valide,
    domaine_expire_le: complet ? (r.domaine_expire_le ?? s.domaine_expire_le) : s.domaine_expire_le,
  };
  const p = problemes(etat, now);
  const alerte = p.length ? p.join(" · ") : null;
  // une panne pas encore confirmée (1er échec) ne change pas l'alerte en cours
  const nouvelle = r.ok || echecs >= 2 ? alerte : s.alerte;
  await db.tech.updateSite(s.id, {
    ...etat,
    dernier_statut: r.statut,
    dernier_check: now.toISOString(),
    ...(complet ? { controle_complet_le: now.toISOString() } : {}),
    alerte: nouvelle,
    alerte_le: nouvelle && nouvelle !== s.alerte ? now.toISOString() : nouvelle ? s.alerte_le : null,
    historique: [...(s.historique ?? []), { le: now.toISOString(), ok: r.ok, ms: r.ms }].slice(-48),
  });
  // on ne publie que les changements : apparition d'un problème (ou nouveau problème), puis retour à la normale
  const nouveauxPb = nouvelle ? p.filter((x) => !(s.alerte ?? "").includes(x.replace(/\d+ j$/, ""))) : [];
  if (nouvelle && nouveauxPb.length) {
    await db.insertJournal({ type: "alerte", titre: `🚨 ${s.nom} : ${nouveauxPb.join(" · ")}`.slice(0, 300), contenu: `${s.url}\nContrôlé par Jade (Atelier Tech) le ${now.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}.`, agent_id: "jade", pole_id: "tech" });
    return true;
  }
  if (!nouvelle && s.alerte) {
    await db.insertJournal({ type: "action", titre: `✅ ${s.nom} : tout est rentré dans l'ordre`.slice(0, 300), contenu: `Problème précédent : ${s.alerte}`, agent_id: "jade", pole_id: "tech" });
  }
  return false;
}
