# Portable exe build — plan

## Tâche
Construire un `.exe` portable (electron-builder `--win portable`) de Light Maestro,
embarquant les dernières améliorations d'exploitation de canaux DMX.

## Prérequis vérifiés
- Cible `portable` x64 déjà configurée dans le champ `build.win.target`.
- `asar: false`, `asarUnpack` sur better-sqlite3 / midi / @serialport / resources.
- Dépendances natives : better-sqlite3@12.11.1, midi@2.0.0, @serialport/bindings-cpp (11 + 13).

## Étapes
1. Recompiler la source à jour (`npm run build`) — **done** (exit 0, renderer 1503 modules).
2. Vérifier que les marqueurs des améliorations sont dans le bundle — **done**
   (b-gobo/b-prism/b-zoom-wide/b-frost/amber/ultraviolet/c-white présents).
3. Repackager portable (`npx electron-builder --win portable --publish never`) — **done** (exit 0).
4. Vérifier l'artefact (PE header MZ, taille, SHA256, fraîcheur) — **done**
   - `release\Light Maestro 1.0.14.exe` — 78,92 Mo — 2026-08-23 22:56:12
   - SHA256 3FCD7532620532863B3533FAE4CA58136B664BE35BCBF9FD2C78C2CABD6C1231
5. Vérification indépendante (subagent verify_portable_exe) — **running**
6. Livraison — **pending**

## Limite connue
L'agent ne peut pas lancer l'IHM Electron (cf. AGENTS.md) → « totalement fonctionnel »
validé par : tsc exit 0, 232/232 tests, build + packaging exit 0, PE header valide,
marqueurs présents. Smoke-test GUI final à faire par l'utilisateur.
