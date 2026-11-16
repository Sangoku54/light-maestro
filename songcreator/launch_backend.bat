@echo off
rem ============================================================
rem  SongCreator - Backend IA complet (MusicGen + Demucs + Bark)
rem  Requiert Python 3.12 avec torch CUDA
rem ============================================================
set PY=py -3.12

echo Verification de l'environnement Python 3.12...
%PY% -c "import torch, transformers, scipy, demucs, soundfile, lameenc" 2>nul
if errorlevel 1 (
    echo.
    echo [!] Dependances manquantes. Installation en cours...
    echo     (cette etape peut prendre plusieurs minutes)
    %PY% -m pip install torch torchaudio torchvision --index-url https://download.pytorch.org/whl/cu124
    %PY% -m pip install transformers scipy numpy soundfile demucs imageio-ffmpeg
    %PY% -m pip install git+https://github.com/suno-ai/bark.git
    echo.
)

echo.
echo Demarrage du backend IA SongCreator (http://127.0.0.1:8765) ...
echo.
echo   - MusicGen medium (musique) : premier chargement ~7.7 Go
echo   - Demucs   (stems)          : premier chargement ~160 Mo
echo   - Bark     (voix)           : premier chargement ~500 Mo
echo.
%PY% server.py --port 8765
pause
