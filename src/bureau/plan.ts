import { agentsOfPole, allLieux, allPoles } from "@/data/catalog";

/**
 * Plan du bureau 3D de MJAGENCY (mètres ; x vers l'est, z vers le sud, y vers le haut).
 * Un bâtiment fermé : quatre rangées de pièces, « La rue des pôles » au milieu (est-ouest), deux couloirs
 * secondaires et un passage central (nord-sud) qui mène au hall d'entrée. Les pôles donnent sur la rue par
 * des cloisons vitrées ; les lieux de vie (café, restaurant, salle de réunion…) sont dans les rangées extérieures.
 * Calcul pur (sans three.js) : pièces, murs, meubles, places des agents, grilles de collision et de déplacement.
 */

export const LARGEUR_PIECE = 10;
export const PROFONDEUR_PIECE = 8;
export const HAUTEUR = 3;
export const PASSAGE = 4;
const COULOIR = 2.6;
const RUE = 5;
export const RES = 0.25;

export type TypeMur = "plein" | "verre" | "exterieur" | "baie";
export type Cote = "n" | "s" | "e" | "o";

export interface Piece {
  id: string;
  nom: string;
  icone: string;
  couleur: string;
  sol: string;
  kind: "pole" | "lieu" | "extra";
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** côté de la porte et centre de la porte */
  cote: Cote;
  porte: { x: number; z: number };
}

/** Mur le long de x (axe « x », z constant = c) ou le long de z (axe « z », x constant = c), avec ses ouvertures. */
export interface Mur {
  axe: "x" | "z";
  c: number;
  a0: number;
  a1: number;
  type: TypeMur;
  trous: [number, number][];
}

export type TypeMeuble =
  | "bureau" | "chaise" | "plante" | "etagere" | "tableau" | "imprimante" | "canape" | "pouf" | "tapis" | "grandeTable" | "ecran"
  | "comptoir" | "machineCafe" | "tableRonde" | "tabouret" | "tampon" | "colis" | "archive" | "babyfoot" | "pingpong" | "tapisCourse"
  | "halteres" | "accueil" | "serveur" | "arbre" | "banc" | "micro" | "caisse" | "lampe" | "frigo";

export interface Meuble {
  type: TypeMeuble;
  x: number;
  z: number;
  /** rotation autour de y (radians) : 0 = face au sud (+z) */
  angle: number;
  /** emprise au sol (avant rotation) */
  w: number;
  d: number;
  bloque: boolean;
  couleur?: string;
  zone: string;
  variante?: number;
}

export type TypeSpot = "desk" | "cafe" | "terrasse" | "detente" | "criee" | "douane" | "archives" | "resto" | "lecture" | "sport";

export interface Spot3 {
  x: number;
  z: number;
  /** direction du regard (radians, 0 = sud) */
  angle: number;
  pose: "sit" | "stand";
  kind: TypeSpot;
  zone: string;
}

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Plan {
  W: number;
  D: number;
  pieces: Piece[];
  murs: Mur[];
  meubles: Meuble[];
  spots: Spot3[];
  deskOf: Record<string, Spot3>;
  /** devant la porte d'entrée, à l'intérieur (les agents arrivent et repartent par là) */
  entree: { x: number; z: number };
  /** couloirs : la rue, les deux couloirs, le passage central */
  couloirs: (Rect & { nom: string })[];
  gw: number;
  gh: number;
  /** 1 = infranchissable (murs, meubles) : collisions du visiteur */
  solide: Uint8Array;
  /** 1 = mur plein (cache la vue) : les cloisons vitrées et les meubles n'y sont pas */
  opaque: Uint8Array;
  /** 1 = interdit aux agents (solide élargi d'une case) */
  nav: Uint8Array;
  /** indice de pièce par case (-1 = couloir ou dehors) */
  pieceDe: Int16Array;
}

