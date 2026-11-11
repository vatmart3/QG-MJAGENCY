import { createHmac, timingSafeEqual } from "node:crypto";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { EngineDb } from "@/engine/db";
import type { Lead } from "./db";

/**
 * Pilote commercial automatique : chaque jour de semaine, Sacha écrit aux meilleurs prospects trouvés par Hugo
 * et Inès, les mails partent tout seuls (étalés dans la journée, plafond quotidien), une relance unique à J+5,
 * et les réponses remontent dans le pipeline. Règles de la prospection B2B : identité de l'agence, lien de
 * désinscription dans chaque mail, « STOP » respecté, jamais de prospect de démonstration.
 */

export { lirePilote, PILOTE_DEFAUT, type Pilote } from "./pilote-reglages";
import type { Pilote } from "./pilote-reglages";

const TZ = "Europe/Paris";

/** Prochain créneau d'envoi : jours ouvrés, dans la plage horaire, au moins `ecart` minutes après le précédent. */
export function prochainCreneau(dernier: Date | null, now: Date, p: Pilote): Date {
  let t = new Date(Math.max(now.getTime() + 2 * 60_000, dernier ? dernier.getTime() + p.ecart_minutes * 60_000 : 0));
  for (let i = 0; i < 10; i++) {
    const jour = formatInTimeZone(t, TZ, "yyyy-MM-dd");
    const dow = Number(formatInTimeZone(t, TZ, "i"));
    const debut = fromZonedTime(`${jour}T${p.debut}:00`, TZ);
    const fin = fromZonedTime(`${jour}T${p.fin}:00`, TZ);
    if (dow <= 5 && t < fin) return t < debut ? debut : t;
    // jour suivant, à l'heure de début
    const lendemain = formatInTimeZone(new Date(fromZonedTime(`${jour}T12:00:00`, TZ).getTime() + 86400_000), TZ, "yyyy-MM-dd");
    t = fromZonedTime(`${lendemain}T${p.debut}:00`, TZ);
  }
  return t;
}

