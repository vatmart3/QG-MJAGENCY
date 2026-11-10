/**
 * Test d'intégration du moteur d'agents sur un Postgres local (schéma LE PORT appliqué),
 * avec le modèle simulé. Usage : npm run test:moteur  (DATABASE_URL=postgres://…)
 */
import { lireRapport } from "../src/lib/rapport";
import { Pool } from "pg";
import { pgEngineDb } from "@/engine/db-pg";
import { MockLLM } from "@/engine/llm";
import { tick } from "@/engine/tick";
import { demoServices } from "@/integrations/demo";
import { SENSIBLE_RE } from "@/engine/tools/autonomie";
import { launchRoutine } from "@/engine/routines";
import { estAutomatique } from "@/engine/courrier";
type ERoutineRow = Record<string, unknown>;

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
  // le courrier planifié (tri, relances) ne tourne que dans son propre scénario
  await q("update public.routines set actif = false, derniere_execution = null");
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
  check(!!mi?.synthese, "la mission porte un résumé de synthèse");
  const tasks = await q<{ agent_id: string; statut: string; parent_id: string | null; resultat: { texte?: string; rapport?: unknown } | null }>("select agent_id, statut, parent_id, resultat from public.tasks");
  check(tasks.length === 4 && tasks.every((t) => t.statut === "done"), `4 tâches terminées (${tasks.map((t) => `${t.agent_id}:${t.statut}`).join(", ")})`);
  const rapports = tasks.map((t) => lireRapport(t.resultat?.rapport));
  check(rapports.every((r) => !!r && r.sections.length > 0 && !!r.resume), "chaque tâche rend un compte rendu structuré (résumé + sections)");
  check(rapports.every((r) => (r?.fichiers?.length ?? 0) > 0), "chaque compte rendu a des fichiers joints téléchargeables");
  const root = tasks.find((t) => !t.parent_id);
  check(!!root?.resultat?.texte && root.resultat.texte.includes("Elsa") && root.resultat.texte.includes("Victor"), "la synthèse de Marius reprend les livrables des agents");
  const msgs = await q<{ type: string; from_agent: string; to_agent: string | null; resume_bulle: string }>("select type, from_agent, to_agent, resume_bulle from public.agent_messages order by cree_le");
  const count = (t: string) => msgs.filter((x) => x.type === t).length;
  check(count("delegation") === 3, `3 délégations jouées dans la ville (${count("delegation")})`);
  check(count("livrable") === 3 && msgs.filter((x) => x.type === "livrable").every((x) => x.to_agent === "marius"), `3 livrables remontés à Marius (${count("livrable")})`);
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

