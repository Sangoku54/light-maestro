# SongCreator — Studio de génération musicale IA (niveau professionnel)

Application complète de création musicale par IA, reproduisant l'architecture
technologique de Suno/Udio avec de **vrais modèles open-source** exécutés en
local sur GPU.

## Pipeline IA (3 modèles réels)

| Fonction | Modèle | Description |
|---|---|---|
| 🎵 Génération musique | **MusicGen-medium** (`facebook/musicgen-medium`, 1,5 G params) | Text → musique haute qualité. Encodeur texte + décodeur autoregressif → codec audio (32 kHz). *Variantes select : medium / melody / small* |
| 🎤 Voix chantée | **Bark** (`suno/bark`) | Paroles → voix chantée/parlée réaliste (modèles en français/anglais) |
| 🎚 Séparation de stems | **Demucs** (`htdemucs`) | Sépare voix / batterie / basse / autre (44,1 kHz stéréo) |

### Paramètres de génération optimisés
- `temperature=1.0`, `top_k=250`, `top_p=0.92`, `guidance_scale=3.0`
- `seed` reproductible (optionnel)
- Structure de chanson injectée (`intro / verse / chorus / bridge / outro`)
- Fade-in/out pour supprimer les clics

Le backend bascule automatiquement entre les 3 modèles en gérant la mémoire
GPU (un modèle chargé à la fois — compatible GPU 6 Go comme la RTX 4050).

## Architecture

```
frontend (statique)                    backend (Python 3.12 + CUDA)
├─ index.html   shell Suno             server.py
├─ style.css    design dark/neon       ├─ /generate → MusicGen
├─ engine.js    moteur procédural      ├─ /sing     → Bark
└─ script.js    logique + bridge       ├─ /stems    → Demucs
                    │                  ├─ /job, /result, /stem (polling)
                    └── HTTP ──────────└─ SQLite (historique)
                                          outputs/ (WAV sauvés)
```

## Installation (une seule fois)

```bash
# Python 3.12 requis (avec CUDA)
py -3.12 -m pip install torch torchaudio torchvision --index-url https://download.pytorch.org/whl/cu124
py -3.12 -m pip install transformers scipy numpy soundfile demucs imageio-ffmpeg
py -3.12 -m pip install git+https://github.com/suno-ai/bark.git
```

> **Note torch** : il faut torch ≥ 2.6 (index `cu124`) pour charger MusicGen
> (restriction de sécurité transformers CVE-2025-32434). L'index `cu121`
> s'arrête à torch 2.5.1.

## Lancement

```bash
launch_backend.bat        # démarre le backend IA (télécharge les modèles au 1er run)
```

Puis ouvrir `index.html`. Le bandeau affiche **« Moteur : IA (GPU CUDA) »**
quand le backend est détecté, sinon bascule sur le moteur procédural.

### Téléchargements au premier lancement
- MusicGen-medium : ~7,7 Go (qualité haute)
- MusicGen-small : ~2,3 Go (rapide, qualité inférieure)
- HTDemucs : ~160 Mo
- Bark (small) : ~500 Mo

## Fonctionnalités

### Création
- Mode Chanson / Mode ReMi
- Mode personnalisé : titre, paroles (metatags `[Intro][Verse][Chorus]…`),
  style, styles exclus, personas, modèle, durée
- Outils : paroles, **voix chantée (Bark)**, instrumental, upload, **séparation (Demucs)**

### Morceau
- Lecture, like, **remasteriser**, **prolonger**, **reprendre (voix Bark)**,
  **séparer en stems (Demucs)**, téléchargement **WAV / MP3**, persona, playlists

### Lecteur global
File d'attente, précédent/suivant, aléatoire, répétition, seek, volume

### Système
- Crédits quotidiens (150/jour), persistance `localStorage`
- Historique SQLite côté backend
- Auth simulée (Google prérremplit `sangoku54@gmail.com`)

## API backend

```
GET  /health              état + VRAM
POST /generate {text,duration}   → {job_id}
POST /sing     {text,voice}      → {job_id}
POST /stems    {audio_b64}       → {job_id}
GET  /job?id=           statut + progression (polling)
GET  /result?id=&fmt=wav|mp3  audio final
GET  /stem?id=&stem=vocals|drums|bass|other
GET  /history?limit=
```

## Limites connues
- MusicGen-small produit de la musique principalement instrumentale; les voix
  sont fournies par Bark (séparément, ou combinées).
- La génération de voix Bark est plus lente (~12 s pour quelques phrases en
  small models) et occupe la VRAM → le backend recharge le modèle demandé.
