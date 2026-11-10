import { formatInTimeZone } from "date-fns-tz";
import { fr } from "date-fns/locale";
import type { EngineDb } from "@/engine/db";
import { moisDecale, resumeFinance } from "./calc";
import { calendrierFiscal } from "./fiscal";
import { dateFr, eur, type Invoice } from "./types";

/**
 * Automatismes financiers SANS IA (aucun crédit) : factures d'abonnement, relances d'impayés,
 * clôture du mois, alertes fiscales. Tout ce qui part chez un client passe par La Douane.
 */

const TZ = "Europe/Paris";
const jour = (now: Date) => formatInTimeZone(now, TZ, "yyyy-MM-dd");

/** 1er du mois : Bastien prépare la facture de chaque abonnement actif (envoi après validation en Douane). */
export async function facturerAbonnements(db: EngineDb, now: Date): Promise<number> {
  const f = db.finance;
  const today = jour(now);
  const mois = today.slice(0, 7);
  const libMois = formatInTimeZone(now, TZ, "MMMM yyyy", { locale: fr });
  let n = 0;
  for (const s of await f.subscriptions()) {
    if (!s.actif || s.debut > today || (s.fin && s.fin < today) || !s.lignes.length) continue;
    if (!(await f.markSubscription(s.id, mois))) continue;
    const client = await f.client(s.client_id);
    if (!client) continue;
    const inv = await f.insertInvoice({ client_id: s.client_id, objet: `${s.libelle} — ${libMois}`, lignes: s.lignes, abonnement_id: s.id, cree_par: "bastien", delai_jours: (await f.settings()).delai_paiement });
    await db.insertApproval({
      agent_id: "bastien",
      task_id: null,
      type_action: "facture",
      titre: `Facture d'abonnement : ${client.nom} — ${s.libelle}`.slice(0, 200),
      destinataire: client.email ?? null,
      objet: `Facture ${libMois} — ${s.libelle}`,
      apercu: messageFacture(client.nom, `${s.libelle} (${libMois})`, inv.total),
      payload: { kind: "document", doc: "facture", id: inv.id, emettre: true, a: client.email ?? null },
      execution_statut: "a_faire",
    });
    n++;
  }
  if (n) await db.insertJournal({ type: "action", titre: `🧾 Bastien a préparé ${n} facture${n > 1 ? "s" : ""} d'abonnement (${libMois}) : à valider en Douane`, agent_id: "bastien", pole_id: "finance" });
  return n;
}

export function messageFacture(client: string, objet: string, total: number): string {
  return `Bonjour,\n\nVeuillez trouver ci-joint votre facture pour : ${objet}, d'un montant de ${eur(total)}.\n\nMerci pour votre confiance,`;
}

const RELANCES: Record<number, { titre: string; texte: (i: Invoice, reste: number, retard: number) => string }> = {
  1: {
    titre: "Relance courtoise",
    texte: (i, reste) =>
      `Bonjour,\n\nSauf erreur de notre part, la facture ${i.numero} du ${dateFr(i.emis_le)}, d'un montant de ${eur(reste)}, arrivée à échéance le ${dateFr(i.echeance)}, n'a pas encore été réglée.\n\nS'il s'agit d'un simple oubli, merci de procéder au règlement dès que possible. Si le paiement est déjà parti, merci de ne pas tenir compte de ce message.\n\nBelle journée,`,
  },
  2: {
    titre: "Relance ferme",
    texte: (i, reste, retard) =>
      `Bonjour,\n\nMalgré notre premier rappel, la facture ${i.numero} d'un montant de ${eur(reste)} reste impayée, avec ${retard} jours de retard sur l'échéance du ${dateFr(i.echeance)}.\n\nNous vous remercions de régulariser ce règlement sous 8 jours. Conformément à nos conditions, des pénalités de retard et l'indemnité forfaitaire de 40 € pour frais de recouvrement (clients professionnels) peuvent s'appliquer.\n\nCordialement,`,
  },
  3: {
    titre: "Mise en demeure",
    texte: (i, reste, retard) =>
      `Madame, Monsieur,\n\nLa facture ${i.numero} du ${dateFr(i.emis_le)}, d'un montant de ${eur(reste)}, reste impayée ${retard} jours après son échéance du ${dateFr(i.echeance)}, malgré nos relances.\n\nPar la présente, nous vous mettons en demeure de procéder à son règlement sous 8 jours à compter de la réception de ce courrier, majoré des pénalités de retard prévues et de l'indemnité forfaitaire de 40 € pour frais de recouvrement (clients professionnels).\n\nÀ défaut, nous nous réservons le droit d'engager une procédure de recouvrement.\n\nCordialement,`,
  },
};

