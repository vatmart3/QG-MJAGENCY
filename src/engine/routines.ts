import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { fr } from "date-fns/locale";
import { rapportEmailHtml } from "@/lib/email-html";
import { lireRapport, rapportVersMarkdown } from "@/lib/rapport";
import type { Services } from "@/integrations/types";
import { alertesFiscales, clotureMois, facturerAbonnements, relancesImpayes } from "@/finance/automations";
import { relancesDevis, trouverProspects } from "@/commercial/prospection";
import { surveillerBoutique } from "@/boutique/surveillance";
import { relancesProspects, tacheProspectionAuto } from "@/commercial/pilote";
import { surveillerSites } from "@/tech/surveillance";
import { relancesSansReponse, triInbox } from "./courrier";
import type { EAgent, ERoutine, EngineDb } from "./db";
import { portDigest } from "./digest";
import { bulle } from "./prompts";

/**
 * Routines (table routines, fuseau Europe/Paris) : à chaque tick, celles qui sont dues sont « réservées »
 * (derniere_execution, mise à jour atomique : jamais deux fois) puis lancées.
 */

const TZ = "Europe/Paris";
/** routines qui attendent les outils d'une phase suivante (rien n'est lancé pour ne pas inventer de travail) */
export const ROUTINES_PLUS_TARD: Record<string, number> = {};
/** comptes rendus envoyés par mail aux destinataires du récap (Réglages) */
const PAR_MAIL: Record<string, string> = { rt_recap: "Récap quotidien", rt_rapport_hebdo: "Rapport hebdo" };
/** routines qui reçoivent les données réelles du port dans leur consigne */
const AVEC_DONNEES: Record<string, number> = { rt_recap: 24, rt_point_18h: 12, rt_rapport_hebdo: 24 * 7, rt_standup: 24 };
/** au-delà, une routine « fixe » manquée n'est plus rattrapée */
const RATTRAPAGE_MS = 6 * 3600_000;

const hhmm = (t: string) => t.slice(0, 5);

/** Instant avant lequel la dernière exécution doit dater pour que la routine soit due ; null si pas due. */
export function dueBefore(r: ERoutine, now: Date): Date | null {
  const ymd = formatInTimeZone(now, TZ, "yyyy-MM-dd");
  const dow = Number(formatInTimeZone(now, TZ, "i"));
  const dom = Number(formatInTimeZone(now, TZ, "d"));
  if (r.jours?.length && !r.jours.includes(dow)) return null;
  if (r.jour_du_mois && r.jour_du_mois !== dom) return null;
  if (r.mode === "intervalle") {
    const hm = formatInTimeZone(now, TZ, "HH:mm");
    if (hm < hhmm(r.plage_debut) || hm >= hhmm(r.plage_fin)) return null;
    return new Date(now.getTime() - Math.max(5, r.intervalle_minutes) * 60_000 + 30_000);
  }
  const occ = fromZonedTime(`${ymd}T${hhmm(r.heure)}:00`, TZ);
  if (now < occ || now.getTime() - occ.getTime() > RATTRAPAGE_MS) return null;
  return occ;
}

