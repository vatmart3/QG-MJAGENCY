import type { ApprovalType } from "@/store/world";

/**
 * Contenu du mode DÉMO (Phase 1) : échanges entre agents, bavardage d'ambiance,
 * éléments en Douane. En Phase 3, tout ça vient du vrai moteur (agent_messages, approvals…).
 */

export interface ScriptedTalk {
  a: string;
  b: string;
  lines: [string, string][]; // [qui, texte]
  journal: string;
}

export const TALKS: ScriptedTalk[] = [
  {
    a: "lucie", b: "noe", journal: "Lucie confie à Noé la réponse à la boulangerie Marceau",
    lines: [["lucie", "Noé, mail de la boulangerie Marceau : ils veulent un devis vitrine."], ["noe", "Je prépare une réponse, ton chaleureux, vouvoiement."], ["lucie", "Top. Je tague Victor pour le devis."], ["noe", "Brouillon prêt d'ici 10 min, direction la Douane."]],
  },
  {
    a: "bastien", b: "heloise", journal: "Bastien signale le paiement Arvéo à Héloïse",
    lines: [["bastien", "Héloïse, t'as vu ? La facture Arvéo est payée !"], ["heloise", "Super, je mets à jour l'encaissé du mois."], ["bastien", "F-2026-0087, 890 €, virement reçu ce matin."], ["heloise", "On passe à 64 % de l'objectif. Ça avance !"]],
  },
  {
    a: "remi", b: "bastien", journal: "Rémi prépare une relance J+10 avec Bastien",
    lines: [["remi", "Bastien, la F-2026-0079 est échue depuis 10 jours."], ["bastien", "Studio Pilates Thau ? Ils avaient promis cette semaine."], ["remi", "Je prépare une relance ferme, mais polie."], ["bastien", "Ok, mets-la en Douane, Jérémy validera."]],
  },
  {
    a: "hugo", b: "ines", journal: "Hugo transmet 10 leads à Inès pour scoring",
    lines: [["hugo", "Inès, 10 restos sans site à Frontignan, je te les passe."], ["ines", "Je score. Il y en a avec de bons avis ?"], ["hugo", "Trois au-dessus de 4,6 étoiles, aucun site."], ["ines", "Parfait : angle « vos avis méritent une vitrine »."]],
  },
  {
    a: "ines", b: "sacha", journal: "Inès donne l'angle d'attaque à Sacha",
    lines: [["ines", "Sacha, Le Comptoir Thau : 4,8 étoiles, fiche sans photos."], ["sacha", "J'écris un mail court + un DM Insta à envoyer à la main."], ["ines", "Insiste sur le local, ils sont à 300 m de nous."], ["sacha", "Je mets le mail en Douane dans 5 min."]],
  },
  {
    a: "victor", b: "margaux", journal: "Victor et Margaux font le point sur les devis",
    lines: [["victor", "Margaux, devis D-2026-0042 prêt pour l'Atelier Mistral."], ["margaux", "Je le passe en « devis envoyé » dès validation."], ["victor", "1 450 €, site vitrine + 3 mois de maintenance."], ["margaux", "Relance auto prévue à J+5 si pas de réponse."]],
  },
  {
    a: "zoe", b: "leon", journal: "Zoé brief Léon sur la charte Huîtres Tarbouriech",
    lines: [["zoe", "Léon, charte validée : bleu étang, nacre, typo serif."], ["leon", "Je fais le prompt Claude Code avec un hero en 3D ?"], ["zoe", "Oui, mais rien de « template IA », on casse les codes."], ["leon", "Promis. Parallaxe sur les parcs à huîtres !"]],
  },
  {
    a: "mila", b: "zoe", journal: "Mila propose des accroches à Zoé",
    lines: [["mila", "Zoé, accroche : « Le goût de l'étang, livré chez vous »."], ["zoe", "J'aime. Un CTA moins générique que « Commander » ?"], ["mila", "« Réserver ma bourriche » ?"], ["zoe", "Validé, c'est local et concret."]],
  },
  {
    a: "jade", b: "axel", journal: "Jade alerte Axel sur un certificat SSL",
    lines: [["jade", "Axel, le SSL du Bistrot du Canal expire dans 6 jours."], ["axel", "Domaine chez OVH ? Je regarde le renouvellement."], ["jade", "Oui. Le reste des sites est au vert ce matin."], ["axel", "Je m'en occupe avant midi."]],
  },
  {
    a: "oscar", b: "axel", journal: "Oscar remonte l'audit du site Arvéo",
    lines: [["oscar", "Audit Arvéo : LCP à 3,1 s sur mobile."], ["axel", "Les images du hero ne sont pas en AVIF ?"], ["oscar", "Non, et il manque les données LocalBusiness."], ["axel", "Je crée deux tâches pour Léon."]],
  },
  {
    a: "chloe", b: "raphael", journal: "Chloé et Raphaël calent le prochain Reel",
    lines: [["chloe", "Raphaël, Reel avant/après du site Mareyeur jeudi ?"], ["raphael", "Hook : « Ce poissonnier a doublé ses appels »."], ["chloe", "Ça marche. Légende + 5 hashtags locaux de mon côté."], ["raphael", "Script prêt ce soir."]],
  },
  {
    a: "gabin", b: "rose", journal: "Gabin partage une veille concurrentielle avec Rose",
    lines: [["gabin", "Rose, une agence de Montpellier cible Sète en Google Ads."], ["rose", "Sur quels mots-clés ?"], ["gabin", "« création site internet Sète », surtout."], ["rose", "On renforce le SEO local de mjagency.eu, je m'y mets."]],
  },
  {
    a: "paul", b: "elsa", journal: "Paul et Elsa ciblent les clients pour les cartes NFC",
    lines: [["paul", "Elsa, 4 clients restau pourraient prendre les cartes NFC."], ["elsa", "Je te fais un argumentaire spécial restauration."], ["paul", "Avec l'avant/après des avis Google du Bistrot ?"], ["elsa", "Exactement, +23 avis en un mois."]],
  },
  {
    a: "jules", b: "nina", journal: "Jules passe le relais à Nina après livraison",
    lines: [["jules", "Nina, site de l'Atelier Mistral livré hier."], ["nina", "Je prépare la demande d'avis Google pour J+7."], ["jules", "Ils sont ravis, ça devrait bien passer."], ["nina", "Je mets un petit lien direct vers la fiche."]],
  },
  {
    a: "yanis", b: "iris", journal: "Yanis prévient Iris d'un retard de livraison",
    lines: [["yanis", "Iris, 2 commandes bloquées chez le transporteur."], ["iris", "Je préviens les clients avant qu'ils écrivent."], ["yanis", "#1038 et #1041, retard de 3 jours estimé."], ["iris", "Brouillons d'excuses en Douane d'ici 10 min."]],
  },
  {
    a: "celeste", b: "max", journal: "Céleste et Max calent la journée des fondateurs",
    lines: [["celeste", "Max, Matheis a cours jeudi après-midi, je bloque."], ["max", "Alors le RDV Garage passe vendredi 10 h ?"], ["celeste", "Oui, Jérémy est libre aussi."], ["max", "J'ajoute « préparer le RDV » à leur to-do."]],
  },
  {
    a: "diane", b: "clemence", journal: "Diane prépare le récap avec Clémence",
    lines: [["diane", "Clémence, 6 éléments attendent en Douane."], ["clemence", "Mets-les en tête du récap, avec les liens directs."], ["diane", "Météo du jour : « grand beau, pipeline chargé »."], ["clemence", "Parfait, j'adore."]],
  },
  {
    a: "marius", b: "clemence", journal: "Marius et Clémence arbitrent les priorités",
    lines: [["marius", "Clémence, on priorise les devis avant la prospection aujourd'hui."], ["clemence", "Ok. Victor a deux devis en cours."], ["marius", "Et dis à Hugo de viser Balaruc cette semaine."], ["clemence", "Je relaie au stand-up."]],
  },
  {
    a: "agathe", b: "heloise", journal: "Agathe vérifie le seuil de franchise de TVA",
    lines: [["agathe", "Héloïse, on est à 71 % du seuil de franchise de TVA."], ["heloise", "Au rythme actuel, on le passe quand ?"], ["agathe", "Pas avant septembre. Je surveille chaque mois."], ["heloise", "Je l'ajoute au prévisionnel."]],
  },
  {
    a: "capucine", b: "edouard", journal: "Capucine et Édouard mettent à jour les CGV",
    lines: [["capucine", "Édouard, nouvelles CGV pour les abonnements mensuels."], ["edouard", "Tu as intégré la résiliation à tout moment ?"], ["capucine", "Oui, préavis d'un mois, jamais abusif."], ["edouard", "Je mets à jour le registre RGPD en parallèle."]],
  },
  {
    a: "theo", b: "victor", journal: "Théo prépare le RDV Garage avec Victor",
    lines: [["theo", "Victor, objection probable au RDV Garage : le prix."], ["victor", "On propose la formule mixte : 490 € + 39 €/mois."], ["theo", "Et l'argument : 60 % de leurs clients cherchent sur mobile."], ["victor", "Je mets ça dans la proposition."]],
  },
  {
    a: "lou", b: "yanis", journal: "Lou propose un nouvel angle pub à Yanis",
    lines: [["lou", "Yanis, la lampe galet cartonne sur TikTok en ce moment."], ["yanis", "Il nous en reste 34 en stock."], ["lou", "Je prépare 3 angles pub + une fiche produit refaite."], ["yanis", "Go, je surveille les ventes du jour."]],
  },
  {
    a: "tom", b: "elsa", journal: "Tom et Elsa discutent roadmap SaaS",
    lines: [["tom", "Elsa, la prise de RDV pour coiffeurs : on la met en V1 ?"], ["elsa", "Trois salons l'ont déjà demandée."], ["tom", "Alors je la remonte en haut du backlog."], ["elsa", "Je prépare la fiche produit en parallèle."]],
  },
  {
    a: "lina", b: "chloe", journal: "Lina coordonne l'article de blog avec Chloé",
    lines: [["lina", "Chloé, article « site web pour restaurant à Sète » en ligne demain."], ["chloe", "Je le relaie en carrousel Insta."], ["lina", "Je t'envoie les 5 points clés."], ["chloe", "Nickel, ça fera un bon post."]],
  },
];

