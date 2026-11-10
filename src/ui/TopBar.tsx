"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { allAgents, poleById, useCatalogVersion } from "@/data/catalog";
import { STATE_ICON } from "@/data/types";
import { hhmm } from "@/lib/paris";
import { phaseLabel } from "@/world/daynight";
import { useWorld } from "@/store/world";
import { ui, useUI } from "@/store/ui";
import { getGame } from "./gameRef";
import { useHour, useIsMobile } from "./hooks";
import { Portrait } from "./Portrait";

export function TopBar() {
  useCatalogVersion();
  const path = usePathname();
  const mobile = useIsMobile();
  const approvals = useWorld((s) => s.approvals.length);
  const running = useWorld((s) => s.tasks.filter((t) => t.status === "running").length);
  const rapports = useWorld((s) => Object.keys(s.rapports).length);
  const online = useWorld((s) => Object.values(s.agents).filter((a) => a.state !== "offline").length);
  const hour = useHour();

  const tabs = [
    { href: "/", label: "Ville", count: undefined as number | undefined },
    { href: "/equipe", label: "Équipe", count: allAgents().length },
    { href: "/taches", label: "Tâches", count: running },
    { href: "/flux", label: "Flux" },
    { href: "/rapports", label: "Rapports", count: rapports || undefined },
    { href: "/commercial", label: "Commercial" },
    { href: "/douane", label: "Douane", count: approvals, alert: approvals > 0 },
    { href: "/finances", label: "Finances" },
    { href: "/journal", label: "Journal" },
    { href: "/reglages", label: "Réglages" },
  ];

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-start gap-2 px-3 pt-[max(12px,env(safe-area-inset-top))] sm:px-4">
      <Link href="/" className="glass pointer-events-auto flex shrink-0 items-center gap-2 rounded-full py-1.5 pr-4 pl-1.5" aria-label="LE PORT — accueil">
        <span className="grid size-8 place-items-center rounded-full bg-ink text-sm text-white">⚓</span>
        <span className="leading-none">
          <span className="block font-pixel text-[15px] font-semibold tracking-wide">LE PORT</span>
          <ConnBadge />
        </span>
      </Link>

      <nav className="glass hide-scrollbar pointer-events-auto flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-full p-1" aria-label="Navigation">
        {tabs.map((t) => {
          const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`relative flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition ${
                active ? "bg-ink text-white" : "text-ink/80 hover:bg-white/80 hover:text-ink"
              }`}
            >
              {t.label}
              {t.count !== undefined && (
                <span
                  className={`min-w-5 rounded-full px-1.5 py-px text-center font-silk text-[9px] ${
                    t.alert ? "bg-phare text-white" : active ? "bg-white/20" : "bg-ink/8 text-ink-soft"
                  }`}
                >
                  {t.count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {!mobile && <AgentSearch />}
        <div className="glass pointer-events-auto hidden items-center gap-2 rounded-full px-3 py-2 text-[12px] font-medium md:flex" title="Agents en ligne">
          <span className="relative flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative size-2 rounded-full bg-emerald-500" />
          </span>
          {online} en ligne
        </div>
        {hour !== null && (
          <div className="glass pointer-events-auto hidden items-center gap-1.5 rounded-full px-3 py-2 font-silk text-[10px] lg:flex" title="Heure de Paris">
            {hhmm(hour)} · {phaseLabel(hour)}
          </div>
        )}
      </div>
    </div>
  );
}

function ConnBadge() {
  const conn = useUI((s) => s.conn);
  const label = { demo: "DÉMO", connexion: "CONNEXION…", direct: "EN DIRECT", hors_ligne: "HORS LIGNE" }[conn];
  const color = { demo: "text-phare", connexion: "text-ink-soft", direct: "text-moss", hors_ligne: "text-phare" }[conn];
  return (
    <span className={`flex items-center gap-1 font-silk text-[8px] ${color}`} title={conn === "direct" ? "Synchronisé en temps réel avec Supabase" : conn === "demo" ? "Mode démo : rien n'est enregistré côté serveur" : ""}>
      {conn === "direct" && <span className="size-1.5 rounded-full bg-moss" />}
      {label}
    </span>
  );
}

export function AgentSearch({ onPicked }: { onPicked?: () => void }) {
  useCatalogVersion();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const agents = useWorld((s) => s.agents);
  const results = useMemo(() => {
    const n = q.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    if (!n) return [];
    return allAgents().filter((a) =>
      `${a.nom} ${a.role} ${poleById(a.pole)?.nom ?? ""}`.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").includes(n),
    ).slice(0, 7);
  }, [q]);

  const pickAgent = (id: string) => {
    getGame()?.flyToAgent(id);
    ui.selectAgent(id);
    setQ("");
    setOpen(false);
    inputRef.current?.blur();
    onPicked?.();
  };

  return (
    <div className="pointer-events-auto relative">
      <label className="glass flex items-center gap-2 rounded-full px-3 py-2">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden className="text-ink-soft">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="2" fill="none" />
          <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(results.length - 1, a + 1));
            if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
            if (e.key === "Enter" && results[active]) pickAgent(results[active].id);
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Chercher un agent…"
          className="w-40 bg-transparent text-[13px] outline-none placeholder:text-ink-soft/80 lg:w-48"
          aria-label="Chercher un agent"
        />
      </label>
      {open && results.length > 0 && (
        <ul className="paper absolute right-0 mt-2 w-72 overflow-hidden rounded-2xl p-1.5" role="listbox">
          {results.map((a, i) => (
            <li key={a.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickAgent(a.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition ${i === active ? "bg-ink/6" : "hover:bg-ink/4"}`}
              >
                <Portrait agentId={a.id} size={1.5} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{a.nom}</span>
                  <span className="block truncate text-xs text-ink-soft">
                    {poleById(a.pole)?.icone} {a.role}
                  </span>
                </span>
                <span className="text-sm">{STATE_ICON[agents[a.id]?.state ?? "idle"]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
