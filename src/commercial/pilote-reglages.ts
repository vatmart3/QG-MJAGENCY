/** Réglages du pilote commercial (partagés par le serveur et l'écran Commercial → Réglages). */

export interface Pilote {
  actif: boolean;
  mails_par_jour: number;
  score_min: number;
  /** relance unique au bout de N jours (0 = pas de relance) */
  relance_jours: number;
  debut: string;
  fin: string;
  ecart_minutes: number;
}

export const PILOTE_DEFAUT: Pilote = { actif: true, mails_par_jour: 10, score_min: 55, relance_jours: 5, debut: "09:00", fin: "18:00", ecart_minutes: 12 };

export function lirePilote(v: unknown): Pilote {
  const o = (v && typeof v === "object" ? v : {}) as Partial<Pilote>;
  const n = (x: unknown, d: number, min: number, max: number) => (Number.isFinite(Number(x)) ? Math.max(min, Math.min(max, Math.round(Number(x)))) : d);
  const h = (x: unknown, d: string) => (typeof x === "string" && /^\d{2}:\d{2}$/.test(x) ? x : d);
  return {
    actif: o.actif ?? PILOTE_DEFAUT.actif,
    mails_par_jour: n(o.mails_par_jour, PILOTE_DEFAUT.mails_par_jour, 0, 40),
    score_min: n(o.score_min, PILOTE_DEFAUT.score_min, 0, 100),
    relance_jours: n(o.relance_jours, PILOTE_DEFAUT.relance_jours, 0, 30),
    debut: h(o.debut, PILOTE_DEFAUT.debut),
    fin: h(o.fin, PILOTE_DEFAUT.fin),
    ecart_minutes: n(o.ecart_minutes, PILOTE_DEFAUT.ecart_minutes, 3, 120),
  };
}
