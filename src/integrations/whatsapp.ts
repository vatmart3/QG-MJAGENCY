import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WhatsApp Business (API Cloud de Meta) : les fondateurs envoient une mission par message, LE PORT répond
 * et renvoie le résultat quand la mission est terminée. Variables (Vercel) :
 *  WHATSAPP_TOKEN (jeton permanent d'un utilisateur système), WHATSAPP_PHONE_NUMBER_ID,
 *  WHATSAPP_APP_SECRET (clé secrète de l'application Meta, vérifie que les messages viennent bien de Meta),
 *  WHATSAPP_VERIFY_TOKEN (mot de passe choisi par toi, demandé une fois par Meta pour valider l'adresse du webhook).
 */

const VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";

export const waConfigure = () => !!process.env.WHATSAPP_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID && !!process.env.WHATSAPP_APP_SECRET && !!process.env.WHATSAPP_VERIFY_TOKEN;

/** Numéro au format WhatsApp : chiffres seuls, indicatif pays (06 12… → 33612…). */
export function normNumero(n: string): string {
  const d = n.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d.slice(1);
  if (d.startsWith("00")) return d.slice(2);
  if (/^0[1-9]\d{8}$/.test(d)) return `33${d.slice(1)}`;
  return d;
}

/** Vérifie l'en-tête X-Hub-Signature-256 (HMAC SHA-256 du corps brut avec la clé secrète de l'application). */
export function signatureValide(corps: string, entete: string | null, secret = process.env.WHATSAPP_APP_SECRET): boolean {
  if (!secret || !entete?.startsWith("sha256=")) return false;
  const attendu = Buffer.from(createHmac("sha256", secret).update(corps, "utf8").digest("hex"));
  const recu = Buffer.from(entete.slice(7));
  return attendu.length === recu.length && timingSafeEqual(attendu, recu);
}

/** Envoie un message texte (dans les 24 h qui suivent le dernier message du fondateur, règle de WhatsApp). */
export async function envoyerWhatsApp(a: string, texte: string): Promise<void> {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) throw new Error("WhatsApp n'est pas configuré.");
  const res = await fetch(`https://graph.facebook.com/${VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: a, type: "text", text: { preview_url: true, body: texte.slice(0, 4000) } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } };
    throw new Error(`WhatsApp ${res.status}${j.error?.code ? ` (${j.error.code})` : ""} : ${j.error?.message ?? "erreur"}`);
  }
}

export interface MessageEntrant {
  id: string;
  de: string;
  type: string;
  texte: string | null;
}

/** Extrait les messages reçus d'une notification de Meta (les accusés de lecture sont ignorés). */
export function messagesEntrants(payload: unknown): MessageEntrant[] {
  const out: MessageEntrant[] = [];
  const p = payload as { entry?: { changes?: { field?: string; value?: { messages?: { id: string; from: string; type: string; text?: { body?: string } }[] } }[] }[] };
  for (const e of p.entry ?? [])
    for (const c of e.changes ?? [])
      for (const m of c.value?.messages ?? []) if (m?.id && m.from) out.push({ id: m.id, de: normNumero(m.from), type: m.type, texte: m.text?.body?.trim() || null });
  return out;
}

export type Commande = { type: "aide" } | { type: "point" } | { type: "douane" } | { type: "mission"; texte: string; cible: string | null };

const sansAccents = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * Comprend un message : « aide », « point », « douane », ou une mission (pour Marius par défaut ;
 * « @victor … » ou « Victor : … » pour un agent précis). `agents` : identifiant + prénom.
 */
export function interpreter(texte: string, agents: { id: string; nom: string }[]): Commande {
  const t = texte.trim();
  const n = sansAccents(t).replace(/[!.?]+$/, "").trim();
  if (/^(aide|help|\?|menu|commandes?)$/.test(n)) return { type: "aide" };
  if (/^(point|etat|statut|status|ca va le port|le point)$/.test(n)) return { type: "point" };
  if (/^(douane|a valider|validations?)$/.test(n)) return { type: "douane" };
  const m = t.match(/^@?([\p{L}-]{2,20})\s*[:,]\s*([\s\S]+)$/u) ?? t.match(/^@([\p{L}-]{2,20})\s+([\s\S]+)$/u);
  if (m) {
    const ref = sansAccents(m[1]!);
    const a = agents.find((x) => x.id === ref || sansAccents(x.nom) === ref);
    if (a) return { type: "mission", texte: m[2]!.trim(), cible: a.id };
  }
  return { type: "mission", texte: t, cible: null };
}

export const AIDE_WHATSAPP = [
  "⚓ *LE PORT* — ce que tu peux m'écrire :",
  "• Une mission, tout simplement : « Prépare une offre pour les restaurants de Sète » → Marius organise l'équipe.",
  "• Pour un agent précis : « @victor devis site vitrine pour La Marée » ou « Victor : … ».",
  "• *point* → ce qui tourne au port en ce moment.",
  "• *douane* → ce qui attend ta validation.",
  "• *aide* → ce message.",
  "Je te renvoie le résultat ici quand la mission est terminée.",
].join("\n");
