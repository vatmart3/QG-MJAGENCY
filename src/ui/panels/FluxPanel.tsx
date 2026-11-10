"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { agentById, poleById, useCatalogVersion } from "@/data/catalog";
import { FLUX_STYLE } from "@/lib/flux";
import { formatParis } from "@/lib/paris";
import { loadMissionFlux, type MissionFluxData } from "@/sync/live";
import { ui } from "@/store/ui";
import { useWorld, type FluxEvent, type FluxType, type Mission, type TaskItem } from "@/store/world";
import { getGame } from "../gameRef";
import { Portrait } from "../Portrait";
import { RoutePanel } from "./RoutePanel";

const STATUT: Record<TaskItem["status"], { label: string; cls: string }> = {
  queued: { label: "En file", cls: "bg-ink/8 text-ink-soft" },
  running: { label: "En cours", cls: "bg-sky-100 text-sky-700" },
  waiting_tool: { label: "Attend un collègue", cls: "bg-amber-100 text-amber-700" },
  waiting_approval: { label: "En Douane", cls: "bg-rose-100 text-rose-700" },
  waiting_founder: { label: "Attend les fondateurs", cls: "bg-rose-100 text-rose-700" },
  done: { label: "Livré", cls: "bg-moss/15 text-moss" },
  failed: { label: "Échec", cls: "bg-phare/10 text-phare" },
  cancelled: { label: "Annulé", cls: "bg-ink/8 text-ink-soft" },
};

const MISSION_STATUT: Record<Mission["status"], string> = { nouvelle: "Reçue", planification: "Planification", en_cours: "En cours", terminee: "Terminée", annulee: "Abandonnée" };

function Who({ id, size = 1.1 }: { id: string | null; size?: number }) {
  if (!id || id === "fondateurs")
    return (
      <span className="grid shrink-0 place-items-center rounded-full bg-ink text-white" style={{ width: 16 * size + 8, height: 16 * size + 8, fontSize: 9 * size + 4 }} title={id ? "Fondateurs" : "Toute l'équipe"}>
        {id ? "👥" : "📣"}
      </span>
    );
  return <Portrait agentId={id} size={size} />;
}

const nomDe = (id: string | null) => (!id ? "l'équipe" : id === "fondateurs" ? "Fondateurs" : (agentById(id)?.nom ?? id));

function TypeChip({ type }: { type: FluxType }) {
  const st = FLUX_STYLE[type];
  return (
    <span className="shrink-0 rounded-full px-2 py-px text-[10.5px] font-semibold text-white" style={{ background: st.color }}>
      {st.icon} {st.label}
    </span>
  );
}

