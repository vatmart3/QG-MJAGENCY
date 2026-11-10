import type { Services } from "@/integrations/types";
import type { ModifBoutique } from "@/boutique/shopify";
import { archiverPdf, emettrePiece } from "@/finance/emit";
import type { EApproval, EngineDb } from "./db";

/**
 * Exécute ce que les fondateurs ont validé en Douane : envoi des mails (Gmail), création des
 * invitations (Google Agenda). Un envoi refusé est annulé et l'agent garde le motif en note.
 * Réservation atomique (a_faire → en_cours) : deux ticks n'envoient jamais deux fois le même mail.
 */
export async function executeApprovals(db: EngineDb, services: Services, now = new Date()): Promise<{ faits: number; echecs: number }> {
  let faits = 0;
  let echecs = 0;
  for (const a of await db.approvalsToExecute()) {
    // mode autonome : on laisse le délai aux fondateurs pour bloquer l'envoi
    const apres = typeof a.payload.envoyer_apres === "string" ? new Date(a.payload.envoyer_apres) : null;
    if (a.statut !== "refuse" && apres && apres > now) continue;
    if (!(await db.claimApprovalExecution(a.id))) continue;
    if (a.statut === "refuse") {
      await db.finishApprovalExecution(a.id, "annule", { motif: a.motif ?? null });
      if (a.agent_id) await db.insertNote(a.agent_id, `Refusé en Douane : « ${a.titre} ».${a.motif ? ` Motif des fondateurs : ${a.motif}` : ""} À éviter la prochaine fois.`);
      continue;
    }
    try {
      const r = await executeOne(a, services, db);
      await db.finishApprovalExecution(a.id, r.demo ? "simule" : "fait", r.execution);
      await db.insertJournal({ type: "action", titre: `${r.titre}${a.decide_par === "mode autonome" ? " · mode autonome" : ""}`.slice(0, 300), contenu: r.contenu, agent_id: a.agent_id });
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

async function executeOne(a: EApproval, services: Services, db: EngineDb): Promise<{ demo: boolean; execution: Record<string, unknown>; titre: string; contenu: string }> {
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
  if (p.kind === "document") {
    const kind = p.doc === "devis" ? "devis" : "facture";
    const id = String(p.id);
    const f = db.finance;
    let piece = kind === "facture" ? await f.invoice(id) : await f.quote(id);
    if (!piece) throw new Error("Pièce introuvable.");
    if (piece.statut === "brouillon") {
      if (!p.emettre) throw new Error("La pièce n'est pas émise.");
      await emettrePiece(f, services.documents, kind, id);
    } else if (!piece.pdf_path) await archiverPdf(f, services.documents, kind, id);
    piece = kind === "facture" ? await f.invoice(id) : await f.quote(id);
    if (!piece?.pdf_path || !piece.numero) throw new Error("PDF introuvable.");
    const pdf = await services.documents.lire(piece.pdf_path);
    if (!pdf) throw new Error("PDF absent du coffre.");
    const dest = a.destinataire || String(p.a ?? "") || piece.client_snapshot?.email || "";
    if (!dest) throw new Error("Le client n'a pas d'adresse e-mail : ajoute-la dans Finances → Clients.");
    const mb = await services.mailbox();
    const objet = a.objet || `${kind === "facture" ? "Facture" : "Devis"} ${piece.numero}`;
    const corps = a.apercu || String(p.corps ?? "");
    const r = await mb.send({ a: dest, objet, corps, pieces: [{ nom: `${piece.numero}.pdf`, mime: "application/pdf", data: pdf }] });
    if (kind === "facture" && piece.statut === "emise") await f.updateInvoice(id, { statut: "envoyee" });
    if (kind === "devis" && piece.statut === "emis") await f.updateQuote(id, { statut: "envoye" });
    const demo = mb.kind === "demo";
    return { demo, execution: { id: r.id, numero: piece.numero }, titre: `🧾 ${p.relance ? `Relance ${piece.numero}` : `${kind === "facture" ? "Facture" : "Devis"} ${piece.numero}`} ${demo ? "simulée (DÉMO)" : "envoyée"} à ${dest}`, contenu: corps.slice(0, 1500) };
  }
  if (p.kind === "event") {
    const cal = await services.calendar();
    const r = await cal.create({ titre: a.objet || String(p.titre ?? ""), debut: String(p.debut), fin: String(p.fin), lieu: (p.lieu as string) || undefined, description: (p.description as string) || undefined, invites: (p.invites as string[]) ?? [] });
    const demo = cal.kind === "demo";
    return { demo, execution: { id: r.id, lien: r.lien ?? null }, titre: `📅 Invitation ${demo ? "simulée (DÉMO)" : "envoyée"} : ${a.objet ?? p.titre}`, contenu: a.apercu };
  }
  if (p.kind === "shopify") {
    const b = await services.boutique();
    const fait = await b.appliquer(p.modif as ModifBoutique, a.id);
    const demo = b.kind === "demo";
    return { demo, execution: { resultat: fait }, titre: `🛍️ Boutique ${demo ? "(DÉMO, rien de modifié)" : "mise à jour"} : ${fait}`, contenu: a.apercu };
  }
  throw new Error("Type d'envoi inconnu.");
}
