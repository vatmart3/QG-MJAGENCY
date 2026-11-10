import { agentById, allAgents } from "@/data/catalog";
import { ON_CALL } from "@/data/seed";
import { APPROVALS, CHATTER, MISSION_ROUTES, STANDUP_LINES, TALKS, type ScriptedTalk } from "@/data/mockContent";
import { parisHour } from "@/lib/paris";
import { mulberry32 } from "@/lib/rng";
import { isWorkingHour } from "@/world/daynight";
import { uid, world, type AgentRuntime, type Line, type Meeting, type TaskRef } from "@/store/world";

/**
 * Directeur de démo (Phase 1) : simule le moteur d'agents côté client.
 * Il ne fait que modifier l'état « réel » (store) ; la ville se contente de le refléter.
 * En Phase 3, ce rôle est tenu par /api/engine/tick + Supabase Realtime.
 */

const LINE_MS = 3400;
const rng = mulberry32(Date.now() & 0xffffffff);
const rand = () => rng();
const chance = (p: number) => rng() < p;
const pickOne = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;

interface Timer {
  at: number;
  fn: () => void;
}

/** Écritures réelles en base (mode « direct ») — implémenté par src/sync/live.ts. */
export interface LiveAdapter {
  email: string;
  insertMission(texte: string, cible: string): Promise<void>;
  decideApproval(id: string, decision: { statut: "approuve" | "modifie" | "refuse"; motif?: string; apercu?: string; regle?: { agentId: string; type: string } }): Promise<void>;
  log(entry: { type: string; titre: string; contenu?: string; agentId?: string; poleId?: string }): Promise<void>;
}

class Director {
  private timer: ReturnType<typeof setInterval> | null = null;
  private timers: Timer[] = [];
  private taskEnd: Record<string, number> = {};
  private lastTalk = 0;
  private lastChatter = 0;
  private lastStandupDay = -1;
  private lastLineAt: Record<string, number> = {};
  private started = false;
  /** demo = moteur simulé dans le navigateur ; live = la base fait foi, on ne joue que les bulles */
  private mode: "demo" | "live" = "demo";
  private live: LiveAdapter | null = null;
  private convActivity: Record<string, number> = {};
  private bootstrapped = false;

  hour(): number {
    return world.get().clockOverride ?? parisHour();
  }

  get isLive(): boolean {
    return this.mode === "live";
  }

  start(mode: "demo" | "live" = "demo", live?: LiveAdapter): void {
    if (this.started) return;
    this.started = true;
    this.mode = mode;
    this.live = live ?? null;
    if (mode === "demo" && !this.bootstrapped) {
      this.bootstrapped = true;
      this.bootstrap();
    }
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push({ at: Date.now() + ms, fn });
  }

  // ---------------------------------------------------------------- démarrage
  private bootstrap(): void {
    const h = this.hour();
    const now = Date.now();
    const working = isWorkingHour(h);
    // journal du jour déjà rempli
    const past: [number, string, string][] = [
      [-6.2, "diane", "Récap quotidien envoyé à Jérémy, Matheis et la boîte officielle"],
      [-6.5, "jade", "12 sites clients vérifiés : tous au vert"],
      [-6.4, "remi", "2 factures échues détectées, relances préparées"],
      [-5.0, "clemence", "Stand-up : 8 responsables de pôle présents"],
      [-4.1, "lucie", "14 mails triés (3 prospects, 2 clients, 1 fournisseur)"],
      [-3.2, "hugo", "10 nouveaux leads à Frontignan et Balaruc"],
      [-2.4, "bastien", "Paiement reçu : Bistrot du Canal (650 €)"],
      [-1.1, "victor", "Devis D-2026-0041 préparé pour la Fromagerie Saint-Clair"],
    ];
    for (const [dh, agentId, title] of past) {
      world.log({ at: now + dh * 3600_000, agentId, poleId: agentById(agentId)?.pole, type: "action", title });
    }
    // éléments déjà en Douane
    for (const t of APPROVALS.slice(0, 4)) {
      world.addApproval({ agentId: t.agentId, type: t.type, title: t.title, to: t.to, subject: t.subject, preview: t.preview, delivered: true });
    }
    for (const a of allAgents()) {
      if (!working && !ON_CALL.includes(a.id)) {
        world.patchAgent(a.id, { state: "offline", offlineReason: "nuit" });
        continue;
      }
      if (chance(working ? 0.62 : 0.5)) this.startTask(a.id, true);
      else world.patchAgent(a.id, { state: "idle" });
    }
    this.lastTalk = now - 12_000;
    this.lastChatter = now;
  }

