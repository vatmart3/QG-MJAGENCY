"use client";

import { useEffect, useRef } from "react";
import { useCatalog } from "@/data/catalog";
import { renderPortrait } from "@/world/sprites/characters";

/**
 * Bonhomme agrandi (pixel art net), dessiné par le même générateur que la ville.
 * `seed` / `pole` permettent un aperçu avant enregistrement (Réglages).
 */
export function Portrait({ agentId, size = 4, className = "", seed, pole }: { agentId: string; size?: number; className?: string; seed?: string; pole?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const agents = useCatalog((s) => s.agents);
  const poles = useCatalog((s) => s.poles);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const src = renderPortrait(agentId, "F_walk0", seed !== undefined || pole !== undefined ? { seed, pole } : undefined);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0);
  }, [agentId, seed, pole, agents, poles]);
  return <canvas ref={ref} width={16} height={24} className={`pixel ${className}`} style={{ width: 16 * size, height: 24 * size }} aria-hidden />;
}
