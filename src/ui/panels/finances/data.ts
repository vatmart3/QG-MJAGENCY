"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";
import { FINANCE_DEFAUT, lireFinance, num, type Client, type EcommMonth, type FinanceSettings, type Invoice, type Ligne, type Payment, type Quote, type Subscription } from "@/finance/types";

export interface FinanceData {
  invoices: Invoice[];
  quotes: Quote[];
  clients: Client[];
  payments: Payment[];
  subscriptions: Subscription[];
  ecomm: EcommMonth[];
  settings: FinanceSettings;
}

const normL = (l: unknown): Ligne[] => (Array.isArray(l) ? (l as Ligne[]).map((x) => ({ designation: x.designation ?? "", quantite: num(x.quantite), prix_unitaire: num(x.prix_unitaire) })) : []);

/** Données finance (lecture directe, sécurisée par la RLS) + rechargement en temps réel. */
export function useFinance(): { data: FinanceData | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<FinanceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const sb = browserSupabase();
    if (!sb) return;
    const since = new Date(Date.now() - 400 * 86400_000).toISOString().slice(0, 10);
    const [inv, quo, cli, pay, sub, eco, set] = await Promise.all([
      sb.from("invoices").select("*").order("cree_le", { ascending: false }).limit(2000),
      sb.from("quotes").select("*").order("cree_le", { ascending: false }).limit(1000),
      sb.from("clients").select("*").order("nom").limit(2000),
      sb.from("payments").select("*").gte("date", since).order("date").limit(5000),
      sb.from("subscriptions").select("*").order("libelle"),
      sb.from("ecomm_months").select("*").order("mois", { ascending: false }).limit(36),
      sb.from("settings").select("finance").eq("id", 1).maybeSingle(),
    ]);
    const err = [inv, quo, cli, pay, sub, eco].find((r) => r.error)?.error;
    if (err) {
      setError(/does not exist|schema cache/i.test(err.message) ? "La base n'a pas encore les tables finance (migration 1000 à appliquer)." : err.message);
      return;
    }
    setError(null);
    setData({
      invoices: ((inv.data ?? []) as Invoice[]).map((i) => ({ ...i, total: num(i.total), lignes: normL(i.lignes) })),
      quotes: ((quo.data ?? []) as Quote[]).map((q) => ({ ...q, total: num(q.total), lignes: normL(q.lignes) })),
      clients: (cli.data ?? []) as Client[],
      payments: ((pay.data ?? []) as Payment[]).map((p) => ({ ...p, montant: num(p.montant) })),
      subscriptions: ((sub.data ?? []) as Subscription[]).map((s) => ({ ...s, montant: num(s.montant), lignes: normL(s.lignes) })),
      ecomm: ((eco.data ?? []) as EcommMonth[]).map((e) => ({ ...e, ca: num(e.ca), cout_marchandises: num(e.cout_marchandises), depenses_pub: num(e.depenses_pub), autres_frais: num(e.autres_frais) })),
      settings: set.data ? lireFinance(set.data.finance) : FINANCE_DEFAUT,
    });
  }, []);

  const reload = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(), 250);
  }, [load]);

  useEffect(() => {
    void load();
    const sb = browserSupabase();
    if (!sb) return;
    const ch = sb
      .channel(`finances-${Date.now().toString(36)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "quotes" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, reload)
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [load, reload]);

  return { data, error, reload };
}

/** Appel d'une route finance (JSON) ; lève une erreur lisible. */
export async function api<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(d.error ?? `Erreur ${res.status}`);
  return d;
}

export const today = () => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());
export const pdfUrl = (kind: "facture" | "devis", id: string, dl = false) => `/api/finance/pdf?kind=${kind}&id=${encodeURIComponent(id)}${dl ? "&dl=1" : ""}`;
