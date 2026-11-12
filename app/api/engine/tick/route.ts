import { NextResponse } from "next/server";
import { runTick } from "@/engine/run";
import { identify } from "@/lib/supabase/guard";

// Un pas d'agent appelle le modèle : on laisse jusqu'à 60 s à la fonction (limite Vercel).
export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  const caller = await identify(request);
  if (!caller) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  try {
    const r = await runTick(caller.kind);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    // version en ligne (commit) : visible dans les réponses gardées par Supabase, pour vérifier une mise en ligne
    return NextResponse.json({ ...r.report, appelant: caller.kind, version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "locale" });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur du moteur" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
