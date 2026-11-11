import { supabaseEngineDb } from "@/engine/db";
import { jetonValide } from "@/commercial/pilote";
import { adminSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const page = (titre: string, texte: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titre}</title><meta name="robots" content="noindex"></head><body style="font-family:system-ui,sans-serif;background:#f6f3ee;color:#2a2140;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center"><div style="max-width:440px"><div style="font-size:42px">⚓</div><h1 style="font-size:22px">${titre}</h1><p style="line-height:1.5">${texte}</p><p style="font-size:13px;color:#6b6480">MJAGENCY — agence web à Sète</p></div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );

/** Lien de désinscription des mails de prospection (public, protégé par un jeton propre à chaque adresse). */
export async function GET(request: Request) {
  const u = new URL(request.url);
  const e = (u.searchParams.get("e") ?? "").trim().toLowerCase();
  const t = u.searchParams.get("t") ?? "";
  if (!e || !t || !jetonValide(e, t)) return page("Lien invalide", "Ce lien de désinscription n'est pas valable. Répondez simplement « STOP » à notre message : nous ne vous écrirons plus.", 400);
  const admin = adminSupabase();
  if (admin) {
    const db = supabaseEngineDb(admin);
    await db.commercial.desinscrire(e, "lien de désinscription");
    const lead = await db.commercial.leadParEmail(e);
    if (lead) await db.commercial.updateLead(lead.id, { statut: "ecarte" });
    await db.insertJournal({ type: "action", titre: `🚫 ${lead?.nom ?? e} s'est désinscrit de la prospection`, agent_id: "sacha", pole_id: "prospection" });
  }
  return page("C'est noté", "Vous ne recevrez plus de messages de notre part. Désolés pour le dérangement, et belle journée !");
}
