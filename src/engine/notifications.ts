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

/**
 * Missions venues de WhatsApp : le résultat est renvoyé au fondateur sur WhatsApp, et une question d'un agent
 * pendant la mission y est signalée (la réponse se donne dans la Douane). Sans IA.
 */
export async function whatsappFondateurs(db: EngineDb, services: Services, now = new Date()): Promise<number> {
  if (!services.whatsapp) return 0;
  const app = process.env.APP_URL?.replace(/\/$/, "");
  let n = 0;
  for (const m of await db.missionsWhatsApp()) {
    // on marque d'abord : jamais deux envois, même si WhatsApp refuse (fenêtre de 24 h dépassée)
    await db.updateMission(m.id, { whatsapp_envoye_le: now.toISOString() });
    const texte =
      m.statut === "terminee"
        ? `✅ *Mission terminée* — « ${m.texte.slice(0, 120)} »\n\n${(m.synthese ?? "").slice(0, 3000)}${app ? `\n\n📄 Compte rendu complet : ${app}/rapports` : ""}`
        : `⛔ Mission annulée — « ${m.texte.slice(0, 120)} »\n${(m.synthese ?? "").slice(0, 500)}`;
    try {
      await services.whatsapp(m.whatsapp!, texte);
      n++;
    } catch (e) {
      await db.insertJournal({ type: "alerte", titre: "⚠️ Résultat de mission non envoyé sur WhatsApp", contenu: `${e instanceof Error ? e.message : String(e)}\n(WhatsApp n'autorise les réponses que 24 h après ton dernier message : le résultat reste dans Rapports.)` });
    }
  }
  // questions des agents pendant une mission WhatsApp
  const memo = (await db.kvGet<{ ids?: string[] }>("whatsapp.questions")) ?? {};
  const deja = new Set(memo.ids ?? []);
  const questions = (await db.pendingApprovals()).filter((a) => a.type_action === "question" && a.task_id && !deja.has(a.id));
  for (const a of questions) {
    deja.add(a.id);
    const [t] = await db.tasks([a.task_id!]);
    const mission = t?.mission_id ? await db.mission(t.mission_id) : null;
    if (!mission?.whatsapp) continue;
    await services.whatsapp(mission.whatsapp, `❓ *Question pendant ta mission*\n${a.titre}\n\n${a.apercu.slice(0, 1500)}${app ? `\n\nRéponds dans la Douane : ${app}/douane` : ""}`).catch(() => undefined);
    n++;
  }
  if (questions.length) await db.kvSet("whatsapp.questions", { ids: [...deja].slice(-200) });
  return n;
}
