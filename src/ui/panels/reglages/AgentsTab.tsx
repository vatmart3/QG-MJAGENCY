"use client";

import { useState } from "react";
import { slugify, useCatalog } from "@/data/catalog";
import { getRepo } from "@/data/repo";
import type { AgentDef } from "@/data/types";
import { agentSchema, firstError, TOOLS } from "@/lib/schemas";
import { Portrait } from "../../Portrait";
import { Field, ListRow, SaveBar, Toggle, inputCls, linesToList, useSaver } from "./fields";

const TOOL_GROUPS: { label: string; tools: readonly string[] }[] = [
  { label: "Interne", tools: ["ask_agent", "delegate_task", "post_to_journal", "request_meeting", "finish_task", "ask_founder", "create_founder_todo"] },
  { label: "Mémoire", tools: ["read_company_memory", "search_memory", "write_agent_note", "propose_company_memory_update"] },
  { label: "Mails & agenda", tools: ["list_inbox", "read_email", "search_emails", "create_email_draft", "send_email", "label_email", "list_events", "find_free_slots", "create_event"] },
  { label: "CRM & prospection", tools: ["create_lead", "update_lead", "search_leads", "create_opportunity", "update_opportunity_stage", "get_client", "places_search", "fetch_url_summary", "web_search"] },
  { label: "Finance", tools: ["create_quote", "create_invoice", "render_pdf", "record_payment", "list_unpaid_invoices", "get_finance_summary", "get_tax_calendar"] },
  { label: "Tech", tools: ["check_site_health", "audit_url"] },
];

const blank = (pole: string, ordre: number): AgentDef => ({
  id: "",
  nom: "",
  pole,
  role: "",
  personnalite: "",
  promptSysteme: "",
  modele: "worker",
  outils: ["ask_agent", "delegate_task", "post_to_journal", "finish_task", "read_company_memory", "write_agent_note"],
  autonomie: 0,
  apparenceSeed: Math.random().toString(36).slice(2, 10),
  critique: false,
  responsable: false,
  sortant: false,
  taches: [],
  routines: [],
  actif: true,
  ordre,
});

