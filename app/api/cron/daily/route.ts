import { NextResponse } from "next/server";
import { runTick } from "@/engine/run";
import { identify } from "@/lib/supabase/guard";

/**
 * Filet de sécurité quotidien (Vercel Cron, cf. vercel.json) au cas où pg_cron serait arrêté.
 * Phase 5 : déclenchera aussi les routines du jour.
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const caller = await identify(request);
  if (caller?.kind !== "cron") return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const r = await runTick();
  return r.ok ? NextResponse.json(r.report) : NextResponse.json({ error: r.error }, { status: r.status });
}