  // ---------------------------------------------------------------- boucle
  private tick(): void {
    const now = Date.now();
    const s = world.get();
    const h = this.hour();
    const working = isWorkingHour(h);

    // minuteries
    const due = this.timers.filter((t) => t.at <= now);
    this.timers = this.timers.filter((t) => t.at > now);
    for (const t of due) t.fn();

    if (this.mode === "live") {
      this.runConversations(now);
      this.runMeetings(now);
      return;
    }

    // nuit / jour
    for (const a of allAgents()) {
      const rt = s.agents[a.id];
      if (!rt) continue;
      const onCall = ON_CALL.includes(a.id);
      if (!working && !onCall && rt.state !== "offline" && rt.state !== "talking" && rt.state !== "meeting") {
        if (chance(0.06)) {
          world.patchAgent(a.id, { state: "offline", offlineReason: "nuit", task: null });
          if (chance(0.3)) world.say(a.id, "Bonne soirée !", 2500);
        }
      } else if (working && rt.state === "offline" && rt.offlineReason === "nuit") {
        if (chance(0.05)) world.patchAgent(a.id, { state: "idle", offlineReason: null });
      }
    }

    // tâches
    for (const a of allAgents()) {
      const rt = world.get().agents[a.id];
      if (!rt) continue;
      if (rt.state === "working" && rt.task) {
        const end = this.taskEnd[a.id] ?? 0;
        const steps = rt.task.steps;
        const total = Math.max(1, end - rt.task.startedAt);
        const progress = (now - rt.task.startedAt) / total;
        const doneCount = Math.min(steps.length, Math.floor(progress * steps.length));
        if (steps.some((st, i) => st.done !== i < doneCount)) {
          world.patchAgent(a.id, { task: { ...rt.task, steps: steps.map((st, i) => ({ ...st, done: i < doneCount })) } });
        }
        if (now >= end) this.finishTask(a.id);
      } else if (rt.state === "idle" && working) {
        if (chance(1 / 22)) this.startTask(a.id);
      } else if (rt.state === "idle" && !working && ON_CALL.includes(a.id) && chance(1 / 60)) {
        this.startTask(a.id);
      }
    }

    // conversations
    this.runConversations(now);
    this.runMeetings(now);
    if (working && now - this.lastTalk > 16_000 + rand() * 14_000 && Object.keys(world.get().conversations).length < 2) {
      this.tryStartTalk();
      this.lastTalk = now;
    }

    // stand-up 08:30
    const day = new Date().getDate();
    if (h >= 8.5 && h < 8.75 && this.lastStandupDay !== day) {
      this.lastStandupDay = day;
      this.startMeeting(
        "Stand-up du matin",
        allAgents().filter((a) => a.responsable || a.id === "clemence").map((a) => a.id).slice(0, 10),
        STANDUP_LINES.map(([from, text]) => ({ from, text })),
      );
    }

    // bavardage d'ambiance
    if (s.chatterEnabled && now - this.lastChatter > 9_000 + rand() * 9_000) {
      this.lastChatter = now;
      const candidates = CHATTER.filter(([id]) => {
        const st = s.agents[id]?.state;
        return st === "idle" || st === "working";
      });
      if (candidates.length) {
        const [id, text] = pickOne(candidates);
        world.say(id, text, 3800);
      }
    }
  }

