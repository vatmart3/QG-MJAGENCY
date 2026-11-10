/**
 * Test d'intégration du moteur d'agents sur un Postgres local (schéma LE PORT appliqué),
 * avec le modèle simulé. Usage : npm run test:moteur  (DATABASE_URL=postgres://…)
 */
import { Pool } from "pg";
import { pgEngineDb } from "@/engine/db-pg";
import { MockLLM } from "@/engine/llm";
import { tick } from "@/engine/tick";

const url = process.env.DATABASE_URL ?? "postgres:///leport_test";
const pool = new Pool({ connectionString: url });
const db = pgEngineDb(pool);
const llm = new MockLLM();
let failures = 0;
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
};
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows as T[];

async function reset() {
  await q("delete from public.agent_chats; delete from public.usage; delete from public.agent_messages; delete from public.approvals; delete from public.task_runs; update public.agents set tache_courante_id = null, etat = 'idle', offline_raison = null, interlocuteur = null; delete from public.tasks; delete from public.missions; delete from public.journal;");
}

async function scenarioMission() {
  console.log("\n— Mission « offre de lancement cartes NFC »");
  await reset();
  const [m] = await q<{ id: string }>("insert into public.missions (demandeur, texte, cible) values ($1, $2, 'marius') returning id", ["jeremyvatuonepro@gmail.com", "Prépare une offre de lancement pour les cartes NFC"]);
  let ticks = 0;
  for (; ticks < 12; ticks++) {
    const r = await tick(db, llm);
    const st = Object.entries(r.pas).filter(([, n]) => n).map(([k, n]) => `${k}:${n}`).join(" ");
    console.log(`  tick ${ticks + 1} → missions:${r.missions} reprises:${r.reprises} ${st}${r.erreurs.length ? " ERREURS " + r.erreurs.join(" / ") : ""}`);
    const [mi] = await q<{ statut: string }>("select statut from public.missions where id = $1", [m!.id]);
    if (mi?.statut === "terminee") break;
  }
  const [mi] = await q<{ statut: string; synthese: string; plan: { agentId: string }[] }>("select statut, synthese, plan from public.missions where id = $1", [m!.id]);
  check(mi?.statut === "terminee", `mission terminée en ${ticks + 1} ticks`);
  const team = (mi?.plan ?? []).map((p) => p.agentId).sort();
  check(JSON.stringify(team) === JSON.stringify(["elsa", "mila", "victor"]), `plan de Marius : ${team.join(", ")}`);
  check(!!mi?.synthese && mi.synthese.includes("Elsa") && mi.synthese.includes("Victor"), "la synthèse reprend les livrables des agents");
  const tasks = await q<{ agent_id: string; statut: string; parent_id: string | null }>("select agent_id, statut, parent_id from public.tasks");
  check(tasks.length === 4 && tasks.every((t) => t.statut === "done"), `4 tâches terminées (${tasks.map((t) => `${t.agent_id}:${t.statut}`).join(", ")})`);
  const msgs = await q<{ type: string; from_agent: string; to_agent: string | null; resume_bulle: string }>("select type, from_agent, to_agent, resume_bulle from public.agent_messages order by cree_le");
  const count = (t: string) => msgs.filter((x) => x.type === t).length;
  check(count("delegation") === 3, `3 délégations jouées dans la ville (${count("delegation")})`);
  check(count("question") === 3 && count("reponse") === 3, `3 questions / 3 réponses entre agents (${count("question")}/${count("reponse")})`);
  check(msgs.every((x) => !x.resume_bulle || x.resume_bulle.length <= 90), "bulles ≤ 90 caractères");
  console.log("  exemples de bulles :", msgs.slice(0, 6).map((x) => `${x.from_agent}→${x.to_agent ?? "tous"} « ${x.resume_bulle} »`).join(" | "));
  const journal = await q<{ titre: string }>("select titre from public.journal order by cree_le");
  check(journal.some((j) => j.titre.startsWith("Plan de Marius")), "le plan est publié dans le Journal");
  check(journal.some((j) => j.titre.startsWith("Synthèse livrée")), "la synthèse est publiée dans le Journal");
  const runs = await q<{ iterations: number }>("select iterations from public.task_runs");
  check(runs.every((r) => r.iterations <= 12), "limite de 12 itérations respectée");
  const [marius] = await q<{ etat: string }>("select etat from public.agents where id = 'marius'");
  check(marius?.etat === "done", `Marius célèbre à la fin (état ${marius?.etat})`);
}

