import { AGENT_BY_ID, POLE_BY_ID } from "@/data/seed";
import { hashString, mulberry32, pick } from "@/lib/rng";
import { PixelCanvas, rgb, shade, mix, type Pen, type RGBA } from "./pixel";
import type { AtlasEntryDef } from "./atlas";

/**
 * Bonshommes 16×24 générés procéduralement. Apparence fixe = seed sur l'id de l'agent.
 * Les vues « F » regardent vers le bas-droite (SE), les vues « B » vers le haut-droite (NE) ;
 * le miroir horizontal donne SW et NW.
 */

export const CHAR_W = 16;
export const CHAR_H = 24;

export const FRAMES = [
  "F_walk0", "F_walk1", "F_walk2", "F_walk3",
  "B_walk0", "B_walk1", "B_walk2", "B_walk3",
  "F_sit", "F_type0", "F_type1",
  "F_talk0", "F_talk1",
  "F_drink0", "F_drink1",
  "F_sleep",
  "F_cheer0", "F_cheer1",
  "B_sit", "B_talk0", "B_talk1",
] as const;
export type FrameName = (typeof FRAMES)[number];

const SKINS = ["#f7d7bd", "#eec09a", "#d9a173", "#b98055", "#8d5b3b", "#5f3c28"];
const HAIRS = ["#2b1d17", "#4a2d1f", "#7b4a2a", "#c58b3c", "#ead08a", "#b0432a", "#9c9aa3", "#26263a", "#d77fa1"];
const PANTS = ["#2f3a5a", "#3b3b46", "#c9b48f", "#24242c", "#4d6b9a", "#6b4f3a", "#5a6b4a"];
const SHOES = ["#2a2230", "#f2efe9", "#7a4a2a", "#c0392b", "#2f4f8f"];

export interface Appearance {
  skin: RGBA;
  hair: RGBA;
  hairStyle: number;
  shirt: RGBA;
  shirtStyle: number;
  pants: RGBA;
  shoes: RGBA;
  glasses: boolean;
}

export function appearanceOf(agentId: string): Appearance {
  const r = mulberry32(hashString(agentId) ^ 0x9e3779b9);
  const agent = AGENT_BY_ID[agentId];
  const pole = agent ? POLE_BY_ID[agent.pole] : undefined;
  const base = rgb(pole?.couleur ?? "#888888");
  // légère variation de teinte autour de la couleur du pôle
  const v = r();
  const shirt = v < 0.33 ? base : v < 0.66 ? shade(base, 0.15) : shade(base, -0.12);
  return {
    skin: rgb(pick(SKINS, r())),
    hair: rgb(pick(HAIRS, r())),
    hairStyle: Math.floor(r() * 6),
    shirt,
    shirtStyle: Math.floor(r() * 4),
    pants: rgb(pick(PANTS, r())),
    shoes: rgb(pick(SHOES, r())),
    glasses: r() < 0.25,
  };
}

const OUTLINE = rgb("#2a2140");
const EYE = rgb("#241c33");

interface Pose {
  back: boolean;
  /** -1, 0, 1 : jambe gauche en avant / repos / jambe droite en avant */
  step: number;
  bob: number;
  sit: boolean;
  arms: "down" | "swingL" | "swingR" | "type0" | "type1" | "talk" | "cup0" | "cup1" | "up0" | "up1" | "sleep";
  mouth: "closed" | "open" | "smile";
  eyesClosed?: boolean;
}