  // ---------------------------------------------------------------- tâches
  startTask(agentId: string, initial = false, title?: string, opts?: { missionId?: string; important?: boolean; durationMs?: number }): void {
    const a = agentById(agentId);
    if (!a) return;
    const t = title ?? (a.taches.length ? pickOne(a.taches) : `${a.role || "Travail"} — dossier du jour`);
    const now = Date.now();
    const dur = opts?.durationMs ?? 35_000 + rand() * 70_000;
    const startedAt = initial ? now - rand() * dur * 0.6 : now;
    const task: TaskRef = {
      id: uid("t"),
      title: t,
      startedAt,
      missionId: opts?.missionId,
      important: opts?.important ?? chance(0.3),
      steps: stepsFor(a.id, t),
    };
    this.taskEnd[agentId] = startedAt + dur;
    world.patchAgent(agentId, { state: "working", task, talkWith: null });
    world.upsertTask({ id: task.id, agentId, title: t, status: "running", createdAt: startedAt, updatedAt: now, missionId: opts?.missionId });
    if (!initial && chance(0.5)) world.say(agentId, t.length > 54 ? t.slice(0, 52) + "…" : t, 3600);
  }

  private finishTask(agentId: string): void {
    const rt = world.get().agents[agentId];
    const a = agentById(agentId);
    if (!rt || !rt.task || !a) return;
    const task = rt.task;
    const pendingCount = world.get().approvals.length;
    if (a.sortant && !task.missionId && pendingCount < 10 && chance(0.45)) {
      const tpl = APPROVALS.find((x) => x.agentId === agentId) ?? {
        agentId, type: "email" as const, title: task.title, preview: `${a.nom} a préparé : ${task.title}.\n\n(Contenu de démonstration.)`,
      };
      const ap = world.addApproval({ agentId, type: tpl.type, title: tpl.title, to: tpl.to, subject: tpl.subject, preview: tpl.preview });
      world.patchAgent(agentId, { state: "waiting_approval", approvalId: ap.id });
      world.upsertTask({ id: task.id, agentId, title: task.title, status: "waiting_approval", createdAt: task.startedAt, updatedAt: Date.now() });
      world.log({ agentId, poleId: a.pole, type: "validation", title: `${a.nom} dépose en Douane : ${tpl.title}` });
      world.say(agentId, "Je dépose ça à La Douane.", 3000);
      // l'enveloppe est livrée par l'animation ; filet de sécurité
      this.later(45_000, () => world.markDelivered(ap.id));
      this.later(50_000, () => {
        const cur = world.get().agents[agentId];
        if (cur?.state === "waiting_approval") world.patchAgent(agentId, { state: "idle", task: null, approvalId: null });
      });
      return;
    }
    world.upsertTask({ id: task.id, agentId, title: task.title, status: "done", createdAt: task.startedAt, updatedAt: Date.now(), missionId: task.missionId });
    world.log({ agentId, poleId: a.pole, type: "action", title: `${a.nom} — ${task.title}` });
    if (task.important) {
      world.patchAgent(agentId, { state: "done", task: null });
      world.celebrate(agentId);
      this.later(2600, () => {
        const cur = world.get().agents[agentId];
        if (cur?.state === "done") world.patchAgent(agentId, { state: "idle", task: null });
      });
    } else {
      world.patchAgent(agentId, { state: "idle", task: null });
    }
    if (task.missionId) this.onMissionSubtaskDone(task.missionId);
  }

  // ---------------------------------------------------------------- conversations
  private available(id: string): boolean {
    const st = world.get().agents[id]?.state;
    return st === "idle" || st === "working";
  }

  private tryStartTalk(): void {
    const options = TALKS.filter((t) => this.available(t.a) && this.available(t.b));
    if (!options.length) return;
    this.startTalk(pickOne(options));
  }

  startTalk(t: ScriptedTalk): void {
    const id = uid("c");
    const lines: Line[] = t.lines.map(([from, text]) => ({ from, text }));
    world.setConversation({ id, a: t.a, b: t.b, lines, phase: "gathering", idx: 0, startedAt: Date.now(), ready: false });
    world.patchAgent(t.a, { state: "talking", talkWith: t.b });
    world.patchAgent(t.b, { state: "talking", talkWith: t.a });
    this.later(1, () => world.log({ agentId: t.a, poleId: agentById(t.a)?.pole, type: "echange", title: t.journal, detail: t.lines.map(([w, x]) => `${agentById(w)?.nom} : ${x}`).join("\n") }));
  }

