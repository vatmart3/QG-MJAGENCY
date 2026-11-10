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
import { resumeFinance } from "@/finance/calc";
import { relancesDevis, trouverProspects, urlPublique } from "@/commercial/prospection";
import { tacheSacha } from "@/commercial/taches";
import { demoPlaces } from "@/integrations/places";
import { sha256Hex } from "@/finance/pdf";
import { surveillerSites } from "@/tech/surveillance";
import { analyser, auditUrl } from "@/tech/audit";
import { demoBoutique } from "@/boutique/shopify";
import { surveillerBoutique } from "@/boutique/surveillance";
import { executeApprovals } from "@/engine/douane";
import { kpis, kpisTexte } from "@/engine/kpis";
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
    check(SENSIBLE_RE.test("Le site vitrine est à 890 € HT") && SENSIBLE_RE.test("voici le contrat à signer") && !SENSIBLE_RE.test("Nous préparons votre devis, vous l'aurez sous 48 h.") && !SENSIBLE_RE.test("Merci, on vous rappelle jeudi."), "prix chiffré / contrat → Douane ; « nous préparons votre devis » part seul");
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

  // 08:31 : stand-up dans La Criée (la nuit a pu renvoyer des agents chez eux : ils reviennent d'abord)
  await run("2026-11-10T07:05:00Z", 6);
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

