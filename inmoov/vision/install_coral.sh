#!/usr/bin/env bash
# Installe tout ce qu'il faut au suivi de visage avec le Coral USB, sur Raspberry Pi 5 (arm64).
#   cd ~/domokami/inmoov && bash vision/install_coral.sh        (SANS sudo)
#
# Le dépôt apt de Google pour le Coral répond « 403 Forbidden » depuis fin septembre 2026 et
# PyCoral officiel s'arrête à Python 3.9. On utilise donc les versions recompilées par la
# communauté (github.com/feranick : libedgetpu, pycoral, TFlite-builds), pour Python 3.12.
# Chaque fichier téléchargé est vérifié par son empreinte SHA-256 avant d'être installé.
set -euo pipefail
if [ "$(id -u)" -eq 0 ]; then
    echo "Lancez ce script sans sudo : il demandera le mot de passe quand il le faudra." >&2
    exit 1
fi
if [ "$(uname -m)" != "aarch64" ]; then
    echo "Ce script est prévu pour un Raspberry Pi en 64 bits (aarch64)." >&2
    exit 1
fi
DIR="$(cd "$(dirname "$0")/.." && pwd)"
DL="$DIR/.coral-telechargements"
mkdir -p "$DL"

fetch() {  # url empreinte : télécharge (si besoin) et vérifie
    local url="$1" sum="$2" f="$DL/$(basename "$1")"
    [ -f "$f" ] || wget -q --show-progress -O "$f" "$url"
    echo "$sum  $f" | sha256sum -c --quiet - || { echo "Empreinte incorrecte pour $f : fichier supprimé." >&2; rm -f "$f"; exit 1; }
}

# 1. Pilote (bibliothèque libedgetpu)
. /etc/os-release
DEB_URL="https://github.com/feranick/libedgetpu/releases/download/16.0TF2.19.1-1/libedgetpu1-std_16.0tf2.19.1-1.trixie_arm64.deb"
DEB_SUM="df9e9b16c802f4e4ad6fd8d9d0866d25eff8ddef989813f398794546d267bd11"
if dpkg -s libedgetpu1-std >/dev/null 2>&1; then
    echo "1/4 pilote libedgetpu déjà installé"
elif [ "${VERSION_CODENAME:-}" = "trixie" ]; then
    echo "1/4 installation du pilote libedgetpu"
    fetch "$DEB_URL" "$DEB_SUM"
    sudo apt-get install -y "$DL/$(basename "$DEB_URL")"
else
    echo "1/4 système « ${VERSION_CODENAME:-?} » : prendre le paquet libedgetpu1-std correspondant sur" >&2
    echo "    https://github.com/feranick/libedgetpu/releases puis relancer ce script." >&2
    exit 1
fi
# la règle d'accès (groupe plugdev) du pilote ne vaut que pour les Coral branchés après son
# installation : on l'applique tout de suite au Coral déjà branché
sudo udevadm control --reload-rules
sudo udevadm trigger --subsystem-match=usb --attr-match=idVendor=1a6e
sudo udevadm trigger --subsystem-match=usb --attr-match=idVendor=18d1
if [ -f /etc/apt/sources.list.d/coral-edgetpu.list ]; then
    echo "    retrait de l'ancien dépôt Google (403) : /etc/apt/sources.list.d/coral-edgetpu.list"
    sudo rm -f /etc/apt/sources.list.d/coral-edgetpu.list /etc/apt/keyrings/coral.gpg
fi
if ! id -nG | grep -qw plugdev; then
    sudo usermod -aG plugdev "$(id -un)"
    echo "    groupe plugdev ajouté : redémarrer le Pi à la fin (sudo reboot)"
fi

# 2. Python 3.12 (Debian 13 a Python 3.13, pour lequel PyCoral n'existe pas) via uv
if ! command -v uv >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/uv" ]; then
    echo "2/4 installation de uv (gestionnaire de versions de Python)"
    curl -LsSf https://astral.sh/uv/install.sh | sh
fi
UV="$(command -v uv || echo "$HOME/.local/bin/uv")"
echo "2/4 environnement Python 3.12 : $DIR/.venv-vision"
"$UV" venv --seed --allow-existing --python 3.12 "$DIR/.venv-vision"

# 3. Bibliothèques Python du Coral
echo "3/4 bibliothèques Python (tflite-runtime, pycoral, OpenCV)"
TFL_URL="https://github.com/feranick/TFlite-builds/releases/download/v2.17.1/tflite_runtime-2.17.1-cp312-cp312-linux_aarch64.whl"
TFL_SUM="8e544b9001d713dec0c220626ded61e25d7e60b8485e3c78c9a2ff652dbfbd00"
PYC_URL="https://github.com/feranick/pycoral/releases/download/2.0.3TF2.17.1/pycoral-2.0.3-cp312-cp312-linux_aarch64.whl"
PYC_SUM="fcc88d41627af91a4a9c08f9663d896a398a281765aed63b0e7158f4d7821aa4"
fetch "$TFL_URL" "$TFL_SUM"
fetch "$PYC_URL" "$PYC_SUM"
"$DIR/.venv-vision/bin/pip" install -q "$DL/$(basename "$TFL_URL")" "$DL/$(basename "$PYC_URL")"
"$DIR/.venv-vision/bin/pip" install -q -r "$DIR/vision/requirements.txt"

# 4. Modèle de détection de visage
MODEL="$DIR/models/ssd_mobilenet_v2_face_quant_postprocess_edgetpu.tflite"
if [ ! -f "$MODEL" ]; then
    echo "4/4 modèle de détection de visage"
    mkdir -p "$DIR/models"
    wget -q --show-progress -O "$MODEL" \
        https://raw.githubusercontent.com/google-coral/test_data/master/ssd_mobilenet_v2_face_quant_postprocess_edgetpu.tflite
else
    echo "4/4 modèle déjà présent"
fi

echo
echo "Vérification : Coral vu par PyCoral ?"
"$DIR/.venv-vision/bin/python" -c "from pycoral.utils.edgetpu import list_edge_tpus; t = list_edge_tpus(); print(t if t else 'AUCUN Coral trouvé : rebrancher le Coral (port bleu) puis relancer ce script')"
echo "Vérification : modèle chargé sur le Coral ?"
"$DIR/.venv-vision/bin/python" -c "
from pycoral.utils.edgetpu import make_interpreter
i = make_interpreter('$MODEL'); i.allocate_tensors(); print('OK : le Coral exécute le modèle')
" || echo "ÉCHEC : débrancher/rebrancher le Coral (port bleu) ; si cela persiste, voir sudo dmesg | tail -15"
