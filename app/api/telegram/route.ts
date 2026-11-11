import { formatInTimeZone } from "date-fns-tz";
import { supabaseEngineDb } from "@/engine/db";
import { eur } from "@/finance/types";
import { AIDE_TELEGRAM, boutonTelegram, carteDouane, envoyerTelegram, html, lireTelegram, messageTelegram, modifierMessage, repondreBouton, secretValide, type BoutonTelegram, type ReglagesTelegram } from "@/integrations/telegram";
import { interpreter } from "@/integrations/whatsapp";
import { adminSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Clic sur « Accepter » / « Refuser » sous une demande de la Douane : même effet que dans l'application (le moteur
 * envoie au passage suivant, dans la minute). Décision atomique : un double clic, ou une décision déjà prise dans le
 * QG ou par l'autre fondateur, ne fait rien de plus.
 */
async function decider(b: BoutonTelegram, admin: NonNullable<ReturnType<typeof adminSupabase>>, tg: ReglagesTelegram): Promise<void> {
  const bulle = (t: string) => repondreBouton(b.id, t).catch(() => undefined);
  const chat = tg.chats[b.chat];
  if (!chat) return void (await bulle("Ce compte Telegram n'est pas relié à LE PORT."));
  const db = supabaseEngineDb(admin);
  const a = await db.deciderSiEnAttente(b.approval, b.decision, chat.email, b.decision === "refuse" ? "Refusé depuis Telegram" : null);
  const prenom = chat.email.split("@")[0];
  if (!a) {
    const deja = await db.approval(b.approval);
    const etat = !deja ? "n'existe plus" : deja.statut === "refuse" ? "a déjà été refusée" : "a déjà été validée";
    await bulle(`Cette demande ${etat}.`);
    if (b.messageId && b.texte) await modifierMessage(b.chat, b.messageId, `${html(b.texte)}\n\n<i>Cette demande ${etat}${deja?.decide_par ? ` (${html(deja.decide_par.split("@")[0]!)})` : ""}.</i>`).catch(() => undefined);
    return;
  }
  const question = a.type_action === "question";
  const verbe = b.decision === "refuse" ? (question ? "Répondu non" : "Refusé") : question ? "Répondu oui" : "Validé";
  await admin.from("journal").insert({ type: "validation", titre: `${verbe} : ${a.titre}`.slice(0, 300), contenu: `Depuis Telegram (${prenom}).`, agent_id: a.agent_id });
  const suite = b.decision === "refuse" ? (question ? "L'agent continue sans." : "Rien ne part ; l'agent est prévenu.") : question ? "L'agent reprend son travail." : a.type_action === "memoire" || a.type_action === "autre" ? "C'est noté." : "Ça part dans la minute.";
  await bulle(`${b.decision === "refuse" ? "❌" : "✅"} ${verbe}. ${suite}`);
  if (b.messageId && b.texte) await modifierMessage(b.chat, b.messageId, `${html(b.texte)}\n\n<b>${b.decision === "refuse" ? "❌" : "✅"} ${verbe}</b> par ${html(prenom!)} — ${suite}`).catch(() => undefined);
}