async function scenarioQuestionFondateur() {
  console.log("\n— Question aux fondateurs (Douane) puis reprise");
  await reset();
  const [t] = await q<{ id: string }>("insert into public.tasks (agent_id, titre, statut) values ('marius', 'Choisir la promo NFC', 'waiting_founder') returning id");
  const [a] = await q<{ id: string }>("insert into public.approvals (agent_id, task_id, type_action, titre, apercu) values ('marius', $1, 'question', 'Marius a une question', '-20 % ou installation offerte ?') returning id", [t!.id]);
  await db.saveRun(t!.id, {
    messages: [
      { role: "user", content: "<tache>Choisir la promo NFC</tache>" },
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_q1", name: "ask_founder", input: { question: "-20 % ou installation offerte ?" } }] },
    ],
    iterations: 1,
    attente: [{ tool_use_id: "toolu_q1", kind: "approval", id: a!.id }],
    resultats_en_suspens: [],
  });
  let r = await tick(db, llm);
  const [t1] = await q<{ statut: string }>("select statut from public.tasks where id = $1", [t!.id]);
  check(t1?.statut === "waiting_founder" && r.reprises === 0, "la tâche attend tant que la Douane n'a pas répondu");
  await q("update public.approvals set statut = 'modifie', apercu = 'Installation offerte, pas de remise.', decide_par = 'jeremyvatuonepro@gmail.com' where id = $1", [a!.id]);
  r = await tick(db, llm);
  const [run] = await q<{ messages: { role: string; content: unknown }[] }>("select messages from public.task_runs where task_id = $1", [t!.id]);
  const resultMsg = JSON.stringify(run?.messages[2] ?? "");
  check(r.reprises === 1 && resultMsg.includes("Installation offerte"), "la réponse des fondateurs revient à Marius dans le tool_result");
  const [t2] = await q<{ statut: string }>("select statut from public.tasks where id = $1", [t!.id]);
  check(t2?.statut === "done", `puis Marius termine (statut ${t2?.statut})`);
}

async function scenarioBudget() {
  console.log("\n— Budget épuisé");
  await reset();
  await q("insert into public.usage (agent_id, modele, cout_estime) values ('marius', 'claude-opus-5-5', 5)");
  await q("insert into public.tasks (agent_id, titre) values ('zoe', 'Charte non critique'), ('diane', 'Récap (agent critique)')");
  const r = await tick(db, llm);
  const ag = await q<{ id: string; etat: string; offline_raison: string | null }>("select id, etat, offline_raison from public.agents where id in ('zoe','diane','lucie')");
  check(r.budget.depasse, `budget du jour dépassé détecté (${r.budget.depense} € / ${r.budget.jour} €)`);
  check(ag.find((x) => x.id === "zoe")?.offline_raison === "budget", "Zoé (non critique) passe hors ligne");
  const ts = await q<{ agent_id: string; statut: string }>("select agent_id, statut from public.tasks");
  check(ts.find((x) => x.agent_id === "diane")?.statut === "done", "Diane (critique) continue et termine sa tâche");
  check(ts.find((x) => x.agent_id === "zoe")?.statut === "queued", "la tâche de Zoé est reportée");
  const al = await q("select 1 from public.journal where titre like 'Budget IA épuisé%'");
  check(al.length === 1, "alerte budget dans le Journal (une seule fois)");
  await q("delete from public.usage");
  await tick(db, llm);
  const [z] = await q<{ etat: string }>("select etat from public.agents where id = 'zoe'");
  check(z?.etat !== "offline", "le lendemain (budget remis à zéro), Zoé revient");
}

async function scenarioConcurrence() {
  console.log("\n— Deux ticks en même temps");
  await reset();
  await q("insert into public.tasks (agent_id, titre) select id, 'Tâche simple ' || id from public.agents where id in ('chloe','lina','rose','gabin','oscar','axel')");
  const [r1, r2] = await Promise.all([tick(db, llm), tick(db, llm)]);
  const total = r1.pas.done + r2.pas.done;
  const runs = await q<{ iterations: number }>("select iterations from public.task_runs");
  check(total === 6 && runs.length === 6 && runs.every((r) => r.iterations === 1), `6 tâches, chacune exécutée une seule fois (${total} pas, itérations ${runs.map((r) => r.iterations).join(",")})`);
}

(async () => {
  try {
    await scenarioMission();
    await scenarioQuestionFondateur();
    await scenarioBudget();
    await scenarioConcurrence();
  } catch (e) {
    console.error(e);
    failures++;
  } finally {
    await pool.end();
  }
  console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert.");
  process.exit(failures ? 1 : 0);
})();
