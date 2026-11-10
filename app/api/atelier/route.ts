import { commercialCtx } from "@/commercial/server";
import { auditUrl } from "@/tech/audit";
import { normUrl } from "@/tech/db";
import { controlerSite } from "@/tech/surveillance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Atelier Tech (sans IA) : ajouter / retirer un site suivi, le contrôler maintenant, l'auditer. */
export async function POST(request: Request) {
  const c = await commercialCtx(request);
  if (!c.ok) return c.res;
  try {
    const b = (await request.json()) as { action: "ajouter" | "controler" | "audit" | "pause" | "retirer"; id?: string; nom?: string; url?: string; client_id?: string | null; actif?: boolean };
    const now = new Date();
    if (b.action === "ajouter") {
      const url = b.url ? normUrl(b.url) : null;
      if (!url || !/^https?:\/\/[^/]+\.[a-z]{2,}/i.test(url)) return Response.json({ error: "Adresse invalide (ex. monsite.fr)." }, { status: 400 });
      const s = await c.db.tech.insertSite({ nom: (b.nom?.trim() || new URL(url).hostname.replace(/^www\./, "")).slice(0, 200), url, client_id: b.client_id ?? null });
      if (!s) return Response.json({ error: "Ce site est déjà suivi." }, { status: 409 });
      await controlerSite(c.db, s, now, true);
      return Response.json({ ok: true, id: s.id });
    }
    if (b.action === "audit" && b.url && !b.id) return Response.json({ ok: true, audit: await auditUrl(b.url, now) });
    const [s] = b.id ? await c.db.tech.findSites(b.id) : [];
    if (!s) return Response.json({ error: "Site introuvable." }, { status: 404 });
    if (b.action === "controler") {
      await controlerSite(c.db, s, now, true);
      return Response.json({ ok: true });
    }
    if (b.action === "audit") {
      const a = await auditUrl(s.url, now);
      if (!a.erreur) await c.db.tech.updateSite(s.id, { audit: a, audit_le: a.le });
      return Response.json({ ok: true, audit: a });
    }
    if (b.action === "pause") {
      await c.db.tech.updateSite(s.id, { actif: !!b.actif });
      return Response.json({ ok: true });
    }
    if (b.action === "retirer") {
      await c.db.tech.deleteSite(s.id);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Action inconnue." }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