const EXTRAS: Record<string, { nom: string; icone: string; couleur: string; sol: string }> = {
  hall: { nom: "Accueil", icone: "🛎️", couleur: "#2f7d6b", sol: "#e9dcc6" },
  serveurs: { nom: "Salle des serveurs", icone: "🖥️", couleur: "#3d4a66", sol: "#cfd6e2" },
  podcast: { nom: "Studio podcast", icone: "🎙️", couleur: "#5a3d7a", sol: "#d9cfe6" },
  patio: { nom: "Jardin d'hiver", icone: "🌿", couleur: "#3f8f4f", sol: "#cfe3c4" },
  cine: { nom: "Ciné", icone: "🎬", couleur: "#7a2f45", sol: "#4c3344" },
  jeux: { nom: "Jeux vidéo", icone: "🎮", couleur: "#3a5c9c", sol: "#d6dcec" },
  sieste: { nom: "Siestes", icone: "😴", couleur: "#6d5a8f", sol: "#ddd6ea" },
  flex: { nom: "Bureaux libres", icone: "💻", couleur: "#7d8494", sol: "#e6e3dc" },
  reserve: { nom: "Réserve", icone: "📦", couleur: "#8a7a63", sol: "#e2dccf" },
};

const SUD = 0;
const EST = Math.PI / 2;
const NORD = Math.PI;
const OUEST = -Math.PI / 2;

