import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Protège LE PORT quand Supabase est configuré : sans session → /login.
 * En mode démo (pas de variables Supabase), tout reste ouvert.
 * L'allowlist est vérifiée à l'envoi du lien magique et par la RLS de chaque table.
 */

// /api/engine et /api/cron vérifient eux-mêmes CRON_SECRET ou la session
const PUBLIC = ["/login", "/auth/", "/api/auth/", "/api/engine/", "/api/cron/"];

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  // rafraîchit la session (ne pas retirer : getUser() valide le jeton côté Supabase)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(p));

  if (!user && !isPublic) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Non connecté" }, { status: 401 });
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    to.search = "";
    return NextResponse.redirect(to);
  }
  if (user && path === "/login") {
    const to = request.nextUrl.clone();
    to.pathname = "/";
    to.search = "";
    return NextResponse.redirect(to);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|.*\\.(?:png|jpg|svg|webp|ico|txt|woff2?)$).*)"],
};