async function scenarioFinance() {
  console.log("\n— Finance : facture de Bastien, Douane, paiements, abonnements, relances, avoir, fiscal");
  await reset();
  await pool.query("set session_replication_role = replica; delete from public.payments; delete from public.invoices where avoir_de is not null; delete from public.invoices; delete from public.subscriptions; delete from public.quotes; delete from public.clients; delete from public.engine_kv; set session_replication_role = origin;");
  const run = async (iso: string, n = 6) => {
    for (let i = 0; i < n; i++) await tick(db, llm, { now: () => new Date(iso), services: demoServices });
  };
  const f = db.finance;

  // 1. Bastien : brouillon → émission (numéro + PDF archivé) → Douane
  await q("insert into public.tasks (agent_id, cree_par, titre, description, statut) values ('bastien', 'jeremy', 'Facture du pack NFC pour La Marée', 'Prépare la facture et envoie-la.', 'queued')");
  await run("2026-11-10T10:00:00Z");
  const [fac] = await q<{ id: string; numero: string; statut: string; total: string; pdf_path: string; pdf_sha256: string }>("select * from public.invoices where type = 'facture' order by cree_le limit 1");
  check(!!fac && /^F-\d{4}-\d{4}$/.test(fac.numero) && Number(fac.total) === 436, `Bastien émet la facture ${fac?.numero} (${fac?.total} €)`);
  const pdf = fac?.pdf_path ? await demoServices.documents.lire(fac.pdf_path) : null;
  check(!!pdf && new TextDecoder().decode(pdf.slice(0, 5)) === "%PDF-" && fac!.pdf_sha256 === (await sha256Hex(pdf)), "PDF archivé, empreinte SHA-256 conforme");
  const [ap] = await q<{ id: string; type_action: string; execution_statut: string; payload: { kind: string } }>("select * from public.approvals where type_action = 'facture'");
  check(ap?.payload.kind === "document" && ap.execution_statut === "a_faire", "l'envoi de la facture attend en Douane (jamais automatique)");
  await q("update public.approvals set statut = 'approuve', decide_par = 'test', decide_le = now() where id = $1", [ap!.id]);
  await run("2026-11-10T10:05:00Z", 1);
  const [apres] = await q<{ statut: string }>("select statut from public.invoices where id = $1", [fac!.id]);
  const [ex] = await q<{ execution_statut: string }>("select execution_statut from public.approvals where id = $1", [ap!.id]);
  check(ex?.execution_statut === "simule" && apres?.statut === "envoyee", "validée en Douane : envoyée avec le PDF joint (simulé), facture « envoyée »");

  // 2. verrou légal
  let verrou = false;
  try {
    await q("update public.invoices set lignes = '[]' where id = $1", [fac!.id]);
  } catch {
    verrou = true;
  }
  check(verrou, "une facture émise ne se modifie plus");

  // 3. paiements → payée → livre des recettes
  await f.insertPayment({ invoice_id: fac!.id, montant: 200, date: "2026-11-12", moyen: "virement" });
  const [part] = await q<{ statut: string }>("select statut from public.invoices where id = $1", [fac!.id]);
  await f.insertPayment({ invoice_id: fac!.id, montant: 236, date: "2026-11-15", moyen: "carte" });
  const [paid] = await q<{ statut: string; paye_le: Date }>("select statut, paye_le from public.invoices where id = $1", [fac!.id]);
  const livre = await q("select * from public.livre_recettes");
  check(part?.statut === "envoyee" && paid?.statut === "payee" && livre.length === 2, "paiement partiel puis total : facture payée, 2 lignes au livre des recettes");

  // 4. abonnement facturé le 1er du mois → Douane → émis à la validation
  await q("update public.routines set actif = true where id in ('rt_abonnements', 'rt_echues', 'rt_fiscal', 'rt_cloture')");
  const cl = await f.insertClient({ nom: "Boulangerie Abonnée (test)", email: "abo@example.fr", type: "pro" });
  await q("insert into public.subscriptions (client_id, libelle, lignes, debut) values ($1, 'Maintenance du site', '[{\"designation\":\"Maintenance mensuelle\",\"quantite\":1,\"prix_unitaire\":49}]', '2026-01-01')", [cl.id]);
  await run("2026-12-01T07:30:00Z", 1);
  await run("2026-12-01T07:31:00Z", 1);
  const abo = await q<{ id: string; statut: string; total: string }>("select * from public.invoices where abonnement_id is not null");
  const [apAbo] = await q<{ id: string }>("select id from public.approvals where titre like 'Facture d''abonnement%'");
  check(abo.length === 1 && abo[0]!.statut === "brouillon" && Number(abo[0]!.total) === 49 && !!apAbo, "1er du mois : facture d'abonnement préparée (brouillon), envoi en Douane, une seule fois");
  await q("update public.approvals set statut = 'approuve', decide_le = now() where id = $1", [apAbo!.id]);
  await run("2026-12-01T07:35:00Z", 1);
  const [aboEmis] = await q<{ numero: string; statut: string }>("select numero, statut from public.invoices where id = $1", [abo[0]!.id]);
  check(!!aboEmis?.numero && aboEmis.statut === "envoyee", `validée : émise ${aboEmis?.numero} et envoyée`);

  // 5. relances graduées (sans IA)
  const brouillon = await f.insertInvoice({ client_id: cl.id, objet: "Logo", lignes: [{ designation: "Logo", quantite: 1, prix_unitaire: 300 }], delai_jours: 0 });
  await f.emettre("facture", brouillon.id);
  const usage0 = await q<{ n: string }>("select count(*) as n from public.usage");
  // le test remonte le temps : on oublie la dernière exécution de la routine
  await q("update public.routines set derniere_execution = null where id = 'rt_echues'");
  await run("2026-11-22T06:20:00Z", 1);
  await run("2026-11-22T06:25:00Z", 1);
  const r1 = await q<{ titre: string; payload: { relance: number } }>("select titre, payload from public.approvals where type_action = 'relance' order by cree_le");
  await run("2026-12-11T06:20:00Z", 1);
  const r2 = await q<{ payload: { relance: number; jamais_auto: boolean } }>("select payload from public.approvals where type_action = 'relance' order by cree_le");
  const usage1 = await q<{ n: string }>("select count(*) as n from public.usage");
  check(r1.length === 1 && r1[0]!.payload.relance === 2 && r2.length === 2 && r2[1]!.payload.relance === 3 && r2[1]!.payload.jamais_auto, "relances : ferme à J+12, mise en demeure à J+31 (jamais automatique), une seule par niveau");
  check(usage0[0]!.n === usage1[0]!.n, "relances, abonnements et alertes : zéro appel à l'IA");

  // 6. avoir
  await f.avoir(brouillon.id, "Erreur de prestation");
  const [annule] = await q<{ statut: string }>("select statut from public.invoices where id = $1", [brouillon.id]);
  const [av] = await q<{ numero: string; total: string }>("select numero, total from public.invoices where type = 'avoir'");
  check(annule?.statut === "annulee" && /^A-/.test(av?.numero ?? "") && Number(av?.total) === -300, `avoir ${av?.numero} : la facture est annulée`);

  // 7. tableau de bord, clôture, fiscal
  const inv = await f.invoicesSince("2025-11-01");
  const pays = await f.payments("2025-11-01");
  const r = resumeFinance({ invoices: inv, payments: pays, subscriptions: await f.subscriptions(), settings: await f.settings(), mois: "2026-11", aujourdhui: "2026-11-30" });
  check(r.encaisseMois === 436 && r.cotisationsMois === Math.round(436 * 0.246 * 100) / 100, `tableau de bord : ${r.encaisseMois} € encaissés en novembre, cotisations estimées ${r.cotisationsMois} €`);
  await run("2026-12-01T08:05:00Z", 1);
  const clo = await q<{ titre: string }>("select titre from public.journal where titre like '📊 Clôture%'");
  check(clo.length === 1 && clo[0]!.titre.includes("436"), "clôture du mois publiée au Journal (chiffres réels)");
  await q("update public.routines set derniere_execution = null where id = 'rt_fiscal'");
  await run("2026-11-25T07:10:00Z", 1);
  await run("2026-11-25T07:20:00Z", 1);
  const fisc = await q("select 1 from public.journal where titre like '🗓️%'");
  check(fisc.length >= 1, "Agathe prévient de l'échéance URSSAF à 7 jours (une seule fois)");
}

