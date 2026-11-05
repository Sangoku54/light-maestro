#!/usr/bin/env python3
"""
SongCreator — Backend IA professionnel
═══════════════════════════════════════════════════════════════════════════

Pipeline de génération musicale complet (text→music + stems + voix chantées),
exécuté sur GPU via un serveur HTTP local.

Fonctionnalités :
  • /generate   text → musique            (MusicGen, ~10-60s)
  • /stems      audio → séparation       (Demucs : voix/drums/basse/autre)
  • /sing       paroles → voix chantee   (Bark)
  • /mix        musique + voix → chanson complète (et stems optionnels)
  • persistance SQLite (historique, métadonnées)
  • exports WAV / MP3 (lameenc embarqué)
  • gestion de la mémoire GPU (charge/décharge des modèles à la demande)

Démarrage :
  py -3.12 server.py --port 8765

Dépendances (Python 3.12) :
  torch (CUDA), transformers, scipy, numpy, demucs, soundfile,
  imageio-ffmpeg, lameenc, suno-bark
"""

import argparse
import base64
import io
import json
import os
import sqlite3
import sys
import threading
import time
import uuid
import wave

# Console Windows : forcer UTF-8 pour éviter les UnicodeEncodeError (cp1252)
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

try:
    from http.server import ThreadingHTTPServer
except ImportError:  # pragma: no cover
    import socketserver
    class ThreadingHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
        daemon_threads = True

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("SUNO_USE_SMALL_MODELS", "1")  # Bark small
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import numpy as np
import torch

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "songcreator.db")
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
os.makedirs(OUT_DIR, exist_ok=True)

TOKENS_PER_SECOND = 50
MAX_TOKENS = 3000

# ── Modèle de génération musicale ──
# "medium" = meilleure qualité (7,7 Go de poids, tient en fp16 sur 6 Go de VRAM)
# "small"  = qualité inférieure mais rapide
DEFAULT_MODEL = "medium"

MODELS = {
    "small": "facebook/musicgen-small",
    "medium": "facebook/musicgen-medium",
    "melody": "facebook/musicgen-melody",
}

# Paramètres de génération optimisés (sampling doux + substance musicale)
GEN_CFG = {
    "temperature": 1.0,     # créativité mesurée
    "top_k": 250,           # plafond de tokens
    "top_p": 0.92,          # nucleus sampling
    "guidance_scale": 3.0,  # adhérence au prompt (3 = bon équilibre musique/prompt)
    "do_sample": True,
}

# Structure de chanson injectée dans le prompt pour guider le modèle
STRUCTURE_HINT = "A well-structured song with an intro, verse, catchy chorus, bridge and outro"


# ═══════════════════════════════════════════════════════════════════════
# Persistance SQLite
# ═══════════════════════════════════════════════════════════════════════