  private runConversations(now: number): void {
    for (const c of Object.values(world.get().conversations)) {
      if (c.phase === "gathering" && (c.ready || now - c.startedAt > 28_000)) {
        world.setConversation({ ...c, phase: "playing", idx: 0 });
        this.lastLineAt[c.id] = 0;
        continue;
      }
      if (c.phase === "playing") {
        if (now - (this.lastLineAt[c.id] ?? 0) < LINE_MS) continue;
        const line = c.lines[c.idx];
        if (!line) {
          if (this.mode === "live") {
            // on attend d'éventuelles répliques encore en route
            if (now - (this.convActivity[c.id] ?? 0) > 9000) world.dropConversation(c.id);
            continue;
          }
          world.dropConversation(c.id);
          for (const id of [c.a, c.b]) this.resume(id);
          continue;
        }
        world.say(line.from, line.text, LINE_MS - 150);
        this.lastLineAt[c.id] = now;
        this.convActivity[c.id] = now;
        world.setConversation({ ...c, idx: c.idx + 1 });
      }
    }
  }

  private resume(id: string): void {
    const rt = world.get().agents[id];
    if (!rt) return;
    if (rt.task && (this.taskEnd[id] ?? 0) > Date.now()) world.patchAgent(id, { state: "working", talkWith: null });
    else world.patchAgent(id, { state: "idle", talkWith: null, task: null });
  }

  /** Mode direct : un message entre agents (table agent_messages) devient une bulle dans la ville. */
  playMessage(m: { conversationId: string | null; from: string | null; to: string | null; text: string }): void {
    if (!m.from || !m.text) return;
    if (!m.to) {
      world.say(m.from, m.text, 3800);
      return;
    }
    const pairKey = [m.from, m.to].sort().join("+");
    const id = m.conversationId ?? `pair_${pairKey}`;
    const cur = world.get().conversations[id];
    const line = { from: m.from, text: m.text };
    this.convActivity[id] = Date.now();
    if (cur) world.setConversation({ ...cur, lines: [...cur.lines, line] });
    else world.setConversation({ id, a: m.from, b: m.to, lines: [line], phase: "playing", idx: 0, startedAt: Date.now(), ready: true });
  }

  // ---------------------------------------------------------------- réunions
  startMeeting(title: string, participants: string[], lines: Line[], onDone?: () => void): string {
    const id = uid("m");
    const present = participants.filter((p) => world.get().agents[p]?.state !== "offline");
    const m: Meeting = { id, title, participants: present, lines, phase: "gathering", idx: 0, startedAt: Date.now(), arrived: [] };
    world.setMeeting(m);
    for (const p of present) world.patchAgent(p, { state: "meeting", talkWith: null });
    world.log({ type: "decision", poleId: "criee", title: `Réunion dans La Criée : ${title}`, detail: present.map((p) => agentById(p)?.nom).join(", ") });
    if (onDone) this.meetingDone[id] = onDone;
    return id;
  }

  private meetingDone: Record<string, () => void> = {};

  private runMeetings(now: number): void {
    for (const m of Object.values(world.get().meetings)) {
      if (m.phase === "gathering") {
        const enough = m.arrived.length >= Math.ceil(m.participants.length * 0.8);
        if (enough || now - m.startedAt > 35_000) {
          world.setMeeting({ ...m, phase: "playing", idx: 0 });
          this.lastLineAt[m.id] = 0;
        }
        continue;
      }
      if (m.phase === "playing") {
        if (now - (this.lastLineAt[m.id] ?? 0) < LINE_MS) continue;
        const line = m.lines[m.idx];
        if (!line) {
          world.dropMeeting(m.id);
          for (const p of m.participants) this.resume(p);
          this.meetingDone[m.id]?.();
          delete this.meetingDone[m.id];
          continue;
        }
        world.say(line.from, line.text, LINE_MS - 150);
        this.lastLineAt[m.id] = now;
        world.setMeeting({ ...m, idx: m.idx + 1 });
      }
    }
  }

  // ---------------------------------------------------------------- missions
  private missionPending: Record<string, Set<string>> = {};

