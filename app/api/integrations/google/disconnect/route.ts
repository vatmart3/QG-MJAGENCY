import { NextResponse } from "next/server";
import { revokeToken } from "@/integrations/google";
import { googleIntegration, refreshTokenOf } from "@/integrations/server";
import { identify } from "@/lib/supabase/guard";
import { adminSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Déconnecte Google : révoque l'accès chez Google et efface les jetons. */
export async function POST(request: Request) {
  const caller = await identify(request);
  if (caller?.kind !== "fondateur") return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const admin = adminSupabase();
  if (!admin) return NextResponse.json({ error: "Serveur non configuré" }, { status: 503 });
  const row = await googleIntegration(admin);
  if (row) {
    try {
      await revokeToken(refreshTokenOf(row));
    } catch {
      // jeton illisible : on efface quand même
    }
    await admin.from("integrations").delete().eq("id", row.id);
    await admin.from("journal").insert({ type: "decision", titre: `🔌 Google déconnecté : ${row.compte}`, contenu: `Par ${caller.email}. Les agents repassent sur la boîte de démonstration.` });
  }
  return NextResponse.json({ ok: true });
}
