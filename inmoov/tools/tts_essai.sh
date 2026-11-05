#!/bin/bash
# Essayer d'autres voix françaises hors ligne pour Kamil, sans toucher à son installation.
#
#   bash ~/domokami/inmoov/tools/tts_essai.sh kokoro    # Kokoro (≈ 5 min la 1re fois, 350 Mo)
#   bash ~/domokami/inmoov/tools/tts_essai.sh melo      # MeloTTS (≈ 20-30 min la 1re fois, 2-3 Go)
#
# Tout s'installe dans ~/tts-test (à effacer quand on veut : rm -rf ~/tts-test).
# La voix de Kamil est arrêtée pendant l'essai (le haut-parleur doit être libre), puis relancée.
# Pour chaque voix : temps de calcul affiché, puis Entrée pour l'écouter.
set -e
DIR="$HOME/tts-test"
TEXT="Bonjour ! Je suis Kamil, ton robot. J'ai une batterie pleine et une grande envie de discuter. On commence ?"
mkdir -p "$DIR" && cd "$DIR"

restart_kamil() { curl -s -X POST http://127.0.0.1:8090/api/programs/voice/start >/dev/null || true; echo; echo "Voix de Kamil relancée."; }
curl -s -X POST http://127.0.0.1:8090/api/programs/voice/stop >/dev/null || true
trap restart_kamil EXIT

case "$1" in
kokoro)
  [ -x kokoro-venv/bin/python ] || python3 -m venv kokoro-venv
  kokoro-venv/bin/pip install -q -U kokoro-onnx soundfile
  for f in kokoro-v1.0.onnx voices-v1.0.bin; do
    [ -s "$f" ] || wget -q --show-progress "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/$f"
  done
  TEXT="$TEXT" kokoro-venv/bin/python - <<'EOF'
import os, subprocess, time
import soundfile as sf
from kokoro_onnx import Kokoro
k = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")
french = [v for v in k.get_voices() if v.startswith("f")]
print("Voix françaises de Kokoro :", ", ".join(french) or "aucune trouvée, essai de ff_siwis")
for voice in french or ["ff_siwis"]:
    for speed in (1.0, 1.1):
        t = time.time()
        audio, rate = k.create(os.environ["TEXT"], voice=voice, speed=speed, lang="fr-fr")
        name = "kokoro-%s-%.1f.wav" % (voice, speed)
        sf.write(name, audio, rate)
        print("%s : %.1f s de calcul pour %.1f s de voix" % (name, time.time() - t, len(audio) / rate))
        input("  Entrée pour écouter…")
        subprocess.run(["aplay", "-q", name])
EOF
  ;;
melo)
  # MeloTTS n'est testé qu'avec Python 3.9-3.10 : un Python 3.10 à part, installé par uv
  [ -x uv-venv/bin/uv ] || { python3 -m venv uv-venv && uv-venv/bin/pip install -q uv; }
  [ -x melo-venv/bin/python ] || uv-venv/bin/uv venv --python 3.10 melo-venv
  [ -d MeloTTS ] || git clone -q https://github.com/myshell-ai/MeloTTS.git
  VIRTUAL_ENV="$DIR/melo-venv" uv-venv/bin/uv pip install -e ./MeloTTS
  melo-venv/bin/python -m unidic download
  TEXT="$TEXT" melo-venv/bin/python - <<'EOF'
import os, subprocess, time, wave
from melo.api import TTS
model = TTS(language="FR", device="cpu")
for speed in (1.0, 1.1):
    name = "melo-%.1f.wav" % speed
    t = time.time()
    model.tts_to_file(os.environ["TEXT"], model.hps.data.spk2id["FR"], name, speed=speed)
    with wave.open(name) as w:
        dur = w.getnframes() / w.getframerate()
    print("%s : %.1f s de calcul pour %.1f s de voix" % (name, time.time() - t, dur))
    input("  Entrée pour écouter…")
    subprocess.run(["aplay", "-q", name])
EOF
  ;;
*)
  echo "Usage : bash $0 kokoro   ou   bash $0 melo"
  exit 1
  ;;
esac
