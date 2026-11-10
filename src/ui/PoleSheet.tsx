"use client";

import { POLE_BY_ID, agentsOfPole } from "@/data/seed";
import { STATE_ICON, STATE_LABEL } from "@/data/types";
import { formatParis } from "@/lib/paris";
import { useWorld } from "@/store/world";
import { ui, useUI } from "@/store/ui";
import { getGame } from "./gameRef";
import { Portrait } from "./Portrait";
import { DemoBadge, SectionTitle, Sheet } from "./Sheet";

export function PoleSheet() {
  const id = useUI((s) => s.selectedPole);
  const pole = id ? POLE_BY_ID[id] : undefined;
  const agents = useWorld((s) => s.agents);
  const tasks = useWorld((s) => s.tasks);
  const presence = useWorld((s) => s.presence);
  const approvals = useWorld((s) => s.approvals);
  const members = id ? agentsOfPole(id) : [];
  const memberIds = new Set(members.map((m) => m.id));
  const poleTasks = tasks.filter((t) => memberIds.has(t.agentId));
  const running = poleTasks.filter((t) => t.status === "running");
  const done = poleTasks.filter((t) => t.status === "done");
  const pending = approvals.filter((a) => memberIds.has(a.agentId));

  return (
    <Sheet
      open={!!pole}
      onClose={() => ui.selectPole(null)}
      title={pole?.nom ?? ""}
      kicker={pole?.kind === "lieu" ? "Lieu commun" : "Pôle"}
      icon={pole?.icone}
      accent={pole?.couleur}
    >
      {pole && (
        <div>
          <p className="text-[15px] leading-snug">{pole.description}</p>

          {pole.kind === "pole" && (
            <>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  { k: "Au poste", v: `${presence[pole.id] ?? 0}/${members.length}` },
                  { k: "En cours", v: running.length },
                  { k: "En Douane", v: pending.length },
                ].map((x) => (
                  <div key={x.k} className="rounded-2xl border border-paper-edge bg-white/60 px-3 py-2">
                    <div className="font-pixel text-2xl leading-none">{x.v}</div>
                    <div className="mt-1 text-[11px] text-ink-soft">{x.k}</div>
                  </div>
                ))}
              </div>

              <SectionTitle>Missions du pôle</SectionTitle>
              <ul className="space-y-1">
                {pole.missions.map((m) => (
                  <li key={m} className="flex gap-2 text-sm">
                    <span style={{ color: pole.couleur }}>▸</span>
                    {m}
                  </li>
                ))}
              </ul>

              <SectionTitle>Agents</SectionTitle>
              <ul className="space-y-1">
                {members.map((a) => {
                  const rt = agents[a.id];
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => {
                          ui.selectAgent(a.id);
                          getGame()?.flyToAgent(a.id);
                        }}
                        className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-ink/5"
                      >
                        <Portrait agentId={a.id} size={1.75} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold">{a.nom}</span>
                          <span className="block truncate text-xs text-ink-soft">{rt?.task?.title ?? a.role}</span>
                        </span>
                        <span className="text-xs text-ink-soft" title={rt ? STATE_LABEL[rt.state] : ""}>
                          {rt ? STATE_ICON[rt.state] : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <SectionTitle right={<DemoBadge />}>Terminé aujourd&apos;hui</SectionTitle>
              {done.length ? (
                <ul className="space-y-1">
                  {done.slice(0, 8).map((t) => (
                    <li key={t.id} className="flex items-baseline gap-2 text-sm">
                      <span className="font-silk text-[9px] text-ink-soft">{formatParis(t.updatedAt, "HH:mm")}</span>
                      {t.title}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-soft">Les tâches terminées apparaîtront ici.</p>
              )}
            </>
          )}

          {pole.kind === "lieu" && (
            <p className="mt-4 font-hand text-xl text-ink/80">
              {presence[pole.id] ?? 0} agent{(presence[pole.id] ?? 0) > 1 ? "s" : ""} sur place en ce moment.
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}
