import "server-only";
import { timingSafeEqual } from "node:crypto";
import { adminSupabase, serverSupabase } from "./server";

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

/** jeton du pilote automatique (généré dans la base, lu via service_role), gardé 10 min en mémoire */
let pilote: { token: string; until: number } | null = null;
async function piloteToken(): Promise<string | null> {
  if (pilote && pilote.until > Date.now()) return pilote.token;
  const admin = adminSupabase();
  if (!admin) return null;
  const { data, error } = await admin.rpc("le_port_cron_token");
  if (error || typeof data !== "string" || data.length < 32) return null;
  pilote = { token: data, until: Date.now() + 10 * 60_000 };
  return data;
}

export async function identify(request: Request): Promise<Caller | null> {
  const fromDb = request.headers.get("x-le-port-cron");
  if (fromDb) {
    const tok = await piloteToken();
    if (tok && sameSecret(fromDb, tok)) return { kind: "cron" };
    return null;
  }
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
