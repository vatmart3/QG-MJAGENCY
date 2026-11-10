import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { googleAuthUrl, hasGoogleOAuth } from "@/integrations/google";
import { AGENCY } from "@/integrations/server";
import { hasEncryptionKey } from "@/lib/crypto";
import { identify } from "@/lib/supabase/guard";

export const dynamic = "force-dynamic";

const appOrigin = (request: Request) => process.env.APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;

/** « Connecter Google » (Réglages) : redirige vers l'écran de consentement Google. */
export async function GET(request: Request) {
  const origin = appOrigin(request);
  const caller = await identify(request);
  if (caller?.kind !== "fondateur") return NextResponse.redirect(`${origin}/login`);
  if (!hasGoogleOAuth() || !hasEncryptionKey()) return NextResponse.redirect(`${origin}/reglages?onglet=connexions&google=config`);
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(googleAuthUrl(state, `${origin}/api/integrations/google/callback`, AGENCY));
  res.cookies.set("lp_google_state", state, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", path: "/api/integrations/google", maxAge: 600 });
  return res;
}
