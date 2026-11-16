# Plan — Crash renderer `Cannot read properties of undefined (reading 'push')`

## Contexte
- Crash sur le PC live au lancement/usage : `TypeError: Cannot read properties of undefined (reading 'push')` dans un callback `useMemo` du renderer.
- Bundle confirmé : `release\win-unpacked\resources\app\dist\renderer\assets\index-evtRuieA.js` (1.57 MB, 4576 lignes) — build actuel, pas périmé.
- Stack : instruction fautive à (4572, 406184), via `Object.useMemo` (38, 23347).
- Pas de sourcemaps (dist ni win-unpacked). Aucune map → mapping par reconstruction minifiée + croisement source.
- Chemin d'exécution : `AppData/Local/Temp/<hash>/resources/app/...` → exe portable.

## Dépendances & sous-tâches
1. **Trace** (sous-agent `Traceur de crash`) → `.cluster/crash-tape/subagent_trace.md`
   - Extraire ligne 4572 + contexte autour de col 406184 ; identifier l'identifiant minifié recevant `.push` et sa provenance.
   - Reconstruire la forme (bucket par clé dynamique : kind/category/mode…).
   - Croiser avec `src/views/*.tsx` : tous les `useMemo` avec `.push(` et accès par clé dynamique. Attention aux ajouts laser récents (`laser-pattern`, `laser-scan`, `laser-color`, `KIND_META`, bucket maps).
   - Sortie : fichier source exact + ligne + extrait + variable undefined + scénario de déclenchement + fix minimal proposé + 2-3 candidats écartés justifiés.
2. **Fix mainline** (moi) : correctif chirurgical + test de régression (vitest).
3. **Revue adversaire** (sous-agent `Relecteur correctif`) : valider le fix, chercher les régressions sur les autres useMemo/key maps.
4. **Vérification + rebuild** : `tsc --noEmit`, `vitest run` complet, rebuild portable + NSIS, contrôle bundle (présence du correctif).
5. **Livraison** : exe + preuves + scénario déclencheur expliqué.

## Livrables
- Correctif source + test de régression.
- `release\Light Maestro 1.0.14.exe` + `release\Light Maestro Setup 1.0.14.exe` reconstruits.