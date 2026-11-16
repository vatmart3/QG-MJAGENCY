"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ui, uiStore } from "@/store/ui";
import { getGame, setGame, type Scene } from "./gameRef";
import { useStyleVille } from "./hooks";

/** Monte la ville PixiJS (côté client uniquement) et sa couche DOM. */
export function CityCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const style = useStyleVille();

  useEffect(() => {
    let cancelled = false;
    uiStore.setState({ ready: false });
    let game: Scene | null = null;
    (async () => {
      const onZoneClick = (zoneId: string) => {
        if (zoneId === "douane" || zoneId === "phare") {
          router.push("/douane");
          return;
        }
        ui.selectPole(zoneId);
        getGame()?.flyToZone(zoneId);
      };
      if (cancelled || !host.current || !overlay.current) return;
      let g: Scene;
      if (style === "bureau") {
        const { Bureau } = await import("@/bureau/Bureau");
        if (cancelled || !host.current || !overlay.current) return;
        g = await Bureau.create(host.current, overlay.current, { onZoneClick });
      } else {
        const { Game } = await import("@/world/Game");
        if (cancelled || !host.current || !overlay.current) return;
        g = await Game.create(host.current, overlay.current, { style, onZoneClick });
      }
      if (cancelled) {
        g.destroy();
        return;
      }
      game = g;
      setGame(g);
      // accès console / tests de rendu : window.__LE_PORT__.flyToAgent("marius")
      (window as unknown as { __LE_PORT__?: unknown }).__LE_PORT__ = g;
    })();
    return () => {
      cancelled = true;
      setGame(null);
      game?.destroy();
    };
  }, [router, style]);

  return (
    <div className="absolute inset-0">
      <div ref={host} className="absolute inset-0" aria-label={style === "bureau" ? "Le bureau 3D de MJAGENCY" : "La ville du Port"} role="img" />
      <div ref={overlay} className="world-overlay" />
    </div>
  );
}