  submitMission(text: string): void {
    const clean = text.trim();
    if (!clean) return;
    const mention = clean.match(/@([\p{L}]+)/u);
    const tagged = mention ? allAgents().find((a) => norm(a.nom) === norm(mention[1]!)) : undefined;
    const missionId = uid("mi");
    const short = shorten(clean.replace(/@[\p{L}]+\s*/u, ""), 48);

    if (this.mode === "live" && this.live) {
      const target = tagged ?? agentById("marius");
      const cible = target?.id ?? "marius";
      void this.live.insertMission(clean, cible).then(
        () => world.say(cible, cible === "marius" ? "Reçu. Mission enregistrée, je la planifie dès que le moteur est branché." : "Bien reçu, c'est noté !", 4200),
        (e: unknown) => world.say(cible, `Oups, la mission n'a pas été enregistrée (${e instanceof Error ? e.message : "erreur"}).`, 5000),
      );
      return;
    }

    if (tagged && tagged.id !== "marius") {
      world.addMission({ id: missionId, text: clean, target: tagged.id, plan: [{ agentId: tagged.id, title: short }], status: "en_cours", createdAt: Date.now() });
      world.log({ agentId: tagged.id, poleId: tagged.pole, type: "mission", title: `Mission directe pour ${tagged.nom} : ${short}` });
      if (world.get().agents[tagged.id]?.state === "offline") world.patchAgent(tagged.id, { state: "idle", offlineReason: null });
      world.say(tagged.id, "Bien reçu, je m'en occupe !", 3200);
      this.missionPending[missionId] = new Set([tagged.id]);
      this.later(1500, () => this.startTask(tagged.id, false, `Mission : ${short}`, { missionId, important: true, durationMs: 28_000 + rand() * 12_000 }));
      return;
    }

    // via Marius
    world.addMission({ id: missionId, text: clean, target: "marius", plan: [], status: "planification", createdAt: Date.now() });
    world.log({ agentId: "marius", poleId: "direction", type: "mission", title: `Nouvelle mission pour Marius : ${short}` });
    if (world.get().agents.marius?.state === "offline") world.patchAgent("marius", { state: "idle", offlineReason: null });
    world.patchAgent("marius", { state: "working", task: { id: uid("t"), title: `Planification : ${short}`, startedAt: Date.now(), steps: [{ label: "Comprendre la demande", done: false }, { label: "Découper en sous-tâches", done: false }, { label: "Choisir les agents", done: false }], missionId } });
    this.taskEnd.marius = Date.now() + 60_000;
    world.say("marius", "Reçu. Je planifie et je répartis.", 3200);

    const lower = norm(clean);
    const team = new Set<string>();
    for (const r of MISSION_ROUTES) if (r.keys.some((k) => lower.includes(norm(k)))) r.agents.forEach((a) => team.add(a));
    if (!team.size) ["clemence", "diane"].forEach((a) => team.add(a));
    const members = [...team].slice(0, 4);
    const plan = members.map((id) => ({ agentId: id, title: subtaskTitle(id, short) }));

    this.later(4500, () => {
      world.patchMission(missionId, { plan, status: "en_cours" });
      world.log({
        agentId: "marius", poleId: "direction", type: "decision", title: `Plan de Marius : ${plan.length} sous-tâches`,
        detail: plan.map((p) => `• ${agentById(p.agentId)?.nom} — ${p.title}`).join("\n"),
      });
      for (const m of members) if (world.get().agents[m]?.state === "offline") world.patchAgent(m, { state: "idle", offlineReason: null });
      const lines: Line[] = [
        { from: "marius", text: `Mission : ${shorten(short, 44)}` },
        ...plan.map((p) => ({ from: p.agentId, text: `Je prends : ${shorten(p.title, 42)}` })),
        { from: "marius", text: "Parfait. On se retrouve pour la synthèse." },
      ];
      this.missionPending[missionId] = new Set(members);
      world.patchAgent("marius", { task: null });
      this.startMeeting(`Mission — ${short}`, ["marius", ...members], lines, () => {
        world.patchAgent("marius", { state: "working", task: { id: uid("t"), title: `Suivi : ${short}`, startedAt: Date.now(), steps: plan.map((p) => ({ label: `${agentById(p.agentId)?.nom} — ${p.title}`, done: false })), missionId } });
        this.taskEnd.marius = Date.now() + 10 * 60_000;
        for (const p of plan) {
          this.later(600 + rand() * 1200, () => this.startTask(p.agentId, false, p.title, { missionId, important: true, durationMs: 26_000 + rand() * 22_000 }));
        }
      });
    });
  }

