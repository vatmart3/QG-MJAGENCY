import { carteDouane, html } from "@/integrations/telegram";
import type { Services } from "@/integrations/types";
import type { EApproval, EngineDb } from "./db";

const CLE = "push.dernier";

export interface Nouvelle {
  important: boolean;
  agent: string | null;
  pole: string | null;
  texte: string;
  url: string;
  /** demande de la Douane : envoyée sur Telegram avec les boutons Accepter / Refuser */
  demande?: EApproval;
}

/** Retire « Noé — » ou « (Noé) » du titre quand le nom de l'agent est déjà affiché. */
function sansNom(titre: string, nom: string | null): string {
  if (!nom) return titre;
  const t = titre.replace(new RegExp(`\\s*[—-]?\\s*${nom}\\s*[—:-]\\s*`), " ").replace(new RegExp(`\\s*\\(${nom}\\)`), "");
  // « ▶️ Noé commence : … » → « ▶️ commence : … » (le nom est déjà affiché)
  return (t === titre ? t.replace(`${nom} `, "") : t).replace(/\s+/g, " ").trim();
}

/**
 * Ce qui s'est passé au port depuis le dernier passage, sans IA : chaque action des agents (Journal),
 * les nouvelles demandes en Douane et les alertes (importantes).
 */
export async function nouvellesDuPort(db: EngineDb, depuis: string, jusqua: string): Promise<Nouvelle[]> {
  // fenêtre ]depuis, jusqua] : une entrée tombe dans un seul passage, même créée dans la même milliseconde
  const [journal, attente, team, poles] = await Promise.all([db.journalDepuis(depuis, 40, jusqua), db.pendingApprovals(), db.agents(), db.poles()]);
  const agent = (id: string | null) => team.find((a) => a.id === id);
  const pole = (id: string | null | undefined) => poles.find((p) => p.id === id)?.nom ?? null;
  const t0 = new Date(depuis).getTime();
  const t1 = new Date(jusqua).getTime();
  const out: Nouvelle[] = [];
  for (const j of journal) {
    const a = agent(j.agent_id);
    const important = j.type === "alerte" || j.titre.startsWith("Synthèse livrée") || j.titre.startsWith("🛍️ Nouvelle commande");
    out.push({ important, agent: a?.nom ?? null, pole: pole(a?.pole_id ?? j.pole_id), texte: sansNom(j.titre, a?.nom ?? null), url: j.type === "alerte" ? "/journal" : "/" });
  }
  for (const d of attente.filter((x) => !!x.cree_le && new Date(x.cree_le).getTime() > t0 && new Date(x.cree_le).getTime() <= t1 && !x.payload.envoyer_apres)) {
    const a = agent(d.agent_id);
    out.push({ important: true, agent: a?.nom ?? null, pole: pole(a?.pole_id), texte: `🛂 attend ta validation : ${sansNom(d.titre, a?.nom ?? null)}`, url: "/douane", demande: d });
  }
  return out;
}

/**
 * Notifications sur le téléphone des fondateurs, groupées (une par passage au plus), jamais deux fois la même chose :
 *  - Telegram (gratuit) : chaque compte relié choisit « tout » (chaque action, sans sonnerie) ou l'important (avec sonnerie) ;
 *  - notification push de l'application installée : selon le réglage général.
 */
export async function notifierFondateurs(db: EngineDb, services: Services, now = new Date()): Promise<number> {
  if (!services.notifier && !services.telegram) return 0;
  await brancherBoutons(db, services, now);
  const memo = await db.kvGet<{ le?: string }>(CLE);
  // premier passage : on part de maintenant (pas d'avalanche avec l'historique)
  if (!memo?.le) {
    await db.kvSet(CLE, { le: now.toISOString() });
    return 0;
  }
  const [nouvelles, canaux] = await Promise.all([nouvellesDuPort(db, memo.le, now.toISOString()), db.canaux()]);
  await db.kvSet(CLE, { le: now.toISOString() });
  if (!nouvelles.length) return 0;
  let n = 0;

  if (services.telegram) {
    // les demandes de la Douane arrivent une par une, avec leurs boutons (5 par passage au plus, le reste dans /douane)
    const cartes = services.telegramBoutons ? nouvelles.filter((x) => x.demande).slice(0, 5) : [];
    for (const [chat, c] of Object.entries(canaux.telegram)) {
      for (const x of cartes) {
        const { texte, boutons } = carteDouane(x.demande!, x.agent);
        await services.telegramBoutons!(chat, texte, boutons).then(
          () => n++,
          () => undefined,
        );
      }
      const liste = (c.niveau === "tout" ? nouvelles : nouvelles.filter((x) => x.important)).filter((x) => !cartes.includes(x));
      if (!liste.length) continue;
      const lignes = liste.slice(0, 15).map((x) => (x.agent ? `<b>${html(x.agent)}</b>${x.pole ? ` <i>(${html(x.pole)})</i>` : ""} — ${html(x.texte)}` : `⚓ ${html(x.texte)}`));
      if (liste.length > 15) lignes.push(`… et ${liste.length - 15} autre(s) dans le Journal.`);
      await services.telegram(chat, lignes.join("\n"), !liste.some((x) => x.important)).then(
        () => n++,
        () => undefined,
      );
    }
  }

  if (services.notifier) {
    const liste = canaux.niveau === "tout" ? nouvelles : nouvelles.filter((x) => x.important);
    if (liste.length) {
      const seule = liste.length === 1 ? liste[0]! : null;
      n += await services.notifier({
        titre: seule ? (seule.agent ? `${seule.agent}${seule.pole ? ` · ${seule.pole}` : ""}` : "⚓ LE PORT") : `⚓ ${liste.length} nouvelles au port`,
        corps: seule ? seule.texte : liste.slice(0, 5).map((x) => (x.agent ? `${x.agent} — ${x.texte}` : x.texte)).join("\n"),
        url: liste.find((x) => x.url === "/douane")?.url ?? seule?.url ?? "/journal",
        tag: liste.some((x) => x.important) ? "important" : "activite",
      });
    }
  }
  return n;
}

