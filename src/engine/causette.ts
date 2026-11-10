/**
 * Petite discussion GRATUITE avec un agent (aucun appel à l'IA) : salutations, nouvelles, remerciements,
 * blagues… Les réponses sont composées à partir de sa personnalité et de ce qu'il fait vraiment.
 * Pour une vraie question, le fondateur demande explicitement une réponse « ⚡ IA ».
 */

export interface CausetteCtx {
  nom: string;
  role: string;
  etat: string;
  tache?: string | null;
  derniere?: string | null;
  heure: number;
  fondateur: string;
}

const pick = <T,>(a: readonly T[], seed: number): T => a[Math.abs(seed) % a.length]!;
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s?!]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const BLAGUES = [
  "Pourquoi les mouettes de Sète volent au-dessus de la mer ? Parce que si elles volaient au-dessus de la baie, ce serait des baie-gulls. 🐦 …Bon, je retourne bosser.",
  "Tu sais ce qu'un site web dit à un autre site web ? « T'as un bon référencement, toi ! » 😄",
  "J'ai voulu faire une blague sur les cookies, mais il fallait d'abord accepter les conditions. 🍪",
  "Un client m'a demandé un site « simple mais qui fait tout ». Je lui ai proposé un couteau suisse en HTML. 🔧",
  "Pourquoi les tielles sétoises ne font jamais de bug ? Parce qu'elles sont bien encapsulées. 🥧",
];

export function reponseGratuite(message: string, c: CausetteCtx): string | null {
  const m = norm(message);
  if (!m) return null;
  const seed = [...m].reduce((s, ch) => s + ch.charCodeAt(0), 0) + new Date().getMinutes();
  const bonjour = c.heure >= 18 || c.heure < 5 ? "Bonsoir" : "Salut";
  const prenom = c.fondateur;
  const occupe = c.tache ? `Là je suis sur « ${c.tache} ».` : c.etat === "offline" ? "Je suis rentré(e) pour la nuit, mais je t'entends !" : c.derniere ? `Je viens de finir « ${c.derniere} ».` : "Je suis dispo en ce moment.";
  const court = m.length <= 90;

  if (/^(salut|bonjour|bonsoir|coucou|hello|hey|yo|wesh|re|bjr|slt)\b/.test(m) && court && m.split(" ").length <= 8) {
    if (/ca va|comment (tu vas|vas tu|va)|la forme/.test(m)) return `${bonjour} ${prenom} ! ${pick(["Ça va très bien, merci !", "Toujours en forme au port ⚓", "Nickel, et toi ?"], seed)} ${occupe}`;
    return `${bonjour} ${prenom} ! ${pick(["Content de te voir passer 😊", "Toujours un plaisir !", "Bienvenue au port ⚓"], seed)} ${occupe}`;
  }
  if (/^(ca va|comment (tu vas|vas tu|ca va|va)|la forme|tu vas bien|bien ou quoi)/.test(m) && court) return `${pick(["Très bien, merci !", "Au top !", "Ça roule, le port tourne bien."], seed)} ${occupe} Et toi ?`;
  if (/(tu fais quoi|que fais tu|qu est ce que tu fais|t es sur quoi|tu bosses sur quoi|quoi de neuf|du nouveau|tu en es ou|t en es ou)/.test(m)) return `${occupe}${c.tache && c.derniere ? ` Avant ça : « ${c.derniere} ».` : ""} ${pick(["Si tu veux que je m'occupe d'autre chose, donne-moi une mission dans la barre du bas.", "Besoin d'un coup de main ? Envoie-moi une mission."], seed)}`;
  if (/(t es ou|tu es ou|ou es tu|ou t es)/.test(m)) return c.etat === "offline" ? "Je suis rentré(e) chez moi pour la nuit 🌙 Une mission me fera revenir au port." : c.etat === "meeting" ? "Dans La Criée, en réunion !" : c.etat === "working" ? "À mon bureau, concentré(e) 💻" : "Je traîne du côté du Quai, prêt(e) à repartir ☕";
  if (/^(merci|thanks|top|super|parfait|genial|bravo|bien joue|nickel|excellent|trop bien|gg|cool|impec)/.test(m) && court) return pick([`Avec plaisir ${prenom} !`, "Merci à toi 🙌", "C'est le métier ! 😄", "Ravi(e) que ça te plaise !"], seed);
  if (/^(bonne nuit|a demain|bonne soiree|ciao|bye|a plus|a\+|tchao|bonne journee|a toute)/.test(m)) return pick([`Bonne ${c.heure >= 17 ? "soirée" : "journée"} ${prenom} !`, "À plus ! Je garde un œil sur le port ⚓", "Ciao ! 👋"], seed);
  if (/(blague|fais moi rire|raconte|une histoire drole)/.test(m)) return pick(BLAGUES, seed);
  if (/(qui es tu|t es qui|tu es qui|presente toi|ton role|tu fais quoi dans la vie|c est quoi ton job|ton travail)/.test(m)) return `Je suis ${c.nom}, ${c.role.toLowerCase()} chez MJAGENCY. ${occupe}`;
  if (/^(ok|oki|d accord|dac|ca marche|entendu|parfait|oui|ouais|yes|non|nope|haha|ahah|mdr|lol|hihi|👍|😂|😄)\b/.test(m) && m.length <= 25) return pick(["👍", "Ça marche !", "Reçu !", "😄"], seed);
  if (/(tu es (fort|forte|genial|geniale|le meilleur|la meilleure)|je t aime|t es top)/.test(m)) return pick(["Arrête, je vais rougir 😳", "C'est l'équipe qui est top !", "Merci, ça motive 💪"], seed);
  return null;
}

/** Réponse gratuite quand le message demande une vraie réflexion (sans appeler l'IA). */
export function invitationIa(c: CausetteCtx): string {
  return `Pour te répondre vraiment là-dessus, j'ai besoin de réfléchir avec l'IA : appuie sur ⚡ (≈ 0,1 centime). Pour un vrai travail, donne-moi plutôt une mission dans la barre du bas. ${c.tache ? `(Là je suis sur « ${c.tache} ».)` : ""}`.trim();
}
