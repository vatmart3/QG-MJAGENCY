"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AGENTS, POLE_BY_ID } from "@/data/seed";
import { getDirector } from "@/sim/director";
import { getGame } from "./gameRef";
import { Portrait } from "./Portrait";

/* Web Speech API (préfixée sur Safari / Chrome) */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
type SRCtor = new () => SpeechRecognitionLike;

function speechCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function CommandBar() {
  const [text, setText] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const [mentionIdx, setMentionIdx] = useState(0);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setCanSpeak(!!speechCtor()), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  // autocomplétion @agent
  const mention = useMemo(() => {
    const m = text.match(/@([\p{L}]*)$/u);
    if (!m) return null;
    const q = norm(m[1] ?? "");
    return AGENTS.filter((a) => norm(a.nom).startsWith(q)).slice(0, 6);
  }, [text]);

  const applyMention = (nom: string) => {
    setText((t) => t.replace(/@([\p{L}]*)$/u, `@${nom} `));
    input.current?.focus();
  };

  const send = () => {
    const t = text.trim();
    if (!t) return;
    getDirector().submitMission(t);
    const tag = t.match(/@([\p{L}]+)/u)?.[1];
    const target = tag ? AGENTS.find((a) => norm(a.nom) === norm(tag)) : undefined;
    const who = target && target.id !== "marius" ? target : AGENTS.find((a) => a.id === "marius");
    setToast(target && target.id !== "marius" ? `Mission confiée directement à ${target.nom}` : "Mission confiée à Marius — il planifie et répartit");
    if (who) setTimeout(() => getGame()?.flyToAgent(who.id), 250);
    setText("");
  };

  const toggleMic = () => {
    const Ctor = speechCtor();
    if (!Ctor) return;
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Ctor();
    r.lang = "fr-FR";
    r.interimResults = true;
    r.continuous = false;
    const base = text ? text.trimEnd() + " " : "";
    r.onresult = (e) => {
      let s = "";
      for (let i = 0; i < e.results.length; i++) s += e.results[i]?.[0]?.transcript ?? "";
      setText(base + s);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex flex-col items-center px-3 pb-[max(14px,env(safe-area-inset-bottom))]">
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6 }}
            className="mb-2 rounded-full bg-ink px-4 py-2 text-[13px] text-white shadow-lg"
            role="status"
          >
            ✓ {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pointer-events-auto relative w-full max-w-[640px]">
        {mention && mention.length > 0 && (
          <ul className="paper absolute bottom-full left-4 mb-2 w-64 overflow-hidden rounded-2xl p-1.5">
            {mention.map((a, i) => (
              <li key={a.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyMention(a.nom)}
                  className={`flex w-full items-center gap-2 rounded-xl px-2 py-1 text-left text-sm ${i === mentionIdx ? "bg-ink/6" : "hover:bg-ink/4"}`}
                >
                  <Portrait agentId={a.id} size={1.25} />
                  <b>@{a.nom}</b>
                  <span className="truncate text-xs text-ink-soft">
                    {POLE_BY_ID[a.pole]?.icone} {a.role}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="glass flex items-center gap-2 rounded-[22px] p-1.5 pl-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <span className="hidden shrink-0 sm:block">
            <Portrait agentId="marius" size={1.5} />
          </span>
          <input
            ref={input}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setMentionIdx(0);
            }}
            onKeyDown={(e) => {
              if (!mention?.length) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMentionIdx((i) => Math.min(mention.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setMentionIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Tab" || (e.key === "Enter" && mention[mentionIdx])) {
                e.preventDefault();
                const a = mention[mentionIdx];
                if (a) applyMention(a.nom);
              }
            }}
            placeholder={listening ? "Je t'écoute…" : "Donne une mission à Marius, ton DG…"}
            className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-[15px] outline-none placeholder:text-ink-soft/80"
            aria-label="Mission pour Marius"
            enterKeyHint="send"
          />
          {canSpeak && (
            <button
              type="button"
              onClick={toggleMic}
              className={`grid size-10 shrink-0 place-items-center rounded-full transition active:scale-95 ${listening ? "bg-phare text-white" : "text-ink-soft hover:bg-ink/5 hover:text-ink"}`}
              aria-label={listening ? "Arrêter la dictée" : "Dicter la mission"}
              aria-pressed={listening}
            >
              <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden>
                <rect x="5" y="1" width="6" height="10" rx="3" fill="currentColor" />
                <path d="M2 8a6 6 0 0012 0M8 14v3" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
              </svg>
            </button>
          )}
          <button
            type="submit"
            disabled={!text.trim()}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-white transition hover:bg-ink/90 active:scale-95 disabled:opacity-35"
            aria-label="Envoyer la mission"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M2 8h11M9 3.5L13.5 8 9 12.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>
        <p className="mt-1.5 hidden text-center text-[11.5px] text-ink/70 drop-shadow-[0_1px_0_rgba(255,255,255,0.6)] sm:block">
          Marius connaît tout le monde et répartit le travail entre les pôles. Tague un agent avec <b>@</b> pour lui parler directement.
        </p>
      </div>
    </div>
  );
}
