import { NextResponse } from "next/server";
import { hasGoogleOAuth } from "@/integrations/google";
import { AGENCY, googleIntegration } from "@/integrations/server";
import { hasEncryptionKey } from "@/lib/crypto";
import { identify } from "@/lib/supabase/guard";
import { adminSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** État de la connexion Google (jamais les jetons). */
export async function GET(request: Request) {
  const caller = await identify(request);
  if (caller?.kind !== "fondateur") return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const origin = process.env.APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  const admin = adminSupabase();
  const row = admin ? await googleIntegration(admin) : null;
  return NextResponse.json({
    configure: { client: hasGoogleOAuth(), cle: hasEncryptionKey(), serveur: !!admin },
    attendu: AGENCY,
    redirectUri: `${origin}/api/integrations/google/callback`,
    connexion: row ? { compte: row.compte, statut: row.statut, erreur: row.erreur, scopes: row.scopes, par: row.connecte_par, le: row.maj_le } : null,
  });
}
