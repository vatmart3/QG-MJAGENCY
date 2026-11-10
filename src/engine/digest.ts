import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { fr } from "date-fns/locale";
import type { Services } from "@/integrations/types";
import type { EAgent, EngineDb } from "./db";

/** Données réelles du port, mises en forme pour les récaps (Diane) et le stand-up (Clémence). */

const TZ = "Europe/Paris";
const h = (iso: string) => formatInTimeZone(new Date(iso), TZ, "HH:mm");

export async function portDigest(db: EngineDb, services: Services, team: EAgent[], now: Date, depuisHeures = 24): Promise<string> {
  const since = new Date(now.getTime() - depuisHeures * 3600_000).toISOString();
  const nom = (id: string | null | undefined) => team.find((a) => a.id === id)?.nom ?? id ?? "?";
  const ymd = formatInTimeZone(now, TZ, "yyyy-MM-dd");
  const [douane, mails, faits, ouverts] = await Promise.all([db.pendingApprovals(), db.emailsSince(since), db.tasksDoneSince(since, 30), db.openTasks(30)]);

  let agenda = "Agenda indisponible.";
  try {
    const cal = await services.calendar();
    const ev = await cal.list(fromZonedTime(`${ymd}T00:00:00`, TZ).toISOString(), fromZonedTime(`${ymd}T23:59:59`, TZ).toISOString());
    agenda = ev.length ? ev.map((e) => `- ${h(e.debut)}–${h(e.fin)} · ${e.titre}${e.lieu ? ` (${e.lieu})` : ""}`).join("\n") : "Aucun rendez-vous aujourd'hui.";
    if (cal.kind === "demo") agenda += "\n(agenda de DÉMONSTRATION : Google non connecté)";
  } catch (e) {
    agenda = `Agenda indisponible : ${e instanceof Error ? e.message : String(e)}`;
  }

  const importants = mails.filter((m) => m.categorie !== "spam" && ((m.urgence ?? 0) >= 1 || m.categorie === "client" || m.categorie === "prospect"));
  const spent = await db.spentSince(formatInTimeZone(new Date(now.getTime() - 86400_000), TZ, "yyyy-MM-dd")).catch(() => 0);

  return [
    `<donnees_du_port date="${formatInTimeZone(now, TZ, "EEEE d MMMM yyyy HH:mm", { locale: fr })}">`,
    `## À valider en Douane : ${douane.length}`,
    ...douane.slice(0, 10).map((a) => `- ${nom(a.agent_id)} · ${a.titre}`),
    "",
    "## Agenda du jour (boîte de l'agence)",
    agenda,
    "",
    `## Mails depuis ${depuisHeures} h : ${mails.length} reçus, ${importants.length} importants`,
    ...importants.slice(0, 12).map((m) => `- ${m.urgence === 2 ? "🔴 " : m.urgence === 1 ? "🟠 " : ""}${m.de} — ${m.objet}${m.resume ? ` : ${m.resume}` : ""}${m.statut === "traite" ? " (traité)" : ""}`),
    "",
    `## Travail des agents depuis ${depuisHeures} h : ${faits.length} tâches terminées`,
    ...faits.slice(0, 12).map((t) => `- ${nom(t.agent_id)} · ${t.titre}`),
    "",
    `## En cours ou en attente : ${ouverts.length}`,
    ...ouverts.slice(0, 12).map((t) => `- ${nom(t.agent_id)} · ${t.titre} (${t.statut})`),
    "",
    "## Commercial et finances",
    "Les modules Commercial (leads, devis, RDV) et Finance (CA, encaissements, impayés) arrivent aux phases 6 et 7 : écris « bientôt disponible », n'invente aucun chiffre.",
    "",
    `## Budget IA : ${spent.toFixed(2)} € dépensés depuis hier`,
    "</donnees_du_port>",
  ].join("\n");
}
