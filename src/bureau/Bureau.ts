import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { agentById, allAgents, catalogStore, poleById } from "@/data/catalog";
import { STATE_LABEL } from "@/data/types";
import { parisHour } from "@/lib/paris";
import { ui, uiStore } from "@/store/ui";
import { world } from "@/store/world";
import { ambianceAt } from "@/world/daynight";
import { Overlay } from "@/world/overlay";
import { dessinerInfos, dessinerPubs } from "@/world/times";
import { Agent3D, type Services3 } from "./agent3d";
import { construireDecor, type Decor } from "./decor";
import { Nav } from "./nav";
import { HAUTEUR, RES, getPlan, lieuDe, type Plan } from "./plan";

/**
 * LE PORT en bureau 3D : un bâtiment fermé vu en maquette (toit ouvert, caméra libre) et visitable à pied en
 * première personne (Z Q S D ou flèches, souris pour regarder, Maj pour courir, E pour parler à un agent).
 * Même interface que la ville 2D (zoom, « aller à », mode TV) : le reste de l'application ne change pas.
 */

export interface BureauOptions {
  onZoneClick: (zoneId: string) => void;
}

const YEUX = 1.62;
const RAYON = 0.28;
const FOV_MAQUETTE = 36;
const FOV_VISITE = 74;

interface Ecran {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  role: "infos" | "pubs";
}