async function scenarioNuit() {
  console.log("\n— La nuit : les agents rentrent chez eux, Lucie et Jade restent de garde");
  await reset();
  await q("update public.routines set actif = true where id = 'rt_nuit'");
  const run = async (iso: string, n: number) => {
    for (let i = 0; i < n; i++) await tick(db, llm, { now: () => new Date(iso), services: demoServices, maxSteps: 0 });
  };
  await run("2026-11-10T20:30:00Z", 8);
  const off = await q<{ id: string }>("select id from public.agents where actif and etat = 'offline' and offline_raison = 'nuit'");
  const garde = await q<{ id: string; etat: string }>("select id, etat from public.agents where id in ('lucie', 'jade')");
  const actifs = await q<{ n: string }>("select count(*) as n from public.agents where actif");
  check(off.length === Number(actifs[0]!.n) - 2 && garde.every((g) => g.etat !== "offline"), `21 h 30 : ${off.length} agents rentrés, Lucie et Jade de garde`);
  await q("insert into public.tasks (agent_id, cree_par, titre, statut) values ('bastien', 'test', 'Tâche de nuit', 'queued')");
  await tick(db, llm, { now: () => new Date("2026-11-10T21:00:00Z"), services: demoServices });
  const [b] = await q<{ etat: string; offline_raison: string | null }>("select etat, offline_raison from public.agents where id = 'bastien'");
  check(b?.offline_raison === null, "une tâche la nuit réveille l'agent concerné");
  await run("2026-11-11T07:30:00Z", 8);
  const reste = await q("select 1 from public.agents where etat = 'offline' and offline_raison = 'nuit'");
  check(reste.length === 0, "8 h 30 : tout le monde est revenu");
}

