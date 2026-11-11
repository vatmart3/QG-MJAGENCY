import { identify } from "@/lib/supabase/guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const caller = await identify(request);
  if (caller?.kind !== "fondateur") return Response.json({ error: "Non autorisé" }, { status: 401 });
  const ia = !!process.env.ANTHROPIC_API_KEY && process.env.MOCK_MODE !== "true";
  return Response.json({ places: true, source: process.env.GOOGLE_PLACES_API_KEY ? "google" : ia ? "web" : "osm" });
}
