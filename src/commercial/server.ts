import "server-only";
import { supabaseEngineDb, type EngineDb } from "@/engine/db";
import { engineServices } from "@/integrations/server";
import type { Services } from "@/integrations/types";
import { identify } from "@/lib/supabase/guard";
import { adminSupabase } from "@/lib/supabase/server";

export async function commercialCtx(request: Request): Promise<{ ok: true; email: string; db: EngineDb; services: Services } | { ok: false; res: Response }> {
  const caller = await identify(request);
  if (caller?.kind !== "fondateur") return { ok: false, res: Response.json({ error: "Non autorisé" }, { status: 401 }) };
  const admin = adminSupabase();
  if (!admin) return { ok: false, res: Response.json({ error: "Serveur non configuré (SUPABASE_SERVICE_ROLE_KEY)." }, { status: 503 }) };
  return { ok: true, email: caller.email, db: supabaseEngineDb(admin), services: await engineServices(admin) };
}
