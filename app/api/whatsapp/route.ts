import { formatInTimeZone } from "date-fns-tz";
import { supabaseEngineDb } from "@/engine/db";
import { eur } from "@/finance/types";
import { AIDE_WHATSAPP, envoyerWhatsApp, interpreter, messagesEntrants, reponseBavardage, signatureValide } from "@/integrations/whatsapp";
import { adminSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Vérification de l'adresse par Meta (une fois, à la configuration du webhook). */
export async function GET(request: Request) {
  const u = new URL(request.url);
  const ok = u.searchParams.get("hub.mode") === "subscribe" && !!process.env.WHATSAPP_VERIFY_TOKEN && u.searchParams.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN;
  return ok ? new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("Refusé", { status: 403 });
}

/** Messages WhatsApp des fondateurs : mission, « point », « douane », « aide ». Sans IA (Marius prend le relais). */
export async function POST(request: Request) {
  const corps = await request.text();
  if (!signatureValide(corps, request.headers.get("x-hub-signature-256"))) return new Response("Signature invalide", { status: 401 });
  const admin = adminSupabase();
  if (!admin) return new Response("ok");
  let payload: unknown;
  try {
    payload = JSON.parse(corps);
  } catch {
    return new Response("ok");
  }
  const db = supabaseEngineDb(admin);
  const { data: s } = await admin.from("settings").select("whatsapp").eq("id", 1).maybeSingle();
  const numeros = ((s?.whatsapp as { numeros?: Record<string, string> } | null)?.numeros ?? {}) as Record<string, string>;
  const repondre = (a: string, t: string) => envoyerWhatsApp(a, t).catch((e) => console.error("WhatsApp", e));

  for (const m of messagesEntrants(payload)) {
    const email = numeros[m.de];
    if (!email) {
      await repondre(m.de, "Ce numéro n'est pas autorisé.");
      continue;
    }
    if (!m.texte) {
      await repondre(m.de, m.type === "audio" ? "🎙️ Je ne comprends pas encore les vocaux : écris-moi la mission en texte." : "Écris-moi la mission en texte (ou *aide*).");
      continue;
    }
    const team = await db.agents();
    const c = interpreter(m.texte, team.filter((a) => a.actif).map((a) => ({ id: a.id, nom: a.nom })));
    if (c.type === "aide") {
      await repondre(m.de, AIDE_WHATSAPP);
    } else if (c.type === "bavardage") {
      const [ouvertes, attente] = await Promise.all([db.openTasks(60), db.pendingApprovals()]);
      const agent = team.find((a) => a.id === (c.cible ?? "marius"))?.nom ?? "Marius";
      const heure = Number(formatInTimeZone(new Date(), "Europe/Paris", "H"));
      await repondre(m.de, `${c.cible ? `*${agent}* : ` : ""}${reponseBavardage(c.genre, { agent, prenom: null, enCours: ouvertes.length, douane: attente.length, heure })}`);
    } else if (c.type === "point") {
      const jour = formatInTimeZone(new Date(), "Europe/Paris", "yyyy-MM-dd");
      const [ouvertes, attente, depense, settings] = await Promise.all([db.openTasks(60), db.pendingApprovals(), db.spentSince(jour), db.settings()]);
      const nom = (id: string | null) => team.find((a) => a.id === id)?.nom ?? "?";
      await repondre(
        m.de,
        [
          `⚓ *Le point du port*`,
          ouvertes.length ? `🔧 ${ouvertes.length} tâche(s) en cours :\n${ouvertes.slice(0, 6).map((t) => `• ${nom(t.agent_id)} — ${t.titre}`).join("\n")}` : "🔧 Aucune tâche en cours.",
          `🛂 ${attente.length} demande(s) en Douane${attente.length ? " (écris *douane*)" : ""}.`,
          `🤖 IA aujourd'hui : ${eur(depense)} sur ${eur(settings.budget_jour)}.`,
        ].join("\n\n"),
      );
    } else if (c.type === "douane") {
      const attente = await db.pendingApprovals();
      const app = process.env.APP_URL?.replace(/\/$/, "");
      await repondre(m.de, attente.length ? `🛂 *En Douane* (${attente.length}) :\n${attente.slice(0, 8).map((a) => `• ${a.titre}`).join("\n")}${app ? `\n\nValider : ${app}/douane` : ""}` : "🛂 Rien n'attend ta validation. 👌");
    } else {
      const cible = c.cible ?? "marius";
      const { error } = await admin.from("missions").insert({ demandeur: email, texte: c.texte.slice(0, 4000), cible, statut: "nouvelle", whatsapp: m.de, whatsapp_msg_id: m.id });
      // doublon (Meta renvoie parfois la même notification) : déjà pris en compte, on ne répond pas deux fois
      if (error) {
        if (!/duplicate|unique/i.test(error.message)) await repondre(m.de, `⚠️ Mission non enregistrée : ${error.message}`);
        continue;
      }
      const agent = team.find((a) => a.id === cible);
      await admin.from("journal").insert({ type: "mission", titre: `📱 Mission reçue par WhatsApp (${email.split("@")[0]})`, contenu: c.texte.slice(0, 2000), agent_id: cible });
      await repondre(m.de, `⚓ Mission reçue ! ${agent?.nom ?? "Marius"} s'en occupe${cible === "marius" ? " et organise l'équipe" : ""}. Je te renvoie le résultat ici dès que c'est fini.`);
    }
  }
  return new Response("ok");
}
