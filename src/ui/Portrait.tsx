"use client";

import { useEffect, useRef } from "react";
import { renderPortrait } from "@/world/sprites/characters";

/** Bonhomme agrandi (pixel art net), dessiné à partir du même générateur que la ville. */
export function Portrait({ agentId, size = 4, className = "" }: { agentId: string; size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const src = renderPortrait(agentId);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0);
  }, [agentId]);
  return <canvas ref={ref} width={16} height={24} className={`pixel ${className}`} style={{ width: 16 * size, height: 24 * size }} aria-hidden />;
}