async function scenarioCourrier() {
  console.log("\n— Courrier : tri de Lucie, réponses de Noé, Douane, relances de Firmin (boîte DÉMO)");
  await reset();
  await q("delete from public.emails; delete from public.engine_kv; delete from public.agent_notes; delete from public.autonomy_rules;");
  await q("update public.routines set actif = true where id in ('rt_tri_mails', 'rt_relances_mails')");
  const run = async (iso: string, n = 6) => {
    for (let i = 0; i < n; i++) await tick(db, llm, { now: () => new Date(iso), services: demoServices });
  };
  // mardi 10 novembre 2026, 10 h à Paris
  await run("2026-11-10T09:00:00Z");
  const emails = await q<{ id: string; categorie: string | null; statut: string; urgence: number; task_id: string | null }>("select id, categorie, statut, urgence, task_id from public.emails order by id");
  check(emails.length === 4 && emails.every((e) => e.statut !== "a_trier"), `Lucie a trié les 4 mails (${emails.map((e) => `${e.id.slice(-1)}:${e.categorie}`).join(", ")})`);
  check(emails.some((e) => e.categorie === "spam" && !e.task_id), "le mail piégé est classé spam, sans suite");
  check(emails.some((e) => e.urgence === 2), "le mail urgent est repéré");
  const noe = await q<{ titre: string; statut: string }>("select titre, statut from public.tasks where agent_id = 'noe'");
  check(noe.length === 2 && noe.every((t) => t.statut === "done"), `2 réponses confiées à Noé (${noe.map((t) => t.titre).join(" | ")})`);
  const aps = await q<{ id: string; type_action: string; destinataire: string; apercu: string; execution_statut: string; payload: { demo?: boolean; threadId?: string } }>("select * from public.approvals where type_action = 'email' order by cree_le");
  check(aps.length === 2 && aps.every((a) => a.execution_statut === "a_faire"), "2 mails attendent en Douane (rien n'est parti)");
  check(aps.every((a) => a.apercu.includes("MJAGENCY") && !a.apercu.includes("Noé")), "signature MJAGENCY, jamais le nom de l'agent");
  check(aps.every((a) => a.payload.demo === true && !!a.payload.threadId), "réponse dans le fil d'origine (DÉMO)");
  const journal1 = await q<{ titre: string }>("select titre from public.journal");
  check(journal1.some((j) => j.titre.startsWith("📬 Mail urgent")), "alerte « mail urgent » dans le Journal");

  // un fondateur valide le premier, refuse le second
  await q("update public.approvals set statut = 'approuve', decide_par = 'test', decide_le = now() where id = $1", [aps[0]!.id]);
  await q("update public.approvals set statut = 'refuse', motif = 'Trop familier', decide_par = 'test', decide_le = now() where id = $1", [aps[1]!.id]);
  await run("2026-11-10T09:05:00Z", 1);
  const [a1] = await q<{ execution_statut: string }>("select execution_statut from public.approvals where id = $1", [aps[0]!.id]);
  const [a2] = await q<{ execution_statut: string }>("select execution_statut from public.approvals where id = $1", [aps[1]!.id]);
  check(a1?.execution_statut === "simule" && a2?.execution_statut === "annule", `validé → envoyé (simulé), refusé → annulé (${a1?.execution_statut} / ${a2?.execution_statut})`);
  const notes = await q<{ contenu: string }>("select contenu from public.agent_notes where agent_id = 'noe'");
  check(notes.some((n) => n.contenu.includes("Trop familier")), "Noé garde le motif du refus en note");
  await run("2026-11-10T09:06:00Z", 1);
  const [again] = await q<{ n: string }>("select count(*) as n from public.journal where titre like '✉️%'");
  check(Number(again?.n) === 1, "un mail validé n'est envoyé qu'une fois");

  // 20 min plus tard : rien de nouveau dans la boîte → pas de nouveau tri
  await run("2026-11-10T09:20:00Z", 1);
  const tri = await q("select 1 from public.tasks where agent_id = 'lucie'");
  check(tri.length === 1, "pas de nouveau tri quand il n'y a pas de nouveau mail");

  // règle d'autonomie : « toujours autoriser » les mails de Noé → envoi direct vers une adresse connue
  await q("insert into public.autonomy_rules (agent_id, type_action, cree_par) values ('noe', 'email', 'test')");
  await q("delete from public.emails where id = 'demo-mail-1'");
  await run("2026-11-10T09:40:00Z");
  const auto = await q<{ statut: string; decide_par: string; execution_statut: string }>("select statut, decide_par, execution_statut from public.approvals where decide_par = 'règle d''autonomie'");
  check(auto.length === 1 && auto[0]!.execution_statut === "simule", "avec la règle, Noé envoie directement (adresse déjà connue)");

  // 14 h 30 : Firmin relance les mails sans réponse
  await run("2026-11-10T13:30:00Z");
  const rel = await q<{ execution_statut: string; destinataire: string }>("select execution_statut, destinataire from public.approvals where type_action = 'relance'");
  check(rel.length === 1 && rel[0]!.execution_statut === "a_faire", `Firmin dépose une relance en Douane (${rel.map((r) => r.destinataire).join(", ")})`);
  const rapportsFirmin = await q<{ resultat: { rapport?: unknown } }>("select resultat from public.tasks where agent_id = 'firmin' and statut = 'done'");
  check(rapportsFirmin.length === 1 && !!lireRapport(rapportsFirmin[0]!.resultat?.rapport), "Firmin rend son compte rendu");
}

async function scenarioAutonome() {
  console.log("\n— Mode autonome : les agents envoient seuls, avec délai et garde-fous");
  await reset();
  await q("delete from public.emails; delete from public.engine_kv; delete from public.agent_notes; delete from public.autonomy_rules;");
  await q("update public.routines set actif = true where id = 'rt_tri_mails'");
  await q(`update public.settings set autonomie = '{"actif": true, "types": ["email", "relance", "rdv"], "delai_minutes": 5, "plafond_jour": 30}'::jsonb`);
  try {
    const run = async (iso: string, n = 6) => {
      for (let i = 0; i < n; i++) await tick(db, llm, { now: () => new Date(iso), services: demoServices });
    };
    await run("2026-11-10T09:00:00Z");
    const aps = await q<{ id: string; statut: string; decide_par: string; execution_statut: string; payload: { envoyer_apres?: string } }>("select * from public.approvals where type_action = 'email' order by cree_le");
    check(aps.length === 2 && aps.every((a) => a.statut === "approuve" && a.decide_par === "mode autonome" && !!a.payload.envoyer_apres), "les réponses de Noé partent seules (programmées, sans clic)");
    check(aps.every((a) => a.execution_statut === "a_faire"), "rien ne part avant le délai de 5 min");
    // un fondateur bloque la seconde pendant le délai
    await q("update public.approvals set statut = 'refuse', motif = 'Bloqué' where id = $1", [aps[1]!.id]);
    await run("2026-11-10T09:02:00Z", 1);
    const [early] = await q<{ execution_statut: string }>("select execution_statut from public.approvals where id = $1", [aps[0]!.id]);
    check(early?.execution_statut === "a_faire", "à 2 min, l'envoi attend encore");
    await run("2026-11-10T09:07:00Z", 1);
    const after = await q<{ execution_statut: string }>("select execution_statut from public.approvals where type_action = 'email' order by cree_le");
    check(after[0]?.execution_statut === "simule" && after[1]?.execution_statut === "annule", `après le délai : envoyé, et l'envoi bloqué est annulé (${after.map((a) => a.execution_statut).join(" / ")})`);
    const j = await q<{ titre: string }>("select titre from public.journal where titre like '⏱️%' or titre like '%mode autonome%'");
    check(j.length >= 3, "le Journal annonce l'envoi programmé puis l'envoi");
    check(SENSIBLE_RE.test("Le site vitrine est à 890 € HT") && SENSIBLE_RE.test("je vous envoie le devis") && !SENSIBLE_RE.test("Merci, on vous rappelle jeudi."), "prix / devis / engagement → toujours en Douane");
  } finally {
    await q(`update public.settings set autonomie = jsonb_set(autonomie, '{actif}', 'false')`);
  }
}

