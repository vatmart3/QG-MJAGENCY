import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { fr } from "date-fns/locale";

export const TZ = "Europe/Paris";

/** « 2026-11-12 », « 2026-11-12T14:30 » ou ISO complet → Date (heure de Paris si pas de fuseau). */
export function parseParis(v: string, endOfDay = false): Date | null {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return fromZonedTime(`${s}T${endOfDay ? "23:59:59" : "00:00:00"}`, TZ);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return fromZonedTime(s, TZ);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const parisLabel = (d: Date | string) => formatInTimeZone(new Date(d), TZ, "EEEE d MMMM HH:mm", { locale: fr });
export const parisLocal = (d: Date) => formatInTimeZone(d, TZ, "yyyy-MM-dd'T'HH:mm");
