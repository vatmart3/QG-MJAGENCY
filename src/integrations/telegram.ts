import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Bot Telegram de LE PORT (gratuit, sans compte entreprise) : missions envoyées depuis le téléphone et
 * notifications « quel agent fait quoi ». Une seule variable : TELEGRAM_BOT_TOKEN (donné par @BotFather).
 * Le secret du webhook en est dérivé : rien d'autre à configurer.
 */


export interface ChatTelegram {
  email: string;
  niveau: "tout" | "important";
}
export interface ReglagesTelegram {
  chats: Record<string, ChatTelegram>;
  appairages: Record<string, { email: string; expire: string }>;
}
export const lireTelegram = (v: unknown): ReglagesTelegram => {
  const o = (v && typeof v === "object" ? v : {}) as Partial<ReglagesTelegram>;
  return { chats: o.chats ?? {}, appairages: o.appairages ?? {} };
};

/**
 * Jeton du bot nettoyé des erreurs de copier-coller fréquentes : espaces et retours à la ligne, guillemets,
 * « bot » ajouté devant, adresse complète https://api.telegram.org/bot…/ collée à la place du jeton.
 */
export function nettoyerJeton(brut: string | undefined): string {
  let t = (brut ?? "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
  const dansUrl = t.match(/api\.telegram\.org\/bot([^/\s]+)/i);
  if (dansUrl) t = dansUrl[1]!;
  t = t.replace(/^bot(?=\d)/i, "").replace(/\s+/g, "");
  return t;
}

export const jetonBot = () => nettoyerJeton(process.env.TELEGRAM_BOT_TOKEN);

/** Diagnostic du jeton sans jamais l'afficher (forme attendue : 123456789:AAH…, environ 46 caractères). */
export function diagnosticJeton(t = jetonBot()): string | null {
  if (!t) return "TELEGRAM_BOT_TOKEN est vide dans Vercel.";
  if (/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(t)) return null;
  const morceaux = [`il fait ${t.length} caractères`, t.includes(":") ? "il contient bien « : »" : "il ne contient pas de « : »", /^\d/.test(t) ? "il commence par des chiffres" : "il ne commence pas par des chiffres"];
  return `Le jeton n'a pas la bonne forme (attendu : des chiffres, « : », puis environ 35 lettres — en tout ~46 caractères ; ${morceaux.join(", ")}). Recopie-le depuis @BotFather (/mybots → ton bot → API Token).`;
}

export const tgConfigure = () => !!jetonBot();

/** Secret envoyé par Telegram dans l'en-tête X-Telegram-Bot-Api-Secret-Token (dérivé du jeton du bot). */
export function secretWebhook(token = jetonBot()): string {
  return createHash("sha256").update(`leport-webhook:${token}`).digest("hex").slice(0, 48);
}

export function secretValide(entete: string | null, token = jetonBot()): boolean {
  if (!token || !entete) return false;
  const a = Buffer.from(secretWebhook(token));
  const b = Buffer.from(entete);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function api<T>(methode: string, corps: Record<string, unknown>): Promise<T> {
  const token = jetonBot();
  if (!token) throw new Error("Telegram n'est pas configuré (TELEGRAM_BOT_TOKEN).");
  const forme = diagnosticJeton(token);
  if (forme) throw new Error(forme);
  const res = await fetch(`https://api.telegram.org/bot${token}/${methode}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (res.status === 404 || res.status === 401)
    throw new Error("Telegram ne reconnaît pas ce jeton (« Not Found ») : il a été mal copié ou régénéré. Recopie-le depuis @BotFather (/mybots → ton bot → API Token), remplace TELEGRAM_BOT_TOKEN dans Vercel, puis Redeploy.");
  if (!j.ok) throw new Error(`Telegram : ${j.description ?? `HTTP ${res.status}`}`);
  return j.result as T;
}

/** Échappe le texte pour le mode HTML de Telegram. */
export const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Envoie un message (HTML simple : <b>, <i>). `silencieux` : arrive sans sonnerie. */
export async function envoyerTelegram(chat: string, texteHtml: string, silencieux = false): Promise<void> {
  await api("sendMessage", { chat_id: chat, text: texteHtml.slice(0, 4000), parse_mode: "HTML", disable_notification: silencieux, link_preview_options: { is_disabled: true } });
}

export const botInfo = () => api<{ username: string; first_name: string }>("getMe", {});
export const webhookInfo = () => api<{ url: string; last_error_message?: string; pending_update_count: number }>("getWebhookInfo", {});
export const installerWebhook = (url: string) => api<boolean>("setWebhook", { url, secret_token: secretWebhook(), allowed_updates: ["message"], drop_pending_updates: true });

export interface MessageTelegram {
  chat: string;
  id: string;
  texte: string | null;
  vocal: boolean;
  prenom: string | null;
}

export function messageTelegram(update: unknown): MessageTelegram | null {
  const u = update as { message?: { message_id: number; chat: { id: number; type: string }; from?: { first_name?: string }; text?: string; voice?: unknown; audio?: unknown } };
  const m = u.message;
  if (!m?.chat || m.chat.type !== "private") return null;
  return { chat: String(m.chat.id), id: `${m.chat.id}:${m.message_id}`, texte: m.text?.trim() || null, vocal: !!(m.voice || m.audio), prenom: m.from?.first_name ?? null };
}

export const AIDE_TELEGRAM = [
  "⚓ <b>LE PORT</b> — ce que tu peux m'écrire :",
  "• Une mission, tout simplement : « Prépare une offre pour les restaurants de Sète » → Marius organise l'équipe.",
  "• Pour un agent précis : « @victor devis site vitrine pour La Marée » ou « Victor : … ».",
  "• /point → ce qui tourne au port en ce moment.",
  "• /douane → ce qui attend ta validation.",
  "• /calme → seulement l'important · /tout → chaque action des agents.",
  "Je te renvoie le résultat ici quand la mission est terminée.",
].join("\n");