/** Chaque matin : Rémi prépare les relances graduées des factures échues (J+3, J+10, J+30), PDF joint. */
export async function relancesImpayes(db: EngineDb, now: Date): Promise<number> {
  const f = db.finance;
  const today = jour(now);
  let n = 0;
  for (const i of await f.openInvoices()) {
    if (!i.echeance || i.activite !== "agence") continue;
    const retard = Math.floor((Date.parse(today) - Date.parse(i.echeance)) / 86400_000);
    const niveau = retard >= 30 ? 3 : retard >= 10 ? 2 : retard >= 3 ? 1 : 0;
    const deja = Math.max(0, ...(i.relances ?? []).map((r) => r.niveau));
    if (niveau <= deja) continue;
    const reste = i.total - (await f.paymentsOf(i.id)).reduce((s, p) => s + p.montant, 0);
    if (reste <= 0) continue;
    const r = RELANCES[niveau]!;
    const email = i.client_snapshot?.email ?? null;
    await f.updateInvoice(i.id, { relances: [...(i.relances ?? []), { niveau, le: today }] });
    await db.insertApproval({
      agent_id: "remi",
      task_id: null,
      type_action: "relance",
      titre: `${r.titre} : ${i.client_snapshot?.nom ?? "client"} — ${i.numero} (${eur(reste)})`.slice(0, 200),
      destinataire: email,
      objet: `${niveau === 3 ? "Mise en demeure" : "Rappel"} — facture ${i.numero}`,
      apercu: r.texte(i, reste, retard),
      payload: { kind: "document", doc: "facture", id: i.id, a: email, relance: niveau, jamais_auto: niveau === 3 },
      execution_statut: "a_faire",
    });
    n++;
  }
  if (n) await db.insertJournal({ type: "action", titre: `📮 Rémi a préparé ${n} relance${n > 1 ? "s" : ""} d'impayé : à valider en Douane`, agent_id: "remi", pole_id: "finance" });
  return n;
}

/** 1er du mois : Héloïse et Agathe clôturent le mois précédent (chiffres réels, sans IA). */
export async function clotureMois(db: EngineDb, now: Date): Promise<boolean> {
  const f = db.finance;
  const today = jour(now);
  const precedent = moisDecale(today.slice(0, 7), -1);
  const debut = `${moisDecale(precedent, -12)}-01`;
  const [invoices, payments, subscriptions, settings] = await Promise.all([f.invoicesSince(debut), f.payments(debut), f.subscriptions(), f.settings()]);
  const r = resumeFinance({ invoices, payments, subscriptions, settings, mois: precedent, aujourdhui: today });
  const lib = formatInTimeZone(new Date(`${precedent}-15T12:00:00Z`), TZ, "MMMM yyyy", { locale: fr });
  await db.insertJournal({
    type: "recap",
    titre: `📊 Clôture de ${lib} : ${eur(r.encaisseMois, 0)} encaissés (${r.pctObjectif} % de l'objectif)`,
    contenu: [
      `Facturé : ${eur(r.factureMois)} · Encaissé : ${eur(r.encaisseMois)} · Reste à encaisser : ${eur(r.aEncaisser)}`,
      `Impayés en retard : ${r.impayes.length} (${eur(r.totalImpayes)})`,
      `Cotisations sociales estimées (Agathe) : ${eur(r.cotisationsMois)} sur le CA encaissé — à déclarer à l'URSSAF.`,
      `CA encaissé depuis janvier : ${eur(r.caAnnuelEncaisse)} (${r.pctSeuilTva} % du seuil de franchise de TVA).`,
      `Prévision : ${r.prevision.map((p) => `${p.mois} ≈ ${eur(p.montant, 0)}`).join(" · ")}`,
    ].join("\n"),
    agent_id: "heloise",
    pole_id: "finance",
  });
  return true;
}

/** Chaque matin : Agathe prévient des échéances fiscales à 7 jours et du seuil de TVA (une seule fois). */
export async function alertesFiscales(db: EngineDb, now: Date): Promise<number> {
  const f = db.finance;
  const today = jour(now);
  const settings = await f.settings();
  let n = 0;
  for (const e of calendrierFiscal(today, settings, 7)) {
    if (await db.kvClaim(`fiscal.${e.date}.${e.titre}`, { at: now.toISOString() }, "2000-01-01T00:00:00Z", now.toISOString())) {
      await db.insertJournal({ type: "alerte", titre: `🗓️ ${e.titre} : avant le ${dateFr(e.date)}`, contenu: e.detail, agent_id: "agathe", pole_id: "finance" });
      n++;
    }
  }
  const annee = today.slice(0, 4);
  const encaisse = (await f.payments(`${annee}-01-01`)).reduce((s, p) => s + p.montant, 0);
  for (const pct of [80, 100]) {
    if (encaisse >= (settings.seuil_tva * pct) / 100 && (await db.kvClaim(`tva.${annee}.${pct}`, { at: now.toISOString() }, "2000-01-01T00:00:00Z", now.toISOString()))) {
      await db.insertJournal({
        type: "alerte",
        titre: `⚠️ Seuil de franchise de TVA : ${pct} % atteint (${eur(encaisse, 0)} sur ${eur(settings.seuil_tva, 0)})`,
        contenu: `Au-delà de ${eur(settings.seuil_tva_majore, 0)}, la TVA devient due dès le dépassement. À vérifier avec un expert-comptable.`,
        agent_id: "agathe",
        pole_id: "finance",
      });
      n++;
    }
  }
  return n;
}