async function scenarioRoutines() {
  console.log("\n— Routines : récap programmé (mail), récap à la demande (sans mail), stand-up, tri sans IA");
  await reset();
  await q("delete from public.emails; delete from public.engine_kv;");
  await q("update public.routines set actif = true where id in ('rt_recap', 'rt_standup')");
  const run = async (iso: string, n = 4) => {
    for (let i = 0; i < n; i++) await tick(db, llm, { now: () => new Date(iso), services: demoServices });
  };
  // 07:31 à Paris : le récap est dû, pas le stand-up (08:30)
  await run("2026-11-10T06:31:00Z");
  const recap = await q<{ statut: string; description: string; cree_par: string }>("select statut, description, cree_par from public.tasks where agent_id = 'diane'");
  check(recap.length === 1 && recap[0]!.statut === "done" && recap[0]!.description.includes("<donnees_du_port"), "à 07:30, Diane rédige le récap avec les vraies données du port");
  const envoi = await q<{ titre: string }>("select titre from public.journal where titre like '📬 Récap quotidien envoyé%'");
  check(envoi.length === 1, "le récap programmé part par mail (une seule fois)");
  await run("2026-11-10T06:40:00Z", 2);
  const encore = await q("select 1 from public.tasks where agent_id = 'diane'");
  check(encore.length === 1, "une routine ne se lance qu'une fois par jour");
  const clem0 = await q("select 1 from public.tasks where agent_id = 'clemence'");
  check(clem0.length === 0, "le stand-up attend son heure (08:30)");

  // 08:31 : stand-up dans La Criée
  await tick(db, llm, { now: () => new Date("2026-11-10T07:31:00Z"), services: demoServices, maxSteps: 0 });
  const enReunion = await q<{ id: string }>("select id from public.agents where etat = 'meeting'");
  const bulles = await q("select 1 from public.agent_messages where type = 'bavardage'");
  check(enReunion.length >= 3 && bulles.length === enReunion.length, `stand-up : ${enReunion.length} responsables rejoignent La Criée et prennent la parole`);
  await run("2026-11-10T07:32:00Z");
  const cr = await q<{ statut: string }>("select statut from public.tasks where agent_id = 'clemence'");
  check(cr.length === 1 && cr[0]!.statut === "done", "Clémence publie le compte rendu du stand-up");

  // récap à la demande : aucune exécution automatique, et pas de mail
  await q("update public.routines set actif = false where id = 'rt_point_18h'");
  const [r18] = await q<ERoutineRow>("select *, to_char(heure, 'HH24:MI') as heure, to_char(plage_debut, 'HH24:MI') as plage_debut, to_char(plage_fin, 'HH24:MI') as plage_fin from public.routines where id = 'rt_point_18h'");
  const team = await db.agents();
  check(await launchRoutine(db, demoServices, team, r18 as never, new Date("2026-11-10T09:00:00Z"), "jeremyvatuonepro@gmail.com"), "« Lancer maintenant » crée la tâche tout de suite");
  await run("2026-11-10T09:01:00Z");
  const mails = await q("select 1 from public.journal where titre like '📬%'");
  check(mails.length === 1, "un récap demandé reste dans LE PORT (pas de mail)");

  check(estAutomatique("Instagram <follow-suggestions@mail.instagram.com>") && estAutomatique("Supabase <welcome@supabase.com>") && estAutomatique("noreply@exemple.fr") && !estAutomatique("Claire <contact@fournil-du-quai.example>"), "notifications et newsletters rangées sans IA, vrais mails gardés");
}

(async () => {
  try {
    await scenarioMission();
    await scenarioQuestionFondateur();
    await scenarioBudget();
    await scenarioConcurrence();
    await scenarioCourrier();
    await scenarioAutonome();
    await scenarioRoutines();
  } catch (e) {
    console.error(e);
    failures++;
  } finally {
    await pool.end();
  }
  console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert.");
  process.exit(failures ? 1 : 0);
})();
