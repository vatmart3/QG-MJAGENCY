"use client";

import { useEffect, useRef, useState } from "react";
import { agentById, poleById, useCatalogVersion } from "@/data/catalog";
import { STATE_ICON, STATE_LABEL } from "@/data/types";
import { formatParis } from "@/lib/paris";
import { getDirector } from "@/sim/director";
import { useWorld } from "@/store/world";
import { ui, useUI } from "@/store/ui";
import { getGame } from "./gameRef";
import { Portrait } from "./Portrait";
import { SectionTitle, Sheet } from "./Sheet";

const MODEL_LABEL = { planner: "Opus · planification", worker: "Sonnet · rédaction & analyse", light: "Haiku · tri & tâches simples" } as const;
const AUTONOMY = [
  "0 — Brouillon : un humain valide tout ce qui sort",
  "1 — Envoi interne libre (récaps, alertes aux fondateurs)",
  "2 — Autonome sur règle validée en Douane",
] as const;

export function AgentSheet() {
  useCatalogVersion();
  const id = useUI((s) => s.selectedAgent);
  const agent = id ? agentById(id) : undefined;
  const rt = useWorld((s) => (id ? s.agents[id] : undefined));
  const tasks = useWorld((s) => s.tasks);
  const chat = useWorld((s) => (id ? s.chats[id] : undefined));
  const [msg, setMsg] = useState("");
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chat?.length]);

  const pole = agent ? poleById(agent.pole) : undefined;
  const history = id ? tasks.filter((t) => t.agentId === id && t.status !== "running").slice(0, 6) : [];

  return (
    <Sheet
      open={!!agent}
      onClose={() => ui.selectAgent(null)}
      title={agent?.nom ?? ""}
      kicker={pole ? `${pole.icone} ${pole.nom}` : ""}
      accent={pole?.couleur}
      footer={
        agent && (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!msg.trim() || !id) return;
              getDirector().chat(id, msg);
              setMsg("");
            }}
          >
            <input
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              placeholder={`Écrire à ${agent.nom}…`}
              className="min-w-0 flex-1 rounded-full border border-paper-edge bg-white/70 px-4 py-2.5 text-sm outline-none focus:border-ink/30"
              aria-label={`Message pour ${agent.nom}`}
            />
            <button type="submit" disabled={!msg.trim()} className="rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-35">
              Envoyer
            </button>
          </form>
        )
      }
    >
      {agent && rt && (
        <div>
          <div className="flex items-end gap-4">
            <button
              type="button"
              onClick={() => getGame()?.flyToAgent(agent.id)}
              className="relative grid h-[124px] w-[96px] shrink-0 place-items-end justify-center rounded-2xl pb-2"
              style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${pole?.couleur} 14%, white), color-mix(in srgb, ${pole?.couleur} 30%, white))` }}
              aria-label={`Voir ${agent.nom} dans la ville`}
              title="Voir dans la ville"
            >
              <Portrait agentId={agent.id} size={4} />
            </button>
            <div className="min-w-0 flex-1 pb-1">
              <div className="text-sm font-semibold">{agent.role}</div>
              <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-xs font-medium shadow-sm">
                <span>{STATE_ICON[rt.state]}</span>
                {STATE_LABEL[rt.state]}
                {rt.state === "offline" && rt.offlineReason === "nuit" && <span className="text-ink-soft">· de retour demain matin</span>}
              </div>
              <p className="mt-2 font-hand text-[19px] leading-[1.1] text-ink/85">« {agent.personnalite} »</p>
            </div>
          </div>

          <SectionTitle>Tâche en cours</SectionTitle>
          {rt.task ? (
            <div className="rounded-2xl border border-paper-edge bg-white/60 p-3">
              <div className="text-[15px] font-semibold">{rt.task.title}</div>
              <ol className="mt-2 space-y-1">
                {rt.task.steps.map((s, i) => {
                  const current = !s.done && (i === 0 || rt.task!.steps[i - 1]!.done);
                  return (
                    <li key={i} className={`flex items-center gap-2 text-sm ${s.done ? "text-ink-soft line-through decoration-ink/30" : current ? "font-medium" : "text-ink-soft"}`}>
                      <span className={`grid size-4 place-items-center rounded-full text-[9px] ${s.done ? "bg-moss text-white" : current ? "bg-ink text-white" : "bg-ink/10"}`}>
                        {s.done ? "✓" : current ? "•" : ""}
                      </span>
                      {s.label}
                      {current && <span className="ml-auto animate-pulse text-xs">en cours…</span>}
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : (
            <p className="text-sm text-ink-soft">
              {rt.state === "talking" && rt.talkWith ? `En discussion avec ${agentById(rt.talkWith)?.nom}.` : rt.state === "meeting" ? "En réunion dans La Criée." : "Aucune tâche en cours."}
            </p>
          )}

          <SectionTitle>Historique</SectionTitle>
          {history.length ? (
            <ul className="space-y-1.5">
              {history.map((t) => (
                <li key={t.id} className="flex items-baseline gap-2 text-sm">
                  <span className="font-silk text-[9px] text-ink-soft">{formatParis(t.updatedAt, "HH:mm")}</span>
                  <span className="flex-1">{t.title}</span>
                  <span className="text-xs">{t.status === "waiting_approval" ? "⏳" : t.status === "done" ? "✓" : ""}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">Rien pour l&apos;instant aujourd&apos;hui.</p>
          )}

          <SectionTitle>Outils autorisés</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {agent.outils.map((o) => (
              <code key={o} className="rounded-md bg-ink/6 px-1.5 py-0.5 text-[11px]">
                {o}
              </code>
            ))}
          </div>

          <SectionTitle>Réglages</SectionTitle>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-ink-soft">Autonomie</dt>
            <dd>{AUTONOMY[agent.autonomie]}</dd>
            <dt className="text-ink-soft">Modèle</dt>
            <dd>{MODEL_LABEL[agent.modele]}</dd>
            <dt className="text-ink-soft">Critique</dt>
            <dd>{agent.critique ? "Oui — continue même si le budget est épuisé" : "Non"}</dd>
            {agent.routines.length > 0 && (
              <>
                <dt className="text-ink-soft">Routines</dt>
                <dd>
                  {agent.routines.map((r) => (
                    <div key={r}>{r}</div>
                  ))}
                </dd>
              </>
            )}
          </dl>

          <SectionTitle>Chat direct</SectionTitle>
          <div className="space-y-2">
            {!chat?.length && <p className="text-sm text-ink-soft">Pose une question ou donne une consigne à {agent.nom}.</p>}
            {chat?.map((m, i) => (
              <div key={i} className={`flex ${m.from === "fondateur" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm ${m.from === "fondateur" ? "bg-ink text-white" : "bg-white/80 shadow-sm"}`}>{m.text}</div>
              </div>
            ))}
            <div ref={chatEnd} />
          </div>
        </div>
      )}
    </Sheet>
  );
}
