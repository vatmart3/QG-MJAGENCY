/**
 * Carte des offres MJ (prix HT 2026, TVA non applicable — art. 293 B du CGI), reprise de l'artefact
 * « Carte des offres MJ. ». Le pilote commercial chiffre chaque prospect avec ces prix, sans IA : l'agent choisit
 * l'offre, le calcul est fait ici (jamais communiqué au prospect sans validation d'un fondateur).
 */

export type Niveau = "essentiel" | "pro" | "signature";
export type Formule = "A" | "C" | "B";

export const NIVEAUX: Record<Niveau, { nom: string; pour: string; comptant: number; maintenance: number; abo_mise: number; abo_mois: number; hybride_acompte: number; hybride_mois: number; livraison: string }> = {
  essentiel: { nom: "Site Essentiel", pour: "artisan, food truck, indépendant sans présence en ligne", comptant: 890, maintenance: 29, abo_mise: 190, abo_mois: 65, hybride_acompte: 390, hybride_mois: 59, livraison: "7 jours" },
  pro: { nom: "Site Vitrine Pro", pour: "boulangerie, restaurant, boucherie, salon : le commerce de quartier", comptant: 1690, maintenance: 49, abo_mise: 290, abo_mois: 119, hybride_acompte: 790, hybride_mois: 105, livraison: "2 à 3 semaines" },
  signature: { nom: "Site Signature", pour: "commerce qui veut se démarquer, marque locale, clientèle premium", comptant: 3200, maintenance: 69, abo_mise: 490, abo_mois: 199, hybride_acompte: 1490, hybride_mois: 169, livraison: "4 à 6 semaines" },
};

export const FORMULES: Record<Formule, string> = {
  A: "Paiement unique (40 % à la commande, 60 % à la livraison ou 3 fois sans frais ; maintenance en option)",
  C: "Hybride (acompte puis 18 mensualités, maintenance comprise ; site à lui au mois 19)",
  B: "Abonnement (petite mise en service puis 24 mensualités tout compris ; site à lui au mois 25)",
};

export const MENSUELS: Record<string, { nom: string; mois: number; detail: string }> = {
  presence: { nom: "Community management Présence", mois: 290, detail: "8 posts/mois, 1 réseau (engagement 3 mois)" },
  croissance: { nom: "Community management Croissance", mois: 490, detail: "12 posts, stories, 2 reels, Instagram + Facebook" },
  domination: { nom: "Community management Domination", mois: 790, detail: "16 posts, 4 reels, pub Meta" },
  google: { nom: "Fiche Google suivie", mois: 39, detail: "posts Google, réponses aux avis, horaires à jour" },
  pub: { nom: "Gestion pub Google / Meta", mois: 250, detail: "budget pub payé par le client en plus (300 € min. conseillés)" },
};

export const MODULES: Record<string, { nom: string; installation: number; mois: number }> = {
  nfc: { nom: "Cartes NFC avis Google", installation: 149, mois: 19 },
  fid: { nom: "Fidélité digitale sans appli", installation: 190, mois: 39 },
  ia: { nom: "Agent IA / chatbot", installation: 490, mois: 49 },
  vv: { nom: "Vitrine Vivante (hors écran)", installation: 1490, mois: 59 },
  borne: { nom: "Borne sans contact (hors matériel)", installation: 1290, mois: 49 },
};

export const OPTIONS: Record<string, { nom: string; prix: number }> = {
  page: { nom: "Page supplémentaire", prix: 150 },
  resa: { nom: "Réservation / prise de RDV", prix: 290 },
  ecom: { nom: "E-commerce jusqu'à 20 produits", prix: 690 },
  en: { nom: "Version anglaise", prix: 290 },
  logo: { nom: "Logo simple", prix: 290 },
  ident: { nom: "Identité visuelle complète", prix: 690 },
  gbp: { nom: "Création / optimisation fiche Google", prix: 149 },
  article: { nom: "Article de blog SEO", prix: 90 },
};

/** Packs (remise intégrée, engagement 6 mois sur la partie mensuelle). */
export const PACKS = [
  { id: "demarrage", nom: "Pack Démarrage", niveau: "essentiel" as Niveau, contenu: { modules: ["nfc"], options: ["gbp"], mensuels: [] as string[] }, signature: 990, mois: 45 },
  { id: "visibilite", nom: "Pack Visibilité", niveau: "pro" as Niveau, contenu: { modules: ["nfc"], options: [] as string[], mensuels: ["presence"] }, signature: 1590, mois: 329 },
  { id: "toutenun", nom: "Pack Tout-en-un", niveau: "signature" as Niveau, contenu: { modules: ["nfc", "fid"], options: [] as string[], mensuels: ["croissance"] }, signature: 3190, mois: 569 },
];

export interface Choix {
  niveau?: Niveau | null;
  formule?: Formule;
  modules?: string[];
  mensuels?: string[];
  options?: string[];
  /** paiement unique : maintenance mensuelle prise ou non */
  maintenance?: boolean;
}

export interface Chiffrage {
  lignes: string[];
  signature: number;
  mois: number;
  total24: number;
  pack: string | null;
  resume: string;
}

const eur = (n: number) => `${n.toLocaleString("fr-FR")} €`;

