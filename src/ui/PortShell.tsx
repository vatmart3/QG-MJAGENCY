"use client";

import { useEffect, type ReactNode } from "react";
import { getDirector } from "@/sim/director";
import { world } from "@/store/world";
import { useUI } from "@/store/ui";
import { AgentSheet } from "./AgentSheet";
import { CityCanvas } from "./CityCanvas";
import { CommandBar } from "./CommandBar";
import { MiniMap } from "./MiniMap";
import { PoleSheet } from "./PoleSheet";
import { TopBar } from "./TopBar";

/** La ville EST l'interface : tout le reste flotte au-dessus. */
export function PortShell({ children }: { children: ReactNode }) {
  const ready = useUI((s) => s.ready);

  useEffect(() => {
    // ?heure=22.5 pour prévisualiser une autre heure de la journée
    const h = new URLSearchParams(window.location.search).get("heure");
    if (h !== null && !Number.isNaN(Number(h))) world.setClockOverride(Number(h));
    const d = getDirector();
    d.start();
    return () => d.stop();
  }, []);

  return (
    <main className="fixed inset-0 overflow-hidden select-none">
      <CityCanvas />
      {!ready && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-lavender">
          <div className="text-center">
            <div className="animate-bounce text-4xl">⚓</div>
            <p className="mt-2 font-pixel text-lg">Le port se réveille…</p>
          </div>
        </div>
      )}
      <TopBar />
      <MiniMap />
      <CommandBar />
      <AgentSheet />
      <PoleSheet />
      {children}
    </main>
  );
}
