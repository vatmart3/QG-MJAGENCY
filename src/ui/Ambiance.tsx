"use client";

import { useEffect } from "react";
import { worldStore } from "@/store/world";
import { jouer } from "./sons";

/**
 * Installe le service worker (application installable, notifications) et joue les sons discrets
 * quand quelque chose arrive au port : une demande en Douane, une célébration, une alerte.
 */
export function Ambiance() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    // on ignore l'état initial (chargement) : seuls les nouveaux événements font du bruit
    const debut = Date.now() + 4000;
    let prev = worldStore.getState();
    return worldStore.subscribe((s) => {
      const p = prev;
      prev = s;
      if (Date.now() < debut || document.hidden) return;
      if (s.approvals.length > p.approvals.length) return jouer("douane");
      if (s.celebrations !== p.celebrations && Object.values(s.celebrations).some((t) => t > Date.now() - 3000)) return jouer("fete");
      if (s.journal !== p.journal && s.journal[0] && s.journal[0] !== p.journal[0] && s.journal[0].type === "alerte") jouer("alerte");
    });
  }, []);

  return null;
}