  private onMissionSubtaskDone(missionId: string): void {
    const pending = this.missionPending[missionId];
    if (!pending) return;
    const mission = world.get().missions.find((m) => m.id === missionId);
    // retire l'agent qui vient de finir
    for (const id of [...pending]) {
      const rt = world.get().agents[id];
      if (!rt?.task || rt.task.missionId !== missionId) pending.delete(id);
    }
    const marius = world.get().agents.marius;
    if (marius?.task?.missionId === missionId) {
      const done = mission ? mission.plan.length - pending.size : 0;
      world.patchAgent("marius", { task: { ...marius.task, steps: marius.task.steps.map((s, i) => ({ ...s, done: i < done })) } });
    }
    if (pending.size === 0) {
      delete this.missionPending[missionId];
      const synth = mission
        ? `Mission « ${shorten(mission.text, 60)} » terminée. ${mission.plan.map((p) => `${agentById(p.agentId)?.nom} : ${p.title}`).join(" · ") || "Tâche réalisée."}`
        : "Mission terminée.";
      world.patchMission(missionId, { status: "terminee", synthese: synth });
      world.log({ agentId: mission?.target ?? "marius", poleId: "direction", type: "mission", title: "Synthèse livrée aux fondateurs", detail: synth });
      const who = mission?.target ?? "marius";
      world.say(who, "Mission terminée, synthèse dans le Journal !", 4200);
      if (who === "marius") {
        world.patchAgent("marius", { state: "done", task: null });
        world.celebrate("marius");
        this.later(2600, () => world.patchAgent("marius", { state: "idle" }));
      }
    }
  }

  // ---------------------------------------------------------------- Douane
  approve(id: string, mode: "envoye" | "modifie" | "regle" = "envoye", apercu?: string): void {
    if (this.mode === "live" && this.live) {
      const ap = world.get().approvals.find((a) => a.id === id);
      if (!ap) return;
      world.removeApproval(id);
      void this.live
        .decideApproval(id, {
          statut: mode === "modifie" ? "modifie" : "approuve",
          apercu: mode === "modifie" ? apercu : undefined,
          regle: mode === "regle" ? { agentId: ap.agentId, type: ap.type } : undefined,
        })
        .catch(() => world.hydrate({ approvals: [...world.get().approvals, ap] }));
      if (ap.agentId) world.say(ap.agentId, ap.type === "question" ? "Merci, je m'adapte !" : "Validé ✅ (envoi réel en Phase 4)", 3200);
      return;
    }
    const ap = world.removeApproval(id);
    if (!ap) return;
    const a = agentById(ap.agentId);
    const verb = ap.type === "question" ? "Réponse transmise" : mode === "modifie" ? "Modifié puis envoyé" : "Validé et envoyé";
    world.log({ agentId: ap.agentId, poleId: a?.pole, type: "validation", title: `${verb} : ${ap.title}` });
    if (mode === "regle" && a) world.log({ agentId: ap.agentId, poleId: a.pole, type: "decision", title: `Règle d'autonomie ajoutée : toujours autoriser « ${typeLabel(ap.type)} » de ${a.nom}` });
    const rt = world.get().agents[ap.agentId];
    if (rt && rt.state !== "offline") world.say(ap.agentId, ap.type === "question" ? "Merci, je m'adapte !" : "Envoyé ✅ merci !", 3000);
    if (rt?.state === "waiting_approval" && rt.approvalId === id) world.patchAgent(ap.agentId, { state: "idle", task: null, approvalId: null });
  }