/** Petites répliques d'ambiance (style Haiku, désactivables). */
export const CHATTER: [string, string][] = [
  ["lucie", "Boîte mail à zéro, ça fait du bien."],
  ["hugo", "Encore une pizzeria sans site à Balaruc…"],
  ["bastien", "Numérotation continue, zéro trou. J'adore."],
  ["jade", "12 sites sur 12 au vert ✅"],
  ["zoe", "Non, pas ce dégradé violet, par pitié."],
  ["chloe", "Le Reel d'hier : 4 200 vues !"],
  ["victor", "Un devis clair, c'est un devis signé."],
  ["diane", "Mails traités aujourd'hui : 37."],
  ["marius", "On garde le cap, l'équipe."],
  ["gabin", "Nouvelle version de Claude Code, je lis le changelog."],
  ["iris", "Client ravi, colis bien arrivé 📦"],
  ["remi", "Aucun impayé de plus de 30 jours. Rare !"],
  ["oscar", "Score Lighthouse : 98. On prend."],
  ["raphael", "Hook de 3 secondes ou rien."],
  ["celeste", "Personne n'a de réunion à 13 h. Pause déj sacrée."],
  ["max", "To-do du jour : 4 tâches, faisable."],
  ["elsa", "Les cartes NFC, c'est magique pour les avis."],
  ["noe", "Un « Bien à vous » de plus, et c'est envoyé."],
  ["mila", "Les CTA génériques, c'est non."],
  ["rose", "+3 positions sur « agence web Sète » 📈"],
  ["paul", "Le Bistrot devrait prendre la maintenance."],
  ["leon", "Prompt de 180 lignes, prêt à coller."],
  ["heloise", "Prévisionnel à 3 mois : ça tient."],
  ["agathe", "Déclaration URSSAF le 31, c'est noté."],
  ["axel", "Déploiement Vercel : vert du premier coup."],
  ["clemence", "Stand-up demain 08:30, soyez à l'heure !"],
  ["yanis", "8 commandes depuis ce matin."],
  ["lou", "Nouvelle tendance repérée : déco méditerranéenne."],
  ["jules", "Checklist d'onboarding : 9/10."],
  ["nina", "Un nouvel avis 5 étoiles pour le Mareyeur !"],
  ["sacha", "Pas de « Cher Monsieur/Madame », jamais."],
  ["theo", "Trois objections, trois réponses. Prêt."],
  ["margaux", "Pipeline : 7 opportunités actives."],
  ["capucine", "Les mentions légales, c'est pas optionnel."],
  ["edouard", "Bannière cookies conforme. Enfin."],
  ["ines", "Score 82/100 pour Le Comptoir Thau."],
  ["firmin", "Une relance polie vaut mieux que deux oublis."],
  ["tom", "Backlog SaaS : 14 idées, 3 vraiment bonnes."],
  ["lina", "H2, H3, maillage interne : coché."],
];