const POSES: Record<FrameName, Pose> = {
  F_walk0: { back: false, step: 0, bob: 0, sit: false, arms: "down", mouth: "closed" },
  F_walk1: { back: false, step: -1, bob: -1, sit: false, arms: "swingR", mouth: "closed" },
  F_walk2: { back: false, step: 0, bob: 0, sit: false, arms: "down", mouth: "closed" },
  F_walk3: { back: false, step: 1, bob: -1, sit: false, arms: "swingL", mouth: "closed" },
  B_walk0: { back: true, step: 0, bob: 0, sit: false, arms: "down", mouth: "closed" },
  B_walk1: { back: true, step: -1, bob: -1, sit: false, arms: "swingR", mouth: "closed" },
  B_walk2: { back: true, step: 0, bob: 0, sit: false, arms: "down", mouth: "closed" },
  B_walk3: { back: true, step: 1, bob: -1, sit: false, arms: "swingL", mouth: "closed" },
  F_sit: { back: false, step: 0, bob: 0, sit: true, arms: "down", mouth: "closed" },
  F_type0: { back: false, step: 0, bob: 0, sit: true, arms: "type0", mouth: "closed" },
  F_type1: { back: false, step: 0, bob: 0, sit: true, arms: "type1", mouth: "closed" },
  F_talk0: { back: false, step: 0, bob: 0, sit: false, arms: "talk", mouth: "open" },
  F_talk1: { back: false, step: 0, bob: 0, sit: false, arms: "down", mouth: "closed" },
  F_drink0: { back: false, step: 0, bob: 0, sit: false, arms: "cup0", mouth: "closed" },
  F_drink1: { back: false, step: 0, bob: 0, sit: false, arms: "cup1", mouth: "closed" },
  F_sleep: { back: false, step: 0, bob: 1, sit: true, arms: "sleep", mouth: "closed", eyesClosed: true },
  F_cheer0: { back: false, step: 0, bob: 0, sit: false, arms: "up0", mouth: "smile" },
  F_cheer1: { back: false, step: 0, bob: -1, sit: false, arms: "up1", mouth: "smile" },
  B_sit: { back: true, step: 0, bob: 0, sit: true, arms: "down", mouth: "closed" },
  B_talk0: { back: true, step: 0, bob: 0, sit: false, arms: "talk", mouth: "closed" },
  B_talk1: { back: true, step: 0, bob: 0, sit: false, arms: "down", mouth: "closed" },
};