export class Bureau {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV_MAQUETTE, 1, 0.5, 600);
  private controls!: MapControls;
  readonly plan: Plan;
  private nav: Nav;
  private decor!: Decor;
  private agents = new Map<string, Agent3D>();
  private reservations = new Map<number, string>();
  private overlay!: Overlay;
  private tags = new Map<string, HTMLDivElement>();
  private tagsRoot!: HTMLDivElement;
  private hemi = new THREE.HemisphereLight(0xffffff, 0xd8cbb5, 1.4);
  private ambiant = new THREE.AmbientLight(0xffffff, 0.8);
  private soleil = new THREE.DirectionalLight(0xfff1dc, 2.4);
  private ecrans: Ecran[] = [];
  private lueurs = new Map<string, THREE.Mesh>();
  private anneau!: THREE.Mesh;
  private colis: THREE.Mesh[] = [];
  private confettis!: THREE.Points;
  private particules: { x: number; y: number; z: number; vx: number; vy: number; vz: number; vie: number }[] = [];
  private heure = 12;
  private dernierHeure = 0;
  private dernierPresence = 0;
  private dernierEcran = -1;
  private temps = 0;
  private horloge = new THREE.Clock();
  private detruit = false;
  private nettoyage: (() => void)[] = [];
  // visite à pied
  private mode: "maquette" | "visite" = "maquette";
  private moi = { x: 0, z: 0, yaw: 0, pitch: 0 };
  private touches = new Set<string>();
  private manette = { x: 0, y: 0 };
  private tactile = false;
  private captureLe = 0;
  private pourParler = false;
  // qualité adaptative : on allège le rendu si l'appareil peine (téléphone, vieux portable)
  private qualite = 0;
  private fpsT = 0;
  private fpsN = 0;
  private sauvegarde: { pos: THREE.Vector3; cible: THREE.Vector3 } | null = null;
  private vol: { t: number; dur: number; p0: THREE.Vector3; p1: THREE.Vector3; c0: THREE.Vector3; c1: THREE.Vector3 } | null = null;
  private rayon = new THREE.Raycaster();
  private v3 = new THREE.Vector3();

  private constructor(
    private host: HTMLElement,
    private overlayEl: HTMLElement,
    private opts: BureauOptions,
  ) {
    this.plan = getPlan(catalogStore.getState().structure);
    this.nav = new Nav(this.plan);
  }

  static async create(host: HTMLElement, overlayEl: HTMLElement, opts: BureauOptions): Promise<Bureau> {
    const b = new Bureau(host, overlayEl, opts);
    b.init();
    return b;
  }

  // ---------------------------------------------------------------- construction
  private init(): void {
    const { plan } = this;
    this.tactile = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.tactile ? 1.5 : 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.display = "block";
    this.host.appendChild(renderer.domElement);

    // lumières : ciel, ambiance intérieure, soleil avec ombres
    const cx = plan.W / 2;
    const cz = plan.D / 2;
    this.soleil.position.set(cx - 34, 60, cz + 26);
    this.soleil.target.position.set(cx, 0, cz);
    this.soleil.castShadow = true;
    this.soleil.shadow.mapSize.set(this.tactile ? 1024 : 2048, this.tactile ? 1024 : 2048);
    const oc = this.soleil.shadow.camera;
    oc.left = -plan.W / 2 - 8;
    oc.right = plan.W / 2 + 8;
    oc.top = plan.D / 2 + 8;
    oc.bottom = -plan.D / 2 - 8;
    oc.near = 10;
    oc.far = 160;
    this.soleil.shadow.bias = -0.0006;
    this.soleil.shadow.normalBias = 0.04;
    this.scene.add(this.hemi, this.ambiant, this.soleil, this.soleil.target);
    this.scene.fog = new THREE.Fog(0xcfd6f2, 140, 380);

    // décor
    this.decor = construireDecor(plan);
    this.scene.add(this.decor.fixe, this.decor.plafond);

    // écrans géants en direct (hall : infos du port ; salle de réunion : offres)
    for (const e of this.decor.ecrans) {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = Math.round((640 * e.h) / e.w);
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(e.w, e.h), new THREE.MeshBasicMaterial({ map: tex }));
      m.position.set(e.x + Math.sin(e.angle) * 0.05, e.y, e.z + Math.cos(e.angle) * 0.05);
      m.rotation.y = e.angle;
      this.scene.add(m);
      this.ecrans.push({ ctx, canvas, tex, role: e.role });
    }

    // agents, lueur de leur écran quand ils travaillent
    const svc: Services3 = {
      plan,
      nav: this.nav,
      reserver: (s, id) => {
        const cur = this.reservations.get(s);
        if (cur && cur !== id) return false;
        this.reservations.set(s, id);
        return true;
      },
      liberer: (id) => {
        for (const [k, v] of this.reservations) if (v === id) this.reservations.delete(k);
      },
      estReserve: (s) => this.reservations.has(s),
      posDe: (id) => {
        const a = this.agents.get(id);
        return a ? { x: a.x, z: a.z, cache: a.cache } : null;
      },
      heure: () => this.heure,
      confetti: (x, z) => this.feter(x, z),
      pileBump: () => undefined,
    };
    const geoLueur = new THREE.PlaneGeometry(0.56, 0.32);
    const matLueur = new THREE.MeshBasicMaterial({ color: 0xa8e6ff });
    for (const def of allAgents()) {
      const a = new Agent3D(def.id, svc);
      this.agents.set(def.id, a);
      this.scene.add(a.perso.racine);
      const d = plan.deskOf[def.id];
      if (d) {
        const l = new THREE.Mesh(geoLueur, matLueur);
        const fx = Math.sin(d.angle);
        const fz = Math.cos(d.angle);
        l.position.set(d.x + fx * 0.86, 1.08, d.z + fz * 0.86);
        l.rotation.y = d.angle + Math.PI;
        l.visible = false;
        this.scene.add(l);
        this.lueurs.set(def.id, l);
      }
    }

    // anneau de sélection, colis de la Douane, confettis
    this.anneau = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 28), new THREE.MeshBasicMaterial({ color: 0xffd34d, side: THREE.DoubleSide }));
    this.anneau.rotation.x = -Math.PI / 2;
    this.anneau.visible = false;
    this.scene.add(this.anneau);
    if (this.decor.pile) {
      const matColis = new THREE.MeshLambertMaterial({ color: 0xc99b62 });
      for (let i = 0; i < 8; i++) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.3), matColis);
        c.position.set(this.decor.pile.x + ((i % 2) - 0.5) * 0.4, 0.56 + Math.floor(i / 2) * 0.25, this.decor.pile.z + (((i * 7) % 3) - 1) * 0.06);
        c.rotation.y = (i * 1.3) % 0.6;
        c.castShadow = true;
        c.visible = false;
        this.scene.add(c);
        this.colis.push(c);
      }
    }
    const gc = new THREE.BufferGeometry();
    gc.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(300 * 3), 3));
    gc.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(300 * 3), 3));
    this.confettis = new THREE.Points(gc, new THREE.PointsMaterial({ size: 0.14, vertexColors: true }));
    this.confettis.frustumCulled = false;
    this.scene.add(this.confettis);

    // étiquettes, bulles et liaisons (couche DOM de la ville, positions projetées en 3D)
    this.overlay = new Overlay(
      this.overlayEl,
      { etiquettes: plan.pieces.map((p) => ({ id: p.id, nom: p.nom, icone: p.icone, couleur: p.couleur })) },
      (z) => this.cliquerPiece(z),
      null,
    );
    this.tagsRoot = document.createElement("div");
    this.tagsRoot.className = "overlay-layer";
    this.overlayEl.appendChild(this.tagsRoot);

    // caméra de la maquette : vue plongeante depuis le sud-est
    this.controls = new MapControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.14;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 170;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = 1.3;
    this.controls.zoomToCursor = true;
    this.vueEnsemble(true);

    this.redimensionner();
    const ro = new ResizeObserver(() => this.redimensionner());
    ro.observe(this.host);
    this.nettoyage.push(() => ro.disconnect());
    this.entrees();

    renderer.setAnimationLoop(() => this.update());
    uiStore.setState({ ready: true, visite: "non", visiteLieu: null, visiteCible: null });
  }

  private redimensionner(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** distance de la vue d'ensemble : tout le bâtiment tient à l'écran, même en portrait sur téléphone */
  private distanceEnsemble(): number {
    const aspect = this.host.clientWidth / Math.max(1, this.host.clientHeight);
    const base = Math.max(70, this.plan.W * 1.38);
    return aspect < 1.2 ? (base * 1.2) / Math.max(0.45, aspect) : base;
  }

  private vueEnsemble(direct = false): void {
    const c = new THREE.Vector3(this.plan.W / 2, 0, this.plan.D / 2 + 1);
    const dir = new THREE.Vector3(0.5, 1.05, 0.85).normalize();
    const p = c.clone().addScaledVector(dir, this.distanceEnsemble());
    if (direct) {
      this.camera.position.copy(p);
      this.controls.target.copy(c);
      this.controls.update();
    } else this.volerVers(p, c, 1.4);
  }

  // ---------------------------------------------------------------- entrées
  private entrees(): void {
    const el = this.renderer.domElement;
    let bas: { x: number; y: number; t: number; id: number } | null = null;
    const surBas = (e: PointerEvent) => {
      bas = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      this.vol = null;
    };
    const surBouge = (e: PointerEvent) => {
      if (this.mode === "visite") {
        // souris capturée : on regarde autour de soi ; sinon (tactile, pause) on fait glisser pour tourner
        // (juste après la capture, le navigateur envoie parfois un faux grand mouvement : on l'ignore)
        if (document.pointerLockElement === el) {
          if (performance.now() - this.captureLe > 250 && Math.abs(e.movementX) < 300 && Math.abs(e.movementY) < 300) this.regarder(e.movementX, e.movementY, 0.0022);
        }
        else if (bas && bas.id === e.pointerId && (e.buttons || e.pointerType === "touch")) this.regarder(-e.movementX, -e.movementY, 0.005);
        return;
      }
      if (e.pointerType !== "mouse" || e.buttons) return;
      const id = this.viser(e.clientX, e.clientY).agent;
      ui.setHover(id);
      el.style.cursor = id ? "pointer" : "grab";
    };
    const surHaut = (e: PointerEvent) => {
      const b = bas;
      bas = null;
      if (!b || this.mode !== "maquette") return;
      if (Math.hypot(e.clientX - b.x, e.clientY - b.y) > 6 || performance.now() - b.t > 500) return;
      const v = this.viser(e.clientX, e.clientY);
      if (v.agent) ui.selectAgent(v.agent);
      else if (v.piece) this.cliquerPiece(v.piece);
      else ui.closeSheets();
    };
    const surSortie = () => ui.setHover(null);
    el.addEventListener("pointerdown", surBas);
    el.addEventListener("pointermove", surBouge);
    el.addEventListener("pointerup", surHaut);
    el.addEventListener("pointerleave", surSortie);

    const champ = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    };
    const toucheBas = (e: KeyboardEvent) => {
      if (this.mode !== "visite" || champ(e)) return;
      // e.code = position physique : Z Q S D sur un clavier français, W A S D sur un clavier anglais
      this.touches.add(e.code);
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
      if (e.code === "KeyE") this.parler();
      if (e.code === "KeyG" && !e.repeat) {
        if (uiStore.getState().telephone) this.fermerTelephone();
        else this.ouvrirTelephone();
        return;
      }
      // téléphone sorti : Échap le range (et la visite reprend)
      if (e.code === "Escape" && uiStore.getState().telephone) {
        this.fermerTelephone();
        return;
      }
      // en pause : Échap ferme d'abord la fiche ouverte, sinon ramène à la maquette
      const u = uiStore.getState();
      if (e.code === "Escape" && document.pointerLockElement !== el && !u.selectedAgent && !u.selectedPole) this.quitterVisite();
    };
    const toucheHaut = (e: KeyboardEvent) => this.touches.delete(e.code);
    const verrou = () => {
      if (this.mode !== "visite" || this.tactile) return;
      if (document.pointerLockElement === el) {
        this.captureLe = performance.now();
        uiStore.setState({ visite: "oui" });
        return;
      }
      this.touches.clear();
      // souris libérée pour parler à un agent (E) ou sortir le téléphone (G) : simple pause ;
      // sinon c'est Échap → retour à la maquette
      if (this.pourParler) {
        this.pourParler = false;
        uiStore.setState({ visite: "pause" });
      } else this.quitterVisite();
    };
    const flou = () => this.touches.clear();
    window.addEventListener("keydown", toucheBas);
    window.addEventListener("keyup", toucheHaut);
    window.addEventListener("blur", flou);
    document.addEventListener("pointerlockchange", verrou);
    this.nettoyage.push(() => {
      el.removeEventListener("pointerdown", surBas);
      el.removeEventListener("pointermove", surBouge);
      el.removeEventListener("pointerup", surHaut);
      el.removeEventListener("pointerleave", surSortie);
      window.removeEventListener("keydown", toucheBas);
      window.removeEventListener("keyup", toucheHaut);
      window.removeEventListener("blur", flou);
      document.removeEventListener("pointerlockchange", verrou);
    });
  }

  private cliquerPiece(id: string): void {
    const p = this.plan.pieces.find((x) => x.id === id);
    if (!p) return;
    if (poleById(id)) this.opts.onZoneClick(id);
    else this.flyToZone(id);
  }

  /** Ce qu'il y a sous le pointeur : un agent, sinon la pièce. */
  private viser(clientX: number, clientY: number): { agent: string | null; piece: string | null } {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.rayon.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    const o = this.rayon.ray.origin;
    const d = this.rayon.ray.direction;
    let agent: string | null = null;
    let meilleur = Infinity;
    for (const a of this.agents.values()) {
      if (a.cache) continue;
      // rayon contre la boîte englobante du personnage
      let t0 = 0;
      let t1 = Infinity;
      const min = [a.x - 0.35, 0, a.z - 0.35];
      const max = [a.x + 0.35, a.perso.hauteur + 0.1, a.z + 0.35];
      const oo = [o.x, o.y, o.z];
      const dd = [d.x, d.y, d.z];
      let touche = true;
      for (let k = 0; k < 3 && touche; k++) {
        if (Math.abs(dd[k]!) < 1e-6) touche = oo[k]! >= min[k]! && oo[k]! <= max[k]!;
        else {
          const a0 = (min[k]! - oo[k]!) / dd[k]!;
          const a1 = (max[k]! - oo[k]!) / dd[k]!;
          t0 = Math.max(t0, Math.min(a0, a1));
          t1 = Math.min(t1, Math.max(a0, a1));
          touche = t0 <= t1;
        }
      }
      if (touche && t0 < meilleur) {
        meilleur = t0;
        agent = a.id;
      }
    }
    let piece: string | null = null;
    if (d.y < -1e-4) {
      const t = -o.y / d.y;
      const l = lieuDe(this.plan, o.x + d.x * t, o.z + d.z * t);
      if (l && l.id !== "couloir") piece = l.id;
    }
    return { agent, piece };
  }

  // ---------------------------------------------------------------- caméra de la maquette
  private volerVers(pos: THREE.Vector3, cible: THREE.Vector3, dur = 0.8): void {
    if (this.mode !== "maquette") return;
    this.vol = { t: 0, dur, p0: this.camera.position.clone(), p1: pos, c0: this.controls.target.clone(), c1: cible };
  }

  /** Centre la maquette sur un point, à une distance donnée (en gardant l'angle de vue). */
  private allerA(x: number, z: number, distance: number, dur = 0.8): void {
    const cible = new THREE.Vector3(x, 0, z);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.volerVers(cible.clone().addScaledVector(dir, distance), cible, dur);
  }

  zoomStep(dir: 1 | -1): void {
    if (this.mode !== "maquette") return;
    const d = this.camera.position.distanceTo(this.controls.target);
    const nd = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, d * (dir > 0 ? 0.72 : 1.38)));
    const t = this.controls.target;
    this.allerA(t.x, t.z, nd, 0.22);
  }

  flyToAgent(id: string): void {
    const a = this.agents.get(id);
    if (!a) return;
    const d = a.cache ? this.plan.deskOf[id] : a;
    if (d) this.allerA(d.x, d.z, Math.min(18, this.camera.position.distanceTo(this.controls.target)));
  }

  flyToZone(zoneId: string): void {
    const p = this.plan.pieces.find((x) => x.id === zoneId);
    if (p) this.allerA((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2, 30);
  }

  overview(): void {
    this.vueEnsemble();
  }

  /** Mode TV : la caméra va sur une pièce ou sur un agent. */
  tvZone(id: string): boolean {
    const p = this.plan.pieces.find((x) => x.id === id);
    if (!p) return false;
    this.allerA((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2, 26, 1.6);
    return true;
  }

  tvAgent(id: string): boolean {
    const a = this.agents.get(id);
    if (!a || a.cache) return false;
    this.allerA(a.x, a.z, 12, 1.6);
    return true;
  }

  /** tests : caméra sur un point de la maquette */
  debugView(x: number, z: number, distance: number): void {
    this.vol = null;
    const cible = new THREE.Vector3(x, 0, z);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.camera.position.copy(cible).addScaledVector(dir, distance);
    this.controls.target.copy(cible);
  }

  // ---------------------------------------------------------------- visite à pied
  get enVisite(): boolean {
    return this.mode === "visite";
  }

  /** Entre dans le bâtiment par la porte d'entrée (à appeler depuis un clic : la souris est capturée). */
  entrerVisite(): void {
    if (this.mode === "visite") return this.reprendreVisite();
    this.vol = null;
    this.sauvegarde = { pos: this.camera.position.clone(), cible: this.controls.target.clone() };
    this.mode = "visite";
    this.controls.enabled = false;
    this.moi = { x: this.plan.entree.x, z: this.plan.entree.z, yaw: 0, pitch: 0 };
    this.camera.fov = FOV_VISITE;
    this.camera.near = 0.06;
    this.camera.updateProjectionMatrix();
    this.decor.plafond.visible = true;
    ui.closeSheets();
    ui.setHover(null);
    this.renderer.domElement.style.cursor = "default";
    uiStore.setState({ visite: this.tactile ? "oui" : "pause" });
    this.reprendreVisite();
  }

  /** Reprend la visite après une pause (capture la souris). */
  reprendreVisite(): void {
    if (this.mode !== "visite" || this.tactile) return;
    try {
      const r = this.renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => undefined);
    } catch {
      // capture refusée : on peut encore tourner en faisant glisser la souris
    }
  }

  quitterVisite(): void {
    if (this.mode !== "visite") return;
    this.mode = "maquette";
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.touches.clear();
    this.manette = { x: 0, y: 0 };
    this.camera.fov = FOV_MAQUETTE;
    this.camera.near = 0.5;
    this.camera.rotation.set(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.decor.plafond.visible = false;
    this.controls.enabled = true;
    if (this.sauvegarde) {
      this.camera.position.copy(this.sauvegarde.pos);
      this.controls.target.copy(this.sauvegarde.cible);
    }
    this.controls.update();
    for (const t of this.tags.values()) t.remove();
    this.tags.clear();
    uiStore.setState({ visite: "non", visiteLieu: null, visiteCible: null, telephone: false });
  }

  /** Sort le téléphone (touche G) : la souris est libérée pour s'en servir, la visite attend. */
  ouvrirTelephone(): void {
    if (this.mode !== "visite" || uiStore.getState().telephone) return;
    if (document.pointerLockElement === this.renderer.domElement) {
      this.pourParler = true;
      document.exitPointerLock();
    }
    this.touches.clear();
    ui.closeSheets();
    uiStore.setState({ telephone: true });
  }

  /** Range le téléphone et reprend la marche. */
  fermerTelephone(): void {
    if (!uiStore.getState().telephone) return;
    uiStore.setState({ telephone: false });
    window.focus();
    this.reprendreVisite();
  }

  /** Manette tactile : x = droite, y = avant (de -1 à 1). */
  manetteVers(x: number, y: number): void {
    this.manette = { x, y };
  }

  /** tests : place le visiteur et l'oriente */
  debugVisite(x: number, z: number, yaw: number): void {
    this.moi = { x, z, yaw, pitch: 0 };
  }

  private regarder(dx: number, dy: number, k: number): void {
    this.moi.yaw -= dx * k;
    this.moi.pitch = Math.max(-1.2, Math.min(1.2, this.moi.pitch - dy * k));
  }

  /** Touche E : ouvre la fiche de l'agent en face (la souris est libérée pour discuter). */
  private parler(): void {
    const id = uiStore.getState().visiteCible;
    if (!id) return;
    if (document.pointerLockElement === this.renderer.domElement) {
      this.pourParler = true;
      document.exitPointerLock();
    }
    ui.selectAgent(id);
  }

  private solide(x: number, z: number): boolean {
    const { gw, gh, solide } = this.plan;
    for (const [dx, dz] of [[0, 0], [RAYON, 0], [-RAYON, 0], [0, RAYON], [0, -RAYON], [RAYON * 0.7, RAYON * 0.7], [-RAYON * 0.7, RAYON * 0.7], [RAYON * 0.7, -RAYON * 0.7], [-RAYON * 0.7, -RAYON * 0.7]] as [number, number][]) {
      const i = Math.floor((x + dx) / RES);
      const j = Math.floor((z + dz) / RES);
      if (i < 0 || j < 0 || i >= gw || j >= gh || solide[j * gw + i]) return true;
    }
    return false;
  }

  /** vue dégagée (murs pleins seulement) entre deux points */
  private voit(x0: number, z0: number, x1: number, z1: number): boolean {
    const { gw, gh, opaque } = this.plan;
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (RES * 0.6));
    for (let k = 1; k < n; k++) {
      const i = Math.floor((x0 + ((x1 - x0) * k) / n) / RES);
      const j = Math.floor((z0 + ((z1 - z0) * k) / n) / RES);
      if (i < 0 || j < 0 || i >= gw || j >= gh || opaque[j * gw + i]) return false;
    }
    return true;
  }

  private marcher(dt: number): void {
    const k = this.touches;
    let av = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) + this.manette.y;
    let dr = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0) + this.manette.x;
    if (k.has("ArrowLeft")) this.moi.yaw += dt * 2;
    if (k.has("ArrowRight")) this.moi.yaw -= dt * 2;
    const n = Math.hypot(av, dr);
    if (n > 1) {
      av /= n;
      dr /= n;
    }
    if (n > 0.01 && uiStore.getState().visite !== "pause") {
      const vitesse = k.has("ShiftLeft") || k.has("ShiftRight") ? 6.5 : 3.4;
      const s = Math.sin(this.moi.yaw);
      const c = Math.cos(this.moi.yaw);
      // avant = (-sin, -cos) ; droite = (cos, -sin)
      const dx = (-s * av + c * dr) * vitesse * dt;
      const dz = (-c * av - s * dr) * vitesse * dt;
      const pas = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.08));
      for (let i = 0; i < pas; i++) {
        // on glisse le long des murs : un axe à la fois
        if (!this.solide(this.moi.x + dx / pas, this.moi.z)) this.moi.x += dx / pas;
        if (!this.solide(this.moi.x, this.moi.z + dz / pas)) this.moi.z += dz / pas;
      }
    }
    // léger balancement en marchant
    const bob = n > 0.01 ? Math.sin(this.temps * 9) * 0.025 : 0;
    this.camera.position.set(this.moi.x, YEUX + bob, this.moi.z);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.set(this.moi.pitch, this.moi.yaw, 0);
  }

  /** Mesure la fluidité ; sous 24 images par seconde, on allège : d'abord la finesse, puis les ombres. */
  private mesurer(dt: number): void {
    if (dt > 1) return; // onglet en arrière-plan
    this.fpsT += dt;
    this.fpsN++;
    if (this.fpsT < 2.5) return;
    const fps = this.fpsN / this.fpsT;
    this.fpsT = 0;
    this.fpsN = 0;
    uiStore.setState({ fps: Math.round(fps) });
    if (fps >= 24 || this.temps < 5 || this.qualite >= 2) return;
    this.qualite++;
    if (this.qualite === 1) {
      this.renderer.setPixelRatio(1);
      this.redimensionner();
    } else {
      this.renderer.shadowMap.enabled = false;
      this.soleil.castShadow = false;
      for (const m of this.decor.materiaux) m.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- effets
  private feter(x: number, z: number): void {
    for (let i = 0; i < 40 && this.particules.length < 300; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 1 + Math.random() * 2.2;
      this.particules.push({ x, y: 1.7, z, vx: Math.cos(a) * v, vy: 2.5 + Math.random() * 3, vz: Math.sin(a) * v, vie: 1.6 + Math.random() * 0.8 });
    }
  }

  private majConfettis(dt: number): void {
    const pos = this.confettis.geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = this.confettis.geometry.getAttribute("color") as THREE.BufferAttribute;
    const teintes = [[1, 0.83, 0.3], [0.88, 0.31, 0.6], [0.23, 0.48, 0.84], [0.18, 0.62, 0.38], [1, 0.44, 0.38]];
    this.particules = this.particules.filter((p) => (p.vie -= dt) > 0);
    let i = 0;
    for (const p of this.particules) {
      p.vy -= 9 * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0.05, p.y + p.vy * dt);
      p.z += p.vz * dt;
      pos.setXYZ(i, p.x, p.y, p.z);
      const t = teintes[i % teintes.length]!;
      col.setXYZ(i, t[0]!, t[1]!, t[2]!);
      i++;
    }
    this.confettis.geometry.setDrawRange(0, i);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  private ecran(p: THREE.Vector3): { x: number; y: number; devant: boolean } {
    this.v3.copy(p).project(this.camera);
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    return { x: (this.v3.x * 0.5 + 0.5) * w, y: (-this.v3.y * 0.5 + 0.5) * h, devant: this.v3.z < 1 && this.v3.z > -1 };
  }

  // ---------------------------------------------------------------- boucle
  private update(): void {
    if (this.detruit) return;
    const brut = this.horloge.getDelta();
    const dt = Math.min(0.1, brut);
    this.temps += dt;
    this.mesurer(brut);
    const now = Date.now();
    const st = world.get();
    const visite = this.mode === "visite";

    if (now - this.dernierHeure > 1000 || st.clockOverride !== null) {
      this.heure = st.clockOverride ?? parisHour();
      this.dernierHeure = now;
    }
    // jour / nuit : le ciel change, l'intérieur reste éclairé (on travaille 24 h/24)
    const amb = ambianceAt(this.heure);
    const ciel = new THREE.Color(amb.skyBottom).lerp(new THREE.Color(amb.skyTop), 0.45);
    this.scene.background = ciel;
    (this.scene.fog as THREE.Fog).color.copy(ciel);
    this.soleil.intensity = 2.4 * (1 - amb.night * 0.92);
    this.hemi.intensity = 1.4 - amb.night * 0.7;
    this.ambiant.intensity = 0.8 + amb.night * 0.55;
    this.ambiant.color.set(amb.night > 0.5 ? 0xffe9c8 : 0xffffff);
    this.decor.jardin.color.set(amb.tint).lerp(new THREE.Color(0x1d2550), amb.night * 0.55);

    // caméra
    if (visite) this.marcher(dt);
    else {
      if (this.vol) {
        const v = this.vol;
        v.t += dt;
        const k = Math.min(1, v.t / v.dur);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        this.camera.position.lerpVectors(v.p0, v.p1, e);
        this.controls.target.lerpVectors(v.c0, v.c1, e);
        if (k >= 1) this.vol = null;
      }
      this.controls.update();
    }

    // agents
    const selection = uiStore.getState().selectedAgent;
    for (const a of this.agents.values()) {
      const rt = st.agents[a.id];
      if (rt) a.sync(rt, st.celebrations[a.id]);
      const b = st.bubbles[a.id];
      a.update(dt, rt, !!b && b.until > now);
      const l = this.lueurs.get(a.id);
      if (l) l.visible = rt?.state === "working" && a.pose === "type";
    }
    const sel = selection ? this.agents.get(selection) : undefined;
    this.anneau.visible = !!sel && !sel.cache;
    if (sel) this.anneau.position.set(sel.x, 0.07, sel.z);
    const livres = st.approvals.filter((a) => a.delivered).length;
    this.colis.forEach((c, i) => (c.visible = i < livres));
    this.majConfettis(dt);

    // écrans géants (8 images par seconde)
    const image = Math.floor(this.temps * 8);
    if (image !== this.dernierEcran) {
      this.dernierEcran = image;
      for (const e of this.ecrans) {
        if (e.role === "infos") dessinerInfos(e.ctx, e.canvas, this.temps, st, this.heure);
        else dessinerPubs(e.ctx, e.canvas, this.temps);
        e.tex.needsUpdate = true;
      }
    }

    // présence par pièce
    if (now - this.dernierPresence > 800) {
      this.dernierPresence = now;
      const presence: Record<string, number> = {};
      for (const a of this.agents.values()) {
        if (a.cache) continue;
        const l = lieuDe(this.plan, a.x, a.z);
        if (!l || l.id === "couloir") continue;
        const pole = poleById(l.id);
        if (!pole || pole.kind === "lieu" || agentById(a.id)?.pole === l.id) presence[l.id] = (presence[l.id] ?? 0) + 1;
      }
      world.setPresence(presence);
    }

    this.renderer.render(this.scene, this.camera);
    this.majCouche(st, now, visite);
  }

  /** Couche DOM : étiquettes des pièces, bulles, liaisons ; en visite, le nom et l'état des agents proches. */
  private majCouche(st: ReturnType<typeof world.get>, now: number, visite: boolean): void {
    const tetes = new Map<string, { x: number; y: number; hidden: boolean }>();
    const p = new THREE.Vector3();
    const proches: { id: string; x: number; y: number; d: number }[] = [];
    let cible: string | null = null;
    let cibleD = Infinity;
    for (const a of this.agents.values()) {
      p.set(a.x, a.perso.hauteur + 0.12, a.z);
      const e = this.ecran(p);
      let cachee = a.cache || !e.devant;
      if (visite && !cachee) {
        const d = Math.hypot(a.x - this.moi.x, a.z - this.moi.z);
        cachee = d > 22 || !this.voit(this.moi.x, this.moi.z, a.x, a.z);
        if (!cachee && d < 16) proches.push({ id: a.id, x: e.x, y: e.y, d });
        // en face, à portée de voix
        const w = this.host.clientWidth;
        if (!cachee && d < 3.6 && Math.abs(e.x - w / 2) < w * 0.16 && d < cibleD) {
          cibleD = d;
          cible = a.id;
        }
      }
      tetes.set(a.id, { x: e.x, y: e.y, hidden: cachee });
    }
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.overlay.update({
      toScreen: (x, y) => ({ x, y }),
      scale: visite ? 2 : Math.max(0.4, Math.min(3, 80 / dist)),
      heads: tetes,
      bubbles: st.bubbles,
      presence: st.presence,
      pending: st.approvals.length,
      agents: st.agents,
      hover: visite ? null : uiStore.getState().hoverAgent,
      now,
      links: st.links,
      labelPos: (zone) => {
        if (visite) return null;
        const pc = this.plan.pieces.find((x) => x.id === zone);
        if (!pc) return null;
        const e = this.ecran(p.set((pc.x0 + pc.x1) / 2, HAUTEUR + 0.3, (pc.z0 + pc.z1) / 2));
        return e.devant ? e : null;
      },
    });

    if (!visite) return;
    // étiquettes « Zoé · au travail » au-dessus des agents proches
    const vus = new Set<string>();
    for (const t of proches) {
      if (st.bubbles[t.id] && st.bubbles[t.id]!.until > now) continue;
      vus.add(t.id);
      let el = this.tags.get(t.id);
      const rt = st.agents[t.id];
      if (!el) {
        el = document.createElement("div");
        el.className = "tag3d";
        const a = agentById(t.id);
        el.style.setProperty("--pole", poleById(a?.pole ?? "")?.couleur ?? "#888");
        el.innerHTML = `<i></i><b></b><span></span>`;
        (el.querySelector("b") as HTMLElement).textContent = a?.nom ?? t.id;
        this.tagsRoot.appendChild(el);
        this.tags.set(t.id, el);
      }
      const etat = rt ? STATE_LABEL[rt.state].toLowerCase() : "";
      const span = el.querySelector("span") as HTMLElement;
      if (span.textContent !== ` · ${etat}`) span.textContent = ` · ${etat}`;
      el.style.transform = `translate3d(${Math.round(t.x)}px, ${Math.round(t.y)}px, 0) translate(-50%, -100%) scale(${Math.max(0.7, Math.min(1.15, 5 / t.d)).toFixed(2)})`;
      el.classList.toggle("is-cible", t.id === cible);
    }
    for (const [id, el] of this.tags) {
      if (!vus.has(id)) {
        el.remove();
        this.tags.delete(id);
      }
    }
    const lieu = lieuDe(this.plan, this.moi.x, this.moi.z)?.nom ?? null;
    const u = uiStore.getState();
    if (u.visiteLieu !== lieu || u.visiteCible !== cible) uiStore.setState({ visiteLieu: lieu, visiteCible: cible });
  }

  destroy(): void {
    this.detruit = true;
    this.renderer.setAnimationLoop(null);
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    for (const c of this.nettoyage) c();
    this.controls.dispose();
    this.overlay.destroy();
    this.tagsRoot.remove();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
    });
    for (const m of this.decor.materiaux) m.dispose();
    for (const e of this.ecrans) e.tex.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    uiStore.setState({ visite: "non", visiteLieu: null, visiteCible: null });
  }
}
