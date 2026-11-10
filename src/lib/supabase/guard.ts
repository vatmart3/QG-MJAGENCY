import "server-only";
import { timingSafeEqual } from "node:crypto";
import { serverSupabase } from "./server";

/**
 * Qui appelle ? « cron » (Authorization: Bearer CRON_SECRET, envoyé par pg_cron/pg_net et Vercel Cron)
 * ou un fondateur connecté et présent dans l'allowlist.
 */
export type Caller = { kind: "cron" } | { kind: "fondateur"; email: string };

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function identify(request: Request): Promise<Caller | null> {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (secret && auth.startsWith("Bearer ") && sameSecret(auth.slice(7), secret)) return { kind: "cron" };
  try {
    const sb = await serverSupabase();
    const { data } = await sb.auth.getUser();
    if (!data.user?.email) return null;
    const allowed = await sb.rpc("is_allowed");
    return allowed.data === true ? { kind: "fondateur", email: data.user.email.toLowerCase() } : null;
  } catch {
    return null;
  }
}
