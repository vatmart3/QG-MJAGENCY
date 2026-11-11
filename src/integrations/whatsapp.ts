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

export type Bavardage = "nuit" | "ca_va" | "salut" | "merci" | "bravo" | "ok";
export type Commande = { type: "aide" } | { type: "point" } | { type: "douane" } | { type: "bavardage"; genre: Bavardage; cible: string | null } | { type: "mission"; texte: string; cible: string | null };

const sansAccents = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * Petit message sans travail à faire (« bonne nuit », « ça va ? », « merci », « bravo », « ok », 👍) : on y répond
 * sans IA, donc gratuitement. Un message long ou qui demande quelque chose reste une mission.
 */
export function bavardage(texte: string): Bavardage | null {
  const n = sansAccents(texte).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, " ").replace(/[!.?,;:…'’-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return /\p{Extended_Pictographic}/u.test(texte) ? "ok" : null;
  if (texte.length > 70) return null;
  // une demande de travail n'est jamais du bavardage
  if (/\b(prepare|fais|fait|envoie|trouve|cherche|ecris|redige|analyse|cree|appelle|relance|calcule|verifie|regarde|peux tu|pourrais|il faut|j ai besoin|devis|facture|mail|offre|site|client|prospect|rdv|rendez)\b/.test(n)) return null;
  const qui = "(?: (?:a tous|a toi|a vous|tout le monde|la team|l equipe|les gars|les agents|la compagnie|marius|\\w+))?";
  if (new RegExp(`^(?:(?:allez |bon |ok |bref )?(?:bonne nuit|bn|a demain|a plus|a \\+|bisous|dors bien|dormez bien|bonne soiree|je vais dormir|je vais me coucher))${qui}(?: .{0,30})?$`).test(n)) return "nuit";
  if (/\b(ca va|ca roule|comment (?:ca )?va|comment vas|comment allez|vous allez bien|tu vas bien|quoi de neuf|la forme|ca dit quoi|bien ou quoi|tout va bien)\b/.test(n)) return "ca_va";
  if (/^(?:merci|thanks|thx|mercii+|merci beaucoup|merci bien|grand merci)\b/.test(n)) return "merci";
  if (/^(?:(?:trop |vraiment |c est )?(?:bravo|bien joue|top|super|genial|parfait|nickel|excellent|trop fort|incroyable|chapeau|felicitations|gg|magnifique|trop bien))\b/.test(n)) return "bravo";
  if (new RegExp(`^(?:salut|bonjour|bonsoir|coucou|hello|hey|yo|wesh|slt|cc|hi|bjr)${qui}$`).test(n)) return "salut";
  if (/^(?:ok|okay|oki|d accord|dac|ca marche|vu|recu|cool|parfait|tres bien|bien|oui|yes|ouais)$/.test(n)) return "ok";
  return null;
}

const auHasard = <T,>(l: T[]): T => l[Math.floor(Math.random() * l.length)]!;

/** Réponse à un petit message, sans IA : quelques phrases au choix, avec l'état du port quand ça a du sens. */
export function reponseBavardage(genre: Bavardage, o: { agent: string; prenom: string | null; enCours: number; douane: number; heure: number }): string {
  const p = o.prenom ? ` ${o.prenom}` : "";
  const port = o.enCours ? `${o.enCours} tâche${o.enCours > 1 ? "s" : ""} en cours` : "rien en cours pour l'instant";
  const douane = o.douane ? ` · ${o.douane} demande${o.douane > 1 ? "s" : ""} t'attend${o.douane > 1 ? "ent" : ""} en Douane (/douane)` : "";
  const moment = o.heure < 5 || o.heure >= 18 ? "Bonsoir" : "Bonjour";
  const r: Record<Bavardage, string[]> = {
    nuit: [
      `Bonne nuit${p} 🌙 On ne dort jamais au port : ${port}. Je te prépare le point pour demain matin.`,
      `Dors bien${p} ! L'équipe veille : ${port}. Rien ne part sans ton accord.`,
      `Bonne nuit${p} ⚓ Le phare reste allumé. ${port.charAt(0).toUpperCase() + port.slice(1)}.`,
    ],
    ca_va: [
      `Ça va très bien${p}, merci ! Au port : ${port}${douane}. Et toi ?`,
      `Tout roule${p} ⚓ ${port.charAt(0).toUpperCase() + port.slice(1)}${douane}.`,
      `La forme ! L'équipe est au complet : ${port}${douane}.`,
    ],
    salut: [`${moment}${p} 👋 ${o.agent} à la barre. ${port.charAt(0).toUpperCase() + port.slice(1)}${douane}. Écris-moi une mission quand tu veux.`, `${moment}${p} ! Tout est calme au port : ${port}${douane}.`],
    merci: [`Avec plaisir${p} 😊`, `De rien${p}, c'est notre boulot ⚓`, `Merci à toi${p} ! L'équipe transmet.`],
    bravo: [`Merci${p} ! Je transmets à l'équipe 💪`, `Ça fait plaisir${p} 😊 L'équipe va être contente.`],
    ok: [`👍`, `Bien reçu${p} ⚓`],
  };
  const t = auHasard(r[genre]);
  return genre === "ok" || genre === "merci" || genre === "bravo" ? t : `${t}`;
}

/**
 * Comprend un message : « aide », « point », « douane », un petit mot (bavardage, sans IA), ou une mission (pour Marius par défaut ;
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
    if (a) {
      const b = bavardage(m[2]!);
      return b ? { type: "bavardage", genre: b, cible: a.id } : { type: "mission", texte: m[2]!.trim(), cible: a.id };
    }
  }
  const b = bavardage(t);
  if (b) return { type: "bavardage", genre: b, cible: null };
  return { type: "mission", texte: t, cible: null };
}

export const AIDE_WHATSAPP = [
  "⚓ *LE PORT* — ce que tu peux m'écrire :",
  "• Une mission, tout simplement : « Prépare une offre pour les restaurants de Sète » → Marius organise l'équipe.",
  "• Pour un agent précis : « @victor devis site vitrine pour La Marée » ou « Victor : … ».",
  "• *point* → ce qui tourne au port en ce moment.",
  "• *douane* → ce qui attend ta validation.",
  "• *aide* → ce message.",
  "• Un petit mot (bonjour, ça va ?, merci, bonne nuit) → réponse tout de suite, gratuite, sans IA.",
  "Je te renvoie le résultat ici quand la mission est terminée.",
].join("\n");
