import { createHmac, timingSafeEqual } from "node:crypto";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { fr } from "date-fns/locale";
import type { EngineDb } from "@/engine/db";
import type { Lead } from "./db";
import { tacheTheo } from "./taches";

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
  `- id ${l.id} · ${l.nom} · ${l.metier ?? ""} à ${l.ville ?? ""} · e-mail : ${l.email ?? "aucun"} · tél. ${l.telephone ?? "inconnu"} · ${l.note_google ? `${l.note_google}★, ${l.nb_avis ?? 0} avis` : "note inconnue"} · ${l.site ? `site ${l.site}` : "pas de site"} · Instagram : ${l.instagram ? `@${l.instagram}` : "inconnu"} · diagnostic : ${l.diagnostic ?? "—"} · angle : ${l.angle ?? "—"}`;

/**
 * Routine de Sacha (rt_prospection_auto) : étude et approche des meilleurs prospects du jour. Avec e-mail → le mail
 * part tout seul ; sans e-mail → un créneau dans l'agenda des fondateurs avec le script (appel, DM, visite).
 */
export async function tacheProspectionAuto(db: EngineDb, now: Date): Promise<string | null> {
  const p = await db.commercial.pilote();
  if (!p.actif) return null;
  if (await db.hasOpenTask("sacha", "Étude et approche")) return null;
  const debutJour = fromZonedTime(`${formatInTimeZone(now, TZ, "yyyy-MM-dd")}T00:00:00`, TZ).toISOString();
  const deja = (await db.commercial.envoisPilote(debutJour)).aujourdhui;
  const resteMails = Math.max(0, p.mails_par_jour - deja);
  const tous = await db.commercial.leadsAEtudier(p.score_min, 30);
  const avecMail = tous.filter((l) => l.email).slice(0, resteMails);
  const sansMail = tous.filter((l) => !l.email).slice(0, Math.max(0, Math.min(p.appels_par_jour, 8)));
  const leads = [...avecMail, ...sansMail];
  if (!leads.length) return null;
  const t = await db.insertTask({
    agent_id: "sacha",
    cree_par: "pilote commercial",
    titre: `Étude et approche : ${leads.length} prospect${leads.length > 1 ? "s" : ""}`,
    description: [
      "Pilote commercial. Pour CHAQUE prospect ci-dessous, dans l'ordre :",
      "1. Étudie-le : s'il a un site, lis-le avec browse_site (2 pages) ; sinon appuie-toi sur le diagnostic. Lis read_company_memory (offres, grille de prix) une seule fois au début.",
      "2. Appelle plan_prospect : ses besoins concrets, l'offre MJAGENCY la plus adaptée (site vitrine, refonte, NFC avis Google, fidélité digitale, réseaux sociaux…), une fourchette de budget INTERNE (jamais communiquée au client), le canal (email s'il a un e-mail, sinon telephone, instagram ou visite), 3 arguments, et le message prêt à l'emploi (mail, DM ou script d'appel de 6 à 8 lignes). plan_prospect crée l'affaire dans le pipeline et, sans e-mail, réserve un créneau dans l'agenda des fondateurs avec ton script.",
      "3. Si le canal est email : envoie le mail avec send_email type=\"prospection\" (5 à 7 lignes, vouvoiement, une observation concrète, l'offre, proposition d'appel de 15 min, AUCUN prix) : il part tout seul, étalé dans la journée.",
      "Termine par un compte rendu : un tableau prospect / offre / budget interne / canal / prochaine étape.",
      "",
      ...leads.map(ligneLead),
    ].join("\n"),
    priorite: 2,
    statut: "queued",
  });
  await db.insertMessage({ from_agent: "ines", to_agent: "sacha", task_id: t.id, type: "delegation", contenu: `${leads.length} prospects à étudier et approcher`, resume_bulle: `Sacha, ${leads.length} prospects à étudier aujourd'hui !` });
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
      let opp = await db.commercial.opportuniteDuLead(lead.id);
      if (!opp) opp = await db.commercial.insertOpportunity({ titre: lead.nom, lead_id: lead.id, etape: "contacte", prochaine_action: "Rappeler et fixer un rendez-vous", notes: `A répondu : « ${m.objet} »` });
      else await db.commercial.updateOpportunity(opp.id, { etape: opp.etape === "nouveau" ? "contacte" : opp.etape, prochaine_action: "Il a répondu : rappeler et fixer un rendez-vous (fiche de Théo prête)" });
      await db.insertJournal({ type: "alerte", titre: `🎣 ${lead.nom} a répondu ! À rappeler — Théo prépare la fiche RDV`, contenu: `${m.objet}\n${m.extrait}`.slice(0, 600), agent_id: "sacha", pole_id: "prospection" });
      // la chaîne continue : Théo prépare le rendez-vous (questions, objections, offre chiffrée)
      await tacheTheo(db, opp.id, "pilote commercial").catch(() => null);
      reponses++;
    }
  }
  return { reponses, stops };
}

// ------------------------------------------------------------------ agenda des fondateurs
/**
 * Prochain créneau libre de 15 min dans l'agenda de l'agence (jours ouvrés, 10 h-12 h puis 14 h-17 h30),
 * à partir du lendemain ouvré si on est déjà l'après-midi. Les créneaux déjà pris sont évités.
 */
