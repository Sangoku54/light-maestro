# Règle : fixtures multi pan/tilt — exploitation complète

## Contexte
Le 2026-08-13, l'utilisateur a validé (« c'est parfait bravo ») le fix d'exploitation complète du Tonio 6 arm (1 pan + 7 tilts) et demandé : « n'oublies pas de faire cette analyse pour toutes les futures fixtures avec de multi pan et tilt ».

## Changement proposé (AGENTS.md — nouvelle section sous "Benchmark Commercial References")

```markdown
## Fixtures Multi Pan/Tilt — Exploitation Complète

Toute fixture avec plusieurs canaux pan/tilt (Tonio 6 arm, flowers, multi-têtes) doit être exploitée à fond sur les 4 étages — jamais seulement le 1ᵉʳ canal :

1. **Analyse** : collecter TOUS les offsets (`panOffsets[]`/`tiltOffsets[]` dans dmx-channel.ts, dmx-cues.ts `analyzeFixture`, stage3d `analyzeFixtureChannels`). Un canal nommé « fine » n'est PAS un bras → exclu des tableaux.
2. **Génération de cues** (genCues) : écrire pan/tilt sur tous les offsets.
3. **Moteur playback** : boucle `motorCount = max(panCount, tiltCount)`, phase décalée par bras.
4. **3D (Stage3D)** : une tête par tilt via `extraHeads[]` (tilt moteur °/s, pan partagé, zoom/mountMode/idle/modale position sur les bras).

Référence : `.openclaw/notes/multi-pan-tilt.md` (cas Tonio 6 arm, pièges connus).
```

## Fichiers de référence déjà en place
- `.openclaw/notes/multi-pan-tilt.md` (documentation technique détaillée)
- `memory/2026-08-13.md` (journal)