class DB:
    _lock = threading.Lock()

    def __init__(self):
        self.conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS generations (
                id TEXT PRIMARY KEY,
                kind TEXT,
                text TEXT,
                duration REAL,
                wav_path TEXT,
                created_at REAL
            )
        """)
        self.conn.commit()

    def add(self, gen_id, kind, text, duration, wav_path):
        with DB._lock:
            self.conn.execute(
                "INSERT OR REPLACE INTO generations VALUES (?,?,?,?,?,?)",
                (gen_id, kind, text, duration, wav_path, time.time()),
            )
            self.conn.commit()

    def history(self, limit=50):
        with DB._lock:
            rows = self.conn.execute(
                "SELECT id, kind, text, duration, created_at FROM generations ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [{"id": r[0], "kind": r[1], "text": r[2], "duration": r[3], "created_at": r[4]} for r in rows]


# ═══════════════════════════════════════════════════════════════════════
# Gestionnaire de mémoire GPU (un modèle à la fois — 6 Go de VRAM)
# ═══════════════════════════════════════════════════════════════════════

class ModelManager:
    """Charge et décharge les modèles pour tenir dans la VRAM limitée."""

    def __init__(self):
        self._current = None          # nom du modèle chargé
        self._lock = threading.Lock() # sérialise le chargement
        self._obj = {}

    def _unload(self):
        for k in list(self._obj.keys()):
            self._obj[k] = None
        self._obj.clear()
        self._current = None
        if DEVICE == "cuda":
            torch.cuda.empty_cache()
            torch.cuda.synchronize()

    def _switch_to(self, name, loader):
        with self._lock:
            if self._current != name:
                self._unload()
                print(f"[mem] chargement du modèle `{name}` ...")
                model = loader()
                self._obj[name] = model
                self._current = name
            return self._obj[name]

    def musicgen(self, variant=None):
        from transformers import AutoProcessor, MusicgenForConditionalGeneration
        variant = variant or DEFAULT_MODEL
        repo = MODELS.get(variant, MODELS[DEFAULT_MODEL])
        def load():
            print(f"[mem] chargement MusicGen ({variant} -> {repo}) en fp16 ...")
            proc = AutoProcessor.from_pretrained(repo)
            model = MusicgenForConditionalGeneration.from_pretrained(
                repo, dtype=torch.float16
            ).to(DEVICE)
            model.eval()
            return {"proc": proc, "model": model, "repo": repo}
        return self._switch_to("musicgen:" + variant, load)

    def demucs(self):
        def load():
            from demucs.pretrained import get_model
            from demucs.apply import apply_model
            model = get_model("htdemucs")
            model.to(DEVICE)
            model.eval()
            return {"model": model, "apply": apply_model}
        return self._switch_to("demucs", load)

    def bark(self):
        def load():
            os.environ["SUNO_USE_SMALL_MODELS"] = "1"
            from bark import SAMPLE_RATE, generate_audio, preload_models
            preload_models()
            return {"SAMPLE_RATE": SAMPLE_RATE, "generate_audio": generate_audio}
        return self._switch_to("bark", load)

    def free(self):
        self._unload()

MM = ModelManager()
DBI = DB()


# ═══════════════════════════════════════════════════════════════════════
# Utilitaires audio
# ═══════════════════════════════════════════════════════════════════════

def pcm16_wav_bytes(audio, sample_rate):
    if audio.ndim == 1:
        audio = audio[None, :]  # (1, N)
    # audio: (channels, samples) float32
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(audio.shape[0])
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.T.tobytes())
    return buf.getvalue()


def encode_mp3(audio, sample_rate, bitrate=192):
    """Encode en MP3 via lameenc (embarqué)."""
    import lameenc
    audio = np.asarray(audio, dtype=np.float32)
    if audio.ndim == 1:
        audio = np.stack([audio, audio], 0)
    chans = audio.shape[0]
    enc = lameenc.Encoder()
    enc.set_bit_rate(bitrate)
    enc.set_in_sample_rate(sample_rate)
    enc.set_channels(chans)
    enc.set_quality(2)
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2")
    interleaved = pcm.T.tobytes()
    return enc.encode(interleaved) + enc.flush()


def load_audio(wav_bytes):
    """Décode WAV → np.float32 (channels, samples)."""
    import soundfile as sf
    data, sr = sf.read(io.BytesIO(wav_bytes), dtype="float32", always_2d=True)
    return data.T, sr  # (ch, n)


def ensure_stereo(audio):
    """(1,n) mono → (2,n) stéréo pour les modèles exigeant 2 canaux (Demucs)."""
    if audio.shape[0] == 1:
        return np.tile(audio, (2, 1))
    return audio


# ═══════════════════════════════════════════════════════════════════════
# Inférences (chacune gère son modèle via MM)
# ═══════════════════════════════════════════════════════════════════════

def gen_music(text, duration_sec, variant=None, seed=None):
    variant = variant or DEFAULT_MODEL
    bundle = MM.musicgen(variant)
    proc, model = bundle["proc"], bundle["model"]

    # prompt enrichi avec une structure de chanson + le texte utilisateur
    full_prompt = f"{text.strip()}. {STRUCTURE_HINT}" if text.strip() else STRUCTURE_HINT

    max_tokens = int(max(200, min(MAX_TOKENS, duration_sec * TOKENS_PER_SECOND)))

    # seed reproductible (si fourni) : rend les générations déterministes
    if seed is not None:
        torch.manual_seed(int(seed))
        if DEVICE == "cuda":
            torch.cuda.manual_seed_all(int(seed))

    inputs = proc(text=[full_prompt], padding=True, return_tensors="pt").to(DEVICE)

    with torch.no_grad():
        out = model.generate(
            **inputs,
            max_new_tokens=max_tokens,
            do_sample=GEN_CFG["do_sample"],
            temperature=GEN_CFG["temperature"],
            top_k=GEN_CFG["top_k"],
            top_p=GEN_CFG["top_p"],
            guidance_scale=GEN_CFG["guidance_scale"],
        )

    audio = out[0].cpu().numpy().astype(np.float32)  # (n,)
    peak = np.abs(audio).max() or 1.0
    if peak > 0.98:
        audio = audio * (0.9 / peak)

    # normalisation douce + fade-in/fade-out pour éviter les clics
    sr = 32000
    fade = int(0.03 * sr)
    if len(audio) > fade * 2:
        audio[:fade] *= np.linspace(0, 1, fade)
        audio[-fade:] *= np.linspace(1, 0, fade)

    n = audio.shape[0]
    return {
        "kind": "music",
        "wav": pcm16_wav_bytes(audio[None, :], sr),
        "sample_rate": sr,
        "duration": n / sr,
        "text": text,
        "model": variant,
    }


def synthesize_speech(text, voice_preset=None):
    bundle = MM.bark()
    sr = bundle["SAMPLE_RATE"]
    gen = bundle["generate_audio"]
    prompt = (voice_preset or "v2/en_speaker_6")
    # compatible avec bark>=0 et numpy 2 : aplatir chaque morceau
    with np.errstate(all="ignore"):
        pieces = gen(text, history_prompt=prompt, text_temp=0.7, waveform_temp=0.7)
    flats = []
    for p in pieces:
        a = np.asarray(p, dtype=np.float32)
        a = a.reshape(-1)
        if a.size:
            flats.append(a)
    if not flats:
        raise RuntimeError("Bark n'a produit aucun audio")
    audio = np.concatenate(flats)
    audio = audio / (np.abs(audio).max() + 1e-8) * 0.9
    return {"kind": "vocals", "wav": pcm16_wav_bytes(audio[None, :], sr),
            "sample_rate": sr, "duration": len(audio) / sr, "text": text}


def separate_stems(wav_bytes):
    """Retourne un dict {kind, wav, sample_rate, duration, stems}."""
    bundle = MM.demucs()
    model = bundle["model"]
    apply = bundle["apply"]
    audio, sr = load_audio(wav_bytes)  # (C, n) float32
    audio = ensure_stereo(audio)
    mix = torch.tensor(audio[None], device=DEVICE)  # (1, 2, n)
    mono = mix / (mix.std() + 1e-8)
    with torch.no_grad():
        sources = apply(model, mono, split=True, overlap=0.25)[0]
    stems = {}
    names = list(model.sources)
    for i, name in enumerate(names):
        # sources[i] shape (2, samples) → on garde stéréo moyen
        stem_audio = sources[i].cpu().numpy().astype(np.float32)  # (2, n)
        stems[name] = pcm16_wav_bytes(stem_audio, model.samplerate)
    import soundfile as sf
    first = list(stems.values())[0]
    info = sf.info(io.BytesIO(first))
    return {
        "kind": "stems",
        "wav": first,
        "sample_rate": model.samplerate,
        "duration": info.frames / model.samplerate,
        "stems": stems,
    }


# ═══════════════════════════════════════════════════════════════════════
# Jobs (polling)
# ═══════════════════════════════════════════════════════════════════════

_JOBS = {}
_JOBS_LOCK = threading.Lock()


def _put(job_id, **kw):
    with _JOBS_LOCK:
        _JOBS[job_id].update(kw)


def submit(kind, fn, *args):
    job_id = uuid.uuid4().hex
    with _JOBS_LOCK:
        _JOBS[job_id] = {"status": "queued", "progress": 0, "started": time.time(),
                         "kind": kind, "result": None, "error": None}
    def run():
        _put(job_id, status="processing")
        try:
            result = fn(*args)
            # persistance : sauvegarde WAV + métadonnées
            if isinstance(result, dict) and "wav" in result:
                path = os.path.join(OUT_DIR, f"{job_id}.wav")
                with open(path, "wb") as f:
                    f.write(result["wav"])
                DBI.add(job_id, kind, result.get("text", ""), result.get("duration", 0), path)
            _put(job_id, status="completed", progress=100, result=result)
        except Exception as e:
            import traceback
            traceback.print_exc()
            _put(job_id, status="error", error=str(e))
    threading.Thread(target=run, daemon=True).start()
    return job_id


# ═══════════════════════════════════════════════════════════════════════
# Serveur HTTP
# ═══════════════════════════════════════════════════════════════════════

class Handler(BaseHTTPRequestHandler):
    server_version = "SongCreatorBackend/2.0"

    def log_message(self, *a):
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Expose-Headers", "X-Duration, X-Kind, Content-Length")

    def _json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _audio(self, wav_bytes, kind, duration):
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(wav_bytes)))
        self.send_header("X-Duration", f"{duration:.2f}")
        self.send_header("X-Kind", kind)
        self.end_headers()
        self.wfile.write(wav_bytes)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        p = urlparse(self.path)
        q = parse_qs(p.query)

        if p.path == "/health":
            free = (torch.cuda.mem_get_info()[0] // (1024 * 1024)) if DEVICE == "cuda" else None
            self._json({"status": "ok", "device": DEVICE, "vram_free_mb": free,
                        "model_loaded": MM._current, "jobs_active": len(_JOBS)})
            return

        if p.path == "/history":
            self._json(DBI.history(int(q.get("limit", ["50"])[0])))
            return

        if p.path == "/job":
            job_id = q.get("id", [""])[0]
            with _JOBS_LOCK:
                job = _JOBS.get(job_id)
            if not job:
                self._json({"status": "not_found"}, 404)
                return
            with _JOBS_LOCK:
                status = job["status"]
                progress = job["progress"]
                if status == "processing":
                    elapsed = time.time() - job.get("started", time.time())
                    progress = max(progress, min(90, int(5 + elapsed * 2)))
            self._json({"id": job_id, "status": status, "progress": progress, "kind": job["kind"]})
            return

        if p.path == "/result":
            job_id = q.get("id", [""])[0]
            fmt = q.get("fmt", ["wav"])[0]
            with _JOBS_LOCK:
                job = _JOBS.get(job_id)
            if not job or job["status"] != "completed":
                self._json({"error": "not ready"}, 404)
                return
            result = job["result"]  # dict {kind, wav, sample_rate, duration, stems?}
            kind = result.get("kind", "audio")
            duration = result.get("duration", 0)
            if fmt == "mp3":
                audio, sr = load_audio(result["wav"])
                mp3 = encode_mp3(audio, sr)
                self.send_response(200)
                self._cors()
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Content-Length", str(len(mp3)))
                self.send_header("X-Duration", f"{duration:.2f}")
                self.send_header("X-Kind", kind)
                self.end_headers()
                self.wfile.write(mp3)
            else:
                self._audio(result["wav"], kind, duration)
            return

        if p.path == "/stem":
            job_id = q.get("id", [""])[0]
            stem = q.get("stem", ["vocals"])[0]
            with _JOBS_LOCK:
                job = _JOBS.get(job_id)
            if not job or job["status"] != "completed":
                self._json({"error": "not ready"}, 404)
                return
            stems = job["result"].get("stems", {})
            if stem not in stems:
                self._json({"error": "stem not found"}, 404)
                return
            data = stems[stem]
            self._audio(data, stem, job["result"].get("duration", 0))
            return

        self._json({"error": "not found"}, 404)

    def do_POST(self):
        p = urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")

        if p.path == "/generate":
            text = body.get("text", "pop song")
            duration = float(body.get("duration", 20))
            duration = max(5, min(120, duration))
            variant = body.get("variant", DEFAULT_MODEL)
            if variant not in MODELS:
                variant = DEFAULT_MODEL
            seed = body.get("seed", None)
            job_id = submit("music", gen_music, text, duration, variant, seed)
            self._json({"job_id": job_id, "status": "queued"})
            return

        if p.path == "/sing":
            text = body.get("text", "")
            voice = body.get("voice", None)
            if not text:
                self._json({"error": "text required"}, 400)
                return
            job_id = submit("vocals", synthesize_speech, text, voice)
            self._json({"job_id": job_id, "status": "queued"})
            return

        if p.path == "/stems":
            b64 = body.get("audio_b64", "")
            if not b64:
                self._json({"error": "audio_b64 required"}, 400)
                return
            wav_bytes = base64.b64decode(b64)
            job_id = submit("stems", separate_stems, wav_bytes)
            self._json({"job_id": job_id, "status": "queued"})
            return

        self._json({"error": "not found"}, 404)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-warmup", action="store_true")
    args = parser.parse_args()

    if not args.no_warmup:
        print("[backend] préchargement de MusicGen ...")
        MM.musicgen()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"[backend] SongCreator v2 à l'écoute sur http://127.0.0.1:{args.port} (device={DEVICE})")
    print("[backend] endpoints : /generate /sing /stems /job /result /stem /history /health")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[backend] arrêt.")
        server.server_close()


if __name__ == "__main__":
    main()
