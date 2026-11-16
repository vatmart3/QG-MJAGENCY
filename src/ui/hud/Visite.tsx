"use client";

import { useEffect, useRef, useState } from "react";
import { agentById, useCatalog } from "@/data/catalog";
import { getPlan } from "@/bureau/plan";
import { ui, useUI } from "@/store/ui";
import { useWorld } from "@/store/world";
import { getGame } from "../gameRef";
import { useIsMobile } from "../hooks";

/** Entre dans le bâtiment à pied (à appeler depuis un clic : la souris est capturée pour regarder autour de soi). */
export function entrerVisite(): void {
  getGame()?.entrerVisite?.();
}

/**
 * Habillage de la visite à pied du bureau 3D : pièce où l'on se trouve (en haut à gauche), viseur, aide des
 * touches, « E — parler à … » devant un agent, barre de pause, et une manette à l'écran sur téléphone.
 */
export function Visite() {
  const visite = useUI((s) => s.visite);
  const lieu = useUI((s) => s.visiteLieu);
  const cible = useUI((s) => s.visiteCible);
  const selection = useUI((s) => s.selectedAgent);
  const mobile = useIsMobile();
  const [aide, setAide] = useState(true);
  useEffect(() => {
    if (visite !== "oui") return;
    setAide(true);
    const t = setTimeout(() => setAide(false), 9000);
    return () => clearTimeout(t);
  }, [visite]);
  if (visite === "non") return null;
  const agent = cible ? agentById(cible) : undefined;
  return (
    <>
      {/* où je suis */}
      <div className="pointer-events-none fixed top-[max(14px,env(safe-area-inset-top))] left-[max(14px,env(safe-area-inset-left))] z-30 flex items-center gap-2 rounded-full bg-white/90 py-2 pr-4 pl-3 text-[14px] font-semibold text-ink shadow-lg backdrop-blur">
        <span className="size-2.5 rounded-full bg-phare" />
        {lieu ?? "MJAGENCY"}
      </div>
      <button
        type="button"
        onClick={() => getGame()?.quitterVisite?.()}
        className="fixed top-[max(14px,env(safe-area-inset-top))] right-[max(14px,env(safe-area-inset-right))] z-30 rounded-full bg-ink/80 px-4 py-2 text-[13px] font-medium text-white backdrop-blur transition hover:bg-ink"
      >
        Revenir à la maquette
      </button>

      {/* viseur */}
      {visite === "oui" && !mobile && <div className="pointer-events-none fixed top-1/2 left-1/2 z-20 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 shadow-[0_0_0_1.5px_rgba(0,0,0,0.35)]" />}

      {/* parler à l'agent en face */}
      {agent && !selection && (
        <button
          type="button"
          onClick={() => ui.selectAgent(agent.id)}
          className="fixed top-[70%] left-1/2 z-30 -translate-x-1/2 rounded-full bg-ink/85 px-4 py-2 text-[13.5px] font-medium text-white shadow-lg backdrop-blur"
        >
          {!mobile && <kbd className="mr-2 rounded bg-white/20 px-1.5 py-0.5 font-sans text-[12px]">E</kbd>}
          Parler à {agent.nom}
        </button>
      )}

      {/* aide des touches */}
      {visite === "oui" && !mobile && aide && (
        <div className="pointer-events-none fixed bottom-[max(18px,env(safe-area-inset-bottom))] left-1/2 z-30 flex -translate-x-1/2 flex-wrap items-center justify-center gap-x-4 gap-y-1 rounded-2xl bg-ink/75 px-4 py-2.5 text-[12.5px] text-white backdrop-blur">
          <Touche k="Z Q S D">marcher</Touche>
          <Touche k="Souris">regarder</Touche>
          <Touche k="Maj">courir</Touche>
          <Touche k="E">parler</Touche>
          <Touche k="Échap">sortir</Touche>
        </div>
      )}

      {/* pause : la souris est libre */}
      {visite === "pause" && (
        <div className="fixed bottom-[max(18px,env(safe-area-inset-bottom))] left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-white/95 p-2 pl-4 text-[13px] shadow-xl backdrop-blur">
          <span className="text-ink-soft">Visite en pause</span>
          <button type="button" onClick={() => getGame()?.reprendreVisite?.()} className="rounded-full bg-ink px-4 py-2 font-medium text-white">
            Reprendre la visite
          </button>
          <button type="button" onClick={() => getGame()?.quitterVisite?.()} className="rounded-full border border-ink/15 px-3 py-2">
            Maquette
          </button>
        </div>
      )}

      {mobile && <Manette />}
    </>
  );
}

