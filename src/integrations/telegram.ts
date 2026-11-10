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

export const tgConfigure = () => !!process.env.TELEGRAM_BOT_TOKEN;

/** Secret envoyé par Telegram dans l'en-tête X-Telegram-Bot-Api-Secret-Token (dérivé du jeton du bot). */
export function secretWebhook(token = process.env.TELEGRAM_BOT_TOKEN ?? ""): string {
  return createHash("sha256").update(`leport-webhook:${token}`).digest("hex").slice(0, 48);
}

export function secretValide(entete: string | null, token = process.env.TELEGRAM_BOT_TOKEN): boolean {
  if (!token || !entete) return false;
  const a = Buffer.from(secretWebhook(token));
  const b = Buffer.from(entete);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function api<T>(methode: string, corps: Record<string, unknown>): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Telegram n'est pas configuré (TELEGRAM_BOT_TOKEN).");
  const res = await fetch(`https://api.telegram.org/bot${token}/${methode}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
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
