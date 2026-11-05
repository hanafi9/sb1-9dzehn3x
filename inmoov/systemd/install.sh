#!/usr/bin/env bash
# Installe les services de démarrage automatique pour l'utilisateur courant.
# Les fichiers .service sont écrits pour l'utilisateur « pi » dans /home/pi/inmoov :
# ce script remplace ces chemins par ceux de votre installation avant de les copier.
#   bash systemd/install.sh            (depuis le dossier inmoov, SANS sudo)
set -euo pipefail
if [ "$(id -u)" -eq 0 ]; then
    echo "Lancez ce script sans sudo : il demandera le mot de passe quand il le faudra." >&2
    exit 1
fi
DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="$(id -un)"
for f in "$DIR"/systemd/inmoov-*.service; do
    sed -e "s#/home/pi/inmoov#$DIR#g" -e "s#/home/pi/#$HOME/#g" -e "s#^User=pi\$#User=$USER_NAME#" "$f" \
        | sudo tee "/etc/systemd/system/$(basename "$f")" > /dev/null
    echo "installé : $(basename "$f")  (utilisateur $USER_NAME, dossier $DIR)"
done
sudo systemctl daemon-reload
echo "Activer ensuite, par exemple : sudo systemctl enable --now inmoov-app"
