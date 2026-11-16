# Scènes — Vue 3D masquée par défaut + faders pas-à-pas

## Objectif (demande utilisateur)
1. Dans la vue **Scènes** (DesignView → onglet « scenes » → `SceneEditor`), la vue 3D ne doit **pas** être visible par défaut. Elle n'apparaît que quand on l'appelle via un **bouton en bas à droite**. Le bouton « Détacher » (passage en fenêtre flottante) reste.
2. **Tous** les faders de canaux DMX (composant unique `ChannelSlider`) doivent être réglables **pas à pas** (boutons − / +) **et/ou** via un **champ de saisie directe** de la valeur.

## Fichier cible
- `src/views/DesignView.tsx` (seul fichier concerné)

## Changements précis

### A. Vue 3D masquée par défaut (SceneEditor, ~l.909 / ~l.1131 / ~l.1250)
- Ajouter `const [show3D, setShow3D] = useState(false);` juste après la déclaration `showFloating3D`.
- Passer le div racine du `SceneEditor` en `relative` (ajouter `relative` à `className="flex gap-4 h-full min-h-0"`).
- Panneau 3D **inline** : condition `{show3D && !showFloating3D && ( … )}` (au lieu de `!showFloating3D`). Ajouter, à côté du bouton « Détacher », un bouton « Masquer » (icône `X`, `setShow3D(false)`).
- Panneau 3D **flottant** : condition `{show3D && showFloating3D && ( … )}` (au lieu de `showFloating3D`).
- Ajouter un bouton « Vue 3D » (`absolute bottom-2 right-2`), visible seulement quand `!show3D`, qui fait `setShow3D(true)`.

### B. Faders pas-à-pas + saisie directe (`ChannelSlider`, ~l.1689)
Réécrire le composant pour produire, par ligne :
- icône, libellé (tronqué),
- bouton **−** (`onChange(clamp255(value - 1))`),
- le `<input type="range">` existant,
- bouton **+** (`onChange(clamp255(value + 1))`),
- champ `<input type="number">` min 0 / max 255 pour saisie directe.

Le champ nombre doit supporter la saisie libre : composant helper `NumberField` à état local (string), synchronisé sur la prop quand pas en édition, commit au **blur** et à **Entrée**, valeur clippée à 0..255.

Ajouter un helper `clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)))`.

## Vérification (obligatoire)
- `npx tsc --noEmit` → 0 erreur.
- `npx vitest run` → aucune régression (le fichier `DesignView.tsx` n'est pas couvert par les tests unitaires, mais la suite doit rester verte).
- Relire le diff : la vue 3D est bien masquée par défaut (`show3D` initial `false`), le bouton bas-droite la réouvre, chaque fader a − / + / saisie.

## Non-vérifié (contrainte)
Impossible de lancer l'app Electron pour contrôler le rendu visuel : l'implémentation est validée par typecheck + relecture du diff uniquement. Layout du fader à ajuster visuellement si besoin.