  refuse(id: string, motif: string): void {
    if (this.mode === "live" && this.live) {
      const ap = world.get().approvals.find((a) => a.id === id);
      if (!ap) return;
      world.removeApproval(id);
      void this.live.decideApproval(id, { statut: "refuse", motif }).catch(() => world.hydrate({ approvals: [...world.get().approvals, ap] }));
      if (ap.agentId) world.say(ap.agentId, "Compris, je corrige.", 3000);
      return;
    }
    const ap = world.removeApproval(id);
    if (!ap) return;
    const a = agentById(ap.agentId);
    world.log({ agentId: ap.agentId, poleId: a?.pole, type: "validation", title: `Refusé : ${ap.title}`, detail: motif ? `Motif : ${motif}` : undefined });
    const rt = world.get().agents[ap.agentId];
    if (rt && rt.state !== "offline") world.say(ap.agentId, "Compris, je corrige.", 3000);
    if (rt?.state === "waiting_approval" && rt.approvalId === id) world.patchAgent(ap.agentId, { state: "idle", task: null, approvalId: null });
  }

  // ---------------------------------------------------------------- chat direct
  chat(agentId: string, text: string): void {
    const a = agentById(agentId);
    if (!a || !text.trim()) return;
    world.pushChat(agentId, { from: "fondateur", text: text.trim(), at: Date.now() });
    if (this.mode === "live") {
      this.later(900, () =>
        world.pushChat(agentId, { from: "agent", text: "Message bien reçu. Je pourrai te répondre pour de vrai quand le moteur d'agents sera branché (Phase 3).", at: Date.now() }),
      );
      return;
    }
    const rt = world.get().agents[agentId];
    if (rt && rt.state !== "offline") world.say(agentId, "Je regarde ça…", 1800);
    this.later(1300 + rand() * 900, () => {
      const replies = [
        `Bien noté ! Je m'en occupe (${a.role.toLowerCase()}).`,
        `Ok, je l'ajoute à ma liste. ${rt?.task ? `Là je suis sur « ${shorten(rt.task.title, 40)} ».` : "Je suis dispo."}`,
        "Reçu 👍 Je te fais un retour dans le Journal.",
      ];
      world.pushChat(agentId, { from: "agent", text: `${pickOne(replies)}\n\n(Mode démo : les vraies réponses arrivent avec le moteur d'agents, Phase 3.)`, at: Date.now() });
    });
  }
}

function typeLabel(t: string): string {
  return { email: "mails", facture: "factures", devis: "devis", relance: "relances", rdv: "invitations", question: "questions" }[t] ?? t;
}

function norm(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function shorten(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function subtaskTitle(agentId: string, short: string): string {
  const a = agentById(agentId);
  const role = a?.role ?? "Contribution";
  const map: Record<string, string> = {
    elsa: "Argumentaire produit", mila: "Accroches et textes", victor: "Grille tarifaire et devis type", margaux: "Mise à jour du pipeline",
    theo: "Objections et réponses", bastien: "Facturation", heloise: "Impact trésorerie", remi: "Relances graduées", firmin: "Relances mails",
    hugo: "Liste de leads", ines: "Scoring et angle", sacha: "Mail + DM Instagram", zoe: "Direction artistique", leon: "Prompt Claude Code",
    rose: "SEO local", oscar: "Audit technique", chloe: "Plan de contenu", raphael: "Script vidéo", lina: "Article de blog", gabin: "Veille",
    celeste: "Créneaux d'agenda", max: "To-do fondateurs", yanis: "Commandes et stocks", lou: "Fiches et créas", iris: "Réponses clients",
    capucine: "Clauses et CGV", edouard: "Conformité", agathe: "Points fiscaux", jules: "Onboarding", nina: "Avis clients", paul: "Pistes d'upsell",
    diane: "Rapport chiffré", clemence: "Coordination", tom: "Roadmap",
  };
  return `${map[agentId] ?? role} — ${shorten(short, 30)}`;
}

function stepsFor(agentId: string, title: string): TaskRef["steps"] {
  const a = agentById(agentId);
  const base = a?.sortant
    ? ["Lire le contexte", "Rédiger le brouillon", "Relire le ton MJAGENCY", "Préparer pour la Douane"]
    : ["Lire le contexte", "Rassembler les données", "Analyser", "Rédiger la synthèse"];
  void title;
  return base.map((label) => ({ label, done: false }));
}

let instance: Director | null = null;
export function getDirector(): Director {
  if (!instance) instance = new Director();
  return instance;
}

export type { AgentRuntime };