async function scenarioCommercial() {
  console.log("\n— Commercial : prospects (sans IA), messages de Sacha, pipeline lié au devis, relances de Margaux");
  await reset();
  await pool.query("set session_replication_role = replica; delete from public.opportunities; delete from public.leads; delete from public.engine_kv; set session_replication_role = origin;");
  const usage0 = Number((await q<{ n: string }>("select count(*) as n from public.usage"))[0]!.n);
  const cfg = await db.commercial.prospection();
  const r1 = await trouverProspects(db, demoPlaces(), cfg, 10);
  const leads = await q<{ id: string; nom: string; score: number; angle: string; site: string | null; email: string | null; diagnostic: string }>("select * from public.leads order by score desc");
  const r2 = await trouverProspects(db, demoPlaces(), cfg, 10);
  const usage1 = Number((await q<{ n: string }>("select count(*) as n from public.usage"))[0]!.n);
  check(r1.crees >= 4 && leads.length === r1.crees && r2.crees === 0, `Hugo trouve ${r1.crees} commerces (DÉMO), aucun doublon ensuite`);
  check(leads.every((l) => l.score > 0 && !!l.angle && !!l.diagnostic) && usage0 === usage1, "Inès note chaque prospect (score, angle, diagnostic) sans aucun appel à l'IA");
  const sansSite = leads.find((l) => !l.site);
  check(!!sansSite && sansSite.angle.startsWith("Site vitrine"), `sans site → angle « ${sansSite?.angle} »`);

  // Sacha : DM Instagram + mails (Douane) pour les 3 meilleurs
  const top = leads.slice(0, 3);
  await tacheSacha(db, top.map((l) => l.id), "jeremy");
  for (let i = 0; i < 4; i++) await tick(db, llm, { now: () => new Date("2026-11-10T10:00:00Z"), services: demoServices });
  const apres = await q<{ dm_instagram: string | null; statut: string; email: string | null }>("select dm_instagram, statut, email from public.leads where id = any($1)", [top.map((l) => l.id)]);
  const mails = await q<{ execution_statut: string; statut: string }>("select execution_statut, statut from public.approvals where type_action = 'email'");
  const avecEmail = apres.filter((l) => l.email).length;
  check(apres.every((l) => !!l.dm_instagram && l.statut === "a_contacter"), "Sacha prépare le DM Instagram de chaque prospect (à envoyer à la main)");
  check(mails.length === avecEmail && mails.every((m) => m.statut === "en_attente" && m.execution_statut === "a_faire"), `${mails.length} mails de prospection en Douane (adresses jamais vues : jamais automatiques)`);

  // pipeline lié au devis
  const cl = await db.finance.insertClient({ nom: "La Marée (test pipeline)", email: "bonjour@lamaree-sete.example", type: "pro" });
  const devis = await db.finance.insertQuote({ client_id: cl.id, objet: "Pack NFC", lignes: [{ designation: "Pack NFC", quantite: 1, prix_unitaire: 349 }] });
  await db.finance.emettre("devis", devis.id);
  const opp = await db.commercial.insertOpportunity({ titre: "La Marée — NFC", lead_id: top[0]!.id, etape: "rdv", quote_id: devis.id });
  await q("update public.quotes set statut = 'envoye' where id = $1", [devis.id]);
  const [e1] = await q<{ etape: string; montant: string }>("select etape, montant from public.opportunities where id = $1", [opp.id]);
  await q("update public.quotes set statut = 'accepte' where id = $1", [devis.id]);
  const [e2] = await q<{ etape: string }>("select etape from public.opportunities where id = $1", [opp.id]);
  check(e1?.etape === "devis" && Number(e1.montant) === 349 && e2?.etape === "signe", "le pipeline suit le devis : envoyé → « devis », accepté → « signé »");

  // Margaux : relances de devis sans réponse (J+7, J+15), sans IA
  const d2 = await db.finance.insertQuote({ client_id: cl.id, objet: "Site vitrine", lignes: [{ designation: "Site", quantite: 1, prix_unitaire: 1290 }] });
  await db.finance.emettre("devis", d2.id);
  const base = (await q<{ emis_le: Date }>("select emis_le from public.quotes where id = $1", [d2.id]))[0]!.emis_le;
  const plus = (j: number) => new Date(base.getTime() + j * 86400_000 + 12 * 3600_000).toISOString().slice(0, 10);
  const a = await relancesDevis(db, plus(8));
  const b = await relancesDevis(db, plus(9));
  const c = await relancesDevis(db, plus(16));
  const rel = await q<{ payload: { kind: string; doc: string } }>("select payload from public.approvals where type_action = 'relance'");
  check(a === 1 && b === 0 && c === 1 && rel.every((r) => r.payload.kind === "document" && r.payload.doc === "devis"), "Margaux relance le devis à J+8 puis J+16 (PDF joint, en Douane), une fois par niveau");

  check(!urlPublique("http://localhost:3000") && !urlPublique("http://10.0.0.1/admin") && !urlPublique("file:///etc/passwd") && !!urlPublique("https://mjagency.eu"), "lecture de sites : adresses internes refusées");
}

