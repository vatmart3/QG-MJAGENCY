import { z } from "zod";
import { envoyerPush, pushConfigure } from "@/lib/push";
import { identify } from "@/lib/supabase/guard";
import { adminSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const abonnement = z.object({
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith("https://"), "https uniquement"),
  keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(4).max(100) }),
});

async function ctx(request: Request) {
  const caller = await identify(request);
  if (caller?.kind !== "fondateur") return { res: Response.json({ error: "Non autorisé" }, { status: 401 }) } as const;
  const admin = adminSupabase();
  if (!admin) return { res: Response.json({ error: "Serveur non configuré (SUPABASE_SERVICE_ROLE_KEY)." }, { status: 503 }) } as const;
  return { email: caller.email, admin } as const;
}

/** État : notifications configurées (clés VAPID) et clé publique pour l'abonnement du navigateur. */
export async function GET() {
  return Response.json({ configure: pushConfigure(), cle: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null });
}

/** Abonne l'appareil du fondateur ({ abonnement }) ou envoie une notification d'essai ({ essai: true }). */
export async function POST(request: Request) {
  const c = await ctx(request);
  if ("res" in c) return c.res;
  const body = (await request.json().catch(() => ({}))) as { abonnement?: unknown; essai?: boolean };
  if (body.essai) {
    const n = await envoyerPush(c.admin, { titre: "⚓ LE PORT", corps: "Les notifications marchent : la Douane te préviendra ici.", url: "/douane", tag: "essai" }, c.email);
    return Response.json({ ok: n > 0, envoyes: n });
  }
  const p = abonnement.safeParse(body.abonnement);
  if (!p.success) return Response.json({ error: "Abonnement invalide." }, { status: 400 });
  const { error } = await c.admin.from("push_subscriptions").upsert({ endpoint: p.data.endpoint, p256dh: p.data.keys.p256dh, auth: p.data.keys.auth, email: c.email }, { onConflict: "endpoint" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

/** Désabonne cet appareil ({ endpoint }). */
export async function DELETE(request: Request) {
  const c = await ctx(request);
  if ("res" in c) return c.res;
  const { endpoint } = (await request.json().catch(() => ({}))) as { endpoint?: string };
  if (!endpoint) return Response.json({ error: "endpoint manquant" }, { status: 400 });
  await c.admin.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("email", c.email);
  return Response.json({ ok: true });
}
