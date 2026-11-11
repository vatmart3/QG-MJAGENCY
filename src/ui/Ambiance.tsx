"use client";

import { useEffect } from "react";
import { worldStore } from "@/store/world";
import { agentById } from "@/data/catalog";
import { toast } from "@/store/toasts";
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
    // on ignore l'état initial (chargement) : seuls les nouveaux événements s'affichent
    const debut = Date.now() + 4000;
    let prev = worldStore.getState();
    return worldStore.subscribe((s) => {
      const p = prev;
      prev = s;
      if (Date.now() < debut) return;
      // nouvelles demandes en Douane
      if (s.approvals !== p.approvals) {
        const anciens = new Set(p.approvals.map((a) => a.id));
        for (const a of s.approvals.filter((x) => !anciens.has(x.id)).slice(0, 3))
          toast({ kind: "douane", titre: "À valider en Douane", texte: a.title, agentId: a.agentId, href: "/douane" }, `ap:${a.id}`);
      }
      // nouvelles lignes du Journal : envois, alertes, missions, commandes
      if (s.journal !== p.journal) {
        const anciens = new Set(p.journal.map((j) => j.id));
        for (const j of s.journal.filter((x) => !anciens.has(x.id)).slice(0, 4).reverse()) {
          const nom = j.agentId ? (agentById(j.agentId)?.nom ?? "") : "";
          if (j.title.startsWith("✉️")) toast({ kind: "envoi", titre: `${nom || "Le port"} a envoyé un mail`, texte: j.title.replace(/^✉️\s*/, ""), agentId: j.agentId, href: "/journal" }, `j:${j.id}`);
          else if (j.title.startsWith("🛍️ Nouvelle commande")) toast({ kind: "fete", titre: "Nouvelle commande !", texte: j.title.replace(/^🛍️\s*Nouvelle commande\s*/, ""), agentId: j.agentId, href: "/atelier" }, `j:${j.id}`);
          else if (j.type === "alerte") toast({ kind: "alerte", titre: j.title.slice(0, 90), texte: j.detail?.slice(0, 140), agentId: j.agentId, href: "/journal" }, `j:${j.id}`);
          else if (j.title.startsWith("Synthèse livrée")) toast({ kind: "mission", titre: "Mission terminée ✅", texte: j.title.replace(/^Synthèse livrée\s*:\s*/, ""), agentId: j.agentId, href: "/rapports" }, `j:${j.id}`);
          else if (j.title.startsWith("📱 Mission reçue")) toast({ kind: "mission", titre: "Mission reçue depuis ton téléphone", texte: j.detail?.slice(0, 140), agentId: j.agentId, href: "/taches" }, `j:${j.id}`);
        }
      }
      if (document.hidden) return;
      if (s.celebrations !== p.celebrations && Object.values(s.celebrations).some((t) => t > Date.now() - 3000)) jouer("fete");
    });
  }, []);

  return null;
}