async function scenarioAtelierBoutique() {
  console.log("\n— Atelier Tech (santé des sites, audit) et Boutique (Shopify DÉMO), sans IA");
  await reset();
  await pool.query("delete from public.sites_monitored; delete from public.engine_kv;");
  const usage0 = Number((await q<{ n: string }>("select count(*) as n from public.usage"))[0]!.n);
  for (const [nom, url] of [["Boulangerie du Port", "https://boulangerie.example/"], ["Site en panne", "https://panne.example/"], ["Certificat bientôt expiré", "https://sslfin.example/"]]) await db.tech.insertSite({ nom: nom!, url: url! });
  const t0 = new Date("2026-11-10T09:00:00Z");
  const p1 = await surveillerSites(db, t0);
  let alertes = await q<{ titre: string }>("select titre from public.journal where type = 'alerte' order by cree_le");
  check(p1.controles === 3 && alertes.length === 1 && alertes[0]!.titre.includes("Certificat SSL : expire dans"), `1er passage : 3 sites contrôlés, alerte SSL (${alertes.map((a) => a.titre).join(" | ")})`);
  const p2 = await surveillerSites(db, new Date(t0.getTime() + 3600_000));
  alertes = await q<{ titre: string }>("select titre from public.journal where type = 'alerte' order by cree_le");
  check(p2.alertes === 1 && alertes.length === 2 && alertes[1]!.titre.includes("Site en panne"), "la panne n'est signalée qu'au 2e contrôle raté, l'alerte SSL n'est pas répétée");
  await surveillerSites(db, new Date(t0.getTime() + 2 * 3600_000));
  check((await q("select 1 from public.journal where type = 'alerte'")).length === 2, "pas de nouvelle alerte tant que rien ne change");
  const [panne] = await q<{ ok: boolean; echecs: number; historique: unknown[]; alerte: string }>("select ok, echecs, historique, alerte from public.sites_monitored where url like 'https://panne%'");
  check(panne?.ok === false && panne.echecs === 3 && panne.historique.length === 3 && !!panne.alerte, "historique et compteur d'échecs tenus à jour");
  // retour à la normale
  await pool.query("update public.sites_monitored set url = 'https://repare.example/' where url like 'https://panne%'");
  await surveillerSites(db, new Date(t0.getTime() + 3 * 3600_000));
  check((await q("select 1 from public.journal where titre like '✅ Site en panne%'")).length === 1, "« tout est rentré dans l'ordre » publié quand le site revient");
  check(!!(await launchRoutine(db, demoServices, await db.agents(), (await db.routine("rt_sante_sites"))!, t0, "jeremy")), "routine rt_sante_sites lançable à la demande");

  const audit = await auditUrl("boulangerie.example");
  check(audit.demo === true && audit.note > 20 && audit.note < 80 && audit.points.some((p) => !p.ok && p.label.startsWith("Titre principal H1 (2)")), `audit (DÉMO) : ${audit.note}/100, H1 en double repéré`);
  const bon = analyser('<!doctype html><html lang="fr"><head><title>Fleuriste à Sète — Atelier Fleuri, bouquets sur mesure</title><meta name="description" content="Atelier Fleuri, fleuriste à Sète : bouquets du jour, mariages, deuil et livraison à domicile dans tout le bassin de Thau. Commandez en ligne."><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://x.fr/"><link rel="icon" href="/f.ico"><meta property="og:title" content="Atelier Fleuri"><meta property="og:image" content="/o.jpg"><script type="application/ld+json">{}</script></head><body><h1>Fleuriste à Sète</h1><img src="a.jpg" alt="Bouquet"></body></html>', { url: "https://x.fr/", https: true, ms: 400, robots: true, sitemap: true });
  check(bon.note === 100, `page soignée : ${bon.note}/100`);

  // boutique
  const b = demoBoutique(t0);
  const r1 = await surveillerBoutique(db, b, { seuil_stock: 3, delai_expedition_h: 48 }, t0);
  const jb = await q<{ titre: string }>("select titre from public.journal where agent_id = 'yanis' order by cree_le");
  check(r1.nouvelles === 0 && jb.some((j) => j.titre.startsWith("📦 #1046")) && jb.some((j) => j.titre.startsWith("⛔ Rupture de stock : Stickers")) && jb.some((j) => j.titre.startsWith("📉 Stock bas : Chevalet")), `Yanis : commande en retard, rupture et stock bas signalés (${jb.length})`);
  await surveillerBoutique(db, b, { seuil_stock: 3, delai_expedition_h: 48 }, new Date(t0.getTime() + 2 * 3600_000));
  check((await q("select 1 from public.journal where agent_id = 'yanis'")).length === jb.length, "aucune alerte répétée au passage suivant");

  // modification de la boutique : seulement via la Douane
  const [ap] = await q<{ id: string }>("insert into public.approvals (agent_id, type_action, titre, apercu, payload, statut, execution_statut, decide_par, decide_le) values ('yanis', 'autre', 'Stock', 'Stock 2 → 10', $1, 'approuve', 'a_faire', 'jeremy', now()) returning id", [JSON.stringify({ kind: "shopify", modif: { op: "stock", inventory_item_id: "demo-i2", quantite: 10, avant: 2, libelle: "Chevalet NFC" } })]);
  await executeApprovals(db, demoServices, t0);
  const [ex] = await q<{ execution_statut: string }>("select execution_statut from public.approvals where id = $1", [ap!.id]);
  check(ex?.execution_statut === "simule", "modification Shopify validée en Douane → appliquée (simulée en DÉMO)");

  const k = await kpis(db, demoServices, t0);
  check(k.tech.sites === 3 && k.boutique?.demo === true && k.boutique.commandes7j === 4 && typeof k.finance.encaisse === "number", `KPIs de Diane : ${kpisTexte(k).split("\n").length} lignes (sites, boutique, finance, IA)`);
  const rech = await llm.search("tarifs sites vitrines Sète");
  check(rech.sources.length > 0 && rech.texte.includes("simulée"), "recherche web de Gabin (simulée sans clé)");
  const usage1 = Number((await q<{ n: string }>("select count(*) as n from public.usage"))[0]!.n);
  check(usage0 === usage1, "surveillance, audit, boutique et KPIs : aucun appel à l'IA");
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
    await scenarioFinance();
    await scenarioNuit();
    await scenarioCommercial();
    await scenarioAtelierBoutique();
  } catch (e) {
    console.error(e);
    failures++;
  } finally {
    await pool.end();
  }
  console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert.");
  process.exit(failures ? 1 : 0);
})();
