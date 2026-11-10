import "server-only";
import { supabaseFinanceDb, type FinanceDb } from "./db";
import { engineServices } from "@/integrations/server";
import type { Services } from "@/integrations/types";
import { identify } from "@/lib/supabase/guard";
import { adminSupabase } from "@/lib/supabase/server";

/** Contexte des routes finance : fondateur connecté + accès serveur (numérotation, coffre des PDF, Gmail). */
export async function financeCtx(request: Request): Promise<{ ok: true; email: string; f: FinanceDb; services: Services } | { ok: false; res: Response }> {
  const caller = await identify(request);
  if (caller?.kind !== "fondateur") return { ok: false, res: Response.json({ error: "Non autorisé" }, { status: 401 }) };
  const admin = adminSupabase();
  if (!admin) return { ok: false, res: Response.json({ error: "Serveur non configuré (SUPABASE_SERVICE_ROLE_KEY)." }, { status: 503 }) };
  return { ok: true, email: caller.email, f: supabaseFinanceDb(admin), services: await engineServices(admin) };
}

export const erreur = (e: unknown, status = 400) => Response.json({ error: e instanceof Error ? e.message : String(e) }, { status });