function Touche({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <span className="whitespace-nowrap">
      <kbd className="mr-1.5 rounded bg-white/20 px-1.5 py-0.5 font-sans text-[11.5px] font-semibold">{k}</kbd>
      {children}
    </span>
  );
}

/** Manette tactile : le pouce gauche marche, l'autre main fait glisser l'écran pour regarder. */
function Manette() {
  const base = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const bouger = (e: React.PointerEvent) => {
    const r = base.current?.getBoundingClientRect();
    if (!r) return;
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const n = Math.hypot(x, y);
    if (n > 1) {
      x /= n;
      y /= n;
    }
    setPos({ x, y });
    getGame()?.manetteVers?.(x, -y);
  };
  const lacher = () => {
    setPos({ x: 0, y: 0 });
    getGame()?.manetteVers?.(0, 0);
  };
  return (
    <div
      ref={base}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        bouger(e);
      }}
      onPointerMove={(e) => e.buttons || e.pointerType === "touch" ? bouger(e) : undefined}
      onPointerUp={lacher}
      onPointerCancel={lacher}
      className="fixed bottom-[max(28px,calc(env(safe-area-inset-bottom)+20px))] left-[max(24px,env(safe-area-inset-left))] z-30 size-[120px] touch-none rounded-full bg-white/25 backdrop-blur"
      aria-label="Manette : fais glisser pour marcher"
      role="application"
    >
      <div className="absolute top-1/2 left-1/2 size-[52px] rounded-full bg-white/85 shadow-lg" style={{ transform: `translate(calc(-50% + ${pos.x * 34}px), calc(-50% + ${pos.y * 34}px))` }} />
    </div>
  );
}

/** Mini-plan du bureau (vue de dessus) pour la carte en bas à droite. */
export function PlanMini({ onAller }: { onAller: (id: string) => void }) {
  const structure = useCatalog((s) => s.structure);
  const presence = useWorld((s) => s.presence);
  const plan = getPlan(structure);
  return (
    <svg viewBox={`-1 -1 ${plan.W + 2} ${plan.D + 2}`} className="block w-full" role="img" aria-label="Plan du bureau">
      <rect x={-0.5} y={-0.5} width={plan.W + 1} height={plan.D + 1} rx={1} fill="#d9b382" stroke="#8a7a63" strokeWidth={0.5} />
      {plan.pieces.map((p) => {
        const n = presence[p.id] ?? 0;
        return (
          <g key={p.id} className="cursor-pointer" onClick={() => onAller(p.id)} role="button" aria-label={`Aller à ${p.nom}`}>
            <title>{p.nom}</title>
            <rect x={p.x0 + 0.25} y={p.z0 + 0.25} width={p.x1 - p.x0 - 0.5} height={p.z1 - p.z0 - 0.5} rx={0.6} fill={p.kind === "extra" ? p.sol : p.couleur} fillOpacity={p.kind === "pole" ? 0.85 : 0.5} stroke="#fff" strokeWidth={0.3} className="transition-[fill-opacity] hover:fill-opacity-100" />
            <text x={(p.x0 + p.x1) / 2} y={(p.z0 + p.z1) / 2 + 1.4} textAnchor="middle" fontSize={3.6}>
              {p.icone}
            </text>
            {n > 0 && (
              <>
                <circle cx={p.x1 - 1.9} cy={p.z0 + 1.9} r={1.5} fill="#fff" />
                <text x={p.x1 - 1.9} y={p.z0 + 2.6} textAnchor="middle" fontSize={2.1} fontWeight={700} fill="#2a2140">
                  {n}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
