"use client";

import { useState } from "react";

type Mode = "motdepasse" | "lien";

export function LoginForm({ erreur }: { erreur?: string }) {
  const [mode, setMode] = useState<Mode>("motdepasse");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "envoi" | "envoye" | "erreur">(erreur ? "erreur" : "idle");
  const [msg, setMsg] = useState(erreur === "lien" ? "Ce lien a expiré ou a déjà servi. Demande-en un nouveau." : "");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("envoi");
    setMsg("");
    try {
      const res = await fetch(mode === "motdepasse" ? "/api/auth/password" : "/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "motdepasse" ? { email, password } : { email }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "La connexion a échoué.");
      if (mode === "motdepasse") {
        window.location.href = "/";
        return;
      }
      setState("envoye");
    } catch (err) {
      setState("erreur");
      setMsg(err instanceof Error ? err.message : "La connexion a échoué.");
    }
  };

  if (state === "envoye") {
    return (
      <div className="mt-6" role="status">
        <p className="text-sm">
          Si <b>{email}</b> a accès au port, un lien de connexion vient de partir.
        </p>
        <p className="mt-2 font-hand text-xl leading-tight text-ink/80">Regarde aussi dans les spams : l&apos;expéditeur est noreply@mail.app.supabase.io.</p>
        <button type="button" onClick={() => setState("idle")} className="mt-4 text-sm text-sea underline underline-offset-2">
          Revenir
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6">
      <div className="mb-4 flex gap-1 rounded-full bg-ink/5 p-1">
        {(["motdepasse", "lien"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setState("idle");
              setMsg("");
            }}
            className={`flex-1 rounded-full px-3 py-1.5 text-[13px] font-medium ${mode === m ? "bg-white shadow-sm" : "text-ink-soft"}`}
          >
            {m === "motdepasse" ? "Mot de passe" : "Lien par e-mail"}
          </button>
        ))}
      </div>
      <label className="block text-sm">
        E-mail
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ton@email.fr"
          className="mt-1 w-full rounded-full border border-paper-edge bg-white/80 px-4 py-2.5 outline-none focus:border-ink/40"
        />
      </label>
      {mode === "motdepasse" && (
        <label className="mt-3 block text-sm">
          Mot de passe
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-full border border-paper-edge bg-white/80 px-4 py-2.5 outline-none focus:border-ink/40"
          />
        </label>
      )}
      <button type="submit" disabled={state === "envoi"} className="mt-3 w-full rounded-full bg-ink py-2.5 text-sm font-medium text-white transition hover:bg-ink/90 disabled:opacity-50">
        {state === "envoi" ? "Un instant…" : mode === "motdepasse" ? "Entrer dans le port" : "Recevoir mon lien"}
      </button>
      {state === "erreur" && msg && (
        <p className="mt-3 text-sm text-phare" role="alert">
          {msg}
        </p>
      )}
      {mode === "motdepasse" && (
        <p className="mt-3 text-[12px] text-ink-soft">Pas encore de mot de passe ? Connecte-toi une fois avec le lien par e-mail, puis choisis-le dans Réglages → Accès & budget.</p>
      )}
    </form>
  );
}
