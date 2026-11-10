"use client";

import { useState } from "react";
import { useUI } from "@/store/ui";
import { AbonnementsTab, ClientsTab, EcommTab, ExportsTab, FiscalTab } from "./finances/Autres";
import { Dashboard } from "./finances/Dashboard";
import { useFinance } from "./finances/data";
import { PiecesTab } from "./finances/Pieces";
import { RoutePanel } from "./RoutePanel";

const TABS = [
  { id: "tableau", label: "Tableau de bord" },
  { id: "factures", label: "Factures" },
  { id: "devis", label: "Devis" },
  { id: "clients", label: "Clients" },
  { id: "abonnements", label: "Abonnements" },
  { id: "exports", label: "Exports & import" },
  { id: "fiscal", label: "Fiscal & réglages" },
  { id: "ecomm", label: "MJ E-comm" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** Finances de MJAGENCY : facturation conforme, encaissements, exports comptables, prévisionnel, fiscal. */
export function FinancesPanel() {
  const conn = useUI((s) => s.conn);
  return (
    <RoutePanel title="Finances" kicker="Facturation & trésorerie" icon="💶" accent="#2e9d62" width={780}>
      {conn === "demo" ? (
        <p className="text-sm text-ink-soft">
          Mode démo : branche Supabase pour utiliser la facturation (factures conformes, devis, paiements, exports). Rien n&apos;est simulé ici pour ne pas mélanger de faux chiffres avec ta compta.
        </p>
      ) : (
        <Live />
      )}
    </RoutePanel>
  );
}

function Live() {
  const { data, error, reload } = useFinance();
  const [tab, setTab] = useState<Tab>("tableau");
  const [ouvrir, setOuvrir] = useState<string | null>(null);
  const go = (t: Tab, id: string | null = null) => {
    setTab(t);
    setOuvrir(id);
  };
  if (error) return <p className="rounded-xl bg-phare/10 px-3 py-2 text-[13px] text-phare">{error}</p>;
  if (!data) return <p className="text-[13px] text-ink-soft">Chargement des finances…</p>;
  return (
    <div>
      <div className="hide-scrollbar -mx-1 mb-4 flex gap-1 overflow-x-auto px-1">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => go(t.id)} className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium transition ${tab === t.id ? "bg-ink text-white" : "bg-ink/5 text-ink-soft hover:text-ink"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "tableau" && <Dashboard d={data} onOpen={(_, id) => go("factures", id)} />}
      {tab === "factures" && <PiecesTab kind="facture" d={data} reload={reload} ouvrir={ouvrir} setOuvrir={setOuvrir} />}
      {tab === "devis" && <PiecesTab kind="devis" d={data} reload={reload} ouvrir={ouvrir} setOuvrir={setOuvrir} />}
      {tab === "clients" && <ClientsTab d={data} reload={reload} />}
      {tab === "abonnements" && <AbonnementsTab d={data} reload={reload} />}
      {tab === "exports" && <ExportsTab reload={reload} />}
      {tab === "fiscal" && <FiscalTab d={data} reload={reload} />}
      {tab === "ecomm" && <EcommTab d={data} reload={reload} />}
    </div>
  );
}
