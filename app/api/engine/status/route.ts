import { NextResponse } from "next/server";
import { identify } from "@/lib/supabase/guard";
import { adminSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Pilote automatique : dernier passage déclenché par la base (pg_cron). */
export async function GET(request: Request) {
  const caller = await identify(request);
  if (caller?.kind !== "fondateur") return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const admin = adminSupabase();
  if (!admin) return NextResponse.json({ pilote: null });
  const { data } = await admin.from("engine_kv").select("valeur").eq("cle", "pilote.dernier").maybeSingle();
  return NextResponse.json({ pilote: (data?.valeur as { at: string; erreurs?: string[] } | null) ?? null });
}
