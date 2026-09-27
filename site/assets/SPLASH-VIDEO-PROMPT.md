# Light Maestro — Prompt vidéo splash hyper-réaliste

> Objectif : remplacer `site/assets/splash.mp4` (actuellement simulé en CSS/Canvas) par une **vidéo hyper-réaliste 6–7s, 1920×1080, 24fps, H.264, muette, loop clean**, qui matche pixel-perfect le scénario du splash.

## Scénario (storyboard 6.2s)

**0.0–1.0s — Noir + haze**
- Salle de concert vide, noir complet, légère brume / haze qui accroche
- On devine un truss au lointain, foule en silhouette en bas
- Caméra : très léger push-in, 2% de zoom

**1.0–2.2s — Révélation**
- 7 lyres sur pont avant s'allument d'un coup — faisceaux volumétriques blancs qui percent la brume
- Sweep synchronisé : -26° → +26° en 1.2s, spots au sol qui glissent
- Couleur : blanc → lavande → cyan (palette Light Maestro)

**2.2–4.5s — Montée**
- Mouvements en cercle / 8, alternance warm / party, strob bref sur le drop (1 flash, limiter visible)
- Haze dense, particules, lens flare subtil
- **À 2.8s** : un **laptop au premier plan (bas-droite, 38% de l'image, perspective 3/4)** s'allume — son écran affiche la **vue 3D Light Maestro** qui joue **exactement les mêmes faisceaux, mêmes angles, mêmes couleurs, même timing** que la scène réelle (sync 1:1 prouvée)
- L'écran porte le header Light Maestro (3 dots + “3D Stage • 128 BPM • Live” + badge Live vert)

**4.5–6.2s — Reveal marque**
- Titre qui s'affiche au centre : “La scène s'allume. **Light Maestro** la pilote.” + badge “Live • Scène réelle ⇄ Vue 3D — sync temps réel”
- Boutons “Entrer dans Light Maestro →” + “Passer l'intro”
- Barre de progression fine en bas du laptop (6.2s)

## Prompt prêt à coller (Runway Gen-3 / Luma Dream Machine / Sora / Pika)

```
Photorealistic interior of a dark concert venue, large stage with 7 moving head lights on a front truss, volumetric light beams cutting through dense haze, light beams are crisp and physically accurate, floor light spots sliding in sync, crowd silhouettes at bottom, cinematic 35mm, shallow depth of field, subtle lens flare, ultra-detailed, 8k -- In the foreground bottom-right, a modern laptop viewed in 3/4 perspective (38% of frame) displays a dark 3D stage preview with the exact same 7 light beams, same pan/tilt angles, same colors and timing as the real stage behind it, perfect synchronization, dark UI with top bar and Live badge, photorealistic product shot -- Lighting: white to lavender to cyan gradient, warm party palette, dramatic concert lighting, high contrast, volumetric fog -- Camera: slow push-in, 24fps, no shake, loopable -- Style: hyper-realistic, not CGI look, not illustration, commercial grade -- No text, no watermark, no people faces in focus
```

**Negative prompt (si l'outil le permet) :**
```
cartoon, anime, illustration, low quality, blurry, distorted beams, extra fingers, text, watermark, logo, overexposed
```

## Spécifications fichier

- **Chemin** : `site/assets/splash.mp4` (le splash détecte auto sa présence et passe en mode vidéo)
- **Poster** : `site/assets/splash-poster.jpg` (frame à 2.5s, 1920×1080, JPG 80%)
- **Codec** : H.264, yuv420p, ~8–12 Mbps, audio **aucun** (muted)
- **Durée** : 6–7s, loop clean (frame 0 ≈ frame fin, haze identique)
- **Poids** : < 6 Mo

## Alternative rapide sans tournage

Si tu n'as pas encore la vidéo, le splash actuel **simule déjà** la scène en CSS/Canvas synchro (7 beams + spots + mini vue 3D, même algo). Il suffit de déposer `splash.mp4` pour basculer en hyper-réaliste — aucun code à changer.
