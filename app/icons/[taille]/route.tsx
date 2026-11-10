import { icone } from "@/lib/icone";

const TAILLES = new Set([96, 192, 512]);

/** /icons/192, /icons/512 (et /icons/512?maskable pour Android). */
export async function GET(request: Request, { params }: { params: Promise<{ taille: string }> }) {
  const n = Number((await params).taille);
  if (!TAILLES.has(n)) return new Response("Taille inconnue", { status: 404 });
  const maskable = new URL(request.url).searchParams.has("maskable");
  const res = icone(n, maskable ? 0.2 : 0.08, !maskable);
  res.headers.set("Cache-Control", "public, max-age=604800, immutable");
  return res;
}
