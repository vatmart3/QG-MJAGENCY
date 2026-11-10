import { randomInt } from "node:crypto";
import { botInfo, installerWebhook, lireTelegram, tgConfigure, webhookInfo } from "@/integrations/telegram";
import { identify } from "@/lib/supabase/guard";
import { adminSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function ctx(request: Request) {
  const caller = await identify(request);
  if (caller?.kind !== "fondateur") return { res: Response.json({ error: "Non autorisé" }, { status: 401 }) } as const;
  const admin = adminSupabase();
  if (!admin) return { res: Response.json({ error: "Serveur non configuré (SUPABASE_SERVICE_ROLE_KEY)." }, { status: 503 }) } as const;
  return { email: caller.email, admin } as const;
}

const adresseWebhook = (request: Request) => `${(process.env.APP_URL ?? new URL(request.url).origin).replace(/\/$/, "")}/api/telegram`;

/** État du bot : jeton présent, nom du bot, webhook installé, comptes reliés. */
export async function GET(request: Request) {
  const c = await ctx(request);
  if ("res" in c) return c.res;
  const { data } = await c.admin.from("settings").select("telegram").eq("id", 1).maybeSingle();
  const chats = Object.entries(lireTelegram(data?.telegram).chats).map(([id, v]) => ({ id, ...v }));
  if (!tgConfigure()) return Response.json({ configure: false, chats });
  try {
    const [bot, wh] = await Promise.all([botInfo(), webhookInfo()]);
    return Response.json({ configure: true, bot: bot.username, webhook: wh.url === adresseWebhook(request), erreur: wh.last_error_message ?? null, chats });
  } catch (e) {
    return Response.json({ configure: true, erreur: e instanceof Error ? e.message : String(e), chats });
  }
}

/** { action: "installer" } : branche le bot sur LE PORT ; { action: "lien" } : lien d'appairage (10 min) ; { action: "retirer", id }. */
export async function POST(request: Request) {
  const c = await ctx(request);
  if ("res" in c) return c.res;
  const b = (await request.json().catch(() => ({}))) as { action?: string; id?: string };
  try {
    if (b.action === "installer") {
      await installerWebhook(adresseWebhook(request));
      return Response.json({ ok: true });
    }
    const { data } = await c.admin.from("settings").select("telegram").eq("id", 1).maybeSingle();
    const tg = lireTelegram(data?.telegram);
    if (b.action === "retirer" && b.id) {
      delete tg.chats[b.id];
      await c.admin.from("settings").update({ telegram: tg }).eq("id", 1);
      return Response.json({ ok: true });
    }
    if (b.action === "lien") {
      const maintenant = Date.now();
      for (const [k, v] of Object.entries(tg.appairages)) if (new Date(v.expire).getTime() < maintenant) delete tg.appairages[k];
      const code = `P${randomInt(10 ** 9, 10 ** 10)}`;
      tg.appairages[code] = { email: c.email, expire: new Date(maintenant + 10 * 60_000).toISOString() };
      await c.admin.from("settings").update({ telegram: tg }).eq("id", 1);
      const bot = await botInfo();
      return Response.json({ ok: true, lien: `https://t.me/${bot.username}?start=${code}` });
    }
    return Response.json({ error: "Action inconnue." }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