export function drawCharacter(p: Pen, ap: Appearance, frame: FrameName): void {
  const pose = POSES[frame];
  const sitDy = pose.sit ? 3 : 0;
  const by = pose.bob + sitDy; // décalage vertical du haut du corps
  const skinD = shade(ap.skin, -0.18);
  const shirtD = shade(ap.shirt, -0.2);
  const shirtL = shade(ap.shirt, 0.18);
  const pantsD = shade(ap.pants, -0.22);

  // ---- jambes
  if (!pose.sit) {
    const legY = 17;
    // jambe gauche (x 5-7) et droite (x 8-10)
    const lOff = pose.step === -1 ? -1 : 0;
    const rOff = pose.step === 1 ? 1 : 0;
    const lLift = pose.step === 1 ? 1 : 0;
    const rLift = pose.step === -1 ? 1 : 0;
    p.rect(5 + lOff, legY, 3, 4 - lLift, ap.pants);
    p.rect(8 + rOff, legY, 3, 4 - rLift, pantsD);
    p.rect(5 + lOff, 21 - lLift, 3, 2, ap.shoes);
    p.rect(8 + rOff + (pose.back ? 0 : 1), 21 - rLift, 3, 2, shade(ap.shoes, -0.1));
  } else {
    // assis : cuisses vers l'avant-droite, tibias vers le bas
    const sy = 17 + sitDy - 1;
    if (!pose.back) {
      p.rect(5, sy, 7, 3, ap.pants);
      p.rect(9, sy + 1, 4, 2, pantsD);
      p.rect(10, sy + 3, 3, 2, ap.pants);
      p.rect(10, sy + 5, 4, 1, ap.shoes);
    } else {
      p.rect(5, sy, 6, 3, ap.pants);
      p.rect(6, sy + 3, 4, 2, pantsD);
    }
  }

  // ---- buste
  const ty = 11 + by;
  p.rect(5, ty, 6, 6, ap.shirt);
  p.rect(10, ty, 1, 6, shirtD);
  p.rect(5, ty + 5, 6, 1, shade(ap.pants, -0.1)); // ceinture
  if (!pose.back) {
    switch (ap.shirtStyle) {
      case 0: // col en V
        p.set(7, ty, ap.skin);
        p.set(8, ty, ap.skin);
        p.set(7, ty + 1, ap.skin);
        break;
      case 1: // marinière
        p.hline(5, 10, ty + 1, shirtL);
        p.hline(5, 10, ty + 3, shirtL);
        p.set(7, ty, ap.skin);
        break;
      case 2: // polo
        p.set(6, ty, shirtL);
        p.set(9, ty, shirtL);
        p.set(7, ty + 1, shirtL);
        p.set(8, ty + 1, shirtL);
        break;
      default: // sweat à poche
        p.hline(6, 9, ty + 3, shirtD);
        p.set(7, ty, shirtD);
        p.set(8, ty, shirtD);
    }
  } else {
    p.hline(5, 10, ty, shirtD);
  }

  // ---- bras
  const sleeve = ap.shirt;
  const arm = (x: number, y0: number, len: number) => {
    p.rect(x, y0, 1, len, sleeve);
    p.set(x, y0 + len, ap.skin);
  };
  switch (pose.arms) {
    case "down":
      arm(4, ty, 4);
      arm(11, ty, 4);
      break;
    case "swingL":
      arm(4, ty, 3);
      arm(11, ty, 5);
      break;
    case "swingR":
      arm(4, ty, 5);
      arm(11, ty, 3);
      break;
    case "type0":
    case "type1": {
      const k = pose.arms === "type0" ? 0 : 1;
      p.rect(4, ty, 1, 3, sleeve);
      p.rect(11, ty, 1, 3, sleeve);
      p.rect(11, ty + 3, 2, 1, sleeve);
      p.set(13, ty + 3 + k, ap.skin);
      p.set(12, ty + 4 - k, ap.skin);
      p.set(5, ty + 4, ap.skin);
      break;
    }
    case "talk":
      arm(4, ty, 4);
      p.rect(11, ty, 1, 2, sleeve);
      p.rect(12, ty - 1, 1, 2, sleeve);
      p.set(12, ty - 2, ap.skin);
      break;
    case "cup0":
    case "cup1": {
      arm(4, ty, 4);
      const up = pose.arms === "cup0" ? 0 : 1;
      p.rect(11, ty + 1 - up, 1, 2, sleeve);
      p.set(11, ty - up, ap.skin);
      // tasse
      p.rect(10, ty - 3 - up + 1, 2, 2, rgb("#fbfaf7"));
      p.set(12, ty - 2 - up + 1, rgb("#d9d4cc"));
      break;
    }
    case "up0":
    case "up1": {
      const w = pose.arms === "up0" ? 0 : 1;
      p.rect(4 - w, ty - 4, 1, 4, sleeve);
      p.rect(11 + w, ty - 4, 1, 4, sleeve);
      p.set(4 - w, ty - 5, ap.skin);
      p.set(11 + w, ty - 5, ap.skin);
      break;
    }
    case "sleep":
      p.rect(4, ty + 2, 8, 2, sleeve);
      p.rect(11, ty + 2, 2, 1, ap.skin);
      break;
  }

  // ---- tête
  const hy = 3 + by;
  p.rect(4, hy + 1, 8, 6, ap.skin);
  p.rect(5, hy, 6, 8, ap.skin);
  p.clear(4, hy + 1);
  // ombre sous le menton / cou
  p.rect(6, hy + 8, 4, 1, skinD);

  if (!pose.back) {
    // visage 3/4 tourné vers la droite
    if (pose.eyesClosed) {
      p.hline(8, 8, hy + 4, EYE);
      p.hline(10, 10, hy + 4, EYE);
    } else {
      p.set(8, hy + 4, EYE);
      p.set(10, hy + 4, EYE);
      p.set(8, hy + 3, mix(ap.skin, EYE, 0.25));
    }
    p.set(11, hy + 5, mix(ap.skin, rgb("#ff8a8a"), 0.35)); // joue
    p.set(6, hy + 4, skinD); // oreille
    if (pose.mouth === "open") {
      p.set(9, hy + 6, rgb("#7a2b33"));
      p.set(9, hy + 7, rgb("#7a2b33"));
    } else if (pose.mouth === "smile") {
      p.hline(8, 10, hy + 6, rgb("#7a2b33"));
    } else {
      p.set(9, hy + 6, shade(ap.skin, -0.3));
    }
    if (ap.glasses) {
      const g = rgb("#2a2140");
      p.set(7, hy + 4, g);
      p.set(9, hy + 4, g);
      p.set(11, hy + 4, g);
      p.hline(7, 11, hy + 3, g);
      p.set(8, hy + 4, rgb("#cfe7ff"));
      p.set(10, hy + 4, rgb("#cfe7ff"));
    }
  } else {
    p.set(11, hy + 4, skinD); // oreille droite
  }

  drawHair(p, ap, hy, pose.back);
}

