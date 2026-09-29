/**
 * Centre d'aide intégré — 18 fiches par fonction réelle.
 *
 * Ton : régie, direct, zéro jargon. Chaque fiche = pitch + pas-à-pas concret
 * (vrais noms d'onglets/boutons) + astuces terrain + 1 défi à essayer.
 * Progression persistée (localStorage) : cocher « J'ai compris » débloque
 * la barre de progression. Français uniquement (comme les autres modales).
 */

export interface HelpPage {
  id: string;
  group: string;
  emoji: string;
  title: string;
  pitch: string;
  steps: string[];
  tips: string[];
  challenge: string;
}

export const HELP_GROUPS: string[] = [
  'Démarrer',
  'Show Auto',
  'Configuration',
  'Performance',
  'Compte',
];

export const HELP_PAGES: HelpPage[] = [
  // ─── Démarrer ──────────────────────────────────────────────
  {
    id: 'projets',
    group: 'Démarrer',
    emoji: '📁',
    title: 'Projets : créer, ouvrir, sauver',
    pitch: 'Tout ton show tient dans un fichier .lmproj : patch, scènes, presets, console.',
    steps: [
      'En haut : Nouveau (page blanche), Ouvrir (un .lmproj), Enregistrer (Ctrl+S).',
      'Travaillez sans peur : à la fermeture, un garde-fou propose Sauver / Jeter.',
      'Un point sale = pastille : tant qu’elle est là, ce n’est pas sauvé.',
    ],
    tips: [
      'Un .lmproj par soirée + date dans le nom : « 2026-10-31-club.lmproj ».',
      'Copie le fichier sur clé USB avant de partir — c’est ton backup.',
    ],
    challenge: 'Crée un projet, patch une fixture, sauvegarde avec Ctrl+S.',
  },
  {
    id: 'audio',
    group: 'Démarrer',
    emoji: '🎧',
    title: 'Audio : importer et analyser',
    pitch: 'Pas d’analyse = pas de show auto. Un morceau bien analysé, c’est 80 % du travail fait.',
    steps: [
      'Mode Show Auto → Source Audio : glisse un MP3/WAV/FLAC.',
      'Lance l’analyse : BPM, sections (intro/couplet/refrain/drop) et énergie sont détectés.',
      'Vérifie les sections affichées : si le drop est mal placé, force le BPM au tap tempo.',
    ],
    tips: [
      'Coupe les silences et intros parlées avant analyse : tempo plus juste.',
      'Un morceau à tempo variable reste un challenge — cale le BPM à la main.',
    ],
    challenge: 'Analyse un morceau et retrouve son drop sur la timeline.',
  },
  // ─── Show Auto ─────────────────────────────────────────────
  {
    id: 'show-auto',
    group: 'Show Auto',
    emoji: '⚡',
    title: 'Show auto : ton morceau pilote la lumière',
    pitch: 'Le Show auto génère chasers, couleurs, strobes et mouvements depuis l’analyse. Toi, tu règles le goût.',
    steps: [
      'Choisis un preset (.lmpreset) ou génère depuis ton morceau analysé.',
      'Règle intensité, palette, mouvement et division du temps.',
      'Appuie sur lecture : la lumière suit les sections (le drop tape plus fort).',
      'Sauvegarde en preset pour rejouer à l’identique en live.',
    ],
    tips: [
      'Strobe trop violent ? Baisse la limite strobe avant de toucher au reste.',
      'En live : Grand Master ou Blackout, toujours à portée de main.',
    ],
    challenge: 'Joue un morceau entier sans toucher un slider après le lancement.',
  },
  {
    id: 'palettes',
    group: 'Show Auto',
    emoji: '🎨',
    title: 'Palettes Couleur',
    pitch: 'Des couleurs cohérentes sur tout le show, au lieu d’un arc-en-ciel fatigué.',
    steps: [
      'Onglet Palettes Couleur : choisis Warm, Cool ou Party selon l’ambiance.',
      'Applique par section : un couplet froid + un refrain chaud, ça raconte quelque chose.',
      'Crée tes presets : 3 couleurs qui vont ensemble valent mieux que 12 au hasard.',
    ],
    tips: [
      'Moins de couleurs = show plus pro. 3 max par morceau.',
      'Le blanc casse tout : réserve-le aux pics (drop, final).',
    ],
    challenge: 'Refais un de tes morceaux avec une seule palette de 3 couleurs.',
  },
  {
    id: 'scenes-preprog',
    group: 'Show Auto',
    emoji: '✨',
    title: 'Scènes pré-programmées',
    pitch: '128 scènes générées depuis TON patch, en 4 banques de 32. La panne d’inspiration n’existe plus.',
    steps: [
      'Onglet Scènes pré-programmées : choisis une banque (Couleurs, Effets, Matrice, Mix).',
      'Clique une tuile : elle joue en boucle. Re-clique : elle s’arrête ET s’éteint.',
      '« Régénérer » produit 128 nouvelles variantes du même patch.',
    ],
    tips: [
      'Une tuile allumée le reste même en changeant d’onglet — re-clique pour l’éteindre.',
      'Les tuiles Effets bougent les têtes : vérifie où elles pointent avant le public.',
    ],
    challenge: 'Trouve une tuile Effets qui bouge + une tuile Couleurs qui claque, enchaîne-les.',
  },
  // ─── Configuration ─────────────────────────────────────────
  {
    id: 'patch',
    group: 'Configuration',
    emoji: '🔌',
    title: 'Patch : déclarer tes projecteurs',
    pitch: 'Le logiciel ne devine pas ton parc : chaque projecteur se déclare une fois, avec sa bonne adresse.',
    steps: [
      'Mode Configuration → onglet Projecteurs : cherche ton modèle (1500+ références, import .qxf possible).',
      'Pose-le à son adresse DMX réelle (lis la notice du projecteur).',
      'Conflit d’adresses = rouge : corrige avant de continuer.',
      'Répète pour chaque projecteur, dans l’ordre de la chaîne DMX.',
    ],
    tips: [
      'Photo de l’afficheur DMX de chaque projecteur avant de démonter. Toujours.',
      'Adresse qui se chevauchent = deux projecteurs qui font n’importe quoi ensemble.',
    ],
    challenge: 'Patch ton premier projecteur et allume-le depuis la fiche (test).',
  },
  {
    id: 'groupes',
    group: 'Configuration',
    emoji: '👥',
    title: 'Groupes',
    pitch: '« Les 4 washes de face » en un clic au lieu de 4 : regroupe par rôle, pas par hasard.',
    steps: [
      'Onglet Groupes : crée un groupe par rôle (face, contre, lyres, strobes).',
      'Glisse les projecteurs dedans.',
      'Pilote le groupe d’un coup dans scènes, chasers et EFX.',
    ],
    tips: [
      'Un projecteur peut vivre dans plusieurs groupes (face + tous).',
      'Nomme comme tu parles en régie : « face », « fond », « strobes ».',
    ],
    challenge: 'Crée un groupe “face” et fais-le clignoter depuis une scène.',
  },
  {
    id: 'scenes',
    group: 'Configuration',
    emoji: '🎬',
    title: 'Scènes : tes looks figés',
    pitch: 'Une scène = un état complet des projecteurs. C’est la brique de tout le reste.',
    steps: [
      'Onglet Scènes : Nouvelle scène, règle dimmer/couleurs/positions.',
      'Dose fade in/out et durée (0 = infini, reste allumée).',
      'Clic droit sur une scène : Renommer, Modifier, Dupliquer.',
      'Modifier allume les faisceaux pour régler en voyant — la preview tient tant que tu édites.',
    ],
    tips: [
      'Duplique plutôt que de repartir de zéro : 80 % des looks se ressemblent.',
      'Durée 0 = tenue infinie : parfait pour bosser, à éviter en chaser sans fin voulue.',
    ],
    challenge: 'Crée “Rouge face” : washes en rouge à 100 %, le reste éteint.',
  },
  {
    id: 'chasers',
    group: 'Configuration',
    emoji: '🏃',
    title: 'Chasers : enchaîner des scènes',
    pitch: 'Un chaser joue des scènes en boucle : chenillards, vagues, strobes rythmés.',
    steps: [
      'Onglet Chasers : Nouveau, ajoute des scènes comme pas.',
      'Règle l’ordre, la vitesse et la direction (avant, arrière, ping-pong).',
      'Teste : ça tourne en boucle jusqu’à l’arrêt.',
    ],
    tips: [
      'Un chaser à 2 pas bien calés bat un chaser à 12 pas brouillons.',
      'Vitesse en BPM du morceau = chaser qui respire avec la musique.',
    ],
    challenge: 'Un chaser 2 pas (rouge/bleu) qui tourne propre à 120 BPM.',
  },
  {
    id: 'cuelists',
    group: 'Configuration',
    emoji: '📋',
    title: 'Cue Lists : la conduite au bouton GO',
    pitch: 'Théâtre, one-man-show, cérémonie : chaque appui sur GO envoie la cue suivante.',
    steps: [
      'Onglet Cue Lists : Nouvelle liste, empile scènes et chasers.',
      'Règle GO manuel ou follow (enchaînement auto après la durée).',
      'En live : un seul bouton, pas d’impro à 3h du matin.',
    ],
    tips: [
      'Numérote et nomme chaque cue comme ton conducteur (« Q12 - final »).',
      'Follow pour les transitions timed, GO manuel dès qu’un humain parle.',
    ],
    challenge: 'Une cue list de 3 cues jouée au GO sans faute.',
  },
  {
    id: 'rgb-matrix',
    group: 'Configuration',
    emoji: '🟧',
    title: 'Matrice RGB',
    pitch: 'Transforme tes PARs en écran géant : lignes, cercles, diamants qui courent.',
    steps: [
      'Onglet Matrice RGB : dessine ta matrice (lignes/colonnes).',
      'Choisis un motif : ligne, cercle, diamant, carré, triangle.',
      'Lance : le motif court, en rythme si audio-réactif.',
    ],
    tips: [
      'Ordonne la matrice comme la scène vue du public, sinon le motif part à l’envers.',
      'Moins vite = plus lisible. Un chase lent se voit, un chase rapide bave.',
    ],
    challenge: 'Un cercle qui tourne sur 4 PARs, sens horaire.',
  },
  {
    id: 'efx',
    group: 'Configuration',
    emoji: '🌀',
    title: 'EFX : mouvements paramétriques',
    pitch: 'Cercles, 8, carrés, vagues : des mouvements propres sans programmer pas à pas.',
    steps: [
      'Onglet EFX : Nouvel effet, choisis un motif (cercle, 8, carré, triangle…).',
      'Règle largeur, hauteur, vitesse, rotation.',
      'Lie-le à une scène : la scène joue le statique + la vague en continu.',
    ],
    tips: [
      'Petite amplitude + vitesse lente = classe. Grand + vite = fête foraine.',
      'Teste au sol d’abord : un cercle trop large finit dans le public.',
    ],
    challenge: 'Un 8 lent sur 2 lyres, 30 secondes sans toucher.',
  },
  {
    id: 'vue-2d',
    group: 'Configuration',
    emoji: '🗺️',
    title: 'Vue 2D : le plan de scène',
    pitch: 'Place tes projecteurs comme en vrai : la 3D et les mouvements suivent.',
    steps: [
      'Onglet Vue 2D : glisse chaque projecteur à sa place (pont, sol, côtés).',
      'Règle l’orientation : face public, contre, latéral.',
      'La Vue 3D et les faisceaux suivent ce plan.',
    ],
    tips: [
      'Un plan faux = des faisceaux qui ne vont nulle part en 3D.',
      'Mets à jour le plan à chaque changement de salle.',
    ],
    challenge: 'Reproduis ta dernière implantation réelle en 2D.',
  },
  {
    id: 'programmeur',
    group: 'Configuration',
    emoji: '🟣',
    title: 'Programateur : le live avant de sauver',
    pitch: 'Le violet, c’est du live non sauvé. Le programateur essaie, la scène garde.',
    steps: [
      'Touche des canaux : ils partent en live (violet), sans toucher aux scènes.',
      'Ça plaît ? Store vers une scène (nouvelle ou existante).',
      'Ça plaît pas ? Clear : retour à l’état programmé.',
    ],
    tips: [
      'Jamais de Store sans regarder ce qui est violet : tu sauverais des scories.',
      'Le programateur a priorité sur presque tout : s’il est plein, rien d’autre ne passe.',
    ],
    challenge: 'Monte un look au programateur, Store-le en nouvelle scène, Clear.',
  },
  // ─── Performance ───────────────────────────────────────────
  {
    id: 'console',
    group: 'Performance',
    emoji: '🎛️',
    title: 'Console Virtuelle : tes tuiles de live',
    pitch: 'Boutons et scènes à toi, en grand, cliquables en stress : ta console perso.',
    steps: [
      'Mode Performance : ajoute boutons (scènes, chasers, blackout) sur le canevas.',
      'Déplace/Redimensionne au drag. Clic droit : configurer, supprimer.',
      'Organise en pages (ex. une par morceau) et navigue aux onglets.',
      'En live : un appui = toggle, sauf flash (maintenu = momentané).',
    ],
    tips: [
      'Grosses tuiles pour les actions panique (blackout en énorme, en bas à droite).',
      'Une page par morceau + une page “secours” : blackout, full, strobe.',
    ],
    challenge: 'Une page 4 tuiles : 2 scènes + 1 chaser + 1 blackout géant.',
  },
  {
    id: 'curseurs',
    group: 'Performance',
    emoji: '🎚️',
    title: 'Curseurs : Grand Master et canal DMX',
    pitch: 'Deux faders vitaux : le volume général de la lumière, et un canal direct.',
    steps: [
      'Ajoute un slider, fonction Grand Master : 0 = noir total, 255 = tout.',
      'Ajoute un slider fonction Canal : choisis univers + adresse + valeur.',
      'En live, le Grand Master baisse tout sans toucher aux scènes.',
    ],
    tips: [
      'Grand Master à 80 % en balance : marge de progression pour le show.',
      'Un slider canal sur le dimmer de secours sauve quand une scène déraille.',
    ],
    challenge: 'Baisse un show en cours à mi-course uniquement au Grand Master.',
  },
  {
    id: 'midi',
    group: 'Performance',
    emoji: '🎹',
    title: 'MIDI : Learn + LEDs qui suivent',
    pitch: 'Mappe ton contrôleur une fois : pads, faders, et les LEDs qui reflètent l’état réel.',
    steps: [
      'Ouvre Mappage MIDI : bouge un contrôle → clique une action → mappé.',
      'Les boutons mappés allument/éteignent comme les tuiles.',
      'Le feedback LED renvoie l’état : pad allumé = tuile active, pour de vrai.',
    ],
    tips: [
      'Mappe d’abord blackout + 4 scènes : le reste, c’est du bonus.',
      'Si une LED ment, c’est le mapping qui est faux, pas la tuile.',
    ],
    challenge: 'Mappe 2 pads (scène on/off) + 1 fader (Grand Master).',
  },
  {
    id: 'distance',
    group: 'Performance',
    emoji: '📡',
    title: 'À distance : OSC, Timecode, Remote web',
    pitch: 'Pilote depuis une tablette, un séquenceur ou une régie son : la lumière suit.',
    steps: [
      'OSC : reçois TouchOSC/Lemur sur le réseau (mêmes actions que MIDI).',
      'Timecode (MTC) : déclenche des cues sur le temps d’un séquenceur.',
      'Remote web : active le serveur, scanne l’URL sur ton téléphone — même réseau exigé.',
    ],
    tips: [
      'Teste le Wi-Fi de la salle AVANT : un réseau saturé = ordres perdus.',
      'Le Remote reste en local : jamais exposé sur internet, par design.',
    ],
    challenge: 'Déclenche une scène depuis ton téléphone via le Remote.',
  },
  // ─── Compte ────────────────────────────────────────────────
  {
    id: 'licence',
    group: 'Compte',
    emoji: '🔑',
    title: 'Compte & Licence : gratuit, Standard, Complète',
    pitch: 'Gratuit : 1 fixture, 1 univers. Standard (69 €) : fixtures illimitées. Complète (99 €) : tout illimité. Perpétuel, jamais d’abonnement.',
    steps: [
      'En haut à droite : badge de version + bouton Connexion.',
      'Crée ton compte (email de confirmation), connecte-toi.',
      'Achète depuis le modal : Standard 69 € ou Complète 99 €, paiement Stripe.',
      'Après achat : reconnecte-toi pour activer. Hors-ligne ensuite : aucun souci.',
    ],
    tips: [
      'Connecte-toi une fois AVANT de partir en campagne sans réseau.',
      'Ne te déconnecte jamais en live : hors-ligne = retour gratuit.',
    ],
    challenge: 'Crée ton compte et retrouve ton badge de version.',
  },
];

const STORAGE_KEY = 'light-maestro-help-done';

function loadDone(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function getHelpDone(): Record<string, boolean> {
  return loadDone();
}

export function setHelpDone(id: string, done: boolean): void {
  try {
    const cur = loadDone();
    if (done) cur[id] = true;
    else delete cur[id];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cur));
  } catch {
    /* stockage indisponible */
  }
}