export async function creneauFondateur(cal: { busy(a: string, b: string): Promise<{ debut: string; fin: string }[]> }, now: Date, dejaPris: { debut: string; fin: string }[] = []): Promise<{ debut: Date; fin: Date }> {
  const heures = ["10:00", "10:30", "11:00", "11:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00"];
  const fin = new Date(now.getTime() + 6 * 86400_000);
  const occupe = [...(await cal.busy(now.toISOString(), fin.toISOString()).catch(() => [])), ...dejaPris].map((b) => [new Date(b.debut).getTime(), new Date(b.fin).getTime()] as const);
  for (let j = 0; j < 7; j++) {
    const jour = formatInTimeZone(new Date(now.getTime() + j * 86400_000), TZ, "yyyy-MM-dd");
    if (Number(formatInTimeZone(fromZonedTime(`${jour}T12:00:00`, TZ), TZ, "i")) > 5) continue;
    for (const h of heures) {
      const d = fromZonedTime(`${jour}T${h}:00`, TZ);
      if (d.getTime() < now.getTime() + 45 * 60_000) continue;
      const f = new Date(d.getTime() + 15 * 60_000);
      if (occupe.some(([a, b]) => d.getTime() < b && f.getTime() > a)) continue;
      return { debut: d, fin: f };
    }
  }
  const d = fromZonedTime(`${formatInTimeZone(new Date(now.getTime() + 86400_000), TZ, "yyyy-MM-dd")}T10:00:00`, TZ);
  return { debut: d, fin: new Date(d.getTime() + 15 * 60_000) };
}

export const jourHeure = (d: Date) => formatInTimeZone(d, TZ, "EEEE d MMMM 'à' HH'h'mm", { locale: fr });

// ------------------------------------------------------------------ Marius optimise la prospection (chaque vendredi)
export function statsProspection(leads: { metier: string | null; ville: string | null; statut: string; angle: string | null; email: boolean }[]): string {
  const groupe = (cle: (l: (typeof leads)[number]) => string) => {
    const m = new Map<string, { total: number; mail: number; contactes: number; reponses: number; signes: number }>();
    for (const l of leads) {
      const k = cle(l) || "?";
      const g = m.get(k) ?? { total: 0, mail: 0, contactes: 0, reponses: 0, signes: 0 };
      g.total++;
      if (l.email) g.mail++;
      if (["contacte", "repondu", "converti"].includes(l.statut)) g.contactes++;
      if (["repondu", "converti"].includes(l.statut)) g.reponses++;
      if (l.statut === "converti") g.signes++;
      m.set(k, g);
    }
    return [...m.entries()]
      .sort((a, b) => b[1].reponses - a[1].reponses || b[1].total - a[1].total)
      .map(([k, g]) => `- ${k} : ${g.total} trouvés, ${g.mail} avec e-mail, ${g.contactes} contactés, ${g.reponses} réponses${g.contactes ? ` (${Math.round((100 * g.reponses) / g.contactes)} %)` : ""}, ${g.signes} signés`)
      .join("\n");
  };
  return [`Par métier :\n${groupe((l) => l.metier ?? "")}`, `Par ville :\n${groupe((l) => l.ville ?? "")}`, `Par offre proposée :\n${groupe((l) => (l.angle ?? "").split(" + ")[0] ?? "")}`].join("\n\n");
}

/** Routine de Marius (rt_optimisation) : les chiffres de la prospection et du coût, puis il ajuste la semaine suivante. */
export async function tacheOptimisation(db: EngineDb, now: Date): Promise<string | null> {
  if (await db.hasOpenTask("marius", "Optimisation")) return null;
  const leads = await db.commercial.leadsResume();
  const [cfg, p, cout] = await Promise.all([db.commercial.prospection(), db.commercial.pilote(), db.spentSince(new Date(now.getTime() - 7 * 86400_000).toISOString().slice(0, 10))]);
  const t = await db.insertTask({
    agent_id: "marius",
    cree_par: "pilote commercial",
    titre: `Optimisation de la semaine — ${formatInTimeZone(now, TZ, "dd/MM")}`,
    description: [
      "Tu es le CEO. Analyse les résultats de la prospection et rends la machine plus efficace ET moins chère.",
      `Coût de l'IA sur 7 jours : ${cout.toFixed(2)} €.`,
      `Réglages actuels : métiers ${cfg.metiers.join(", ")} · zones ${cfg.zones.join(", ")} · ${p.mails_par_jour} mails/jour · ${p.appels_par_jour} appels/jour · score minimum ${p.score_min}.`,
      "",
      leads.length ? statsProspection(leads) : "Pas encore de prospects réels.",
      "",
      "1. Tire 3 conclusions concrètes (quels métiers, villes et offres marchent, lesquels ne donnent rien, où on gaspille).",
      "2. Ajuste avec ajuster_prospection : garde les métiers et villes qui répondent, remplace ceux qui ne donnent rien (au moins 4 métiers et 3 villes), adapte le rythme (mails 20/jour maximum pour la boîte Gmail).",
      "3. Rends un compte rendu court : ce qui marche, ce que tu changes et pourquoi, 2 idées pour la semaine prochaine (marketing compris).",
    ].join("\n"),
    priorite: 2,
    statut: "queued",
  });
  return t.id;
}
