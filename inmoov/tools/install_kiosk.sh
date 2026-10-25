#!/usr/bin/env bash
# Ouvre Kamil en plein écran (mode kiosque) sur l'écran branché au Raspberry Pi, à chaque démarrage.
#   bash tools/install_kiosk.sh            (sans sudo)
#   bash tools/install_kiosk.sh --remove   (pour ne plus le lancer)
# Bureau Wayland « labwc » de Raspberry Pi OS récent ; l'ancien bureau LXDE (X11) est aussi géré.
set -euo pipefail
PORT="${KIOSK_PORT:-8090}"
URL="http://localhost:$PORT/kiosk"
LAUNCHER="$HOME/.local/bin/kamil-kiosk"
MARK="# kamil-kiosk"

if [ "${1:-}" = "--remove" ]; then
    for f in "$HOME/.config/labwc/autostart" "$HOME/.config/lxsession/LXDE-pi/autostart"; do
        [ -f "$f" ] && sed -i "/$MARK/d" "$f" && echo "retiré de $f"
    done
    rm -f "$LAUNCHER"
    exit 0
fi

BROWSER="$(command -v chromium || command -v chromium-browser || true)"
if [ -z "$BROWSER" ]; then
    echo "Chromium introuvable : sudo apt install -y chromium" >&2
    exit 1
fi

mkdir -p "$(dirname "$LAUNCHER")"
cat > "$LAUNCHER" <<SCRIPT
#!/usr/bin/env bash
# attend que l'Atelier réponde (2 min au plus), puis ouvre Kamil en plein écran
for i in \$(seq 1 60); do curl -s -o /dev/null "$URL" && break; sleep 2; done
exec "$BROWSER" --kiosk --noerrdialogs --disable-infobars --no-first-run --password-store=basic \\
     --check-for-update-interval=31536000 --autoplay-policy=no-user-gesture-required "$URL"
SCRIPT
chmod +x "$LAUNCHER"

added=0
for f in "$HOME/.config/labwc/autostart" "$HOME/.config/lxsession/LXDE-pi/autostart"; do
    dir="$(dirname "$f")"
    if [ "$f" = "$HOME/.config/labwc/autostart" ] || [ -d "$dir" ]; then
        mkdir -p "$dir"
        touch "$f"
        sed -i "/$MARK/d" "$f"
        if [[ "$f" == *labwc* ]]; then
            echo "$LAUNCHER &  $MARK" >> "$f"
        else
            echo "@$LAUNCHER  $MARK" >> "$f"
        fi
        echo "ajouté à $f"
        added=1
    fi
done
[ "$added" = 1 ] || { echo "aucun bureau graphique trouvé" >&2; exit 1; }
echo "Kamil s'ouvrira en plein écran au prochain démarrage du bureau ($URL)."
echo "Pour l'essayer tout de suite : $LAUNCHER &"
echo "Pour sortir du plein écran : Alt+F4 ; pour ne plus le lancer : bash tools/install_kiosk.sh --remove"
