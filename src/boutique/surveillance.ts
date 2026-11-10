import type { EngineDb } from "@/engine/db";
import { euros, type Boutique, type ReglagesBoutique } from "./shopify";

const CLE = "boutique.surveillance";
interface Memo {
  /** dernière commande vue (date de création) */
  derniere?: string;
  /** alertes déjà publiées (clé → date), pour ne jamais répéter */
  alertes?: Record<string, string>;
}

/**
 * Routine de Yanis (rt_boutique), sans IA : nouvelles commandes, commandes payées pas encore expédiées
 * au-delà du délai, stocks bas ou épuisés. Chaque alerte n'est publiée qu'une fois (puis oubliée au bout de 7 jours).
 */
export async function surveillerBoutique(db: EngineDb, b: Boutique, r: ReglagesBoutique, now = new Date()): Promise<{ nouvelles: number; alertes: number }> {
  const memo = (await db.kvGet<Memo>(CLE)) ?? {};
  const deja = Object.fromEntries(Object.entries(memo.alertes ?? {}).filter(([, d]) => now.getTime() - new Date(d).getTime() < 7 * 86400_000));
  const depuis = new Date(now.getTime() - 14 * 86400_000).toISOString();
  const [commandes, produits] = await Promise.all([b.commandes({ depuis, max: 50 }), b.produits({ max: 100 })]);
  const demo = b.kind === "demo" ? " (DÉMO)" : "";
  let alertes = 0;
  const publier = async (cle: string, type: "alerte" | "action", titre: string, contenu: string) => {
    if (deja[cle]) return;
    deja[cle] = now.toISOString();
    await db.insertJournal({ type, titre: `${titre}${demo}`.slice(0, 300), contenu, agent_id: "yanis", pole_id: "boutique" });
    if (type === "alerte") alertes++;
  };

  // nouvelles commandes (la première fois : on mémorise sans tout annoncer)
  const nouvelles = memo.derniere ? commandes.filter((c) => c.cree_le > memo.derniere! && !c.annulee) : [];
  for (const c of nouvelles.slice(0, 10).reverse()) {
    await publier(`cmd:${c.id}`, "action", `🛍️ Nouvelle commande ${c.nom} — ${euros(c.total, c.devise)}`, `${c.client ?? "Client"} · ${c.articles.map((a) => `${a.quantite} × ${a.titre}`).join(", ")}${c.lien ? `\n${c.lien}` : ""}`);
  }
  // en retard d'expédition
  const limite = now.getTime() - r.delai_expedition_h * 3600_000;
  for (const c of commandes.filter((c) => !c.annulee && c.paiement === "PAID" && (c.expedition === "UNFULFILLED" || c.expedition === "PARTIALLY_FULFILLED") && new Date(c.cree_le).getTime() < limite)) {
    const h = Math.round((now.getTime() - new Date(c.cree_le).getTime()) / 3600_000);
    await publier(`retard:${c.id}`, "alerte", `📦 ${c.nom} payée il y a ${h} h et toujours pas expédiée`, `${c.client ?? "Client"} · ${c.articles.map((a) => `${a.quantite} × ${a.titre}`).join(", ")}${c.lien ? `\n${c.lien}` : ""}`);
  }
  // stocks
  for (const p of produits.filter((p) => p.statut === "ACTIVE")) {
    for (const v of p.variantes.filter((v) => v.suivi && v.stock !== null)) {
      const nom = `${p.titre}${v.titre && v.titre !== "Default Title" && v.titre !== "Par défaut" ? ` (${v.titre})` : ""}`;
      if (v.stock! <= 0) await publier(`rupture:${v.id}`, "alerte", `⛔ Rupture de stock : ${nom}`, `Plus aucune unité disponible.${p.lien ? `\n${p.lien}` : ""}`);
      else if (v.stock! <= r.seuil_stock) await publier(`bas:${v.id}:${v.stock}`, "alerte", `📉 Stock bas : ${nom} — ${v.stock} restant(s)`, `Seuil d'alerte : ${r.seuil_stock}.${p.lien ? `\n${p.lien}` : ""}`);
    }
  }
  const plusRecente = commandes.reduce<string | undefined>((m, c) => (!m || c.cree_le > m ? c.cree_le : m), memo.derniere);
  await db.kvSet(CLE, { derniere: plusRecente ?? now.toISOString(), alertes: deja } satisfies Memo);
  return { nouvelles: nouvelles.length, alertes };
}
