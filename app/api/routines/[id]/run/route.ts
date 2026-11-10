import { NextResponse } from "next/server";
import { supabaseEngineDb } from "@/engine/db";
import { launchRoutine, ROUTINES_PLUS_TARD } from "@/engine/routines";
import { engineServices } from "@/integrations/server";
import { identify } from "@/lib/supabase/guard";
import { adminSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** « Lancer maintenant » : un fondateur demande une routine (récap, stand-up, point…) quand il en a besoin. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await identify(request);
  if (caller?.kind !== "fondateur") return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const { id } = await ctx.params;
  if (ROUTINES_PLUS_TARD[id]) return NextResponse.json({ error: `Cette routine arrive avec la phase ${ROUTINES_PLUS_TARD[id]}.` }, { status: 409 });
  const admin = adminSupabase();
  if (!admin) return NextResponse.json({ error: "Moteur indisponible : SUPABASE_SERVICE_ROLE_KEY manquante." }, { status: 503 });
  const db = supabaseEngineDb(admin);
  const r = await db.routine(id);
  if (!r) return NextResponse.json({ error: "Routine introuvable." }, { status: 404 });
  const ok = await launchRoutine(db, await engineServices(admin), await db.agents(), r, new Date(), caller.email);
  return NextResponse.json({ ok, message: ok ? "C'est parti : le compte rendu arrivera dans l'onglet Rapports." : "Rien à faire pour l'instant (déjà en cours, ou aucun nouveau mail)." });
}