export async function runRoutines(db: EngineDb, services: Services, team: EAgent[], now: Date): Promise<{ lancees: string[]; erreurs: string[] }> {
  const lancees: string[] = [];
  const erreurs: string[] = [];
  for (const r of await db.activeRoutines()) {
    if (ROUTINES_PLUS_TARD[r.id] || r.id === "rt_nuit") continue;
    if (!team.some((a) => a.id === r.agent_id && a.actif)) continue;
    const before = dueBefore(r, now);
    if (!before) continue;
    if (!(await db.claimRoutine(r.id, before.toISOString(), now.toISOString()))) continue;
    // une routine en échec (ex. table pas encore migrée) n'empêche jamais les autres de tourner
    try {
      if (await launchRoutine(db, services, team, r, now, null)) lancees.push(r.nom);
    } catch (e) {
      erreurs.push(`${r.nom} : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { lancees, erreurs };
}

/**
 * Lance une routine maintenant : à l'heure prévue (par = null) ou à la demande d'un fondateur (par = son e-mail).
 * À la demande, le compte rendu reste dans LE PORT (onglet Rapports) : aucun mail n'est envoyé.
 */
export async function launchRoutine(db: EngineDb, services: Services, team: EAgent[], r: ERoutine, now: Date, par: string | null): Promise<boolean> {
  if (r.id === "rt_nuit") return false;
  const agent = team.find((a) => a.id === r.agent_id && a.actif);
  if (!agent) return false;
  if (r.id === "rt_tri_mails") return (await triInbox(db, services, agent.id)) > 0;
  if (r.id === "rt_relances_mails") return (await relancesSansReponse(db, services, now, agent.id)) > 0;
  // finance : calculs et modèles, sans IA
  if (r.id === "rt_echues") return (await relancesImpayes(db, now)) > 0;
  if (r.id === "rt_abonnements") return (await facturerAbonnements(db, now)) > 0;
  if (r.id === "rt_cloture") return clotureMois(db, now);
  if (r.id === "rt_fiscal") return (await alertesFiscales(db, now)) > 0;
  // commercial : recherche + notation des prospects, relances de devis (sans IA)
  if (r.id === "rt_leads") return (await trouverProspects(db, await services.places(), await db.commercial.prospection())).crees > 0;
  if (r.id === "rt_relances_devis") return (await relancesDevis(db, formatInTimeZone(now, TZ, "yyyy-MM-dd"))) > 0;
  // pilote commercial : Sacha écrit aux meilleurs prospects, relance unique sans IA
  if (r.id === "rt_prospection_auto") return !!(await tacheProspectionAuto(db, now));
  if (r.id === "rt_relances_prospects") return (await relancesProspects(db, now)) > 0;
  // Atelier Tech et boutique : contrôles et alertes, sans IA
  if (r.id === "rt_sante_sites") return (await surveillerSites(db, now)).controles > 0;
  if (r.id === "rt_boutique") {
    await surveillerBoutique(db, await services.boutique(), await db.reglagesBoutique(), now);
    return true;
  }
  if (await db.hasOpenTask(agent.id, r.nom)) return false;
  const dateLabel = formatInTimeZone(now, TZ, "EEEE d MMMM", { locale: fr });
  const donnees = AVEC_DONNEES[r.id] ? await portDigest(db, services, team, now, AVEC_DONNEES[r.id]) : "";
  if (r.id === "rt_standup") await standup(db, team, now);
  const parMail = !par && !!PAR_MAIL[r.id];
  await db.insertTask({
    agent_id: agent.id,
    cree_par: par ?? "routine",
    titre: `${r.nom} — ${dateLabel}`.slice(0, 200),
    description: [
      r.prompt_tache,
      donnees,
      parMail
        ? "Ton compte rendu (finish_task) sera envoyé tel quel par mail aux fondateurs : titre clair, résumé en une phrase (la « météo » de l'agence), puis des sections courtes et concrètes. N'invente aucun chiffre absent des données."
        : "Rends un compte rendu court et concret avec finish_task, à partir des données ci-dessus. Va à l'essentiel : pas d'appel d'outil inutile.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    priorite: par ? 4 : 3,
    statut: "queued",
  });
  await db.insertJournal({ type: "action", titre: `${par ? "▶️ Demandé" : "⏰ Routine"} : ${r.nom} (${agent.nom})`, contenu: par ? `Par ${par}` : null, agent_id: agent.id, pole_id: agent.pole_id });
  return true;
}

/** Stand-up de 08:30 : les responsables de pôle rejoignent La Criée et chacun dit où il en est (bulles). */
async function standup(db: EngineDb, team: EAgent[], now: Date): Promise<void> {
  const presents = team.filter((a) => a.actif && a.etat !== "offline" && (a.responsable || a.id === "marius" || a.id === "clemence")).slice(0, 10);
  await db.updateAgents(
    presents.map((a) => a.id),
    { etat: "meeting", interlocuteur: null },
  );
  const [ouverts, faits] = await Promise.all([db.openTasks(60), db.tasksDoneSince(new Date(now.getTime() - 24 * 3600_000).toISOString(), 60)]);
  for (const a of presents) {
    const fait = faits.find((t) => t.agent_id === a.id);
    const enCours = ouverts.find((t) => t.agent_id === a.id);
    const ligne = enCours ? `Aujourd'hui : ${enCours.titre}` : fait ? `Hier : ${fait.titre}. Rien de bloquant.` : "Rien de bloquant de mon côté.";
    await db.insertMessage({ from_agent: a.id, to_agent: null, type: "bavardage", contenu: ligne, resume_bulle: bulle(ligne) });
  }
}

/** Récap quotidien / rapport hebdo : envoi du compte rendu par mail (HTML) aux destinataires du récap. */
export async function deliverReports(db: EngineDb, services: Services, recipients: string[], now: Date): Promise<number> {
  if (!recipients.length) return 0;
  const prefixes = Object.values(PAR_MAIL);
  let n = 0;
  for (const t of await db.reportsToSend(prefixes, new Date(now.getTime() - 2 * 86400_000).toISOString())) {
    const rapport = lireRapport(t.resultat?.rapport);
    if (!rapport) continue;
    // on marque d'abord (pas de double envoi si deux ticks se croisent)
    await db.updateTask(t.id, { resultat: { ...t.resultat, envoye_le: now.toISOString() } });
    const kind = prefixes.find((p) => t.titre.startsWith(p)) ?? "Compte rendu";
    const app = process.env.APP_URL?.replace(/\/$/, "");
    const aValider = (await db.pendingApprovals()).length;
    try {
      const mb = await services.mailbox();
      await mb.send({
        a: recipients.join(", "),
        objet: `⚓ ${kind} — ${rapport.titre}`.slice(0, 200),
        corps: rapportVersMarkdown(rapport, { date: now.getTime() }),
        html: rapportEmailHtml(rapport, { kicker: kind, lienPort: app, aValider }),
      });
      await db.insertJournal({ type: "recap", titre: `📬 ${kind} envoyé${mb.kind === "demo" ? " (simulé, DÉMO)" : ""} à ${recipients.join(", ")}`.slice(0, 300), contenu: rapport.resume, agent_id: t.agent_id });
      n++;
    } catch (e) {
      await db.insertJournal({ type: "alerte", titre: `⚠️ ${kind} non envoyé`, contenu: e instanceof Error ? e.message : String(e), agent_id: t.agent_id });
    }
  }
  return n;
}
