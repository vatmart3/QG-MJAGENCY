import type { Services } from "@/integrations/types";
import type { EApproval, EngineDb } from "./db";

/**
 * Exécute ce que les fondateurs ont validé en Douane : envoi des mails (Gmail), création des
 * invitations (Google Agenda). Un envoi refusé est annulé et l'agent garde le motif en note.
 * Réservation atomique (a_faire → en_cours) : deux ticks n'envoient jamais deux fois le même mail.
 */
export async function executeApprovals(db: EngineDb, services: Services): Promise<{ faits: number; echecs: number }> {
  let faits = 0;
  let echecs = 0;
  for (const a of await db.approvalsToExecute()) {
    if (!(await db.claimApprovalExecution(a.id))) continue;
    if (a.statut === "refuse") {
      await db.finishApprovalExecution(a.id, "annule", { motif: a.motif ?? null });
      if (a.agent_id) await db.insertNote(a.agent_id, `Refusé en Douane : « ${a.titre} ».${a.motif ? ` Motif des fondateurs : ${a.motif}` : ""} À éviter la prochaine fois.`);
      continue;
    }
    try {
      const r = await executeOne(a, services);
      await db.finishApprovalExecution(a.id, r.demo ? "simule" : "fait", r.execution);
      await db.insertJournal({ type: "action", titre: r.titre.slice(0, 300), contenu: r.contenu, agent_id: a.agent_id });
      const repondre = typeof a.payload.repondre_a === "string" ? a.payload.repondre_a : null;
      if (repondre) await db.updateEmail(repondre, { statut: "traite" }).catch(() => undefined);
      faits++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.finishApprovalExecution(a.id, "echec", { erreur: msg });
      await db.insertJournal({ type: "alerte", titre: `⚠️ Envoi impossible : ${a.titre}`.slice(0, 300), contenu: msg, agent_id: a.agent_id });
      echecs++;
    }
  }
  return { faits, echecs };
}

async function executeOne(a: EApproval, services: Services): Promise<{ demo: boolean; execution: Record<string, unknown>; titre: string; contenu: string }> {
  const p = a.payload;
  if (p.kind === "email") {
    const mb = await services.mailbox();
    // « Modifier » dans la Douane : le texte et l'objet validés font foi
    const corps = a.apercu || String(p.corps ?? "");
    const objet = a.objet || String(p.objet ?? "");
    const dest = a.destinataire || String(p.a ?? "");
    const r = await mb.send({ a: dest, objet, corps, threadId: (p.threadId as string) || undefined, inReplyTo: (p.inReplyTo as string) || undefined, references: (p.references as string) || undefined });
    const demo = mb.kind === "demo";
    return { demo, execution: { id: r.id, threadId: r.threadId }, titre: `✉️ Mail ${demo ? "simulé (DÉMO)" : "envoyé"} à ${dest} : ${objet}`, contenu: corps.slice(0, 1500) };
  }
  if (p.kind === "event") {
    const cal = await services.calendar();
    const r = await cal.create({ titre: a.objet || String(p.titre ?? ""), debut: String(p.debut), fin: String(p.fin), lieu: (p.lieu as string) || undefined, description: (p.description as string) || undefined, invites: (p.invites as string[]) ?? [] });
    const demo = cal.kind === "demo";
    return { demo, execution: { id: r.id, lien: r.lien ?? null }, titre: `📅 Invitation ${demo ? "simulée (DÉMO)" : "envoyée"} : ${a.objet ?? p.titre}`, contenu: a.apercu };
  }
  throw new Error("Type d'envoi inconnu.");
}