/** Onglet « Flux » : qui parle à qui, en direct et mission par mission. */
export function FluxPanel() {
  useCatalogVersion();
  const router = useRouter();
  const params = useSearchParams();
  const missionId = params.get("mission");
  const missions = useWorld((s) => s.missions);

  return (
    <RoutePanel title="Flux" kicker="Qui parle à qui" icon="🔀" accent="#e0812c" width={620}>
      <div className="hide-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        <button
          type="button"
          onClick={() => router.push("/flux")}
          className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium ${!missionId ? "bg-ink text-white" : "bg-ink/5 text-ink-soft hover:text-ink"}`}
        >
          ● En direct
        </button>
        {missions.slice(0, 12).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => router.push(`/flux?mission=${encodeURIComponent(m.id)}`)}
            title={m.text}
            className={`max-w-56 shrink-0 truncate rounded-full px-3 py-1.5 text-[13px] font-medium ${missionId === m.id ? "bg-ink text-white" : "bg-ink/5 text-ink-soft hover:text-ink"}`}
          >
            {m.status === "terminee" ? "✓" : m.status === "annulee" ? "✕" : "⏳"} {m.text}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {(Object.keys(FLUX_STYLE) as FluxType[]).map((t) => (
          <TypeChip key={t} type={t} />
        ))}
      </div>
      {missionId ? <MissionFlux missionId={missionId} /> : <LiveFeed />}
    </RoutePanel>
  );
}

// ------------------------------------------------------------------ en direct
function LiveFeed() {
  const flux = useWorld((s) => s.flux);
  const router = useRouter();
  const list = flux.slice(0, 120);
  return (
    <div className="mt-4">
      <p className="mb-2 text-[12px] text-ink-soft">Chaque échange apparaît aussi dans la ville : une liaison animée relie les deux agents.</p>
      <ul className="divide-y divide-paper-edge">
        {list.map((e) => (
          <li key={e.id} className="py-2">
            <div className="flex items-center gap-2">
              <button type="button" className="flex items-center gap-1.5" onClick={() => focus(e.from)} aria-label={`Voir ${nomDe(e.from)}`}>
                <Who id={e.from} />
              </button>
              <span className="text-ink-soft" style={{ color: FLUX_STYLE[e.type].color }}>
                ➜
              </span>
              <button type="button" className="flex items-center gap-1.5" onClick={() => e.to && focus(e.to)} aria-label={`Voir ${nomDe(e.to)}`}>
                <Who id={e.to} />
              </button>
              <span className="min-w-0 flex-1 truncate text-[13px]">
                <b>{nomDe(e.from)}</b> <span className="text-ink-soft">{FLUX_STYLE[e.type].verbe}</span> <b>{nomDe(e.to)}</b>
              </span>
              <span className="shrink-0 text-[11px] text-ink-soft tabular-nums">{formatParis(e.at, "HH:mm")}</span>
            </div>
            <div className="mt-1 flex items-start gap-2 pl-1">
              <TypeChip type={e.type} />
              <p className="line-clamp-2 text-[12.5px] text-ink/80">{e.text}</p>
            </div>
            {e.missionId && (
              <button type="button" onClick={() => router.push(`/flux?mission=${encodeURIComponent(e.missionId!)}`)} className="mt-1 pl-1 text-[11.5px] text-sea underline-offset-2 hover:underline">
                Voir toute la mission →
              </button>
            )}
          </li>
        ))}
        {!list.length && <li className="py-10 text-center text-sm text-ink-soft">Aucun échange pour l&apos;instant. Donne une mission à Marius : tu verras le travail circuler ici.</li>}
      </ul>
    </div>
  );
}

function focus(id: string): void {
  if (id === "fondateurs") return;
  getGame()?.flyToAgent(id);
  ui.selectAgent(id);
}

// ------------------------------------------------------------------ une mission
function MissionFlux({ missionId }: { missionId: string }) {
  const router = useRouter();
  const mission = useWorld((s) => s.missions.find((m) => m.id === missionId));
  const liveEvents = useWorld((s) => s.flux).filter((e) => e.missionId === missionId);
  const liveTasks = useWorld((s) => s.tasks).filter((t) => t.missionId === missionId);
  const rapports = useWorld((s) => s.rapports);
  const [data, setData] = useState<MissionFluxData | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const signature = `${liveEvents.length}|${liveTasks.map((t) => t.status).join(",")}`;

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => void loadMissionFlux(missionId).then((d) => alive && setData(d)), data ? 900 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId, signature]);

  // tâches : celles chargées + mises à jour temps réel
  const tasks = useMemo(() => {
    const m = new Map<string, TaskItem>();
    for (const t of data?.tasks ?? []) m.set(t.id, t);
    for (const t of liveTasks) m.set(t.id, { ...m.get(t.id), ...t, parentId: t.parentId ?? m.get(t.id)?.parentId });
    return [...m.values()].sort((a, b) => a.createdAt - b.createdAt);
  }, [data, liveTasks]);

  const events = useMemo(() => {
    const m = new Map<string, FluxEvent>();
    for (const e of [...(data?.events ?? []), ...liveEvents]) m.set(e.id, e);
    // anciens livrables sans message : on les déduit des sous-tâches terminées
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const livres = new Set([...m.values()].filter((e) => e.type === "livrable").map((e) => e.taskId));
    for (const t of tasks) {
      if (t.status !== "done" || livres.has(t.id) || !t.parentId) continue;
      const parent = byId.get(t.parentId);
      const to = parent?.agentId ?? (t.parentId.startsWith("synth_") ? "marius" : null);
      if (to && to !== t.agentId) m.set(`deduit_${t.id}`, { id: `deduit_${t.id}`, at: t.updatedAt, type: "livrable", from: t.agentId, to, text: `Livré : ${t.title}`, taskId: t.id, missionId });
    }
    return [...m.values()].filter((e) => e.to && e.from !== e.to).sort((a, b) => a.at - b.at);
  }, [data, liveEvents, tasks, missionId]);

  const synthese = Object.values(rapports).find((r) => r.missionId === missionId && !r.parentId && (!mission || r.agentId === mission.target));
  const lanes = useMemo(() => {
    const order: string[] = ["fondateurs", mission?.target ?? "marius"];
    for (const e of events) for (const id of [e.from, e.to]) if (id && !order.includes(id)) order.push(id);
    for (const t of tasks) if (t.agentId && !order.includes(t.agentId)) order.push(t.agentId);
    return order;
  }, [events, tasks, mission]);

  if (!mission && !data) return <p className="py-10 text-center text-sm text-ink-soft">Chargement de la mission…</p>;
  const selected = events.find((e) => e.id === sel);
  const sousTaches = tasks.filter((t) => t.parentId || t.agentId !== mission?.target);

  return (
    <div className="mt-4 space-y-4">
      {mission && (
        <div className="rounded-2xl border border-paper-edge bg-white/70 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[14px] leading-snug font-semibold">🎯 {mission.text}</p>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${mission.status === "terminee" ? "bg-moss/15 text-moss" : "bg-ink/8"}`}>{MISSION_STATUT[mission.status]}</span>
          </div>
          <p className="mt-1 text-[12px] text-ink-soft">
            Lancée {formatParis(mission.createdAt, "EEEE d MMMM à HH:mm")} · {lanes.length - 1} agent{lanes.length > 2 ? "s" : ""} · {events.length} échange{events.length > 1 ? "s" : ""}
          </p>
          {synthese && (
            <button type="button" onClick={() => router.push(`/rapports?id=${encodeURIComponent(synthese.taskId)}`)} className="mt-2 rounded-full bg-ink px-3 py-1.5 text-[13px] font-medium text-white">
              📄 Lire la synthèse
            </button>
          )}
        </div>
      )}

      <section>
        <h4 className="mb-1.5 font-silk text-[10px] tracking-wider text-ink-soft uppercase">Schéma des échanges</h4>
        <SequenceDiagram lanes={lanes} events={events} selected={sel} onSelect={(id) => setSel(sel === id ? null : id)} />
        {selected && (
          <div className="mt-2 rounded-2xl border-2 bg-white/80 p-3" style={{ borderColor: FLUX_STYLE[selected.type].color }}>
            <div className="flex items-center gap-2 text-[13px]">
              <TypeChip type={selected.type} />
              <b>{nomDe(selected.from)}</b> → <b>{nomDe(selected.to)}</b>
              <span className="ml-auto text-[11px] text-ink-soft">{formatParis(selected.at, "HH:mm:ss")}</span>
            </div>
            <p className="mt-2 text-[13px] whitespace-pre-wrap">{selected.text}</p>
            {selected.taskId && rapports[selected.taskId] && (
              <button type="button" onClick={() => router.push(`/rapports?id=${encodeURIComponent(selected.taskId!)}`)} className="mt-2 text-[12.5px] text-sea underline-offset-2 hover:underline">
                📄 Ouvrir le compte rendu →
              </button>
            )}
          </div>
        )}
      </section>

      {!!sousTaches.length && (
        <section>
          <h4 className="mb-1.5 font-silk text-[10px] tracking-wider text-ink-soft uppercase">Qui fait quoi</h4>
          <ul className="space-y-1.5">
            {sousTaches.map((t) => {
              const a = agentById(t.agentId);
              const r = rapports[t.id];
              return (
                <li key={t.id} className="flex items-center gap-2.5 rounded-xl border border-paper-edge bg-white/60 px-3 py-2">
                  <Portrait agentId={t.agentId} size={1.1} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{t.title}</span>
                    <span className="block text-[11px] text-ink-soft">
                      {a?.nom} · {poleById(a?.pole ?? "")?.court}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${STATUT[t.status].cls}`}>{STATUT[t.status].label}</span>
                  {r && (
                    <button type="button" onClick={() => router.push(`/rapports?id=${encodeURIComponent(t.id)}`)} className="shrink-0 rounded-full border border-ink/15 px-2 py-1 text-[12px]" aria-label={`Compte rendu de ${a?.nom}`}>
                      📄
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ diagramme de séquence
const LANE = 88;
const ROW = 50;
const HEAD = 62;

function SequenceDiagram({ lanes, events, selected, onSelect }: { lanes: string[]; events: FluxEvent[]; selected: string | null; onSelect: (id: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const width = Math.max(lanes.length * LANE, 300);
  const height = HEAD + Math.max(1, events.length) * ROW + 12;
  const x = (id: string | null) => (Math.max(0, lanes.indexOf(id ?? "")) + 0.5) * LANE;

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <div ref={scroller} className="max-h-[52vh] overflow-auto rounded-2xl border border-paper-edge bg-white/70">
      <div className="relative" style={{ width, height }}>
        {/* en-têtes des couloirs */}
        <div className="sticky top-0 z-10 flex border-b border-paper-edge bg-white/95 backdrop-blur" style={{ width, height: HEAD }}>
          {lanes.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => focus(id)}
              className="flex flex-col items-center justify-center gap-1 px-1"
              style={{ width: LANE }}
              title={id === "fondateurs" ? "Fondateurs" : agentById(id)?.role}
            >
              <Who id={id} size={1.2} />
              <span className="w-full truncate text-center text-[11px] font-semibold">{nomDe(id)}</span>
            </button>
          ))}
        </div>
        <svg className="absolute left-0" style={{ top: HEAD }} width={width} height={height - HEAD} aria-hidden>
          {lanes.map((id, i) => (
            <line key={id} x1={(i + 0.5) * LANE} x2={(i + 0.5) * LANE} y1={0} y2={height - HEAD} stroke="#d9cfbd" strokeDasharray="3 5" />
          ))}
          {events.map((e, i) => {
            const y = i * ROW + 34;
            const x1 = x(e.from);
            const x2 = x(e.to);
            const c = FLUX_STYLE[e.type].color;
            const dir = x2 >= x1 ? 1 : -1;
            const active = selected === e.id;
            return (
              <g key={e.id} opacity={selected && !active ? 0.35 : 1}>
                <line x1={x1} x2={x2 - dir * 6} y1={y} y2={y} stroke={c} strokeWidth={active ? 3.5 : 2.2} />
                <path d={`M${x2},${y} l${-dir * 9},-5 v10 z`} fill={c} />
                <circle cx={x1} cy={y} r={3.5} fill={c} />
              </g>
            );
          })}
        </svg>
        {/* étiquettes cliquables */}
        {events.map((e, i) => {
          const x1 = x(e.from);
          const x2 = x(e.to);
          const left = Math.min(x1, x2);
          const w = Math.max(Math.abs(x2 - x1), 120);
          const center = (x1 + x2) / 2;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onSelect(e.id)}
              className="absolute flex items-center gap-1 truncate rounded px-1 text-left text-[11px] leading-tight hover:bg-ink/5"
              style={{ top: HEAD + i * ROW + 8, left: Math.max(2, Math.min(width - w - 2, Math.abs(x2 - x1) >= 120 ? left : center - w / 2)), width: w, height: 20 }}
              title={e.text}
            >
              <span>{FLUX_STYLE[e.type].icon}</span>
              <span className="truncate">{e.text}</span>
              <span className="ml-auto shrink-0 pl-1 text-[9.5px] text-ink-soft tabular-nums">{formatParis(e.at, "HH:mm")}</span>
            </button>
          );
        })}
        {!events.length && <p className="absolute inset-x-0 text-center text-[12px] text-ink-soft" style={{ top: HEAD + 16 }}>Pas encore d&apos;échange sur cette mission.</p>}
      </div>
    </div>
  );
}
