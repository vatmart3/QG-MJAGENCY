"use client";

import { useState } from "react";

export function LoginForm({ erreur }: { erreur?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "envoi" | "envoye" | "erreur">(erreur ? "erreur" : "idle");
  const [msg, setMsg] = useState(erreur === "lien" ? "Ce lien a expiré ou a déjà servi. Demande-en un nouveau." : "");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("envoi");
    setMsg("");
    try {
      const res = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "L'envoi a échoué.");
      setState("envoye");
    } catch (err) {
      setState("erreur");
      setMsg(err instanceof Error ? err.message : "L'envoi a échoué.");
    }
  };

  if (state === "envoye") {
    return (
      <div className="mt-6" role="status">
        <p className="text-sm">
          Si <b>{email}</b> a accès au port, un lien de connexion vient de partir.
        </p>
        <p className="mt-2 font-hand text-xl leading-tight text-ink/80">Ouvre-le depuis cet appareil. Il est valable une heure.</p>
        <button type="button" onClick={() => setState("idle")} className="mt-4 text-sm text-sea underline underline-offset-2">
          Utiliser une autre adresse
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6">
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
      <button type="submit" disabled={state === "envoi"} className="mt-3 w-full rounded-full bg-ink py-2.5 text-sm font-medium text-white transition hover:bg-ink/90 disabled:opacity-50">
        {state === "envoi" ? "Envoi…" : "Recevoir mon lien magique"}
      </button>
      {state === "erreur" && msg && (
        <p className="mt-3 text-sm text-phare" role="alert">
          {msg}
        </p>
      )}
    </form>
  );
}
