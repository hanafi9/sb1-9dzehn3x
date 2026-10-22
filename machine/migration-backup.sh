#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  migration-backup.sh — Sauvegarde complète avant migration RatOS
#  Machine : VCore 3.1 · Octopus Pro 446 · EBB42 · U2C · Cartographer
#
#  Usage :  bash migration-backup.sh
#  Produit ~/backup-migration-<date>.tar.gz à copier sur ton PC.
#  Ce script ne modifie RIEN — lecture seule.
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

STAMP=$(date +%Y%m%d-%H%M%S)
WORK=$(mktemp -d)
DEST="$HOME/backup-migration-$STAMP.tar.gz"
MANIFEST="$WORK/MANIFEST.txt"

echo "── Sauvegarde de migration — $STAMP ──"

# ── 1. Vérifications préalables ─────────────────────────────────────
[ -d "$HOME/printer_data/config" ] || { echo "✗ printer_data/config introuvable"; exit 1; }

# ── 2. Manifeste : versions et état, pour référence après migration ─
{
  echo "Sauvegarde migration RatOS — $STAMP"
  echo "Hostname : $(hostname)"
  echo ""
  echo "── Versions ──"
  echo "OS      : $(grep PRETTY_NAME /etc/os-release | cut -d'"' -f2)"
  command -v git >/dev/null && {
    [ -d "$HOME/klipper/.git" ] && echo "Klipper : $(git -C "$HOME/klipper" describe --tags --always --dirty 2>/dev/null)"
    [ -d "$HOME/moonraker/.git" ] && echo "Moonraker : $(git -C "$HOME/moonraker" describe --tags --always 2>/dev/null)"
    [ -d "$HOME/cartographer-klipper/.git" ] && echo "Cartographer plugin : $(git -C "$HOME/cartographer-klipper" describe --tags --always --dirty 2>/dev/null)"
  }
  echo ""
  echo "── UUIDs CAN (depuis printer.cfg) ──"
  grep -n "canbus_uuid" "$HOME/printer_data/config/printer.cfg" || true
  echo ""
  echo "── Interface can0 ──"
  ip -details link show can0 2>/dev/null | head -5 || echo "can0 absente"
  echo ""
  echo "── Patchs Cartographer appliqués ? ──"
  grep -c 'register_command("PROBE"' "$HOME/cartographer-klipper/cartographer.py" 2>/dev/null \
    && echo "  ✓ patch casse PROBE présent" || echo "  ✗ patch casse PROBE ABSENT"
  grep -c "CLOCK_FREQ" "$HOME/cartographer-klipper/cartographer.py" 2>/dev/null \
    && echo "  ✓ patch _mcu_freq présent" || echo "  ✗ patch _mcu_freq ABSENT"
  echo ""
  echo "── Périphériques série ──"
  ls -la /dev/serial/by-id/ 2>/dev/null || echo "aucun"
} > "$MANIFEST"

cat "$MANIFEST"

# ── 3. Collecte ──────────────────────────────────────────────────────
echo ""
echo "── Collecte des fichiers ──"
COLLECT="$WORK/collect"
mkdir -p "$COLLECT"

cp -r "$HOME/printer_data/config"   "$COLLECT/config"
echo "  ✓ printer_data/config"

if [ -d "$HOME/printer_data/database" ]; then
  cp -r "$HOME/printer_data/database" "$COLLECT/database"
  echo "  ✓ printer_data/database (historique Moonraker)"
fi

mkdir -p "$COLLECT/cartographer-patched"
for f in cartographer.py idm.py; do
  [ -f "$HOME/cartographer-klipper/$f" ] && cp "$HOME/cartographer-klipper/$f" "$COLLECT/cartographer-patched/"
done
echo "  ✓ plugin Cartographer patché (cartographer.py, idm.py)"

for f in printer.cfg.bak cartographer.py.bak idm.py.bak; do
  [ -f "$HOME/$f" ] && cp "$HOME/$f" "$COLLECT/" && echo "  ✓ $f"
done

if [ -f "$HOME/klipper/.config" ]; then
  cp "$HOME/klipper/.config" "$COLLECT/klipper-menuconfig.config"
  echo "  ✓ configuration menuconfig Klipper"
fi
if [ -f "$HOME/katapult/.config" ]; then
  cp "$HOME/katapult/.config" "$COLLECT/katapult-menuconfig.config"
  echo "  ✓ configuration menuconfig Katapult"
fi

cp "$MANIFEST" "$COLLECT/"

# ── 4. Archive ───────────────────────────────────────────────────────
tar czf "$DEST" -C "$COLLECT" .
rm -rf "$WORK"

SIZE=$(du -h "$DEST" | cut -f1)
echo ""
echo "══════════════════════════════════════════════════════"
echo "✓ Sauvegarde : $DEST ($SIZE)"
echo ""
echo "COPIE-LA SUR TON PC MAINTENANT :"
echo "  scp pi@$(hostname -I | awk '{print $1}'):$DEST ."
echo ""
echo "Ne commence la migration qu'une fois la copie vérifiée."
echo "══════════════════════════════════════════════════════"
