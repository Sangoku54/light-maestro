# Rollback — retrait des zones pan/tilt forcés (20 août, ~09h)

## Contexte
Retour utilisateur : « tu n'y arrives pas, fait un rollback à ma demande de 4h43 de ce matin,
mais conserve les modifications d'icone et splash. donc plus de pan/tilt forcés. »

La demande de 4h43 a déclenché la feature « zones de mouvement (têtes mobiles) + contraste
des sections » (commit `e75dd59`, 05:36), suivie de plusieurs correctifs (câblage 1.0.4,
cône 3D 1.0.6, plages pan 1.0.7, ancrage cône 1.0.8) qui n'ont pas satisfait l'utilisateur.

## Décision
Rollback dur à `e1da514` (v1.0.2, état avant la demande de 4h43), en conservant uniquement :
- `public/splash.html` (splash fond sombre, version `8698ff9`)
- `resources/icon.png` (icône cercle foncé, version `8698ff9`)

→ Plus aucune feature de zone / pan-tilt forcé.

## Ce qui est supprimé (commits `e75dd59` → `f9165ee`)
- `src/engine/dmx-movement.ts` : `MOVEMENT_ZONE_PRESETS`, `getMovementZonePreset`, clamp zone.
- `src/__tests__/movement-zone.test.ts` (13 tests).
- `src/views/Stage3D.tsx` : `zoneCone` (cône de couverture).
- Câblage `fixturePositionsRef` (QuickShowView, SongPresetPlayer), champ `zone`, contraste sections.

## Commit de rollback
`168535a` — « rollback: retrait zones pan/tilt forcés (retour v1.0.2) + conservation icône/splash — bump 1.0.9 »

## Vérifications
- `tsc --noEmit` propre.
- **158/158 tests verts** (171 − 13 tests de zones retirés).
- exe 1.0.9 reconstruits et contrôlés (en-tête PE « MZ ») :
  - `Light Maestro 1.0.9.exe` (97 141 278 o, portable)
  - `Light Maestro Setup 1.0.9.exe` (97 388 248 o, installeur)
- Anciens exe 1.0.8 supprimés.

## Notes
- Fichiers `icon-full.svg`, `favicon-16.svg` : inchangés entre `e1da514` et le HEAD — déjà au bon état.
- Données utilisateur (`Foot print.lmpreset`, `baby.lmpreset`) sauvegardées avant reset puis restaurées ;
  laissées hors commit (convention : ne pas committer les données utilisateur).
- Sauvegarde temporaire : `.openclaw/tmp/rollback-backup-0900/`.