/** Chiffrage exact selon la Carte des offres (le pack est appliqué s'il revient moins cher). */
export function chiffrer(c: Choix): Chiffrage {
  const modules = (c.modules ?? []).filter((m) => MODULES[m]);
  const mensuels = (c.mensuels ?? []).filter((m) => MENSUELS[m]);
  const options = (c.options ?? []).filter((o) => OPTIONS[o]);
  const lignes: string[] = [];
  let signature = 0;
  let mois = 0;
  let moisSite = 0;
  let dureeSite = 0;
  const f = c.formule ?? "A";
  if (c.niveau && NIVEAUX[c.niveau]) {
    const n = NIVEAUX[c.niveau];
    if (f === "A") {
      signature += n.comptant;
      lignes.push(`${n.nom} — paiement unique ${eur(n.comptant)}`);
      if (c.maintenance !== false) {
        mois += n.maintenance;
        lignes.push(`Maintenance & hébergement ${eur(n.maintenance)}/mois (sans engagement)`);
      }
    } else if (f === "C") {
      signature += n.hybride_acompte;
      moisSite = n.hybride_mois;
      dureeSite = 18;
      lignes.push(`${n.nom} — hybride : acompte ${eur(n.hybride_acompte)} + ${eur(n.hybride_mois)}/mois pendant 18 mois (maintenance comprise)`);
    } else {
      signature += n.abo_mise;
      moisSite = n.abo_mois;
      dureeSite = 24;
      lignes.push(`${n.nom} — abonnement : mise en service ${eur(n.abo_mise)} + ${eur(n.abo_mois)}/mois pendant 24 mois (tout compris)`);
    }
  }
  for (const m of modules) {
    signature += MODULES[m]!.installation;
    mois += MODULES[m]!.mois;
    lignes.push(`${MODULES[m]!.nom} — ${eur(MODULES[m]!.installation)} + ${eur(MODULES[m]!.mois)}/mois`);
  }
  for (const m of mensuels) {
    mois += MENSUELS[m]!.mois;
    lignes.push(`${MENSUELS[m]!.nom} — ${eur(MENSUELS[m]!.mois)}/mois (${MENSUELS[m]!.detail})`);
  }
  for (const o of options) {
    signature += OPTIONS[o]!.prix;
    lignes.push(`${OPTIONS[o]!.nom} — ${eur(OPTIONS[o]!.prix)}`);
  }
  let total24 = signature + mois * 24 + moisSite * Math.min(24, dureeSite);
  let pack: string | null = null;
  // un pack correspondant (paiement unique ou hybride) revient-il moins cher ?
  const p = PACKS.find((pk) => pk.niveau === c.niveau && pk.contenu.modules.every((m) => modules.includes(m)) && pk.contenu.mensuels.every((m) => mensuels.includes(m)));
  if (p && f !== "B") {
    const horsPack = { mod: modules.filter((m) => !p.contenu.modules.includes(m)), mens: mensuels.filter((m) => !p.contenu.mensuels.includes(m)), opt: options.filter((o) => !p.contenu.options.includes(o)) };
    const sig = p.signature + horsPack.mod.reduce((s, m) => s + MODULES[m]!.installation, 0) + horsPack.opt.reduce((s, o) => s + OPTIONS[o]!.prix, 0);
    const mo = p.mois + horsPack.mod.reduce((s, m) => s + MODULES[m]!.mois, 0) + horsPack.mens.reduce((s, m) => s + MENSUELS[m]!.mois, 0);
    const t = sig + mo * 24;
    if (t < total24) {
      pack = p.nom;
      lignes.unshift(`${p.nom} — ${eur(p.signature)} + ${eur(p.mois)}/mois (remise intégrée, engagement 6 mois sur le mensuel)`);
      signature = sig;
      mois = mo;
      moisSite = 0;
      total24 = t;
    }
  }
  const moisTotal = mois + moisSite;
  return {
    lignes,
    signature,
    mois: moisTotal,
    total24,
    pack,
    resume: `${eur(signature)} à la signature${moisTotal ? ` + ${eur(moisTotal)}/mois` : ""} · ${eur(total24)} sur 24 mois${pack ? ` (${pack})` : ""}`,
  };
}

/** Texte court de la carte, pour la mémoire de l'entreprise et les consignes des agents. */
export const CARTE_TEXTE = [
  "Carte des offres MJ (prix HT, TVA non applicable). Sites : Essentiel 890 € (one-page, 7 j ; ou 390 € + 59 €/mois hybride, ou 190 € + 65 €/mois abonnement) ; Vitrine Pro 1 690 € (5-7 pages, élément 3D ; ou 790 € + 105 €/mois, ou 290 € + 119 €/mois) — l'offre principale ; Signature dès 3 200 € (DA complète, 3D poussée, réservation/boutique ; ou 1 490 € + 169 €/mois, ou 490 € + 199 €/mois).",
  "Maintenance 29/49/69 €/mois. Mensuels : Fiche Google suivie 39 €, community management Présence 290 € / Croissance 490 € / Domination 790 €, pub 250 €. Modules : NFC avis 149 € + 19 €/mois, fidélité 190 € + 39 €/mois, agent IA 490 € + 49 €/mois, Vitrine Vivante, borne.",
  "Options : page 150 €, réservation 290 €, e-commerce 690 €, anglais 290 €, logo 290 €, identité 690 €, fiche Google 149 €, article 90 €. Packs : Démarrage 990 € + 45 €/mois, Visibilité 1 590 € + 329 €/mois, Tout-en-un 3 190 € + 569 €/mois. Remises : −10 % asso/commerce de moins d'un an, −20 % 3 premiers clients vitrine, parrainage 1 mois offert.",
].join(" ");
