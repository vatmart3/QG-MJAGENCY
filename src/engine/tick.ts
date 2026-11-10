import { formatInTimeZone } from "date-fns-tz";
import { LIMITS, NUIT } from "./config";
import { demoServices } from "@/integrations/demo";
import type { Services } from "@/integrations/types";
import { deliverReports, runRoutines } from "./routines";
import type { EngineDb } from "./db";
import { executeApprovals } from "./douane";
import { notifierFondateurs, whatsappFondateurs } from "./notifications";
import type { LLM } from "./llm";
import { isCritical, resumeWaiting, runStep, type Shared, type StepResult } from "./loop";

/**
 * Un « tick » du moteur (appelé toutes les 2 min par pg_cron, par l'onglet ouvert, ou à la main) :
 * 1. budget du jour, 2. nouvelles missions → tâches, 3. reprise des tâches en attente,
 * 4. mémoire validée en Douane, 5. tâches expirées, 6. agents à remettre au calme,
 * 7. pas d'agents sur les tâches prêtes, dans la limite de temps.
 */

export interface TickReport {
  moteur: "anthropic" | "mock";
  missions: number;
  reprises: number;
  envois: number;
  routines: string[];
  rapportsEnvoyes: number;
  pas: Record<StepResult, number>;
  budget: { depense: number; jour: number; depasse: boolean };
  erreurs: string[];
  dureeMs: number;
}

