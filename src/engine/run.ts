import "server-only";
import { engineServices } from "@/integrations/server";
import { adminSupabase } from "@/lib/supabase/server";
import { supabaseEngineDb } from "./db";
import { llmFromEnv } from "./llm";
import { tick, type TickReport } from "./tick";

/** Lance un tick du moteur sur la base Supabase (clé service_role requise). */
export async function runTick(source: "cron" | "fondateur" = "fondateur"): Promise<{ ok: true; report: TickReport } | { ok: false; status: number; error: string }> {
  const admin = adminSupabase();
  if (!admin) return { ok: false, status: 503, error: "Moteur indisponible : SUPABASE_SERVICE_ROLE_KEY n'est pas configurée." };
  const db = supabaseEngineDb(admin);
  const report = await tick(db, llmFromEnv(), { services: await engineServices(admin) });
  if (source === "cron") await db.kvSet("pilote.dernier", { at: new Date().toISOString(), erreurs: report.erreurs.slice(0, 3) }).catch(() => undefined);
  return { ok: true, report };
}
