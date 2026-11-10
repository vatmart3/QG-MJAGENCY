import { identify } from "@/lib/supabase/guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const caller = await identify(request);
  if (caller?.kind !== "fondateur") return Response.json({ error: "Non autorisé" }, { status: 401 });
  return Response.json({ places: !!process.env.GOOGLE_PLACES_API_KEY });
}