export async function tick(db: EngineDb, llm: LLM, opts: { now?: () => Date; maxSteps?: number; budgetMs?: number; services?: Services } = {}): Promise<TickReport> {
  const services = opts.services ?? demoServices;
  const clock = opts.now ?? (() => new Date());
  const start = Date.now();
  const report: TickReport = {
    moteur: llm.kind,
    missions: 0,
    reprises: 0,
    envois: 0,
    routines: [],
    rapportsEnvoyes: 0,
    pas: { done: 0, continue: 0, wait: 0, failed: 0, deferred: 0, retry: 0 },
    budget: { depense: 0, jour: 0, depasse: false },
    erreurs: [],
    dureeMs: 0,
  };
  const safe = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      report.erreurs.push(`${label} : ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const now = clock();
  const today = formatInTimeZone(now, "Europe/Paris", "yyyy-MM-dd");
  const monthStart = formatInTimeZone(now, "Europe/Paris", "yyyy-MM-01");
  const dayStartIso = new Date(`${today}T00:00:00Z`).toISOString();

  const [settings, team, polesList, memory] = await Promise.all([db.settings(), db.agents(), db.poles(), db.memory()]);
  const poles = new Map(polesList.map((p) => [p.id, p.nom]));

  // 1. budget
  const [spentDay, spentMonth] = await Promise.all([db.spentSince(today), db.spentSince(monthStart)]);
  const over = spentDay >= settings.budget_jour || spentMonth >= settings.budget_mois;
  report.budget = { depense: Math.round(spentDay * 1000) / 1000, jour: settings.budget_jour, depasse: over };
  await safe("budget", async () => {
    if (spentDay >= settings.budget_jour * 0.8 && !over) {
      const titre = "Budget IA : 80 % du budget du jour atteint";
      if (!(await db.journalSince(titre, dayStartIso))) await db.insertJournal({ type: "alerte", titre, contenu: `${spentDay.toFixed(2)} € dépensés sur ${settings.budget_jour} €.` });
    }
    if (over) {
      const titre = "Budget IA épuisé : seuls les agents critiques continuent";
      if (!(await db.journalSince(titre, dayStartIso))) await db.insertJournal({ type: "alerte", titre, contenu: `${spentDay.toFixed(2)} € aujourd'hui, ${spentMonth.toFixed(2)} € ce mois-ci.` });
      const toSleep = team.filter((a) => a.actif && !isCritical(a) && a.etat !== "offline").map((a) => a.id);
      await db.updateAgents(toSleep, { etat: "offline", offline_raison: "budget", tache_courante_id: null });
    } else {
      const toWake = team.filter((a) => a.etat === "offline" && a.offline_raison === "budget").map((a) => a.id);
      await db.updateAgents(toWake, { etat: "idle", offline_raison: null });
    }
  });

  // 2. nouvelles missions
  await safe("missions", async () => {
    for (const m of await db.newMissions()) {
      const cible = team.find((a) => a.id === (m.cible ?? "marius") && a.actif) ?? team.find((a) => a.id === "marius");
      if (!cible) continue;
      const court = m.texte.replace(/\s+/g, " ").trim();
      await db.insertTask({
        mission_id: m.id,
        agent_id: cible.id,
        cree_par: m.demandeur,
        titre: `Mission : ${court.length > 110 ? court.slice(0, 109) + "…" : court}`,
        description: m.texte,
        priorite: 4,
        statut: "queued",
      });
      await db.updateMission(m.id, { statut: cible.modele === "planner" ? "planification" : "en_cours" });
      await db.insertJournal({ type: "mission", titre: `${cible.nom} prend la mission`, contenu: m.texte, agent_id: cible.id, pole_id: cible.pole_id });
      report.missions++;
    }
  });

  // 3. tâches en attente (sous-tâches finies, réponse des fondateurs)
  await safe("reprises", async () => {
    for (const t of await db.waitingTasks()) if (await resumeWaiting(db, t, team)) report.reprises++;
  });

  // 4. mises à jour de mémoire validées en Douane
  await safe("mémoire", async () => {
    for (const a of await db.pendingMemoryApprovals()) {
      const cle = String(a.payload.cle ?? "");
      if (!cle) continue;
      const contenu = a.statut === "modifie" ? a.apercu.split("\n\nPourquoi :")[0]!.trim() : String(a.payload.contenu ?? "");
      await db.upsertMemory(cle, contenu);
      await db.markApprovalApplied(a.id, a.payload);
      await db.insertJournal({ type: "decision", titre: `Mémoire d'entreprise mise à jour : ${cle}`, contenu, agent_id: a.agent_id });
    }
  });

  // 4 bis. envois validés en Douane (mails, invitations), puis courrier à trier / relancer
  await safe("douane", async () => {
    const r = await executeApprovals(db, services, now);
    report.envois = r.faits;
  });
  await safe("routines", async () => {
    const r = await runRoutines(db, services, team, now);
    report.routines = r.lancees;
    report.erreurs.push(...r.erreurs.map((e) => `routine ${e}`));
  });
  await safe("récaps", async () => {
    report.rapportsEnvoyes = await deliverReports(db, services, settings.recap_destinataires, now);
  });
  await safe("notifications", async () => {
    await notifierFondateurs(db, services, now);
    await whatsappFondateurs(db, services, now);
  });

  // 5. tâches de plus de 24 h
  await safe("expirations", async () => {
    const before = new Date(now.getTime() - LIMITS.taskTimeoutMs).toISOString();
    for (const t of await db.staleTasks(before)) {
      await db.updateTask(t.id, { statut: "failed", resultat: { erreur: "Délai de 24 h dépassé." }, locked_until: null });
      await db.insertJournal({ type: "alerte", titre: `Tâche abandonnée (plus de 24 h) : ${t.titre}`, agent_id: t.agent_id });
      if (t.mission_id && !t.parent_id) await db.updateMission(t.mission_id, { statut: "annulee", synthese: "Mission abandonnée : délai de 24 h dépassé." });
    }
  });

  // 6. agents dans un état passager (célébration, discussion, réunion) depuis un moment
  await safe("calme", async () => {
    const before = new Date(now.getTime() - 40_000).toISOString();
    // une réunion (stand-up) dure quelques minutes : on laisse le temps de rejoindre La Criée
    const meetingBefore = now.getTime() - 4 * 60_000;
    const relax = (await db.agentsToRelax(before)).filter((a) => a.etat !== "meeting" || new Date(a.maj_le).getTime() < meetingBefore);
    await db.updateAgents(
      relax.map((a) => a.id),
      { etat: "idle", interlocuteur: null },
    );
  });

  // 6 bis. la nuit : les agents sans tâche rentrent par le ponton (quelques-uns à chaque passage),
  // Lucie et Jade restent de garde ; le matin, tout le monde revient. Une tâche réveille l'agent concerné.
  await safe("nuit", async () => {
    // routine « Nuit au port » (Réglages → Routines) : horaires modifiables, désactivable
    const r = await db.routine("rt_nuit");
    const debut = (r?.plage_debut ?? NUIT.debut).slice(0, 5);
    const fin = (r?.plage_fin ?? NUIT.fin).slice(0, 5);
    const hm = formatInTimeZone(now, "Europe/Paris", "HH:mm");
    const nuit = (r?.actif ?? true) && (debut > fin ? hm >= debut || hm < fin : hm >= debut && hm < fin);
    if (nuit) {
      const partants = team.filter((a) => a.actif && !NUIT.deGarde.includes(a.id) && !a.tache_courante_id && (a.etat === "idle" || a.etat === "done")).slice(0, NUIT.parPassage);
      await db.updateAgents(
        partants.map((a) => a.id),
        { etat: "offline", offline_raison: "nuit", interlocuteur: null },
      );
    } else {
      const revenants = team.filter((a) => a.etat === "offline" && a.offline_raison === "nuit").slice(0, NUIT.parPassage);
      await db.updateAgents(
        revenants.map((a) => a.id),
        { etat: "idle", offline_raison: null },
      );
    }
  });

  // 7. pas d'agents
  const shared: Shared = { team, poles, memory, budgetOver: over, now, settings, services };
  const maxSteps = opts.maxSteps ?? LIMITS.stepsPerTick;
  const budgetMs = opts.budgetMs ?? LIMITS.tickBudgetMs;
  let steps = 0;
  while (steps < maxSteps && Date.now() - start < budgetMs) {
    const claimed = await db.claimTasks(Math.min(LIMITS.parallel, maxSteps - steps), LIMITS.lockSeconds);
    if (!claimed.length) break;
    const results = await Promise.all(
      claimed.map((t) =>
        runStep(db, llm, t, { ...shared, now: clock() }).catch(async (e): Promise<StepResult> => {
          report.erreurs.push(`${t.titre} : ${e instanceof Error ? e.message : String(e)}`);
          await db.updateTask(t.id, { statut: "queued", locked_until: null, pas_avant: new Date(Date.now() + 60_000).toISOString() }).catch(() => undefined);
          return "retry";
        }),
      ),
    );
    for (const r of results) report.pas[r]++;
    steps += claimed.length;
    // une sous-tâche finie peut débloquer son parent dans le même tick
    if (results.includes("done")) {
      await safe("reprises", async () => {
        for (const t of await db.waitingTasks()) if (await resumeWaiting(db, t, team)) report.reprises++;
      });
    }
  }

  report.dureeMs = Date.now() - start;
  return report;
}