export function construirePlan(): Plan {
  const poles = allPoles();
  const lieux = allLieux();
  const infos = new Map([...poles, ...lieux].map((p) => [p.id, p]));
  const existe = (id: string) => infos.has(id);

  // ---- 1. répartition des pièces dans les quatre rangées
  // pôles sur la rue (rangées B et C), lieux de vie dans les rangées extérieures (A et D), le hall près de l'entrée
  const pair = (n: number) => 2 * Math.ceil(n / 2);
  const cols = Math.max(6, pair(Math.ceil(poles.length / 2)), pair(Math.ceil((lieux.length + 1) / 2)));
  const moitie = cols / 2;
  const demi = {
    gaucheA: ["archives", "mediatheque", "criee"].filter(existe),
    droiteA: ["douane"].filter(existe),
    gaucheD: ["sport", "detente", "quai"].filter(existe),
    droiteD: ["hall", "restaurant"].filter((id) => id === "hall" || existe(id)),
  };
  const places = new Set(Object.values(demi).flat());
  const reste = [...poles.slice(2 * cols), ...lieux.filter((l) => !places.has(l.id))].map((p) => p.id);
  for (const l of Object.values(demi)) while (l.length > moitie) reste.push(l.pop()!);
  // pièces d'agrément pour compléter : serveurs, studio podcast, jardin d'hiver, puis réserves
  const agrement = ["serveurs", "podcast", "patio", "cine", "jeux", "sieste"];
  const completer = (l: string[], auDebut: boolean) => {
    while (l.length < moitie) {
      const id = reste.shift() ?? agrement.shift() ?? (l.length % 2 ? "reserve" : "flex");
      if (auDebut) l.unshift(id);
      else l.push(id);
    }
  };
  completer(demi.gaucheA, true);
  completer(demi.droiteA, false);
  completer(demi.gaucheD, true);
  completer(demi.droiteD, false);
  const rangA = [...demi.gaucheA, ...demi.droiteA];
  const rangD = [...demi.gaucheD, ...demi.droiteD];
  const idsPoles = poles.map((p) => p.id);
  const rangB = Array.from({ length: cols }, (_, i) => idsPoles[i] ?? reste.shift() ?? "flex");
  const rangC = Array.from({ length: cols }, (_, i) => idsPoles[cols + i] ?? reste.shift() ?? "flex");

  // ---- 2. géométrie
  const zA = 0;
  const zC1 = zA + PROFONDEUR_PIECE;
  const zB = zC1 + COULOIR;
  const zRue = zB + PROFONDEUR_PIECE;
  const zC = zRue + RUE;
  const zC2 = zC + PROFONDEUR_PIECE;
  const zD = zC2 + COULOIR;
  const D = zD + PROFONDEUR_PIECE;
  const W = cols * LARGEUR_PIECE + PASSAGE;
  const xPassage = moitie * LARGEUR_PIECE;
  const xCol = (i: number) => (i < moitie ? i * LARGEUR_PIECE : xPassage + PASSAGE + (i - moitie) * LARGEUR_PIECE);

  const pieces: Piece[] = [];
  const vus = new Map<string, number>();
  const ajouterRang = (ids: string[], z0: number, cote: Cote) => {
    ids.forEach((id0, i) => {
      // une pièce de remplissage peut revenir plusieurs fois : identifiant unique
      const n = vus.get(id0) ?? 0;
      vus.set(id0, n + 1);
      const id = n ? `${id0}${n + 1}` : id0;
      const info = infos.get(id0);
      const ex = EXTRAS[id0] ?? EXTRAS.flex!;
      const x0 = xCol(i);
      const x1 = x0 + LARGEUR_PIECE;
      const z1 = z0 + PROFONDEUR_PIECE;
      pieces.push({
        id,
        nom: info?.nom ?? ex.nom,
        icone: info?.icone ?? ex.icone,
        couleur: info?.couleur ?? ex.couleur,
        sol: info?.sol ?? ex.sol,
        kind: info ? info.kind : "extra",
        x0,
        z0,
        x1,
        z1,
        cote,
        porte: { x: (x0 + x1) / 2, z: cote === "s" ? z1 : z0 },
      });
    });
  };
  ajouterRang(rangA, zA, "s");
  ajouterRang(rangB, zB, "s");
  ajouterRang(rangC, zC, "n");
  ajouterRang(rangD, zD, "n");

  const couloirs: Plan["couloirs"] = [
    { nom: "La rue des pôles", x0: 0, z0: zRue, x1: W, z1: zC },
    { nom: "Couloir nord", x0: 0, z0: zC1, x1: W, z1: zB },
    { nom: "Couloir sud", x0: 0, z0: zC2, x1: W, z1: zD },
    { nom: "Le passage", x0: xPassage, z0: 0, x1: xPassage + PASSAGE, z1: D },
  ];

  // ---- 3. murs (dédoublonnés : deux pièces voisines partagent le même mur)
  const murs = new Map<string, Mur>();
  const rang: Record<TypeMur, number> = { plein: 0, verre: 1, exterieur: 2, baie: 3 };
  const mur = (axe: "x" | "z", c: number, a0: number, a1: number, type: TypeMur, trous: [number, number][] = []) => {
    const k = `${axe}:${c}:${a0}:${a1}`;
    const m = murs.get(k);
    if (m) {
      m.trous.push(...trous);
      if (rang[type] > rang[m.type]) m.type = type;
    } else murs.set(k, { axe, c, a0, a1, type, trous: [...trous] });
  };
  const PORTE = 1.7;
  for (const p of pieces) {
    const bord = (v: number, max: number) => v === 0 || v === max;
    const hall = p.id === "hall";
    for (const cote of ["n", "s"] as const) {
      const z = cote === "n" ? p.z0 : p.z1;
      const porte = p.cote === cote;
      const surRue = z === zRue || z === zC;
      const type: TypeMur = bord(z, D) ? "exterieur" : porte && surRue ? "verre" : "plein";
      mur("x", z, p.x0, p.x1, type, porte ? [[p.porte.x - PORTE / 2, p.porte.x + PORTE / 2]] : []);
    }
    for (const cote of ["o", "e"] as const) {
      const x = cote === "o" ? p.x0 : p.x1;
      // le hall est ouvert sur le passage central
      const ouvert = hall && (x === xPassage || x === xPassage + PASSAGE);
      mur("z", x, p.z0, p.z1, bord(x, W) ? "exterieur" : "plein", ouvert ? [[p.z0 + 1.2, p.z1 - 1.6]] : []);
    }
  }
  // bouts des couloirs : grandes baies vitrées ; l'entrée est au sud du passage
  for (const c of couloirs.slice(0, 3)) {
    mur("z", 0, c.z0, c.z1, "baie");
    mur("z", W, c.z0, c.z1, "baie");
  }
  mur("x", 0, xPassage, xPassage + PASSAGE, "baie");
  mur("x", D, xPassage, xPassage + PASSAGE, "baie");

  // ---- 4. meubles et places
  const meubles: Meuble[] = [];
  const spots: Spot3[] = [];
  const deskOf: Record<string, Spot3> = {};

  for (const p of pieces) {
    const base = p.id.replace(/\d+$/, "");
    const larg = p.x1 - p.x0;
    const prof = p.z1 - p.z0;
    // repère de la pièce : u de gauche à droite (ouest → est), v = distance à la porte
    const versFond = p.cote === "s" ? NORD : SUD;
    const versPorte = versFond + Math.PI;
    const P = (u: number, v: number) => ({ x: p.x0 + u, z: p.cote === "s" ? p.z1 - v : p.z0 + v });
    // dans ce repère : « gauche » (u décroissant) = ouest, « droite » = est
    const m = (type: TypeMeuble, u: number, v: number, angle: number, w: number, d: number, bloque: boolean, o: Partial<Meuble> = {}) => meubles.push({ type, ...P(u, v), angle, w, d, bloque, zone: p.id, ...o });
    const s = (kind: TypeSpot, u: number, v: number, angle: number, pose: "sit" | "stand"): Spot3 => {
      const sp: Spot3 = { ...P(u, v), angle, pose, kind, zone: p.id };
      spots.push(sp);
      return sp;
    };
    const cx = larg / 2;
    const fond = prof - 0.45;

    switch (base) {
      case "criee": {
        m("tapis", cx, 4, 0, 6.4, 3.6, false, { couleur: p.couleur });
        m("grandeTable", cx, 4, 0, 4.6, 1.5, true);
        for (const du of [-1.6, -0.55, 0.55, 1.6]) {
          m("chaise", cx + du, 2.85, versFond, 0.5, 0.5, false);
          s("criee", cx + du, 2.85, versFond, "sit");
          m("chaise", cx + du, 5.15, versPorte, 0.5, 0.5, false);
          s("criee", cx + du, 5.15, versPorte, "sit");
        }
        m("chaise", cx - 2.75, 4, EST, 0.5, 0.5, false);
        s("criee", cx - 2.75, 4, EST, "sit");
        m("chaise", cx + 2.75, 4, OUEST, 0.5, 0.5, false);
        s("criee", cx + 2.75, 4, OUEST, "sit");
        m("ecran", cx, fond + 0.25, versPorte, 2.6, 0.12, false, { variante: 1 });
        m("plante", 0.8, fond - 0.2, 0, 0.6, 0.6, true, { variante: 1 });
        m("plante", larg - 0.8, fond - 0.2, 0, 0.6, 0.6, true, { variante: 2 });
        break;
      }
      case "quai": {
        // le café : comptoir au fond, machine, tables hautes
        m("comptoir", cx - 1.4, fond - 0.35, versPorte, 3.4, 0.8, true, { couleur: "#a0673a" });
        m("machineCafe", cx - 2.2, fond - 0.35, versPorte, 0.5, 0.45, false);
        m("frigo", larg - 1, fond - 0.2, versPorte, 0.8, 0.7, true);
        for (const du of [-2.4, -1.4, -0.4]) s("cafe", cx + du, fond - 1.35, versFond, "stand");
        const tables: [number, number][] = [[2.3, 2.6], [larg - 2.6, 2.4], [larg - 2.4, 4.9]];
        tables.forEach(([tu, tv], i) => {
          m("tableRonde", tu, tv, 0, 1, 1, true);
          const dv3 = i === 2 ? -0.85 : 0.85;
          const sieges: [number, number, number][] = [[-0.85, 0, EST], [0.85, 0, OUEST], [0, dv3, dv3 > 0 ? versPorte : versFond]];
          for (const [du, dv, a] of sieges) {
            m("chaise", tu + du, tv + dv, a, 0.5, 0.5, false, { variante: 1 });
            s("terrasse", tu + du, tv + dv, a, "sit");
          }
        });
        m("plante", 0.8, fond - 0.2, 0, 0.6, 0.6, true, { variante: 2 });
        break;
      }
      case "douane": {
        m("tapis", cx, 3.4, 0, 5, 2.6, false, { couleur: p.couleur });
        m("tampon", cx, 4.4, versPorte, 2.6, 0.8, true);
        m("colis", cx + 2.6, 5.6, 0, 1, 1, true);
        s("douane", cx - 0.9, 3.4, versFond, "stand");
        s("douane", cx, 3.3, versFond, "stand");
        s("douane", cx + 0.9, 3.4, versFond, "stand");
        m("etagere", 2, fond, versPorte, 1.8, 0.45, true, { variante: 2 });
        m("etagere", larg - 2, fond, versPorte, 1.8, 0.45, true, { variante: 2 });
        m("caisse", 1, 1.4, 0.3, 0.7, 0.7, true);
        m("caisse", larg - 1.1, 1.3, -0.2, 0.7, 0.7, true, { variante: 1 });
        break;
      }
      case "archives":
      case "reserve": {
        for (const v of [2.4, 4.3, 6.2]) {
          m("archive", 2.4, v, versPorte, 3.2, 0.5, true, { variante: Math.round(v) % 3 });
          m("archive", larg - 2.4, v, versPorte, 3.2, 0.5, true, { variante: (Math.round(v) + 1) % 3 });
        }
        if (base === "archives") {
          s("archives", 2.4, 3.3, versFond, "stand");
          s("archives", larg - 2.4, 5.2, versFond, "stand");
        } else m("caisse", cx, 1.6, 0.4, 0.8, 0.8, true);
        m("plante", larg - 0.7, 0.9, 0, 0.5, 0.5, true);
        break;
      }
      case "detente": {
        m("tapis", 2.7, 5.4, 0, 4, 3, false, { couleur: p.couleur });
        m("canape", 1.9, fond - 0.35, versPorte, 2, 0.9, true, { couleur: "#5b7fa6" });
        s("detente", 1.4, fond - 0.3, versPorte, "sit");
        s("detente", 2.4, fond - 0.3, versPorte, "sit");
        m("canape", 0.75, 4.6, EST, 2, 0.9, true, { couleur: "#c0694e" });
        s("detente", 0.8, 4.2, EST, "sit");
        s("detente", 0.8, 5.1, EST, "sit");
        m("babyfoot", larg - 2.6, 2.6, 0, 1.5, 0.8, true);
        s("detente", larg - 2.6, 1.75, versFond, "stand");
        s("detente", larg - 2.6, 3.45, versPorte, "stand");
        m("pingpong", larg - 2.8, 5.6, 0, 2.6, 1.4, true);
        s("detente", larg - 4.55, 5.6, EST, "stand");
        s("detente", larg - 1.05, 5.6, OUEST, "stand");
        m("pouf", 3.6, 3.6, 0, 0.8, 0.8, false, { couleur: "#e8b100" });
        s("detente", 3.6, 3.6, versPorte, "sit");
        m("plante", larg - 0.7, fond - 0.2, 0, 0.6, 0.6, true, { variante: 2 });
        break;
      }
      case "restaurant": {
        m("comptoir", cx, fond - 0.35, versPorte, 5, 0.8, true, { couleur: "#c8553d" });
        m("frigo", 0.9, fond - 0.2, versPorte, 0.8, 0.7, true);
        const tables: [number, number][] = [[2.2, 2.2], [5, 2.6], [7.8, 2.2], [3.5, 4.9], [6.6, 4.9]];
        for (const [tu, tv] of tables) {
          m("tableRonde", tu, tv, 0, 1.1, 1.1, true, { variante: 1 });
          for (const [du, dv, a] of [[-0.9, 0, EST], [0.9, 0, OUEST]] as [number, number, number][]) {
            m("chaise", tu + du, tv + dv, a, 0.5, 0.5, false, { variante: 1 });
            s("resto", tu + du, tv + dv, a, "sit");
          }
        }
        m("plante", larg - 0.8, fond - 0.2, 0, 0.6, 0.6, true, { variante: 1 });
        break;
      }
      case "mediatheque": {
        for (const u of [1.6, 3.6, 6.4, 8.4]) m("etagere", u, fond, versPorte, 1.8, 0.45, true, { variante: Math.round(u) % 3 });
        for (const u of [3, 7]) {
          m("bureau", u, 3.6, versPorte, 1.5, 0.75, true, { variante: 2 });
          m("chaise", u, 2.85, versFond, 0.5, 0.5, false);
          s("lecture", u, 2.85, versFond, "sit");
        }
        m("canape", 0.75, 4.4, EST, 2, 0.9, true, { couleur: "#7a5ea8" });
        s("lecture", 0.8, 4, EST, "sit");
        s("lecture", 0.8, 4.9, EST, "sit");
        m("pouf", larg - 1.3, 4.8, 0, 0.8, 0.8, false, { couleur: "#3a7bd5" });
        s("lecture", larg - 1.3, 4.8, OUEST, "sit");
        m("lampe", 0.7, 5.9, 0, 0.4, 0.4, false);
        break;
      }
      case "sport": {
        for (const u of [2, 4.2, 6.4]) {
          m("tapisCourse", u, fond - 0.9, versFond, 0.8, 1.7, true);
          s("sport", u, fond - 1.0, versFond, "stand");
        }
        m("halteres", larg - 1.3, 3, 0, 1.4, 0.6, true);
        s("sport", larg - 1.3, 2.1, versFond, "stand");
        m("tapis", 2.6, 2.6, 0, 3, 1.8, false, { couleur: "#3fae8f" });
        s("sport", 2, 2.6, EST, "stand");
        s("sport", 3.4, 2.6, OUEST, "stand");
        m("plante", larg - 0.7, fond - 0.2, 0, 0.6, 0.6, true);
        break;
      }
      case "hall": {
        // ouvert sur le passage (à l'ouest) : la banque d'accueil fait face aux visiteurs qui arrivent
        m("tapis", 4.4, 4, 0, 4.6, 3.6, false, { couleur: p.couleur });
        m("accueil", larg - 2.5, 4, OUEST, 3.2, 0.9, true, { couleur: p.couleur });
        m("ecran", larg - 0.25, 4, OUEST, 3.6, 0.12, false, { variante: 2 });
        m("canape", 2.4, 0.75, versFond, 2.2, 0.9, true, { couleur: "#2f7d6b" });
        m("canape", 3.2, fond - 0.35, versPorte, 2.2, 0.9, true, { couleur: "#2f7d6b" });
        m("plante", larg - 0.8, fond - 0.2, 0, 0.7, 0.7, true, { variante: 2 });
        m("plante", larg - 0.8, 0.9, 0, 0.7, 0.7, true, { variante: 1 });
        m("plante", 0.75, fond - 0.2, 0, 0.7, 0.7, true, { variante: 2 });
        break;
      }
      case "serveurs": {
        for (const u of [1.6, 3.2, 4.8, 6.4, 8.0]) {
          m("serveur", u, fond - 0.3, versPorte, 0.8, 1, true);
          m("serveur", u, 3.6, versPorte, 0.8, 1, true, { variante: 1 });
        }
        break;
      }
      case "podcast": {
        m("tapis", cx, 4, 0, 5.4, 3.6, false, { couleur: p.couleur });
        m("tableRonde", cx, 4, 0, 1.6, 1.6, true, { variante: 2 });
        m("micro", cx - 0.4, 4, 0, 0.2, 0.2, false);
        m("micro", cx + 0.4, 4, 0, 0.2, 0.2, false);
        m("chaise", cx - 1.25, 4, EST, 0.5, 0.5, false, { variante: 1 });
        m("chaise", cx + 1.25, 4, OUEST, 0.5, 0.5, false, { variante: 1 });
        s("detente", cx - 1.25, 4, EST, "sit");
        s("detente", cx + 1.25, 4, OUEST, "sit");
        m("canape", 1.9, fond - 0.35, versPorte, 2, 0.9, true, { couleur: "#5a3d7a" });
        m("lampe", larg - 0.8, fond - 0.3, 0, 0.4, 0.4, false);
        m("plante", larg - 0.8, 1, 0, 0.6, 0.6, true, { variante: 1 });
        break;
      }
      case "cine": {
        // salle de projection : grand écran au fond, trois rangs de fauteuils rouges
        m("ecran", cx, fond + 0.25, versPorte, 5, 0.12, false, { variante: 1 });
        for (const v of [2.2, 3.7, 5.2]) {
          for (const u of [2.6, 5, 7.4]) {
            m("canape", u, v, versFond, 2, 0.9, true, { couleur: "#b3344a" });
            s("detente", u - 0.5, v + 0.05, versFond, "sit");
            s("detente", u + 0.5, v + 0.05, versFond, "sit");
          }
        }
        m("lampe", 0.7, 1, 0, 0.4, 0.4, false);
        m("lampe", larg - 0.7, 1, 0, 0.4, 0.4, false);
        break;
      }
      case "jeux": {
        m("tapis", cx, 4.2, 0, 5.4, 4, false, { couleur: p.couleur });
        m("ecran", cx, fond + 0.25, versPorte, 3, 0.12, false, { variante: 1 });
        m("canape", cx, 4.6, versFond, 2.4, 0.9, true, { couleur: "#3a5c9c" });
        s("detente", cx - 0.6, 4.65, versFond, "sit");
        s("detente", cx + 0.6, 4.65, versFond, "sit");
        m("pouf", cx - 2.2, 5.2, 0, 0.8, 0.8, false, { couleur: "#e2574c" });
        s("detente", cx - 2.2, 5.2, versFond, "sit");
        m("pouf", cx + 2.2, 5.2, 0, 0.8, 0.8, false, { couleur: "#e8b100" });
        s("detente", cx + 2.2, 5.2, versFond, "sit");
        m("babyfoot", 1.8, 2, 0, 1.5, 0.8, true);
        m("serveur", larg - 0.9, 2.4, OUEST, 0.8, 0.8, true, { variante: 1 });
        m("plante", larg - 0.8, fond - 0.2, 0, 0.6, 0.6, true, { variante: 1 });
        break;
      }
      case "sieste": {
        m("tapis", cx, 4, 0, 7, 4.4, false, { couleur: p.couleur });
        for (const [u, v] of [[2, 2.6], [4, 2.6], [6, 2.6], [8, 2.6], [3, 5.4], [5, 5.4], [7, 5.4]] as [number, number][]) {
          m("pouf", u, v, 0, 0.9, 0.9, false, { couleur: ["#8b5cf6", "#6d5a8f", "#3a7bd5", "#1f9aa8"][Math.round(u + v) % 4]! });
          s("detente", u, v, versPorte, "sit");
        }
        m("lampe", 0.7, fond - 0.3, 0, 0.4, 0.4, false);
        m("lampe", larg - 0.7, fond - 0.3, 0, 0.4, 0.4, false);
        m("plante", 0.8, 1, 0, 0.6, 0.6, true, { variante: 2 });
        m("plante", larg - 0.8, 1, 0, 0.6, 0.6, true, { variante: 2 });
        break;
      }
      case "patio": {
        m("arbre", 2.4, 5.4, 0, 0.8, 0.8, true);
        m("arbre", larg - 2.4, 3.2, 0, 0.8, 0.8, true, { variante: 1 });
        m("arbre", cx, 6.4, 0, 0.8, 0.8, true, { variante: 2 });
        m("banc", cx, 3.9, versPorte, 1.8, 0.5, true);
        s("terrasse", cx - 0.4, 3.9, versPorte, "sit");
        s("terrasse", cx + 0.4, 3.9, versPorte, "sit");
        m("banc", 1.2, 2.6, EST, 1.8, 0.5, true);
        s("terrasse", 1.2, 2.6, EST, "sit");
        for (const [u, v] of [[1, fond - 0.3], [larg - 1, fond - 0.3], [larg - 1, 1.2], [4.2, 1.4]] as [number, number][]) m("plante", u, v, 0, 0.6, 0.6, true, { variante: 2 });
        break;
      }
      default: {
        // bureau d'un pôle : îlot de bureaux face à face, tapis à la couleur du pôle
        const membres = p.kind === "pole" ? agentsOfPole(p.id) : [];
        const n = Math.max(membres.length, base === "flex" ? 4 : 2);
        const parRang = Math.min(4, Math.ceil(n / 2));
        const direction = base === "direction";
        m("tapis", cx, 3.95, 0, parRang * 1.75 + 1.4, 4, false, { couleur: p.couleur });
        for (let i = 0; i < n; i++) {
          const r = i < parRang ? 0 : 1;
          const k = r === 0 ? i : i - parRang;
          const nb = r === 0 ? parRang : n - parRang;
          const u = cx + (k - (nb - 1) / 2) * 1.75;
          // rang 0 : dos à la porte, regarde le fond ; rang 1 : dos au fond, regarde la porte
          const vBureau = r === 0 ? 3.55 : 4.35;
          const vChaise = r === 0 ? 2.8 : 5.1;
          const regard = r === 0 ? versFond : versPorte;
          m("bureau", u, vBureau, regard + Math.PI, 1.55, 0.78, true, { variante: direction ? 1 : 0, couleur: p.couleur });
          m("chaise", u, vChaise, regard, 0.5, 0.5, false);
          const a = membres[i];
          if (a) deskOf[a.id] = s("desk", u, vChaise, regard, "sit");
        }
        m("tableau", cx, fond + 0.3, versPorte, 2.2, 0.08, false);
        m("etagere", 1.5, fond, versPorte, 1.8, 0.45, true, { variante: Math.round(p.x0 / 10) % 3 });
        m("imprimante", larg - 1.1, fond - 0.1, versPorte, 0.7, 0.6, true);
        m("plante", larg - 0.75, 1, 0, 0.6, 0.6, true, { variante: Math.round(p.x0 / 10) % 3 });
        m("plante", 0.75, 1, 0, 0.6, 0.6, true, { variante: (Math.round(p.x0 / 10) + 1) % 3 });
        if (direction) {
          m("canape", larg - 0.75, 4.4, OUEST, 2, 0.9, true, { couleur: p.couleur });
          s("detente", larg - 0.8, 4.4, OUEST, "sit");
        }
      }
    }
  }
  // la rue des pôles : plantes, bancs et cabines le long des cloisons
  const rue = couloirs[0]!;
  for (let x = 4; x < W - 2; x += 5) {
    if (x > xPassage - 2 && x < xPassage + PASSAGE + 2) continue;
    const pair = Math.round(x / 5) % 2 === 0;
    // jamais devant une porte
    const devantPorte = pieces.some((p) => (p.z1 === rue.z0 || p.z0 === rue.z1) && Math.abs(p.porte.x - x) < 1.6);
    if (devantPorte) continue;
    meubles.push({ type: pair ? "plante" : "banc", x, z: pair ? rue.z0 + 0.6 : rue.z1 - 0.5, angle: pair ? 0 : NORD, w: pair ? 0.7 : 1.8, d: pair ? 0.7 : 0.5, bloque: true, zone: "rue", variante: 2 });
  }

  // ---- 5. grilles
  const gw = Math.ceil(W / RES);
  const gh = Math.ceil(D / RES);
  const solide = new Uint8Array(gw * gh);
  const opaque = new Uint8Array(gw * gh);
  const pieceDe = new Int16Array(gw * gh).fill(-1);
  const marquer = (x0: number, z0: number, x1: number, z1: number, aussiOpaque = false) => {
    const i0 = Math.max(0, Math.floor(x0 / RES));
    const i1 = Math.min(gw - 1, Math.ceil(x1 / RES) - 1);
    const j0 = Math.max(0, Math.floor(z0 / RES));
    const j1 = Math.min(gh - 1, Math.ceil(z1 / RES) - 1);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        solide[j * gw + i] = 1;
        if (aussiOpaque) opaque[j * gw + i] = 1;
      }
  };
  pieces.forEach((p, pi) => {
    for (let j = Math.floor(p.z0 / RES); j < Math.ceil(p.z1 / RES); j++) for (let i = Math.floor(p.x0 / RES); i < Math.ceil(p.x1 / RES); i++) pieceDe[j * gw + i] = pi;
  });
  const E = 0.13;
  for (const w of murs.values()) {
    const segs: [number, number][] = [];
    let a = w.a0;
    for (const [t0, t1] of [...w.trous].sort((p, q) => p[0] - q[0])) {
      if (t0 > a) segs.push([a, t0]);
      a = Math.max(a, t1);
    }
    if (a < w.a1) segs.push([a, w.a1]);
    for (const [s0, s1] of segs) {
      const plein = w.type === "plein" || w.type === "exterieur";
      if (w.axe === "x") marquer(s0, w.c - E, s1, w.c + E, plein);
      else marquer(w.c - E, s0, w.c + E, s1, plein);
    }
  }
  for (const f of meubles) {
    if (!f.bloque) continue;
    const tourne = Math.abs(Math.sin(f.angle)) > 0.7;
    const w = (tourne ? f.d : f.w) / 2;
    const d = (tourne ? f.w : f.d) / 2;
    marquer(f.x - w, f.z - d, f.x + w, f.z + d);
  }
  // agents : on garde une case de marge autour des obstacles
  const nav = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++)
    for (let i = 0; i < gw; i++) {
      let b = 0;
      for (let dj = -1; dj <= 1 && !b; dj++)
        for (let di = -1; di <= 1; di++) {
          const x = i + di;
          const z = j + dj;
          if (x < 0 || z < 0 || x >= gw || z >= gh || solide[z * gw + x]) {
            b = 1;
            break;
          }
        }
      nav[j * gw + i] = b;
    }

  return {
    W,
    D,
    pieces,
    murs: [...murs.values()],
    meubles,
    spots,
    deskOf,
    entree: { x: xPassage + PASSAGE / 2, z: D - 1.2 },
    couloirs,
    gw,
    gh,
    solide,
    opaque,
    nav,
    pieceDe,
  };
}

/** Pièce (ou couloir) où se trouve un point. */
export function lieuDe(plan: Plan, x: number, z: number): { id: string; nom: string } | null {
  if (x < 0 || z < 0 || x >= plan.W || z >= plan.D) return null;
  const pi = plan.pieceDe[Math.floor(z / RES) * plan.gw + Math.floor(x / RES)]!;
  if (pi >= 0) return plan.pieces[pi]!;
  for (const c of plan.couloirs) if (x >= c.x0 && x < c.x1 && z >= c.z0 && z < c.z1) return { id: "couloir", nom: c.nom };
  return null;
}

let cache: { cle: string; plan: Plan } | null = null;

/** Plan du bureau, recalculé quand la structure du catalogue change (pôle ajouté, agent déplacé…). */
export function getPlan(cle: string): Plan {
  if (cache && cache.cle === cle) return cache.plan;
  cache = { cle, plan: construirePlan() };
  return cache.plan;
}
