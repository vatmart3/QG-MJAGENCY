"use client";

import { useEffect, useRef, useState } from "react";
import { agentById, allPoles } from "@/data/catalog";
import { formatParis } from "@/lib/paris";
import { ui, uiStore, useUI } from "@/store/ui";
import { world, useWorld } from "@/store/world";
import { getGame } from "../gameRef";

/** Passe la ville en mode TV (plein écran, sans menus, caméra qui se promène). */
export function entrerTV(): void {
  ui.closeSheets();
  uiStore.setState({ tv: true });
  document.documentElement.requestFullscreen?.().catch(() => undefined);
}

export function sortirTV(): void {
  uiStore.setState({ tv: false });
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
}

const PAS_S = 9;

/**
 * Mode TV pour un écran au bureau : la caméra passe d'un pôle à l'autre, s'arrête sur un agent au travail,
 * montre la ville entière de temps en temps. Échap, ou le bouton (il apparaît quand la souris bouge), pour sortir.
 */
export function ModeTV() {
  const tv = useUI((s) => s.tv);
  const douane = useWorld((s) => s.approvals.length);
  const travail = useWorld((s) => Object.values(s.agents).filter((a) => a.state === "working").length);
  const [cible, setCible] = useState("Toute la ville");
  const [maintenant, setMaintenant] = useState(Date.now());
  const [souris, setSouris] = useState(true);
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);

  // promenade de la caméra
  useEffect(() => {
    if (!tv) return;
    let pas = 0;
    const poles = allPoles();
    const suivant = () => {
      const g = getGame();
      if (!g) return;
      const st = world.get();
      if (pas % 5 === 0) {
        g.overview();
        setCible("Toute la ville");
      } else if (pas % 5 === 3) {
        const actifs = Object.values(st.agents).filter((a) => a.state === "working").map((a) => a.id);
        const id = actifs[Math.floor(Math.random() * actifs.length)];
        const p = id ? g.agentPos(id) : null;
        if (id && p) {
          g.flyToExact(p.x, p.y, 2.5);
          const a = agentById(id);
          const tache = st.agents[id]?.task;
          setCible(`${a?.nom ?? id}${tache ? ` — ${tache.title}` : " au travail"}`);
        } else {
          g.overview();
          setCible("Toute la ville");
        }
      } else {
        const pole = poles[(pas * 7) % Math.max(1, poles.length)];
        const p = pole ? g.zonePos(pole.id) : null;
        if (pole && p) {
          g.flyToExact(p.x, p.y - 10, 1.5);
          setCible(`${pole.icone} ${pole.nom}`);
        }
      }
      pas++;
    };
    suivant();
    const t = setInterval(suivant, PAS_S * 1000);
    const h = setInterval(() => setMaintenant(Date.now()), 15_000);
    return () => {
      clearInterval(t);
      clearInterval(h);
    };
  }, [tv]);

  // sortie : Échap, fin du plein écran
  useEffect(() => {
    if (!tv) return;
    const touche = (e: KeyboardEvent) => e.key === "Escape" && sortirTV();
    const plein = () => {
      if (!document.fullscreenElement && uiStore.getState().tv) uiStore.setState({ tv: false });
    };
    const bouge = () => {
      setSouris(true);
      if (minuterie.current) clearTimeout(minuterie.current);
      minuterie.current = setTimeout(() => setSouris(false), 2500);
    };
    window.addEventListener("keydown", touche);
    document.addEventListener("fullscreenchange", plein);
    window.addEventListener("pointermove", bouge);
    bouge();
    return () => {
      window.removeEventListener("keydown", touche);
      document.removeEventListener("fullscreenchange", plein);
      window.removeEventListener("pointermove", bouge);
      if (minuterie.current) clearTimeout(minuterie.current);
    };
  }, [tv]);

  if (!tv) return null;
  return (
    <>
      <div className="pointer-events-none fixed bottom-[max(20px,env(safe-area-inset-bottom))] left-[max(20px,env(safe-area-inset-left))] z-30 rounded-2xl bg-ink/70 px-5 py-3.5 text-white shadow-xl backdrop-blur">
        <div className="font-pixel text-[13px] tracking-wide text-amber-200">⚓ LE PORT · MJAGENCY</div>
        <div className="font-pixel text-[44px] leading-none tabular-nums">{formatParis(maintenant, "HH:mm")}</div>
        <div className="mt-1 text-[13px] capitalize opacity-80">{formatParis(maintenant, "EEEE d MMMM")}</div>
        <div className="mt-2 max-w-[340px] truncate text-[14px] font-medium">📍 {cible}</div>
        <div className="mt-1 text-[12px] opacity-80">
          {travail} agent{travail > 1 ? "s" : ""} au travail · {douane} en Douane
        </div>
      </div>
      <button
        type="button"
        onClick={sortirTV}
        className={`fixed top-[max(16px,env(safe-area-inset-top))] right-[max(16px,env(safe-area-inset-right))] z-30 rounded-full bg-ink/75 px-4 py-2 text-sm font-medium text-white transition-opacity duration-300 ${souris ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        Quitter le mode TV (Échap)
      </button>
    </>
  );
}
