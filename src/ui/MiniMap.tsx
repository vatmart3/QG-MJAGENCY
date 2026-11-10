"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { POLE_BY_ID, agentsOfPole } from "@/data/seed";
import { useWorld } from "@/store/world";
import { ui } from "@/store/ui";
import { GH, GW, T, getLayout, idx } from "@/world/layout";
import { getGame } from "./gameRef";
import { useIsMobile } from "./hooks";

// projection mini : 1 case = 4×2 px
const MW = 4;
const MH = 2;
const OX = GH * (MW / 2);
const mini = (u: number, v: number) => ({ x: OX + (u - v) * (MW / 2), y: (u + v) * (MH / 2) });
const W = (GW + GH) * (MW / 2);
const H = (GW + GH) * (MH / 2) + 8;

const TILE_COL: Partial<Record<T, string>> = {
  [T.GRASS]: "#93d36e",
  [T.PATH]: "#e4dacb",
  [T.QUAY]: "#cfcbc4",
  [T.WATER]: "#5db3d6",
  [T.BRIDGE]: "#c08d5a",
  [T.WOOD]: "#d6a774",
  [T.ROCK]: "#9a96a8",
  [T.PONTOON]: "#c4935f",
  [T.FLOOR]: "#f1e9dc",
};

export function MiniMap() {
  const ref = useRef<HTMLCanvasElement>(null);
  const presence = useWorld((s) => s.presence);
  const agents = useWorld((s) => s.agents);
  const mobile = useIsMobile();
  const [open, setOpen] = useState(true);
  const layout = useMemo(() => getLayout(), []);

  useEffect(() => {
    if (mobile) setOpen(false);
  }, [mobile]);

  useEffect(() => {
    const c = ref.current;
    if (!c || !open) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        const t = layout.tiles[idx(x, y)] as T;
        if (t === T.VOID) continue;
        const zi = layout.zoneOf[idx(x, y)]!;
        ctx.fillStyle = zi >= 0 ? layout.zones[zi]!.floor : (TILE_COL[t] ?? "#93d36e");
        const p = mini(x, y);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + MW / 2, p.y + MH / 2);
        ctx.lineTo(p.x, p.y + MH);
        ctx.lineTo(p.x - MW / 2, p.y + MH / 2);
        ctx.closePath();
        ctx.fill();
      }
    // tranche de falaise
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#8d5a35";
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        if (layout.tiles[idx(x, y)] === T.VOID) continue;
        const p = mini(x, y);
        ctx.fillRect(p.x - MW / 2, p.y + MH / 2, MW, 5);
      }
    ctx.globalCompositeOperation = "source-over";
  }, [layout, open]);

  const fly = (id: string) => {
    getGame()?.flyToZone(id);
    if (id === "douane") return;
    ui.selectPole(id);
  };

  return (
    <div className="pointer-events-none fixed right-3 bottom-[max(96px,calc(env(safe-area-inset-bottom)+90px))] z-20 flex flex-col items-end gap-2 sm:right-4 sm:bottom-6">
      <ZoomControls onToggleMap={() => setOpen((o) => !o)} mapOpen={open} />
      {open && (
        <div className="glass pointer-events-auto rounded-2xl p-2" style={{ width: mobile ? 210 : 260 }}>
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="font-silk text-[9px] uppercase text-ink-soft">Carte du port</span>
            <span className="font-silk text-[9px] text-ink-soft">{Object.values(agents).filter((a) => a.state !== "offline").length} actifs</span>
          </div>
          <div className="relative" style={{ aspectRatio: `${W} / ${H}` }}>
            <canvas ref={ref} width={W} height={H} className="absolute inset-0 h-full w-full" />
            <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full overflow-visible">
              {layout.zones.map((z) => {
                const pole = POLE_BY_ID[z.id];
                if (!pole) return null;
                const pts = [mini(z.x, z.y), mini(z.x + z.w, z.y), mini(z.x + z.w, z.y + z.h), mini(z.x, z.y + z.h)];
                const c = mini(z.x + z.w / 2, z.y + z.h / 2);
                const count = presence[z.id] ?? 0;
                const total = pole.kind === "pole" ? agentsOfPole(z.id).length : 0;
                return (
                  <g key={z.id} className="cursor-pointer" onClick={() => fly(z.id)} role="button" aria-label={`Aller à ${pole.nom}`}>
                    <title>{`${pole.nom}${pole.kind === "pole" ? ` — ${count}/${total} au poste` : ""}`}</title>
                    <polygon
                      points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill={pole.couleur}
                      fillOpacity={pole.kind === "pole" ? 0.75 : 0.4}
                      stroke="white"
                      strokeWidth={0.8}
                      className="transition-[fill-opacity] hover:fill-opacity-100"
                    />
                    {count > 0 && (
                      <>
                        <circle cx={c.x} cy={c.y - 1} r={4.4} fill="white" />
                        <text x={c.x} y={c.y + 1.2} textAnchor="middle" fontSize="6" fontWeight={700} fill="#2a2140">
                          {count}
                        </text>
                      </>
                    )}
                  </g>
                );
              })}
              {(() => {
                const p = mini(layout.pharePos.x + 0.5, layout.pharePos.y + 0.5);
                return (
                  <g className="cursor-pointer" onClick={() => getGame()?.flyToZone("phare")}>
                    <rect x={p.x - 1.5} y={p.y - 7} width={3} height={7} fill="#d8433a" />
                    <rect x={p.x - 1.5} y={p.y - 4.5} width={3} height={1.4} fill="white" />
                  </g>
                );
              })()}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

function ZoomControls({ onToggleMap, mapOpen }: { onToggleMap: () => void; mapOpen: boolean }) {
  const btn = "grid size-9 place-items-center rounded-full text-ink transition hover:bg-white active:scale-95";
  return (
    <div className="glass pointer-events-auto flex items-center gap-0.5 rounded-full p-1">
      <button type="button" className={btn} onClick={() => getGame()?.zoomStep(-1)} aria-label="Dézoomer">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path d="M2 6h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <button type="button" className={btn} onClick={() => getGame()?.zoomStep(1)} aria-label="Zoomer">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path d="M2 6h8M6 2v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <button type="button" className={`${btn} ${mapOpen ? "bg-white/70" : ""}`} onClick={onToggleMap} aria-label="Afficher la carte" aria-pressed={mapOpen}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <path d="M1 3l4-2 4 2 4-2v10l-4 2-4-2-4 2z M5 1v10 M9 3v10" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
