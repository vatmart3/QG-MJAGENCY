"use client";

/**
 * Sons discrets du port, synthétisés à la volée (Web Audio, aucun fichier) : carillon de la Douane,
 * petite fanfare des célébrations, cloche d'alerte. Désactivables (Réglages ou bouton 🔈), mémorisé sur l'appareil.
 */

export type Son = "douane" | "fete" | "alerte" | "clic";

const CLE = "leport.sons";
let ctx: AudioContext | null = null;
let dernier = 0;

export function sonsActifs(): boolean {
  try {
    return localStorage.getItem(CLE) !== "0";
  } catch {
    return true;
  }
}

export function activerSons(v: boolean): void {
  try {
    localStorage.setItem(CLE, v ? "1" : "0");
  } catch {
    /* stockage indisponible : réglage non mémorisé */
  }
  window.dispatchEvent(new Event("leport-sons"));
  if (v) jouer("clic", true);
}

const NOTES: Record<Son, [number, number, number][]> = {
  // [fréquence Hz, début s, durée s]
  douane: [
    [880, 0, 0.18],
    [1174.7, 0.12, 0.28],
  ],
  fete: [
    [523.3, 0, 0.12],
    [659.3, 0.09, 0.12],
    [784, 0.18, 0.12],
    [1046.5, 0.27, 0.3],
  ],
  alerte: [
    [440, 0, 0.22],
    [349.2, 0.2, 0.32],
  ],
  clic: [[1318.5, 0, 0.06]],
};

export function jouer(son: Son, force = false): void {
  if (typeof window === "undefined" || (!force && !sonsActifs())) return;
  // pas plus d'un son par seconde (une rafale d'événements reste discrète)
  const t = Date.now();
  if (!force && t - dernier < 1000) return;
  dernier = t;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const base = ctx.currentTime + 0.01;
    for (const [f, debut, duree] of NOTES[son]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = son === "alerte" ? "triangle" : "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, base + debut);
      g.gain.exponentialRampToValueAtTime(0.06, base + debut + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, base + debut + duree);
      o.connect(g).connect(ctx.destination);
      o.start(base + debut);
      o.stop(base + debut + duree + 0.05);
    }
  } catch {
    /* audio indisponible (navigateur sans Web Audio) */
  }
}
