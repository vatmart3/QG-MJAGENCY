"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { AGENT_BY_ID } from "@/data/seed";
import { formatParis } from "@/lib/paris";
import { getDirector } from "@/sim/director";
import { useWorld, type Approval } from "@/store/world";
import { Portrait } from "../Portrait";
import { DemoBadge } from "../Sheet";
import { RoutePanel } from "./RoutePanel";

const VERB: Record<Approval["type"], string> = {
  email: "veut envoyer ce mail",
  facture: "veut envoyer cette facture",
  devis: "veut envoyer ce devis",
  relance: "veut envoyer cette relance",
  rdv: "veut envoyer cette invitation",
  question: "te pose une question",
};

export function DouanePanel() {
  const approvals = useWorld((s) => s.approvals);
  return (
    <RoutePanel title="La Douane" kicker={`${approvals.length} élément${approvals.length > 1 ? "s" : ""} à valider`} icon="📦" accent="#c0392b" width={500}>
      <p className="mb-3 text-sm text-ink-soft">
        Rien ne sort du port sans ton accord : mails, factures, devis, invitations. Valide en un clic, ou crée une règle d&apos;autonomie. <DemoBadge />
      </p>
      <ul className="space-y-3">
        <AnimatePresence initial={false}>
          {approvals.map((a) => (
            <motion.li key={a.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -40, rotate: -3 }} transition={{ duration: 0.22 }}>
              <ApprovalCard ap={a} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {!approvals.length && (
        <div className="py-10 text-center">
          <div className="text-4xl">🌊</div>
          <p className="mt-2 font-hand text-2xl">Tout est validé. Le phare peut se reposer.</p>
        </div>
      )}
    </RoutePanel>
  );
}

function ApprovalCard({ ap }: { ap: Approval }) {
  const agent = AGENT_BY_ID[ap.agentId];
  const [mode, setMode] = useState<"view" | "edit" | "refuse">("view");
  const [draft, setDraft] = useState(ap.preview);
  const [motif, setMotif] = useState("");
  const d = getDirector();
  const neverAuto = ap.type === "facture" || ap.type === "question";

  return (
    <article className="relative rounded-2xl border border-paper-edge bg-white/75 p-3.5 shadow-[0_2px_0_var(--color-paper-edge)]">
      <header className="flex items-center gap-2.5">
        <Portrait agentId={ap.agentId} size={1.6} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] leading-tight">
            <b>{agent?.nom}</b> {VERB[ap.type]}
            {ap.to && (
              <>
                {" "}à <span className="font-medium">{ap.to}</span>
              </>
            )}
          </div>
          <div className="font-silk text-[9px] text-ink-soft">
            {formatParis(ap.createdAt, "HH:mm")} · {ap.title}
          </div>
        </div>
      </header>

      {ap.subject && (
        <div className="mt-2.5 text-sm">
          <span className="text-ink-soft">Objet : </span>
          <b>{ap.subject}</b>
        </div>
      )}
      {mode === "edit" ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          className="mt-2 w-full rounded-xl border border-ink/15 bg-white p-2.5 text-[13px] leading-relaxed outline-none focus:border-ink/40"
          aria-label="Modifier le contenu"
        />
      ) : (
        <pre className="mt-2 max-h-48 overflow-y-auto rounded-xl bg-paper-2/70 p-2.5 font-sans text-[13px] leading-relaxed whitespace-pre-wrap">{ap.preview}</pre>
      )}

      {mode === "refuse" && (
        <input
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          placeholder="Motif du refus (l'agent s'en servira pour corriger)"
          className="mt-2 w-full rounded-full border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-ink/40"
          autoFocus
        />
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {mode === "view" && (
          <>
            <button type="button" onClick={() => d.approve(ap.id)} className="rounded-full bg-ink px-3.5 py-1.5 text-[13px] font-medium text-white transition hover:bg-ink/90 active:scale-95">
              {ap.type === "question" ? "Répondre : oui" : "Envoyer"}
            </button>
            <button type="button" onClick={() => setMode("edit")} className="rounded-full border border-ink/15 px-3.5 py-1.5 text-[13px] transition hover:bg-ink/5">
              Modifier
            </button>
            <button type="button" onClick={() => setMode("refuse")} className="rounded-full border border-ink/15 px-3.5 py-1.5 text-[13px] transition hover:bg-ink/5">
              Refuser
            </button>
            {!neverAuto && (
              <button type="button" onClick={() => d.approve(ap.id, "regle")} className="rounded-full px-3 py-1.5 text-[13px] text-sea underline-offset-2 hover:underline" title="Crée une règle d'autonomie révocable dans Réglages">
                Toujours autoriser ce type
              </button>
            )}
          </>
        )}
        {mode === "edit" && (
          <>
            <button type="button" onClick={() => d.approve(ap.id, "modifie")} className="rounded-full bg-ink px-3.5 py-1.5 text-[13px] font-medium text-white">
              Envoyer la version modifiée
            </button>
            <button type="button" onClick={() => setMode("view")} className="rounded-full px-3 py-1.5 text-[13px] text-ink-soft">
              Annuler
            </button>
          </>
        )}
        {mode === "refuse" && (
          <>
            <button type="button" onClick={() => d.refuse(ap.id, motif)} className="rounded-full bg-phare px-3.5 py-1.5 text-[13px] font-medium text-white">
              Confirmer le refus
            </button>
            <button type="button" onClick={() => setMode("view")} className="rounded-full px-3 py-1.5 text-[13px] text-ink-soft">
              Annuler
            </button>
          </>
        )}
      </div>
      {neverAuto && mode === "view" && ap.type === "facture" && (
        <p className="mt-2 text-[11px] text-ink-soft">Les factures ne sont jamais envoyées automatiquement.</p>
      )}
    </article>
  );
}
