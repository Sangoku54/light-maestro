#!/usr/bin/env python3
"""All-In-One -> light-maestro (option B, offline).

Fait tourner le modele open-source `all-in-one-infer` (Kim & Nam, MIT)
sur un fichier WAV et exporte un JSON normalise `light-maestro-structure-v1`
que light-maestro sait importer (sections fonctionnelles + tempo/temps).

Usage :
    pip install all-in-one-infer
    python scripts/allinone_import.py song.wav -o struct/song.structure.json
    python scripts/allinone_import.py song.wav --model harmonix-fold0 --device cpu

Le script n'inclut AUCUN code du modele : il appelle juste son API publique
`analyze()` et reformate la sortie. Les poids restent telecharges et caches
par le package lui-meme (HuggingFace), jamais vendores ici.
"""

import argparse
import json
import sys
from pathlib import Path


def parse_args(argv=None):
    p = argparse.ArgumentParser(
        description="All-In-One music structure -> light-maestro JSON (offline)."
    )
    p.add_argument("audio", help="Fichier audio (WAV recommande, cf. doc all-in-one).")
    p.add_argument("-o", "--out", default=None,
                   help="Fichier JSON de sortie (defaut: <audio>.structure.json).")
    p.add_argument("--model", default="harmonix-all",
                   help="Modele all-in-one (defaut: harmonix-all).")
    p.add_argument("--device", default=None,
                   help="Device torch (defaut: auto, ex. cpu, cuda).")
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    audio = Path(args.audio)
    if not audio.is_file():
        print(f"ERREUR: fichier introuvable: {audio}", file=sys.stderr)
        return 2

    try:
        from allin1_infer import analyze
    except ImportError:
        print(
            "ERREUR: package 'all-in-one-infer' manquant.\n"
            "Installe-le d'abord : pip install all-in-one-infer",
            file=sys.stderr,
        )
        return 3

    kwargs = {"model": args.model}
    if args.device:
        kwargs["device"] = args.device
    result = analyze(str(audio), **kwargs)

    segments = [
        {"start": float(s.start), "end": float(s.end), "label": str(s.label)}
        for s in (result.segments or [])
    ]
    beats = [float(b) for b in (result.beats or [])]
    downbeats = [float(b) for b in (result.downbeats or [])]
    beat_positions = [int(b) for b in (result.beat_positions or [])]
    duration = max([s["end"] for s in segments], default=0.0)

    out = {
        "format": "light-maestro-structure-v1",
        "source": {"tool": "all-in-one-infer", "model": args.model},
        "audio": audio.name,
        "duration": duration,
        "bpm": float(result.bpm) if result.bpm is not None else None,
        "beats": beats,
        "beat_positions": beat_positions,
        "downbeats": downbeats,
        "segments": segments,
    }

    out_path = Path(args.out) if args.out else audio.with_suffix(".structure.json")
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")

    labels = sorted({s["label"] for s in segments})
    print(f"OK: {out_path} ({len(segments)} segments, bpm={out['bpm']}, labels={labels})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
