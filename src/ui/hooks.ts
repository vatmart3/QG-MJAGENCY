"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { parisHour } from "@/lib/paris";
import { useWorld } from "@/store/world";
import { EVT_STYLE_VILLE, styleVille, type StyleVille } from "@/world/theme";

const MQ = "(max-width: 720px)";

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(MQ);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(MQ).matches,
    () => false,
  );
}

/** Heure de Paris (ou heure forcée en démo), rafraîchie toutes les 15 s. null avant montage (pas de décalage d'hydratation). */
export function useHour(): number | null {
  const override = useWorld((s) => s.clockOverride);
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    setH(parisHour());
    const t = setInterval(() => setH(parisHour()), 15_000);
    return () => clearInterval(t);
  }, []);
  if (h === null) return null;
  return override ?? h;
}

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Style de la ville choisi dans ce navigateur (New York ou Sète), mis à jour quand on le change. */
export function useStyleVille(): StyleVille {
  const [s, setS] = useState<StyleVille>("futur");
  useEffect(() => {
    setS(styleVille());
    const on = (e: Event) => setS((e as CustomEvent<StyleVille>).detail);
    window.addEventListener(EVT_STYLE_VILLE, on);
    return () => window.removeEventListener(EVT_STYLE_VILLE, on);
  }, []);
  return s;
}
