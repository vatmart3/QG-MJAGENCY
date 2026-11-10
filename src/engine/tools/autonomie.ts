import { formatInTimeZone } from "date-fns-tz";
import type { ToolCtx } from "./types";

/** Ce qui n'est jamais envoyé seul : un prix chiffré, un contrat, un paiement, le juridique, des identifiants.
 *  (Parler d'un devis sans donner de prix est autorisé : « nous préparons votre devis ».) */
export const SENSIBLE_RE =
  /\d[\d\s.,]*\s?(€|euros?\b|eur\b|ht\b|ttc\b)|\bcontrat|\bsignatur|\bsigner\b|rembours|résili|resili|mise en demeure|\bavocat|\brib\b|\biban\b|virement|mot de passe/i;

export type AutoDecision = { auto: true; envoyerApres: Date } | { auto: false; raison: string | null };

/**
 * Le mode autonome s'applique-t-il à cet envoi ? Sinon, la raison (affichée en Douane).
 * Raison null = le mode autonome est éteint ou ne couvre pas ce type : passage normal en Douane.
 */
export async function decisionAutonome(ctx: ToolCtx, type: string, o: { texte: string; sensible?: boolean; jamaisVue: string[]; origineSpam?: boolean }): Promise<AutoDecision> {
  const a = ctx.settings.autonomie;
  if (!a.actif || !a.types.includes(type)) return { auto: false, raison: null };
  if (o.origineSpam) return { auto: false, raison: "le mail d'origine est classé spam" };
  if (o.jamaisVue.length) return { auto: false, raison: `adresse jamais vue (${o.jamaisVue.join(", ")})` };
  if (o.sensible) return { auto: false, raison: "l'agent l'a marqué sensible" };
  const m = o.texte.match(SENSIBLE_RE);
  if (m) return { auto: false, raison: `contient « ${m[0].trim().slice(0, 30)} » (prix, devis ou engagement)` };
  const dayStart = new Date(`${formatInTimeZone(ctx.now, "Europe/Paris", "yyyy-MM-dd")}T00:00:00Z`).toISOString();
  if ((await ctx.db.countAutoSendsSince(dayStart)) >= a.plafond_jour) return { auto: false, raison: `plafond de ${a.plafond_jour} envois automatiques atteint aujourd'hui` };
  return { auto: true, envoyerApres: new Date(ctx.now.getTime() + Math.max(0, a.delai_minutes) * 60_000) };
}

export const heureParis = (d: Date) => formatInTimeZone(d, "Europe/Paris", "HH:mm");
