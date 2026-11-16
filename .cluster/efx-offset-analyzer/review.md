# review.md — EFX ±400 + analyse fixtures (heads jaunes) + config minimale

## Demandes utilisateur
1. EFX : augmenter les plages X/Y offset au-delà de ±255 → ±400.
2. Optimiser l'analyse des fixtures : « j'ai 2 heads qui restent en jaune, cela ne devrait plus arriver ».
3. Configuration minimale préconisée.

## 1. EFX X/Y Offset → ±400 (commit c5ecc73)
- Curseurs UI (DesignView L3848/L3860) : ±255 → **±400**.
- Sémantique vérifiée de bout en bout : l'offset est un décalage relatif normalisé — `ox = (xOffset/255) * 0.3` en fraction, appliqué après rotation, converti en DMX `clamp(128 + rx2*127, 0, 255)`. Le clamp matériel final absorbe les trajectoires qui débordent : ±400 produit un décalage plus fort (±199 pas au moteur via fixture-tracks, ±60 via les chemins preview ×0.3), aucun crash, aucun codage en dur à retoucher.
- Store/persistance : `SavedEffect.xOffset/yOffset` (showStore L146) sans clamp, export/import JSON brut → ±400 persiste tel quel.
- **Bug latent corrigé au passage** : PerformanceView L443-444 lisait `efx.xOffset ?? 128` — un efx sans champ était décalé d'environ 19 pas DMX (128 = centreDMX, pas l'unité du champ). Corrigé en `?? 0` (aligné sur DesignView/ShowManager).
- Divergence préexistante documentée (non traitée, option produit) : le moteur principal `generateEfxPanTilt` (fixture-tracks L337-344) applique l'offset plein (±127 pas à ±255) tandis que les 3 chemins « éditeur/preview/show » l'amortissent ×0.3 (±38 pas). Harmonisation possible sur demande.

## 2. Heads « jaunes » — cause racine et routing couleur v2 (commit c5ecc73)
**Chaîne du jaune** : une fixture dont les canaux couleur ne forment pas de segment RGB tombe sur le fallback 3D `wheelValueToColor` → `setHSL(valeur/255, 1, 0.5)` : une valeur DMX de 60-85 rend un jaune STABLE — le symptôme exact.

**Causes trouvées (sur la fixture réelle Tonio 6 arm, 22 canaux)** :
1. **Laser RG sans bleu** : canaux « Red laser » (Colour, 1 cap 0-255 #ff0000) + « Green laser » (Colour, sans caps) — `buildRgbSegments` v1 exigeait R+G+B → aucun segment → fallback. Les lasers 2 canaux RG (Galaxian, Dominator, Tonio…) étaient systématiquement non coloriés.
2. **Gate laser mono-couleur** : `hasLaserColorGateCaps` capturait « Red laser » (1 seule cap pleine plage) comme sélecteur de couleur laser → le canal quittait la collecte couleur. Un vrai sélecteur (Showtec Dominator) propose PLUSIEURS couleurs — critère durci : ≥ 2 couleurs différentes requises.
3. **Familles de canaux mélangeables** : la Tonio a 3 jeux (« Bee eye red/green/blue/white », « Beam red/green/blue/white », lasers RG) — le v1 assemblait en un seul flux ordonné : correct par chance ici, faux si les jeux étaient entrelacés (r=bee red, g=beam green…).

**Correctifs** :
- `buildRgbSegments` v2 (dmx-color.ts) : regroupement par FAMILLE de nom (nom sans mot couleur), segment par famille, **b: null accepté** pour les lasers RG (comme w/a/uv déjà nullables). Tonio réelle → 3 segments : bee eye {11,12,13,14}, beam {15,16,17,18}, laser {19,20,b:null} — verrouillé par test sur le JSON réel.
- Consommateurs blindés sur b null : dmx-playback (fade + dScale + écriture cue ×2), auto-loops (put).
- `enrichWheelCaps` : les caps de roue nommées (« Yellow », « Deep Blue »…) sans champ `color` reçoivent leur hex déduit du nom (12 couleurs mappées) — appliqué aux 4 points de remplissage (roue, canal unique, complétion, gate laser). Une roue nommée non colorisée ne retombe plus dans l'arbitraire.
- `wheelValueToColor` (Stage3D) : fallback HSL → **blanc neutre**. Plus aucun jaune calculé depuis une valeur DMX brute.
- `rgbOffsets` reste `[r,g]` (length 2) sans bleu : les consommateurs simples (`!== undefined`) restent cohérents, Stage3D garde `rgbOffsets[2]` gardé.

## Validation
- tsc 0, vitest **329/329** (36 fichiers) dont 7 nouveaux : builder v2 (3 familles Tonio, ordres entremêlés, RGB simple, fine), enrichWheelCaps, et le verrou sur le JSON réel de la Tonio 6 arm.
- ⚠ **Commit c5ecc73 : mélange assumé avec le WIP utilisateur** présent dans auto-loops.ts (~523 lignes), DesignView.tsx et PerformanceView.tsx (WIP embarqué aussi validé par les 329 tests). Signalé à l'utilisateur.

## 3. Configuration minimale préconisée (audit subagent_03.md, tout sourcé)
**Palier recommandé (le « sans problème »)** : **16 Go RAM, CPU 4-6 cœurs ≥ 2,5 GHz, GPU 2 Go WebGL2 (GTX 1650 / Iris Xe), SSD 50 Go**.
- Minimale (DMX sans vue 3D, 2-3 chansons) : 8 Go RAM, 2 cœurs ≥ 2 GHz, iGPU WebGL2, SSD 10 Go.
- Confort spectacle (20+ fixtures multi-têtes, 10+ univers, 3D) : 32 Go RAM, 8 cœurs, GPU dédiée 4-8 Go, NVMe 100 Go, Ethernet dédié sACN/artnet.
**Points de vigilance chiffrés** (code) : 16 univers max (dmx/engine.ts L59-62, worker 30 fps) ; RAM audio = risque n°1 — cache audio sans purge (audio-cache.ts L16), ~63 Mo PCM décodé par chanson de 3 min + blob base64 55 Mo → 10 chansons préchargées ≈ 2 Go ; Stage3D : 1 PointLight par tête + extra-heads SANS cap, aucun fallback WebGL (driver WebGL2 obligatoire) ; disque : ~55 Mo/chanson externalisée + projets jusqu'à 72 Mo, pas de purge.

## Backlog
- Harmoniser le facteur d'offset ×0.3 entre moteur principal et chemins preview (option produit).
- Purge/LRU du cache audio + GC des blobs orphelins userData.
- Fallback/message si WebGL indisponible (Stage3D).
