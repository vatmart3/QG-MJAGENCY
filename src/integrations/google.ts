import { adresse, type CalEvent, type Calendar, type MailFull, type MailSummary, type Mailbox, type NewEvent, type OutgoingMail } from "./types";

/**
 * Gmail + Google Agenda par l'API REST (fetch, sans SDK). Compte : la boîte officielle de l'agence.
 * Scopes : gmail.modify, gmail.send, calendar.events (+ openid email pour identifier le compte).
 */

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
];

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CAL = "https://www.googleapis.com/calendar/v3";

export const hasGoogleOAuth = (): boolean => !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

export function googleAuthUrl(state: string, redirectUri: string, loginHint?: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  if (loginHint) p.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  id_token?: string;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const data = (await res.json()) as GoogleTokens & { error?: string; error_description?: string };
  if (!res.ok) throw new Error(`Google a refusé la connexion : ${data.error_description ?? data.error ?? res.status}`);
  return data;
}

export async function userEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = (await res.json()) as { email?: string };
  if (!res.ok || !data.email) throw new Error("Impossible de lire l'adresse du compte Google.");
  return data.email.toLowerCase();
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => undefined);
}

export class GoogleAuthError extends Error {}

/** Accès authentifié (rafraîchit le jeton d'accès à partir du refresh token). */
export class GoogleClient {
  private access: { token: string; until: number } | null = null;
  constructor(
    readonly compte: string,
    private refreshToken: string,
  ) {}

  private async token(): Promise<string> {
    if (this.access && this.access.until > Date.now() + 30_000) return this.access.token;
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", refresh_token: this.refreshToken, grant_type: "refresh_token" }),
    });
    const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !data.access_token) {
      const msg = data.error === "invalid_grant" ? "L'accès Google a été retiré ou a expiré : reconnecte Google dans Réglages." : `Google : ${data.error_description ?? data.error ?? res.status}`;
      throw new GoogleAuthError(msg);
    }
    this.access = { token: data.access_token, until: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return data.access_token;
  }

  async api<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(`Google ${res.status} : ${data.error?.message ?? "erreur"}`);
    return data;
  }
}

// ------------------------------------------------------------------ Gmail
interface GPart {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GPart[];
  headers?: { name: string; value: string }[];
}
interface GMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GPart;
}

