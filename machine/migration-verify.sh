#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  migration-verify.sh — Contrôle post-migration RatOS
#  À lancer sur la NOUVELLE installation après restauration.
#
#  Usage :  bash migration-verify.sh
#  Vérifie chaque point critique et sort en erreur si un seul échoue.
#  Ce script ne modifie RIEN — lecture seule.
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail

# UUIDs de CETTE machine (vérifiés le 13/08/2026)
UUID_EBB42="564fed93e397"
UUID_CARTO="4973681e12df"
CAN_BITRATE="1000000"
CFG="$HOME/printer_data/config/printer.cfg"

PASS=0; FAIL=0; WARN=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
ko()   { echo "  ✗ $1"; FAIL=$((FAIL+1)); }
warn() { echo "  ⚠ $1"; WARN=$((WARN+1)); }

echo "══ Contrôle post-migration — $(date '+%F %T') ══"

echo ""
echo "── 1. Interface CAN ──"
if ip link show can0 &>/dev/null; then
  ip link show can0 | grep -q "UP" && ok "can0 active" || ko "can0 présente mais DOWN"
  BR=$(ip -details link show can0 2>/dev/null | grep -oP 'bitrate \K[0-9]+' || echo "0")
  [ "$BR" = "$CAN_BITRATE" ] && ok "bitrate $BR" || ko "bitrate $BR ≠ $CAN_BITRATE attendu"
else
  ko "interface can0 absente — U2C branché ? /etc/network.d configuré ?"
fi

echo ""
echo "── 2. Services ──"
for svc in klipper moonraker; do
  systemctl is-active --quiet "$svc" && ok "service $svc actif" || ko "service $svc inactif"
done

echo ""
echo "── 3. printer.cfg ──"
if [ -f "$CFG" ]; then
  ok "printer.cfg présent"
  grep -q "canbus_uuid: *$UUID_EBB42" "$CFG" \
    && ok "UUID EBB42 ($UUID_EBB42) présent" || ko "UUID EBB42 absent ou incorrect"
  grep -q "canbus_uuid: *$UUID_CARTO" "$CFG" \
    && ok "UUID Cartographer ($UUID_CARTO) présent" || ko "UUID Cartographer absent ou incorrect"
  # La permutation classique : chaque UUID doit être dans la BONNE section
  TOOLHEAD_UUID=$(awk '/^\[mcu toolhead\]/{f=1} f&&/canbus_uuid/{print $2; exit}' "$CFG")
  [ "$TOOLHEAD_UUID" = "$UUID_EBB42" ] \
    && ok "[mcu toolhead] → EBB42 (pas de permutation)" \
    || ko "[mcu toolhead] a l'UUID '$TOOLHEAD_UUID' — PERMUTATION PROBABLE"
  grep -qE "^\[mcu u2c\]" "$CFG" \
    && ko "[mcu u2c] actif — à commenter (le U2C n'est pas un MCU)" \
    || ok "pas de [mcu u2c] actif"
  grep -q "sensor_type: *PT1000" "$CFG" \
    && ok "thermistance PT1000 (Rapido)" \
    || warn "sensor_type PT1000 introuvable — vérifier [extruder] (Rapido = PT1000)"
  grep -q "^\[include mainsail.cfg\]" "$CFG" \
    && ok "mainsail.cfg inclus" || warn "mainsail.cfg non inclus (pause/resume absents)"
else
  ko "printer.cfg introuvable"
fi

echo ""
echo "── 4. Patchs du plugin Cartographer ──"
CP="$HOME/cartographer-klipper/cartographer.py"
if [ -f "$CP" ]; then
  grep -q 'register_command("PROBE"' "$CP" \
    && ok "patch casse PROBE appliqué" \
    || ko "patch casse PROBE MANQUANT → erreur \"Can't register 'probe'\" au démarrage"
  grep -q "get_constant_float('CLOCK_FREQ')" "$CP" \
    && ok "patch _mcu_freq appliqué" \
    || ko "patch _mcu_freq MANQUANT → AttributeError au connect"
  grep -q 'register_command("probe"' "$CP" \
    && ko "un register_command(\"probe\") minuscule subsiste" || true
else
  ko "plugin cartographer-klipper introuvable"
fi

echo ""
echo "── 5. Cohérence firmware hôte / MCU (si Klipper tourne) ──"
if command -v curl >/dev/null && curl -s --max-time 3 localhost:7125/printer/info &>/dev/null; then
  STATE=$(curl -s localhost:7125/printer/info | grep -oP '"state": *"\K[^"]+' || echo "?")
  [ "$STATE" = "ready" ] && ok "Klipper ready" || warn "Klipper en état '$STATE'"
  VERS=$(curl -s "localhost:7125/printer/objects/query?mcu&mcu%20toolhead&mcu%20cartographer" 2>/dev/null | grep -oP '"mcu_version": *"\K[^"]+' | sort -u)
  if [ -n "$VERS" ]; then
    N=$(echo "$VERS" | grep -c "^" )
    echo "    versions MCU détectées :"
    echo "$VERS" | sed 's/^/      /'
    HOST=$(curl -s localhost:7125/printer/info | grep -oP '"software_version": *"\K[^"]+' || echo "?")
    echo "    version hôte : $HOST"
    warn "vérifier manuellement que chaque MCU ≈ version hôte (sinon reflasher)"
  fi
else
  warn "Moonraker injoignable — relancer ce script quand Klipper tourne"
fi

echo ""
echo "══════════════════════════════════════════════════════"
echo "Résultat : $PASS OK · $WARN avertissements · $FAIL échecs"
if [ "$FAIL" -gt 0 ]; then
  echo "✗ NE PAS IMPRIMER — corriger les échecs ci-dessus d'abord."
  exit 1
fi
echo "✓ Contrôles passés. Prochaine étape : G28 puis PROBE_ACCURACY SAMPLES=10."