/** Une fois : le bot apprend à recevoir les clics sur les boutons (nouvel essai toutes les heures en cas d'échec). */
async function brancherBoutons(db: EngineDb, services: Services, now: Date): Promise<void> {
  if (!services.telegramWebhook) return;
  const m = await db.kvGet<{ v?: number; le?: string }>("telegram.boutons");
  if (m?.v === 1 || (m?.le && now.getTime() - new Date(m.le).getTime() < 3600_000)) return;
  const ok = await services.telegramWebhook().catch(() => false);
  await db.kvSet("telegram.boutons", ok ? { v: 1 } : { le: now.toISOString() });
}

/**
 * Missions venues de WhatsApp ou de Telegram : le résultat est renvoyé dans la conversation, et une question d'un
 * agent pendant la mission y est signalée (la réponse se donne dans la Douane). Sans IA.
 */
export async function retoursMissions(db: EngineDb, services: Services, now = new Date()): Promise<number> {
  if (!services.whatsapp && !services.telegram) return 0;
  const app = process.env.APP_URL?.replace(/\/$/, "");
  let n = 0;
  for (const m of await db.missionsARenvoyer()) {
    const fini = m.statut === "terminee";
    if (m.telegram && !m.telegram_envoye_le && services.telegram) {
      // on marque d'abord : jamais deux envois
      await db.updateMission(m.id, { telegram_envoye_le: now.toISOString() });
      const t = fini ? `✅ <b>Mission terminée</b> — « ${html(m.texte.slice(0, 120))} »\n\n${html((m.synthese ?? "").slice(0, 3000))}${app ? `\n\n📄 Compte rendu complet : ${app}/rapports` : ""}` : `⛔ Mission annulée — « ${html(m.texte.slice(0, 120))} »\n${html((m.synthese ?? "").slice(0, 500))}`;
      await services.telegram(m.telegram, t, false).then(
        () => n++,
        () => undefined,
      );
    }
    if (m.whatsapp && !m.whatsapp_envoye_le && services.whatsapp) {
      await db.updateMission(m.id, { whatsapp_envoye_le: now.toISOString() });
      const t = fini ? `✅ *Mission terminée* — « ${m.texte.slice(0, 120)} »\n\n${(m.synthese ?? "").slice(0, 3000)}${app ? `\n\n📄 Compte rendu complet : ${app}/rapports` : ""}` : `⛔ Mission annulée — « ${m.texte.slice(0, 120)} »\n${(m.synthese ?? "").slice(0, 500)}`;
      try {
        await services.whatsapp(m.whatsapp, t);
        n++;
      } catch (e) {
        await db.insertJournal({ type: "alerte", titre: "⚠️ Résultat de mission non envoyé sur WhatsApp", contenu: `${e instanceof Error ? e.message : String(e)}\n(WhatsApp n'autorise les réponses que 24 h après ton dernier message : le résultat reste dans Rapports.)` });
      }
    }
  }
  // questions des agents pendant une mission venue du téléphone
  const memo = (await db.kvGet<{ ids?: string[] }>("mobile.questions")) ?? {};
  const deja = new Set(memo.ids ?? []);
  const questions = (await db.pendingApprovals()).filter((a) => a.type_action === "question" && a.task_id && !deja.has(a.id));
  for (const a of questions) {
    deja.add(a.id);
    const [t] = await db.tasks([a.task_id!]);
    const mission = t?.mission_id ? await db.mission(t.mission_id) : null;
    const suite = app ? `\n\nRéponds dans la Douane : ${app}/douane` : "";
    if (mission?.telegram && services.telegram && !services.telegramBoutons) await services.telegram(mission.telegram, `❓ <b>Question pendant ta mission</b>\n${html(a.titre)}\n\n${html(a.apercu.slice(0, 1500))}${suite}`, false).catch(() => undefined);
    if (mission?.whatsapp && services.whatsapp) await services.whatsapp(mission.whatsapp, `❓ *Question pendant ta mission*\n${a.titre}\n\n${a.apercu.slice(0, 1500)}${suite}`).catch(() => undefined);
  }
  if (questions.length) await db.kvSet("mobile.questions", { ids: [...deja].slice(-200) });
  return n;
}