const b64urlDecode = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const header = (m: GMessage, name: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value ?? "";

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function bodyText(p: GPart | undefined): string {
  if (!p) return "";
  const find = (part: GPart, type: string): string | null => {
    if (part.mimeType === type && part.body?.data) return b64urlDecode(part.body.data);
    for (const c of part.parts ?? []) {
      const r = find(c, type);
      if (r) return r;
    }
    return null;
  };
  const plain = find(p, "text/plain");
  if (plain) return plain.trim();
  const html = find(p, "text/html");
  return html ? htmlToText(html) : "";
}

const summary = (m: GMessage): MailSummary => ({
  id: m.id,
  threadId: m.threadId,
  de: header(m, "From"),
  a: header(m, "To"),
  objet: header(m, "Subject") || "(sans objet)",
  date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : new Date().toISOString(),
  extrait: (m.snippet ?? "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").slice(0, 240),
  nonLu: !!m.labelIds?.includes("UNREAD"),
});

/** En-tête encodé (RFC 2047) pour les accents de l'objet. */
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

const b64body = (s: string) => Buffer.from(s.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");

export function buildRaw(from: string, m: OutgoingMail): string {
  const lines = [`From: MJAGENCY <${from}>`, `To: ${m.a}`, `Subject: ${encodeHeader(m.objet)}`, "MIME-Version: 1.0"];
  if (m.inReplyTo) lines.push(`In-Reply-To: ${m.inReplyTo}`, `References: ${[m.references, m.inReplyTo].filter(Boolean).join(" ")}`);
  if (!m.html) {
    lines.push("Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64");
    return b64url(`${lines.join("\r\n")}\r\n\r\n${b64body(m.corps)}`);
  }
  const boundary = `leport_${Date.now().toString(36)}`;
  lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const part = (type: string, content: string) => `--${boundary}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64body(content)}`;
  return b64url(`${lines.join("\r\n")}\r\n\r\n${part("text/plain", m.corps)}\r\n${part("text/html", m.html)}\r\n--${boundary}--`);
}

export function gmailMailbox(g: GoogleClient): Mailbox {
  const labelIds = new Map<string, string>();
  const ensureLabel = async (name: string): Promise<string> => {
    if (labelIds.has(name)) return labelIds.get(name)!;
    const list = await g.api<{ labels?: { id: string; name: string }[] }>(`${GMAIL}/labels`);
    for (const l of list.labels ?? []) labelIds.set(l.name, l.id);
    if (labelIds.has(name)) return labelIds.get(name)!;
    const created = await g.api<{ id: string }>(`${GMAIL}/labels`, { method: "POST", body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }) });
    labelIds.set(name, created.id);
    return created.id;
  };
  const get = (id: string, format: "metadata" | "full") =>
    g.api<GMessage>(`${GMAIL}/messages/${encodeURIComponent(id)}?format=${format}${format === "metadata" ? "&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date" : ""}`);

  const mb: Mailbox = {
    kind: "gmail",
    compte: g.compte,
    async list(q, max) {
      const r = await g.api<{ messages?: { id: string }[] }>(`${GMAIL}/messages?maxResults=${Math.min(50, max)}&q=${encodeURIComponent(q)}`);
      const msgs = await Promise.all((r.messages ?? []).map((m) => get(m.id, "metadata")));
      return msgs.map(summary);
    },
    async read(id) {
      try {
        const m = await get(id, "full");
        const full: MailFull = { ...summary(m), corps: bodyText(m.payload).slice(0, 20_000), cc: header(m, "Cc") || undefined, messageIdHeader: header(m, "Message-ID") || undefined, references: header(m, "References") || undefined };
        return full;
      } catch {
        return null;
      }
    },
    async draft(m) {
      const d = await g.api<{ id: string }>(`${GMAIL}/drafts`, { method: "POST", body: JSON.stringify({ message: { raw: buildRaw(g.compte, m), ...(m.threadId ? { threadId: m.threadId } : {}) } }) });
      return { id: d.id };
    },
    async send(m) {
      const s = await g.api<{ id: string; threadId: string }>(`${GMAIL}/messages/send`, { method: "POST", body: JSON.stringify({ raw: buildRaw(g.compte, m), ...(m.threadId ? { threadId: m.threadId } : {}) }) });
      return s;
    },
    async label(id, labels, opts) {
      const add = await Promise.all(labels.map(ensureLabel));
      await g.api(`${GMAIL}/messages/${encodeURIComponent(id)}/modify`, { method: "POST", body: JSON.stringify({ addLabelIds: add, removeLabelIds: opts?.markRead ? ["UNREAD"] : [] }) });
    },
    async sentWithoutReply(days, max) {
      const r = await g.api<{ messages?: { id: string; threadId: string }[] }>(`${GMAIL}/messages?maxResults=30&q=${encodeURIComponent(`in:sent older_than:${days}d newer_than:30d`)}`);
      const seen = new Set<string>();
      const out: MailSummary[] = [];
      for (const m of r.messages ?? []) {
        if (seen.has(m.threadId) || out.length >= max) continue;
        seen.add(m.threadId);
        const t = await g.api<{ messages?: GMessage[] }>(`${GMAIL}/threads/${m.threadId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`);
        const last = t.messages?.[t.messages.length - 1];
        if (!last) continue;
        // sans réponse : le dernier message du fil vient de nous
        if (adresse(header(last, "From")) === g.compte.toLowerCase()) out.push(summary(last));
      }
      return out;
    },
    async hasExchangedWith(addr) {
      const r = await g.api<{ resultSizeEstimate?: number; messages?: unknown[] }>(`${GMAIL}/messages?maxResults=1&q=${encodeURIComponent(`from:${addr} OR to:${addr}`)}`);
      return (r.messages?.length ?? 0) > 0;
    },
  };
  return mb;
}

// ------------------------------------------------------------------ Agenda
interface GEvent {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  description?: string;
  attendees?: { email: string }[];
  htmlLink?: string;
}

export function googleCalendar(g: GoogleClient): Calendar {
  const toEvent = (e: GEvent): CalEvent => ({
    id: e.id,
    titre: e.summary ?? "(sans titre)",
    debut: e.start?.dateTime ?? `${e.start?.date}T00:00:00`,
    fin: e.end?.dateTime ?? `${e.end?.date}T00:00:00`,
    lieu: e.location,
    description: e.description?.slice(0, 500),
    invites: (e.attendees ?? []).map((a) => a.email),
  });
  return {
    kind: "google",
    compte: g.compte,
    async list(fromIso, toIso) {
      const p = new URLSearchParams({ timeMin: fromIso, timeMax: toIso, singleEvents: "true", orderBy: "startTime", maxResults: "100", timeZone: "Europe/Paris" });
      const r = await g.api<{ items?: GEvent[] }>(`${CAL}/calendars/primary/events?${p}`);
      return (r.items ?? []).map(toEvent);
    },
    async busy(fromIso, toIso) {
      const r = await g.api<{ calendars?: Record<string, { busy?: { start: string; end: string }[] }> }>(`${CAL}/freeBusy`, {
        method: "POST",
        body: JSON.stringify({ timeMin: fromIso, timeMax: toIso, timeZone: "Europe/Paris", items: [{ id: "primary" }] }),
      });
      return (r.calendars?.primary?.busy ?? []).map((b) => ({ debut: b.start, fin: b.end }));
    },
    async create(e: NewEvent) {
      const r = await g.api<GEvent>(`${CAL}/calendars/primary/events?sendUpdates=${e.invites?.length ? "all" : "none"}`, {
        method: "POST",
        body: JSON.stringify({
          summary: e.titre,
          location: e.lieu,
          description: e.description,
          start: { dateTime: e.debut, timeZone: "Europe/Paris" },
          end: { dateTime: e.fin, timeZone: "Europe/Paris" },
          attendees: (e.invites ?? []).map((email) => ({ email })),
        }),
      });
      return { id: r.id, lien: r.htmlLink };
    },
  };
}
