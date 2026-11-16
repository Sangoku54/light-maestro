# Refactor VC → runtime partagé (scope A)

## Problème

Les 10 `actionType` de la Console Virtuelle sont répartis **5/5** :

| Runtime partagé (`virtual-console-runtime.ts`) | Vue React (`PerformanceView.tsx`) |
|---|---|
| `scene`, `chaser`, `blackout`, `grandMaster`, `dmxChannel` | `loadShow`, `playSong`, `audioAutoScript`, `autoLoop`, `bankLoop` |

Les 5 de droite vivent dans `VCButtonWidget` (closures React, `useState`/`useRef`
locaux) → **elles n'existent que si la tuile est montée** (page VC active).

Conséquences :
- MIDI : warning `midi-actions.ts:736` « utilisable seulement si la page de la
  console est affichée » ;
- Remote (télécommande LAN) : impossible → `vcButtonPress()` renvoie `false`.

## Décision

Sortir les 5 actions playback du composant React vers un runtime module-level.

### Nouveau module `src/engine/vc-playback-runtime.ts`

- Porte l'état de lecture : preset actif, handle audio, rAF, mutex audio,
  `activeIds` (registre des tuiles « allumées »).
- Point d'entrée unique : `vcPlaybackPress(widgetId, press)`.
- `vcPlaybackGetSongPreset()` + `vcPlaybackSubscribe(cb)` exposent le preset en
  cours ; `<VcPlaybackHost>` (monté **une seule fois** dans `App.tsx`) le rend
  via `<SongPresetPlayer>`.
- Dépendances **unidirectionnelles** :
  `virtual-console-runtime.ts` → `vc-playback-runtime.ts` (jamais l'inverse).

### `virtual-console-runtime.ts`

- `vcButtonPress` délègue les 5 actions playback à `vcPlaybackPress`.
- Nouveau point d'entrée unifié **`vcPressWidget(widgetId, press)`** :
  - flash : press → active, release → désactive
  - toggle : press → bascule si déjà actif
- `virtual-console-runtime` notifie `vcPlaybackSetActive()` à chaque run
  (LED de tuile + état « allumé » du Remote).

### `VCButtonWidget` (PerformanceView)

Devient **purement affichage** : `activate()`/`deactivate()` appellent
`vcPressWidget`. Le `useState` local `active` est remplacé par l'abonnement au
runtime.

## Fichiers touchés

| Fichier | Action |
|---|---|
| `src/engine/vc-playback-runtime.ts` | NOUVEAU — runtime playback |
| `src/components/VcPlaybackHost.tsx` | NOUVEAU — hôte global `<SongPresetPlayer>` |
| `src/engine/virtual-console-runtime.ts` | délégation + `vcPressWidget` |
| `src/views/PerformanceView.tsx` | `VCButtonWidget` → affichage seul ; helpers déplacés |
| `src/App.tsx` | montage de `<VcPlaybackHost />` |
| `src/engine/midi-actions.ts` | passe par `vcPressWidget` (bonus : MIDI débloqué) |
| `src/hooks/remote-trigger.ts` | snapshot `widgets` + `vcPressWidget` |
| `electron/remote/server.ts` | types snapshot + page web : onglets + console |

## Invariants à préserver

1. Le comportement d'une tuile cliquée sur le PC est **strictement identique**.
2. Le DMX n'est écrit que par les sources existantes (`vc`, `song-preset`, …).
3. La lecture audio reste **mutuellement exclusive** (1 seule source).
4. Un preset lancé depuis le téléphone joue **audio + autoscript + lumières**.

## Validation

- `npm run check` (tsc renderer + electron + vitest) à chaque bloc.
- Nouveau test : `src/__tests__/vc-playback-runtime.test.ts` (actions Family B
  dispatchées, registre `activeIds`, pas de régression Family A).
- Test navigateur : la page Remote affiche les onglets + la console, les
  boutons déclenchent bien `vcPressWidget`.