export const CAFE_LINES = ["Un café et je repars.", "Ristretto, vite.", "La cafetière fume, bon signe.", "Pause de 5 min !", "Quelqu'un veut un café ?", "Vue sur le canal, le luxe."];

export const STANDUP_LINES: [string, string][] = [
  ["clemence", "Bonjour à tous ! Ordre du jour : Douane, devis, prospection."],
  ["marius", "Priorité du jour : faire signer les deux devis en attente."],
  ["lucie", "14 mails triés depuis hier, 2 urgents transmis."],
  ["bastien", "Une facture payée, deux à émettre ce matin."],
  ["hugo", "10 leads de Frontignan sont scorés."],
  ["jade", "Tous les sites clients sont au vert."],
  ["diane", "Le récap de 07:30 est parti aux fondateurs."],
  ["marius", "Merci. On s'y met, bonne journée !"],
];

export interface ApprovalTemplate {
  agentId: string;
  type: ApprovalType;
  title: string;
  to?: string;
  subject?: string;
  preview: string;
}

export const APPROVALS: ApprovalTemplate[] = [
  {
    agentId: "noe", type: "email", title: "Réponse à la boulangerie Marceau",
    to: "contact@boulangerie-marceau.fr (démo)", subject: "Votre projet de vitrine en ligne",
    preview: "Bonjour Madame Marceau,\n\nMerci pour votre message ! Nous serions ravis de vous accompagner pour la vitrine en ligne de la boulangerie. Victor vous prépare un devis détaillé d'ici demain.\n\nSeriez-vous disponible jeudi ou vendredi pour un appel de 15 minutes ?\n\nBien à vous,\nJérémy — MJAGENCY",
  },
  {
    agentId: "sacha", type: "email", title: "Prospection : Le Comptoir Thau",
    to: "bonjour@comptoir-thau.fr (démo)", subject: "Vos 4,8 étoiles méritent une vitrine",
    preview: "Bonjour,\n\nVous avez 4,8 étoiles sur Google : vos clients vous adorent ! Pourtant, votre fiche n'a ni photos ni site. Nous sommes une agence à 300 m de chez vous, au 54 rue Marceau.\n\nOn vous montre en 10 minutes ce qu'on ferait pour vous ?\n\nL'équipe MJAGENCY",
  },
  {
    agentId: "bastien", type: "facture", title: "Facture F-2026-0088 — Atelier Mistral",
    to: "atelier.mistral@exemple.fr (démo)", subject: "Votre facture F-2026-0088",
    preview: "Facture F-2026-0088 — 1 450,00 €\nSite vitrine + 3 mois de maintenance.\nÉchéance : 30 jours. TVA non applicable, art. 293 B du CGI.\nPDF archivé (SHA-256 calculé à l'émission).",
  },
  {
    agentId: "remi", type: "relance", title: "Relance J+10 — Studio Pilates Thau",
    to: "studio.pilates.thau@exemple.fr (démo)", subject: "Rappel : facture F-2026-0079",
    preview: "Bonjour,\n\nSauf erreur de notre part, la facture F-2026-0079 de 590 € arrivée à échéance le 31/10 reste impayée. Pourriez-vous procéder au règlement sous 8 jours ?\n\nCordialement,\nL'équipe MJAGENCY",
  },
  {
    agentId: "victor", type: "devis", title: "Devis D-2026-0042 — Garage du Pont-Levis",
    to: "garage.pontlevis@exemple.fr (démo)", subject: "Votre devis site internet",
    preview: "Devis D-2026-0042 — formule mixte\n• Site vitrine 5 pages : 490 €\n• Maintenance & hébergement : 39 €/mois\n• Option cartes NFC d'avis : 89 €\nValidité : 30 jours.",
  },
  {
    agentId: "iris", type: "email", title: "SAV boutique : retard commande #1038",
    to: "client-boutique@exemple.fr (démo)", subject: "Votre commande #1038",
    preview: "Bonjour,\n\nVotre commande #1038 a pris un peu de retard chez le transporteur (3 jours estimés). Toutes nos excuses ! Vous recevrez le suivi mis à jour dès demain.\n\nL'équipe MJ E-comm",
  },
  {
    agentId: "celeste", type: "rdv", title: "RDV Garage du Pont-Levis — vendredi 10 h",
    to: "garage.pontlevis@exemple.fr (démo)",
    preview: "Invitation Google Agenda\nVendredi 10:00–10:45 · 54 rue Marceau, Sète\nParticipants : Jérémy, Matheis, M. Ferrand (externe)",
  },
  {
    agentId: "nina", type: "email", title: "Demande d'avis — Atelier Mistral",
    to: "atelier.mistral@exemple.fr (démo)", subject: "Votre avis compte beaucoup pour nous",
    preview: "Bonjour,\n\nVotre site est en ligne depuis une semaine : on espère qu'il vous plaît ! Si vous avez 30 secondes, un avis Google nous aiderait énormément.\n\nMerci et à bientôt,\nL'équipe MJAGENCY",
  },
  {
    agentId: "firmin", type: "relance", title: "Relance douce — Domaine de la Plagette",
    to: "domaine.plagette@exemple.fr (démo)", subject: "Re : votre projet de site",
    preview: "Bonjour,\n\nJe me permets de revenir vers vous au sujet de votre projet de site pour le domaine. Avez-vous eu le temps de regarder notre proposition ?\n\nBelle journée,\nL'équipe MJAGENCY",
  },
  {
    agentId: "marius", type: "question", title: "Marius a une question",
    preview: "Pour l'offre de lancement des cartes NFC : on part sur -20 % les 30 premiers jours, ou on offre l'installation ?",
  },
];

