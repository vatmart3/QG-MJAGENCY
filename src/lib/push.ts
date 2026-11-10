import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";

/**
 * Notifications push (Web Push, clés VAPID). Clés à créer dans Réglages → Connexions → Téléphone, puis à mettre
 * dans Vercel : NEXT_PUBLIC_VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY.
 */

export interface Notif {
  titre: string;
  corps: string;
  url: string;
  tag?: string;
}

export const pushConfigure = () => !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;

/** Envoie à tous les appareils abonnés ; retire ceux qui n'existent plus. Renvoie le nombre d'envois réussis. */
export async function envoyerPush(admin: SupabaseClient, n: Notif, email?: string): Promise<number> {
  if (!pushConfigure()) return 0;
  // (le niveau « tout » / « important » est appliqué par le moteur avant l'envoi)
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:mjagency.officiel@gmail.com", process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  let q = admin.from("push_subscriptions").select("endpoint, p256dh, auth");
  if (email) q = q.eq("email", email);
  const { data } = await q;
  let ok = 0;
  await Promise.all(
    ((data ?? []) as { endpoint: string; p256dh: string; auth: string }[]).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(n), { TTL: 6 * 3600, urgency: "normal", topic: n.tag?.slice(0, 32) });
        ok++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      }
    }),
  );
  return ok;
}
