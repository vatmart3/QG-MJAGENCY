import { toZonedTime, formatInTimeZone } from "date-fns-tz";
import { fr } from "date-fns/locale";

export const TZ = "Europe/Paris";

/** Heure décimale actuelle à Paris (ex. 14.5 = 14 h 30). */
export function parisHour(now: Date = new Date()): number {
  const z = toZonedTime(now, TZ);
  return z.getHours() + z.getMinutes() / 60 + z.getSeconds() / 3600;
}

export function parisDay(now: Date = new Date()): number {
  return toZonedTime(now, TZ).getDay();
}

export function formatParis(d: Date | number, fmt: string): string {
  return formatInTimeZone(d, TZ, fmt, { locale: fr });
}

export function hhmm(h: number): string {
  const H = Math.floor(((h % 24) + 24) % 24);
  const M = Math.floor((h - Math.floor(h)) * 60);
  return `${String(H).padStart(2, "0")}:${String(M).padStart(2, "0")}`;
}
