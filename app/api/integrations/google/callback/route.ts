import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, GOOGLE_SCOPES, userEmail } from "@/integrations/google";
import { AGENCY, saveGoogleIntegration } from "@/integrations/server";
import { identify } from "@/lib/supabase/guard";
import { adminSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const appOrigin = (request: Request) => process.env.APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;

/** Retour de Google : vérifie l'état anti-CSRF, échange le code, chiffre et enregistre le refresh token. */
export async function GET(request: NextRequest) {
  const origin = appOrigin(request);
  const back = (q: string) => {
    const res = NextResponse.redirect(`${origin}/reglages?onglet=connexions&${q}`);
    res.cookies.delete({ name: "lp_google_state", path: "/api/integrations/google" });
    return res;
  };
  const caller = await identify(request);
  if (caller?.kind !== "fondateur") return NextResponse.redirect(`${origin}/login`);
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return back("google=refuse");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const expected = request.cookies.get("lp_google_state")?.value ?? "";
  if (!code || !expected || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) return back("google=etat");
  const admin = adminSupabase();
  if (!admin) return back("google=config");
  try {
    const tokens = await exchangeCode(code, `${origin}/api/integrations/google/callback`);
    if (!tokens.refresh_token) return back("google=sans_refresh");
    const scopes = tokens.scope.split(" ");
    const manquants = GOOGLE_SCOPES.filter((s) => s.startsWith("https://") && !scopes.includes(s));
    if (manquants.length) return back("google=scopes");
    const compte = await userEmail(tokens.access_token);
    await saveGoogleIntegration(admin, { compte, refreshToken: tokens.refresh_token, scopes, par: caller.email });
    await admin.from("journal").insert({ type: "decision", titre: `🔌 Google connecté : ${compte}`, contenu: `Par ${caller.email}. Lucie peut trier la boîte, Noé et Firmin préparer les envois (via la Douane), Céleste gérer l'agenda.`, agent_id: "lucie" });
    return back(compte === AGENCY ? "google=ok" : `google=autre&compte=${encodeURIComponent(compte)}`);
  } catch (e) {
    return back(`google=erreur&detail=${encodeURIComponent(e instanceof Error ? e.message.slice(0, 200) : "erreur")}`);
  }
}