// ------------------------------------------------------------------ désinscription
const secret = () => process.env.ENCRYPTION_KEY || process.env.CRON_SECRET || "le-port";
export const jetonDesinscription = (email: string) => createHmac("sha256", secret()).update(`desinscription:${email.trim().toLowerCase()}`).digest("hex").slice(0, 32);
export function jetonValide(email: string, jeton: string): boolean {
  const a = Buffer.from(jetonDesinscription(email));
  const b = Buffer.from(jeton);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function lienDesinscription(email: string): string {
  const app = (process.env.APP_URL ?? "https://qg-mjagency.vercel.app").replace(/\/$/, "");
  return `${app}/api/desinscription?e=${encodeURIComponent(email.trim().toLowerCase())}&t=${jetonDesinscription(email)}`;
}
/** Pied de chaque mail de prospection : pourquoi on écrit, comment ne plus recevoir. */
export const piedProspection = (email: string) =>
  `\n\n—\nMJAGENCY, agence web à Sète. Vous recevez ce message car les coordonnées de votre commerce sont publiques. Pour ne plus recevoir nos messages, répondez « STOP » ou cliquez ici : ${lienDesinscription(email)}`;

export const STOP_RE = /\b(stop|désinscri\w*|desinscri\w*|unsubscribe|ne plus (me )?(recevoir|contacter)|retirez[- ]moi)\b/i;

// ------------------------------------------------------------------ tâches quotidiennes
const ligneLead = (l: Lead) =>
  `- id ${l.id} · ${l.nom} · ${l.metier ?? ""} à ${l.ville ?? ""} · e-mail : ${l.email} · ${l.note_google ? `${l.note_google}★, ${l.nb_avis ?? 0} avis` : "note inconnue"} · ${l.site ? `site ${l.site}` : "pas de site"} · Instagram : ${l.instagram ? `@${l.instagram}` : "inconnu"} · diagnostic : ${l.diagnostic ?? "—"} · angle : ${l.angle ?? "—"}`;

/** Routine de Sacha (rt_prospection_auto) : une tâche pour écrire aux meilleurs prospects du jour. */
export async function tacheProspectionAuto(db: EngineDb, now: Date): Promise<string | null> {
  const p = await db.commercial.pilote();
  if (!p.actif || p.mails_par_jour <= 0) return null;
  if (await db.hasOpenTask("sacha", "Prospection automatique")) return null;
  const debutJour = fromZonedTime(`${formatInTimeZone(now, TZ, "yyyy-MM-dd")}T00:00:00`, TZ).toISOString();
  const deja = (await db.commercial.envoisPilote(debutJour)).aujourdhui;
  const reste = p.mails_par_jour - deja;
  if (reste <= 0) return null;
  const leads = await db.commercial.leadsAProspecter(p.score_min, reste);
  if (!leads.length) return null;
  const t = await db.insertTask({
    agent_id: "sacha",
    cree_par: "pilote commercial",
    titre: `Prospection automatique : ${leads.length} commerce${leads.length > 1 ? "s" : ""}`,
    description: [
      "Pilote commercial : écris à chacun de ces commerces. Les mails partent tout seuls, étalés dans la journée.",
      "Pour chaque commerce :",
      "1. send_email avec type=\"prospection\" et a = son e-mail : objet court et personnel (pas de majuscules criardes), 5 à 7 lignes, vouvoiement, UNE observation concrète et vraie sur son commerce (le diagnostic ci-dessous ; tu peux lire son site avec browse_site si besoin), l'angle proposé, et une proposition d'appel de 15 minutes. Ne donne aucun prix, aucune promesse chiffrée. Le pied de page (désinscription) et la signature sont ajoutés automatiquement.",
      "2. update_lead avec le DM Instagram (court, chaleureux, 3-4 phrases, une question ouverte) que les fondateurs pourront envoyer à la main.",
      "Termine par un compte rendu court : commerce / angle / heure d'envoi.",
      "",
      ...leads.map(ligneLead),
    ].join("\n"),
    priorite: 2,
    statut: "queued",
  });
  await db.insertMessage({ from_agent: "ines", to_agent: "sacha", task_id: t.id, type: "delegation", contenu: `${leads.length} prospects à contacter`, resume_bulle: `Sacha, ${leads.length} prospects pour aujourd'hui !` });
  return t.id;
}

/** Relance unique, sans IA, des prospects contactés il y a N jours et restés sans réponse. */
export async function relancesProspects(db: EngineDb, now: Date): Promise<number> {
  const p = await db.commercial.pilote();
  if (!p.actif || !p.relance_jours) return 0;
  const debutJour = fromZonedTime(`${formatInTimeZone(now, TZ, "yyyy-MM-dd")}T00:00:00`, TZ).toISOString();
  const plan = await db.commercial.envoisPilote(debutJour);
  let reste = p.mails_par_jour - plan.aujourdhui;
  let dernier = plan.dernier ? new Date(plan.dernier) : null;
  const settings = await db.settings();
  let n = 0;
  for (const l of await db.commercial.leadsARelancer(new Date(now.getTime() - p.relance_jours * 86400_000).toISOString(), 20)) {
    if (reste <= 0 || !l.email) break;
    if (await db.commercial.estDesinscrit(l.email)) continue;
    const premier = await db.commercial.premierEnvoiProspection(l.id);
    if (!premier) continue;
    const quand = prochainCreneau(dernier, now, p);
    const objet = /^re\s*:/i.test(premier.objet) ? premier.objet : `Re: ${premier.objet}`;
    const corps =
      `Bonjour,\n\nJe me permets de revenir vers vous au sujet de mon message de la semaine dernière${l.angle ? ` (${l.angle.charAt(0).toLowerCase()}${l.angle.slice(1)})` : ""}.\n\nSi le sujet vous parle, un appel de 15 minutes suffit pour voir ce qui serait utile à ${l.nom}. Sinon, aucun souci : répondez simplement « non merci » et je ne vous relancerai plus.\n\nBelle journée,\n\n${settings.signataire}` +
      piedProspection(l.email);
    await db.insertApproval({
      agent_id: "sacha",
      task_id: null,
      type_action: "relance",
      titre: `Relance prospection : ${l.nom}`.slice(0, 200),
      destinataire: l.email,
      objet,
      apercu: corps,
      payload: { kind: "email", a: l.email, objet, corps, threadId: premier.threadId, prospection: true, lead_id: l.id, envoyer_apres: quand.toISOString() },
      statut: "approuve",
      decide_par: "pilote commercial",
      execution_statut: "a_faire",
    });
    await db.commercial.updateLead(l.id, { relance_le: quand.toISOString() } as Partial<Lead>);
    dernier = quand;
    reste--;
    n++;
  }
  if (n) await db.insertJournal({ type: "action", titre: `📨 Sacha relance ${n} prospect${n > 1 ? "s" : ""} sans réponse (envoi automatique étalé)`, agent_id: "sacha", pole_id: "prospection" });
  return n;
}

/** Courrier entrant : un prospect répond → pipeline ; « STOP » → désinscrit pour toujours. Sans IA. */
export async function reponsesProspects(db: EngineDb, mails: { id: string; de: string; objet: string; extrait: string }[]): Promise<{ reponses: number; stops: string[] }> {
  let reponses = 0;
  const stops: string[] = [];
  for (const m of mails) {
    const adr = (m.de.match(/<([^>]+)>/)?.[1] ?? m.de).trim().toLowerCase();
    const lead = await db.commercial.leadParEmail(adr);
    if (!lead) continue;
    if (STOP_RE.test(`${m.objet} ${m.extrait}`)) {
      await db.commercial.desinscrire(adr, "réponse STOP");
      await db.commercial.updateLead(lead.id, { statut: "ecarte", notes: `${lead.notes ?? ""}\nA demandé à ne plus être contacté.`.trim() });
      await db.updateEmail(m.id, { categorie: "prospect", resume: "Demande de désinscription (traitée automatiquement).", urgence: 0, statut: "traite" });
      await db.insertJournal({ type: "action", titre: `🚫 ${lead.nom} ne souhaite plus être contacté : désinscrit`, agent_id: "sacha", pole_id: "prospection" });
      stops.push(m.id);
      continue;
    }
    if (lead.statut === "contacte" || lead.statut === "a_contacter" || lead.statut === "nouveau") {
      await db.commercial.updateLead(lead.id, { statut: "repondu" });
      const [deja] = await db.commercial.findOpportunities(lead.nom);
      if (!deja) await db.commercial.insertOpportunity({ titre: lead.nom, lead_id: lead.id, etape: "contacte", prochaine_action: "Répondre et proposer un appel", notes: `A répondu : « ${m.objet} »` });
      await db.insertJournal({ type: "action", titre: `🎣 ${lead.nom} a répondu à la prospection !`, contenu: m.objet, agent_id: "sacha", pole_id: "prospection" });
      reponses++;
    }
  }
  return { reponses, stops };
}