export function AgentsTab() {
  const agents = useCatalog((s) => s.agents);
  const poles = useCatalog((s) => s.poles).filter((p) => p.kind === "pole");
  const [editing, setEditing] = useState<{ draft: AgentDef; isNew: boolean } | null>(null);

  if (editing) return <AgentForm key={editing.draft.id || "nouveau"} initial={editing.draft} isNew={editing.isNew} onDone={() => setEditing(null)} />;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-ink-soft">{agents.filter((a) => a.actif).length} agents actifs</p>
        <button
          type="button"
          onClick={() => setEditing({ draft: blank(poles[0]?.id ?? "", agents.length), isNew: true })}
          className="rounded-full bg-ink px-3.5 py-1.5 text-[13px] font-medium text-white"
        >
          + Nouvel agent
        </button>
      </div>
      <div className="space-y-3">
        {poles.map((p) => {
          const members = agents.filter((a) => a.pole === p.id).sort((a, b) => a.ordre - b.ordre);
          return (
            <section key={p.id}>
              <h4 className="mb-1 text-[12px] font-bold">
                {p.icone} {p.nom} <span className="font-normal text-ink-soft">· {members.filter((m) => m.actif).length}/4 bureaux</span>
              </h4>
              <div className="grid grid-cols-2 gap-0.5">
                {members.map((a) => (
                  <ListRow key={a.id} onClick={() => setEditing({ draft: a, isNew: false })}>
                    <Portrait agentId={a.id} size={1.1} />
                    <span className={`truncate ${a.actif ? "" : "line-through opacity-50"}`}>{a.nom}</span>
                  </ListRow>
                ))}
                {!members.length && <span className="px-2 text-[12px] text-ink-soft">Aucun agent</span>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function AgentForm({ initial, isNew, onDone }: { initial: AgentDef; isNew: boolean; onDone: () => void }) {
  const [a, setA] = useState<AgentDef>(initial);
  const [taches, setTaches] = useState(initial.taches.join("\n"));
  const allAgents = useCatalog((s) => s.agents);
  const poles = useCatalog((s) => s.poles).filter((p) => p.kind === "pole");
  const saver = useSaver();
  const set = <K extends keyof AgentDef>(k: K, v: AgentDef[K]) => setA((x) => ({ ...x, [k]: v }));
  const deskCount = allAgents.filter((x) => x.actif && x.pole === a.pole && x.id !== a.id).length;

  const save = () => {
    const draft: AgentDef = { ...a, id: isNew ? a.id || slugify(a.nom) : a.id, taches: linesToList(taches) };
    const parsed = agentSchema.safeParse(draft);
    if (!parsed.success) return saver.fail(firstError(parsed.error));
    if (isNew && allAgents.some((x) => x.id === draft.id)) return saver.fail("Cet identifiant est déjà pris.");
    void saver.run(async () => {
      await getRepo().saveAgent(draft);
      if (isNew) onDone();
    });
  };

  const remove = () => {
    if (!window.confirm(`Supprimer définitivement ${a.nom} ? Son historique reste dans le Journal. (Tu peux aussi simplement le désactiver.)`)) return;
    void saver.run(async () => {
      await getRepo().deleteAgent(a.id);
      onDone();
    }, "Supprimé");
  };

  return (
    <div>
      <button type="button" onClick={onDone} className="mb-3 text-sm text-sea">
        ← Tous les agents
      </button>
      <div className="flex items-end gap-4">
        <div className="grid h-[112px] w-[84px] place-items-end justify-center rounded-2xl bg-white/60 pb-2">
          <Portrait agentId={a.id || "nouveau"} seed={a.apparenceSeed} pole={a.pole} size={3.5} />
        </div>
        <div className="flex-1 space-y-2">
          <button type="button" onClick={() => set("apparenceSeed", Math.random().toString(36).slice(2, 10))} className="rounded-full border border-ink/15 px-3 py-1.5 text-[13px]">
            🎲 Nouvelle apparence
          </button>
          <p className="text-[11px] text-ink-soft">Le haut du bonhomme prend la couleur de son pôle.</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field label="Nom">
          <input className={inputCls} value={a.nom} onChange={(e) => set("nom", e.target.value)} maxLength={40} />
        </Field>
        <Field label="Identifiant" hint={isNew ? "Généré depuis le nom si vide" : "Non modifiable"}>
          <input className={inputCls} value={isNew ? a.id : a.id} placeholder={slugify(a.nom)} disabled={!isNew} onChange={(e) => set("id", slugify(e.target.value))} />
        </Field>
        <Field label="Pôle" hint={deskCount >= 4 ? "⚠️ Ce pôle a déjà 4 bureaux : l'agent travaillera debout." : undefined}>
          <select className={inputCls} value={a.pole} onChange={(e) => set("pole", e.target.value)}>
            {poles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.icone} {p.nom}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Rôle">
          <input className={inputCls} value={a.role} onChange={(e) => set("role", e.target.value)} maxLength={120} />
        </Field>
      </div>

      <div className="mt-3 space-y-3">
        <Field label="Personnalité (ton d'écriture)">
          <textarea className={inputCls} rows={2} value={a.personnalite} onChange={(e) => set("personnalite", e.target.value)} maxLength={400} />
        </Field>
        <Field label="Consignes propres à l'agent" hint="S'ajoutent aux règles communes (sécurité, ton MJAGENCY, mémoire d'entreprise) à partir de la Phase 3.">
          <textarea className={inputCls} rows={4} value={a.promptSysteme} onChange={(e) => set("promptSysteme", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Modèle">
            <select className={inputCls} value={a.modele} onChange={(e) => set("modele", e.target.value as AgentDef["modele"])}>
              <option value="planner">Opus — planification</option>
              <option value="worker">Sonnet — rédaction, analyse</option>
              <option value="light">Haiku — tri, tâches simples</option>
            </select>
          </Field>
          <Field label="Autonomie par défaut">
            <select className={inputCls} value={a.autonomie} onChange={(e) => set("autonomie", Number(e.target.value) as AgentDef["autonomie"])}>
              <option value={0}>0 — Brouillon (tout passe en Douane)</option>
              <option value={1}>1 — Envoi interne libre</option>
              <option value={2}>2 — Autonome sur règle</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Toggle checked={a.actif} onChange={(v) => set("actif", v)} label="Actif" hint="Inactif = n'apparaît plus dans la ville" />
          <Toggle checked={a.critique} onChange={(v) => set("critique", v)} label="Critique" hint="Continue si le budget est épuisé" />
          <Toggle checked={!!a.responsable} onChange={(v) => set("responsable", v)} label="Responsable de pôle" hint="Participe au stand-up" />
          <Toggle checked={a.sortant} onChange={(v) => set("sortant", v)} label="Prépare des envois" hint="Mails, factures… → Douane" />
        </div>

        <Field label="Outils autorisés">
          <div className="space-y-2 rounded-xl border border-paper-edge bg-white/50 p-2">
            {TOOL_GROUPS.map((g) => (
              <div key={g.label}>
                <div className="mb-1 font-silk text-[9px] uppercase text-ink-soft">{g.label}</div>
                <div className="flex flex-wrap gap-1">
                  {g.tools.map((t) => {
                    const on = a.outils.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => set("outils", on ? a.outils.filter((x) => x !== t) : [...a.outils, t].filter((x): x is (typeof TOOLS)[number] => (TOOLS as readonly string[]).includes(x)))}
                        className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] transition ${on ? "bg-ink text-white" : "bg-ink/6 text-ink-soft hover:bg-ink/10"}`}
                        aria-pressed={on}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Field>
        <Field label="Exemples de tâches (une par ligne)" hint="Utilisés par le mode démo.">
          <textarea className={inputCls} rows={3} value={taches} onChange={(e) => setTaches(e.target.value)} />
        </Field>
      </div>

      <SaveBar saver={saver} onSave={save} onCancel={onDone} onDelete={isNew ? undefined : remove} />
    </div>
  );
}
