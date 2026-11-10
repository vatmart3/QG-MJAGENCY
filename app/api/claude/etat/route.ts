import { CLE_CLAUDE, CLAUDE_VIVANT_MS } from "@/engine/cerveau";
import { supabaseEngineDb } from "@/engine/db";
import { identify } from "@/lib/supabase/guard";
import { adminSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** État du cerveau pour Réglages : mode, dernier passage de Claude Code, tâches en attente. */
export async function GET(request: Request) {
  const caller = await identify(request);
  if (caller?.kind !== "fondateur") return Response.json({ error: "Non autorisé" }, { status: 401 });
  const admin = adminSupabase();
  if (!admin) return Response.json({ error: "Serveur non configuré" }, { status: 503 });
  const db = supabaseEngineDb(admin);
  const [mode, k, attente] = await Promise.all([db.modeIa(), db.kvGet<{ le?: string }>(CLE_CLAUDE), db.tachesClaudeEnAttente()]);
  const le = k?.le ?? null;
  return Response.json({
    mode,
    secret: (process.env.CLAUDE_WORKER_SECRET?.trim().length ?? 0) >= 24,
    dernierPassage: le,
    vivant: !!le && Date.now() - new Date(le).getTime() < CLAUDE_VIVANT_MS,
    attente,
    adresse: `${(process.env.APP_URL ?? new URL(request.url).origin).replace(/\/$/, "")}/api/claude`,
  });
}