function drawHair(p: Pen, ap: Appearance, hy: number, back: boolean): void {
  const h = ap.hair;
  const hl = shade(h, 0.18);
  const hd = shade(h, -0.2);
  switch (ap.hairStyle) {
    case 0: // court
      p.rect(4, hy - 1, 8, 3, h);
      p.rect(4, hy + 2, 2, 3, h);
      if (back) p.rect(4, hy - 1, 8, 6, h);
      p.hline(6, 9, hy - 1, hl);
      break;
    case 1: // très court
      p.rect(5, hy - 1, 6, 2, h);
      p.rect(4, hy, 1, 3, h);
      if (back) p.rect(4, hy - 1, 8, 5, h);
      break;
    case 2: // longs
      p.rect(4, hy - 1, 8, 3, h);
      p.rect(3, hy + 1, 3, 9, h);
      if (back) p.rect(3, hy - 1, 10, 11, h);
      else p.rect(11, hy + 1, 1, 2, h);
      p.vline(4, hy + 2, hy + 9, hd);
      p.hline(6, 10, hy - 1, hl);
      break;
    case 3: // chignon
      p.rect(4, hy - 1, 8, 3, h);
      p.rect(4, hy + 2, 2, 2, h);
      p.rect(5, hy - 4, 4, 3, h);
      p.set(6, hy - 4, hl);
      if (back) p.rect(4, hy - 1, 8, 6, h);
      break;
    case 4: // bouclés
      p.rect(3, hy - 2, 10, 4, h);
      p.rect(3, hy + 2, 3, 4, h);
      for (let i = 0; i < 10; i += 2) p.set(3 + i, hy - 2, hl);
      p.set(12, hy + 2, h);
      if (back) p.rect(3, hy - 2, 10, 9, h);
      p.set(4, hy + 5, hd);
      break;
    default: // queue de cheval + mèche
      p.rect(4, hy - 1, 8, 3, h);
      p.rect(4, hy + 2, 2, 3, h);
      p.rect(9, hy + 1, 2, 1, h);
      p.rect(2, hy + 2, 2, 5, hd);
      if (back) {
        p.rect(4, hy - 1, 8, 6, h);
        p.rect(7, hy + 5, 2, 4, hd);
      }
      p.hline(5, 8, hy - 1, hl);
  }
}

export function characterAtlasDefs(agentIds: string[]): AtlasEntryDef[] {
  const defs: AtlasEntryDef[] = [];
  for (const id of agentIds) {
    const ap = appearanceOf(id);
    for (const f of FRAMES) {
      defs.push({
        key: `${id}:${f}`,
        w: CHAR_W,
        h: CHAR_H,
        ax: CHAR_W / 2,
        ay: CHAR_H - 1,
        draw: (p) => {
          drawCharacter(p, ap, f);
          p.outline(OUTLINE);
        },
      });
    }
  }
  return defs;
}

/** Portrait agrandi pour les fiches (canvas 16×24, à agrandir en CSS « pixelated »). */
export function renderPortrait(agentId: string, frame: FrameName = "F_walk0"): HTMLCanvasElement {
  const pc = new PixelCanvas(CHAR_W, CHAR_H);
  const p = pc.region(0, 0, CHAR_W, CHAR_H);
  drawCharacter(p, appearanceOf(agentId), frame);
  p.outline(OUTLINE);
  return pc.toCanvas();
}