/** Routage des missions par mots-clés (mode démo). En Phase 3, c'est Marius (Opus) qui planifie. */
export const MISSION_ROUTES: { keys: string[]; agents: string[] }[] = [
  { keys: ["nfc", "carte", "avis"], agents: ["elsa", "mila", "victor"] },
  { keys: ["facture", "factur", "paiement", "payé"], agents: ["bastien", "heloise"] },
  { keys: ["impayé", "relance", "recouvrement"], agents: ["remi", "firmin"] },
  { keys: ["devis", "proposition", "offre"], agents: ["victor", "margaux", "theo"] },
  { keys: ["prospect", "lead", "commerce", "restaurant", "coiffeur"], agents: ["hugo", "ines", "sacha"] },
  { keys: ["site", "charte", "design", "maquette"], agents: ["zoe", "leon", "mila"] },
  { keys: ["seo", "google", "référencement"], agents: ["rose", "oscar"] },
  { keys: ["post", "instagram", "tiktok", "vidéo", "contenu", "reel"], agents: ["chloe", "raphael"] },
  { keys: ["blog", "article", "newsletter"], agents: ["lina", "chloe"] },
  { keys: ["veille", "concurrent"], agents: ["gabin"] },
  { keys: ["rdv", "agenda", "réunion", "créneau"], agents: ["celeste", "max"] },
  { keys: ["boutique", "shopify", "commande", "stock"], agents: ["yanis", "lou", "iris"] },
  { keys: ["contrat", "cgv", "rgpd", "juridique"], agents: ["capucine", "edouard"] },
  { keys: ["urssaf", "tva", "impôt", "cfe", "fiscal"], agents: ["agathe"] },
  { keys: ["client", "onboarding", "bienvenue"], agents: ["jules", "nina", "paul"] },
  { keys: ["rapport", "kpi", "récap", "chiffres"], agents: ["diane", "heloise"] },
];