/** Messages du bot Telegram : appairage (/start CODE), missions, /point, /douane, /aide, /calme, /tout, boutons de la Douane. Sans IA. */
export async function POST(request: Request) {
  if (!secretValide(request.headers.get("x-telegram-bot-api-secret-token"))) return new Response("Refusé", { status: 401 });
  const admin = adminSupabase();
  const update = await request.json().catch(() => null);
  const bouton = boutonTelegram(update);
  if (admin && bouton) {
    const { data } = await admin.from("settings").select("telegram").eq("id", 1).maybeSingle();
    await decider(bouton, admin, lireTelegram(data?.telegram)).catch((e) => console.error("Telegram bouton", e));
    return new Response("ok");
  }
  const m = messageTelegram(update);
  if (!admin || !m) return new Response("ok");
  const repondre = (t: string) => envoyerTelegram(m.chat, t).catch((e) => console.error("Telegram", e));
  const { data: s } = await admin.from("settings").select("telegram").eq("id", 1).maybeSingle();
  const tg = lireTelegram(s?.telegram);
  const sauver = (t: ReglagesTelegram) => admin.from("settings").update({ telegram: t }).eq("id", 1);

  // appairage : le lien affiché dans Réglages ouvre le bot avec « /start CODE »
  const start = m.texte?.match(/^\/start(?:\s+(\w+))?$/);
  if (start) {
    const code = start[1];
    const a = code ? tg.appairages[code] : undefined;
    if (a && new Date(a.expire) > new Date()) {
      delete tg.appairages[code!];
      tg.chats[m.chat] = { email: a.email, niveau: tg.chats[m.chat]?.niveau ?? "tout" };
      await sauver(tg);
      await admin.from("journal").insert({ type: "decision", titre: `📱 Telegram relié pour ${a.email.split("@")[0]}`, contenu: "Missions et notifications du port sur le téléphone." });
      await repondre(`✅ Relié à LE PORT${m.prenom ? `, ${html(m.prenom)}` : ""} !\nTu recevras ici ce que font les agents.\n\n${AIDE_TELEGRAM}`);
    } else if (tg.chats[m.chat]) await repondre(AIDE_TELEGRAM);
    else await repondre("Ce lien a expiré ou n'est pas valable. Crée un nouveau lien dans LE PORT → Réglages → Connexions → Telegram.");
    return new Response("ok");
  }

  const chat = tg.chats[m.chat];
  if (!chat) {
    await repondre("Ce compte Telegram n'est pas relié à LE PORT.");
    return new Response("ok");
  }
  if (!m.texte) {
    await repondre(m.vocal ? "🎙️ Je ne comprends pas encore les vocaux : écris-moi la mission (la dictée du clavier marche très bien)." : "Écris-moi la mission en texte (ou /aide).");
    return new Response("ok");
  }

  const texte = m.texte.replace(/^\/(\w+)(@\w+)?/, "$1");
  if (/^(calme|tout)$/i.test(texte)) {
    chat.niveau = /^calme$/i.test(texte) ? "important" : "tout";
    await sauver(tg);
    await repondre(chat.niveau === "tout" ? "🔔 Tu reçois chaque action des agents (sans sonnerie), et l'important avec sonnerie." : "🔕 Tu ne reçois plus que l'important : Douane, alertes, missions terminées.");
    return new Response("ok");
  }

  const db = supabaseEngineDb(admin);
  const team = await db.agents();
  const c = interpreter(texte, team.filter((a) => a.actif).map((a) => ({ id: a.id, nom: a.nom })));
  if (c.type === "aide" || /^start$/i.test(texte)) {
    await repondre(AIDE_TELEGRAM);
  } else if (c.type === "point") {
    const jour = formatInTimeZone(new Date(), "Europe/Paris", "yyyy-MM-dd");
    const [ouvertes, attente, depense, settings] = await Promise.all([db.openTasks(60), db.pendingApprovals(), db.spentSince(jour), db.settings()]);
    const nom = (id: string | null) => team.find((a) => a.id === id)?.nom ?? "?";
    await repondre(
      [
        "⚓ <b>Le point du port</b>",
        ouvertes.length ? `🔧 ${ouvertes.length} tâche(s) en cours :\n${ouvertes.slice(0, 8).map((t) => `• <b>${html(nom(t.agent_id))}</b> — ${html(t.titre)}`).join("\n")}` : "🔧 Aucune tâche en cours.",
        `🛂 ${attente.length} demande(s) en Douane${attente.length ? " (/douane)" : ""}.`,
        `🤖 IA aujourd'hui : ${eur(depense)} sur ${eur(settings.budget_jour)}.`,
      ].join("\n\n"),
    );
  } else if (c.type === "douane") {
    // chaque demande avec ses boutons (les 8 plus anciennes) ; pour modifier un texte, c'est dans le QG
    const attente = await db.pendingApprovals();
    const app = process.env.APP_URL?.replace(/\/$/, "");
    if (!attente.length) await repondre("🛂 Rien n'attend ta validation. 👌");
    else {
      await repondre(`🛂 <b>En Douane : ${attente.length}</b>${attente.length > 8 ? " (voici les 8 plus anciennes)" : ""}. Accepte ou refuse en un clic${app ? ` ; pour modifier un texte : ${app}/douane` : " ; pour modifier un texte, ouvre le QG"}.`);
      for (const a of attente.slice(0, 8)) {
        const { texte: t, boutons } = carteDouane(a, team.find((x) => x.id === a.agent_id)?.nom ?? null);
        await envoyerTelegram(m.chat, t, true, boutons).catch((e) => console.error("Telegram", e));
      }
    }
  } else {
    const cible = c.cible ?? "marius";
    const { error } = await admin.from("missions").insert({ demandeur: chat.email, texte: c.texte.slice(0, 4000), cible, statut: "nouvelle", telegram: m.chat, telegram_msg_id: m.id });
    if (error) {
      if (!/duplicate|unique/i.test(error.message)) await repondre(`⚠️ Mission non enregistrée : ${html(error.message)}`);
      return new Response("ok");
    }
    const agent = team.find((a) => a.id === cible);
    await admin.from("journal").insert({ type: "mission", titre: `📱 Mission reçue par Telegram (${chat.email.split("@")[0]})`, contenu: c.texte.slice(0, 2000), agent_id: cible });
    await repondre(`⚓ Mission reçue ! <b>${html(agent?.nom ?? "Marius")}</b> s'en occupe${cible === "marius" ? " et organise l'équipe" : ""}. Je te renvoie le résultat ici dès que c'est fini.`);
  }
  return new Response("ok");
}
