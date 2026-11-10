import type { Services } from "@/integrations/types";
import type { EngineDb } from "./db";

const CLE = "push.dernier";

/**
 * Notifications sur le téléphone des fondateurs (sans IA) : nouvelles demandes en Douane et alertes du Journal
 * depuis le dernier passage. Une seule notification groupée par passage, jamais deux fois la même chose.
 */
export async function notifierFondateurs(db: EngineDb, services: Services, now = new Date()): Promise<number> {
  if (!services.notifier) return 0;
  const memo = await db.kvGet<{ le?: string }>(CLE);
  // premier passage : on part de maintenant (pas d'avalanche avec l'historique)
  if (!memo?.le) {
    await db.kvSet(CLE, { le: now.toISOString() });
    return 0;
  }
  const depuis = memo.le;
  const [attente, alertes] = await Promise.all([db.pendingApprovals(), db.journalParType("alerte", depuis, 10)]);
  const t0 = new Date(depuis).getTime();
  const nouvelles = attente.filter((a) => !!a.cree_le && new Date(a.cree_le).getTime() > t0 && !a.payload.envoyer_apres);
  await db.kvSet(CLE, { le: now.toISOString() });
  let n = 0;
  if (nouvelles.length) {
    n += await services.notifier({
      titre: nouvelles.length === 1 ? "🛂 La Douane t'attend" : `🛂 ${nouvelles.length} demandes en Douane`,
      corps: nouvelles.slice(0, 3).map((a) => a.titre).join("\n"),
      url: "/douane",
      tag: "douane",
    });
  }
  if (alertes.length) {
    n += await services.notifier({
      titre: alertes.length === 1 ? alertes[0]!.titre.slice(0, 90) : `⚠️ ${alertes.length} alertes au port`,
      corps: alertes.length === 1 ? (alertes[0]!.contenu ?? "").slice(0, 160) : alertes.slice(0, 3).map((a) => a.titre).join("\n"),
      url: "/journal",
      tag: "alerte",
    });
  }
  return n;
}
