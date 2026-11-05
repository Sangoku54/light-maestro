# plan.md — EFX ±400 + analyse jaune + config minimale

## Demandes utilisateur
1. EFX : plages X/Y offset au-delà de ±255 → ±400.
2. Optimiser l'analyse des fixtures : 2 heads restent en jaune (ne devrait plus arriver).
3. Configuration minimale préconisée pour tourner sans problème.

## Dispatch (S2)
- SA-1 analyste-efx-offset : chaîne complète xOffset/yOffset (UI DesignView → stockage → writers DMX → preview) → subagent_01.md
- SA-2 analyste-jaune-fixtures : statut jaune d'analyse (composant + critères + causes heads) → subagent_02.md
- SA-3 analyste-config-mini : audit charges (WebGL/three, audio blobs RAM, rAF, disque) → 3 paliers config → subagent_03.md

## Findings mainline
- Curseurs UI : DesignView L3848-3849/L3860-3861 min/max ±255 → **PASSENT À ±400 (fait)**.
- Sémantique offset : décalage relatif normalisé `ox = (xOffset/255)*0.3`, appliqué `rx2 = px*cos-rot + ox`, puis `dmxPan = clamp(128+rx2*127, 0, 255)` (DesignView L3484, L3624-3626). Clamp matériel final → ±400 cohérent (trajectoire déborde et se clampe naturellement).
- Deux writers design-efx (L3471 write, L3607-3633 writeTransient) — même formule.
- **Incohérence à trancher (SA-1)** : défauts de lecture différents — DesignView `setXOffset(efx.xOffset)` (défaut création 0), PerformanceView L443 `(efx.xOffset ?? 128)/255*0.3`, ShowManager L281 `(effect.xOffset||0)/255*0.3`. Le ?? 128 de PerformanceView injecte un décalage de 0.15 fraction pour les vieux efx sans champ — bug latent potentiel.
- « Jaune » : pas encore localisé — SA-2 en cours.

## État
- S1/S2 done, S3 running (3 subagents en vol). Fix partiel appliqué (curseurs ±400).
