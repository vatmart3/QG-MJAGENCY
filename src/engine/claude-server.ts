import "server-only";
import { supabaseEngineDb, type EngineDb } from "./db";
import { autoriseClaude } from "./claude-worker";
import { engineServices } from "@/integrations/server";
import type { Services } from "@/integrations/types";
import { adminSupabase } from "@/lib/supabase/server";
import { llmFromEnv } from "./llm";

/** Contexte des routes appelées par Claude Code (Authorization: Bearer CLAUDE_WORKER_SECRET). */
export async function claudeCtx(request: Request): Promise<{ ok: true; db: EngineDb; services: Services; llm: ReturnType<typeof llmFromEnv> } | { ok: false; res: Response }> {
  if (!autoriseClaude(request.headers.get("authorization"))) return { ok: false, res: Response.json({ error: "Non autorisé" }, { status: 401 }) };
  const admin = adminSupabase();
  if (!admin) return { ok: false, res: Response.json({ error: "Serveur non configuré (SUPABASE_SERVICE_ROLE_KEY)." }, { status: 503 }) };
  return { ok: true, db: supabaseEngineDb(admin), services: await engineServices(admin), llm: llmFromEnv() };
}
