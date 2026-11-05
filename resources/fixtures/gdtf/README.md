# Fixtures GDTF (démo)

Ce dossier est lu au démarrage par `loadGdtfDirectory` (electron/fixtures/library.ts)
→ `resources/fixtures/gdtf/`. Tous les fichiers `.gdtf` ici sont importés
automatiquement (récursif, `getAllFiles(dir, '.gdtf')`).

## Provenance

Ces fixtures sont des **fixtures de démonstration générées** (script
`scripts/vendor-gdtf.cjs`), pas des fichiers constructeur. Motif : le dépôt
officiel (mvrdevelopment/spec) ne publie pas de `.gdtf` prêts, et l'API
GDTF Share (gdtf-share.com) exige une connexion.

Elles exercent le parseur sur toute sa palette : canaux 8/16 bits, roue de
couleurs, gobos, prismes, zoom/frost/iris/focus, effets, macros, RGBW additif,
strobe, maintenance.

## Ajouter de vraies fixtures

Dépose tes `.gdtf` constructeurs dans ce dossier (ou dans
`%APPDATA%\light-maestro\gdtf-fixtures\`) et relance l'app — import auto.

Régénérer ce jeu : `node scripts/vendor-gdtf.cjs`.
