import { useState } from 'react';
import { Copy, Check, Download, FileCode, FolderDown, Info } from 'lucide-react';
import type { PrinterConfig } from '../App';

// ═══════════════════════════════════════════════════════════════════════════
//  Générateur multi-fichiers — inspiré de la config d'un VCore 3 300,
//  adapté à cette machine (taille, Rapido, Cartographer CAN, LED/COB réels).
//  Chaque fichier est paramétré depuis la config de l'app.
// ═══════════════════════════════════════════════════════════════════════════

interface Props {
  config: PrinterConfig;
}

interface CfgFile {
  name: string;
  desc: string;
  hint?: string;
  generate: (c: PrinterConfig) => string;
}

// ── Macro.cfg ───────────────────────────────────────────────────────────────

function genMacros(c: PrinterConfig): string {
  const hasLeds = c.hasNeopixel || c.hasCOBLed;
  const ledOn = hasLeds ? '    LED_TRAVAIL' : '    # (pas de LED configurée)';
  const ledChauffe = hasLeds ? '    LED_CHAUFFE' : '';
  const ledScan = hasLeds ? '    LED_SCAN' : '';
  const ledDim = hasLeds ? '    LED_TERMINE' : '';
  const half = Math.round(c.printerSize / 2);
  const soak = c.hasChamberSensor;

  return `#############################################################################################################
### MACROS D'IMPRESSION — VCore 3.1 ${c.printerSize}×${c.printerSize}
### Adaptées d'une config VCore 3. Heat-soak par temporisation${soak ? ' + brassage caisson' : ''}.
#############################################################################################################

[gcode_macro START_PRINT]
gcode:
    {% set BED = params.BED_TEMP|default(60)|float %}
    {% set HOTEND = params.EXTRUDER_TEMP|default(220)|float %}
    CLEAR_PAUSE
    G90
    M83
${ledScan ? ledScan + '\n' : ''}    M117 Chauffe plateau {BED|int}C...
    M104 S150                        # préchauffe buse anti-ooze
    M140 S{BED}
${hasLeds ? ledChauffe + '\n' : ''}    M190 S{BED}
    # Heat-soak selon le filament
    {% if BED >= 100 %}
        M117 Soak 8 min (ABS/ASA)...
${c.hasChamberFan ? '        CHAMBER_FAN_OFF\n' : ''}        G4 P480000
    {% elif BED >= 70 %}
        M117 Soak 4 min (PETG)...
        G4 P240000
    {% else %}
        M117 Soak 2 min (PLA)...
        G4 P120000
    {% endif %}
${ledScan ? ledScan + '\n' : ''}    M117 Homing...
    G28
    M117 Nivellement Z-Tilt...
    Z_TILT_ADJUST
    G28 Z
    M117 Maillage adaptatif...
    BED_MESH_CLEAR
    BED_MESH_CALIBRATE ADAPTIVE=1
    PARK_HOTEND
${hasLeds ? ledChauffe + '\n' : ''}    M117 Chauffe buse {HOTEND|int}C...
    M109 S{HOTEND}
${ledOn}
    M117 Purge...
    PRIME_LINE
    # Capteur de filament : activé une fois le filament chargé (si présent)
    {% if printer['filament_motion_sensor SFS'] is defined %}
        SET_FILAMENT_SENSOR SENSOR=SFS ENABLE=1
    {% endif %}
    M117 Impression...

[gcode_macro END_PRINT]
gcode:
    M400
    {% if printer['filament_motion_sensor SFS'] is defined %}
        SET_FILAMENT_SENSOR SENSOR=SFS ENABLE=0
    {% endif %}
    M140 S0
    M104 S0
    M106 S0
${c.hasChamberFan ? '    CHAMBER_FAN_ON SPEED=0.4          # filtration douce en fin\n' : ''}    G91
    G1 E-2 F1800
    G1 Z10 F3000
    G90
    PARK_HOTEND
${ledDim ? ledDim + '\n' : ''}    M117 Impression terminée
    M84

[gcode_macro PARK_HOTEND]
description: Dégage la tête en hauteur puis centre-arrière
gcode:
    {% if "xyz" not in printer.toolhead.homed_axes %}
        G28
    {% endif %}
    {% set max_x = printer.toolhead.axis_maximum.x|float %}
    {% set max_y = printer.toolhead.axis_maximum.y|float %}
    {% set max_z = printer.toolhead.axis_maximum.z|float %}
    {% set act_z = printer.toolhead.position.z|float %}
    {% set z_final = [[act_z + 20, 50]|max, max_z]|min %}
    G90
    G1 Z{z_final} F3000
    G1 X{max_x / 2} Y{max_y - 5} F6000

[gcode_macro PRIME_LINE]
description: Ligne de purge sur le bord avant du PEI
gcode:
    SAVE_GCODE_STATE NAME=prime_line
    G90
    M83
    G1 Z5 F600
    G1 X40 Y45 F6000
    G1 Z0.3 F600
    G92 E0
    G1 X${half + 40} Y45 E15 F1200
    G1 Z2 F600
    RESTORE_GCODE_STATE NAME=prime_line
`;
}

// ── macros-utiles.cfg (confort quotidien : filament, préchauffe, tests) ──────

function genUtilityMacros(c: PrinterConfig): string {
  const hasLeds = c.hasNeopixel || c.hasCOBLed;
  const half = Math.round(c.printerSize / 2);
  const back = c.printerSize - 5;
  const hasSFS = true; // le capteur SFS est géré dans filament-sensor.cfg
  const sfsOff = hasSFS
    ? "    {% if printer['filament_motion_sensor SFS'] is defined %}\n        SET_FILAMENT_SENSOR SENSOR=SFS ENABLE=0\n    {% endif %}\n"
    : '';
  const sfsOn = hasSFS
    ? "    {% if printer['filament_motion_sensor SFS'] is defined %}\n        SET_FILAMENT_SENSOR SENSOR=SFS ENABLE=1\n    {% endif %}\n"
    : '';

  return `#############################################################################################################
### MACROS UTILES — confort au quotidien (VCore 3.1 ${c.printerSize}×${c.printerSize})
### Filament, préchauffage, parking, tests. Centre plateau calculé : X${half} Y${half}.
###
### Include : ajoute [include macros-utiles.cfg] en haut de printer.cfg.
### ⚠️ Retire de printer.cfg toute macro du même nom pour éviter les doublons.
#############################################################################################################

# ── Filament ────────────────────────────────────────────────────────────────
[gcode_macro LOAD_FILAMENT]
description: Charge et purge le filament (chauffe si besoin)
gcode:
    {% set T = params.TEMP|default(220)|int %}
${sfsOff}    {% if printer.extruder.temperature < T - 5 %}
        M117 Chauffe buse {T}C...
        M109 S{T}
    {% endif %}
    M83
    G1 E60 F300                      # amène le filament jusqu'au hotend
    G1 E40 F150                      # purge lente
    M82
    M117 Filament chargé
${sfsOn}
[gcode_macro UNLOAD_FILAMENT]
description: Rétracte et retire le filament (chauffe si besoin)
gcode:
    {% set T = params.TEMP|default(220)|int %}
${sfsOff}    {% if printer.extruder.temperature < T - 5 %}
        M117 Chauffe buse {T}C...
        M109 S{T}
    {% endif %}
    M83
    G1 E10 F300                      # petite poussée (décolle le bouchon)
    G1 E-60 F1000                    # retire le filament
    M82
    M117 Filament retiré

[gcode_macro M600]
description: Changement de filament (parking + rétraction)
gcode:
    {% set X = ${half} %}
    {% set Y = 20 %}
    {% set Z = 20 %}
    SAVE_GCODE_STATE NAME=M600
    PAUSE
    G91
    G1 E-2 F1000
    {% set z_lift = [printer.toolhead.position.z + Z, printer.toolhead.axis_maximum.z]|min %}
    G90
    G1 Z{z_lift} F900
    G1 X{X} Y{Y} F6000
    M117 Change le filament puis RESUME
    RESTORE_GCODE_STATE NAME=M600

# ── Préchauffage rapide (boutons Mainsail) ──────────────────────────────────
[gcode_macro PREHEAT_PLA]
description: Lit 60 / buse 210
gcode:
${hasLeds ? '    LED_CHAUFFE\n' : ''}    SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=60
    SET_HEATER_TEMPERATURE HEATER=extruder TARGET=210

[gcode_macro PREHEAT_PETG]
description: Lit 80 / buse 240
gcode:
${hasLeds ? '    LED_CHAUFFE\n' : ''}    SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=80
    SET_HEATER_TEMPERATURE HEATER=extruder TARGET=240

[gcode_macro PREHEAT_ABS]
description: Lit 100 / buse 245
gcode:
${hasLeds ? '    LED_CHAUFFE\n' : ''}    SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=100
    SET_HEATER_TEMPERATURE HEATER=extruder TARGET=245

[gcode_macro COOLDOWN]
description: Coupe tous les chauffages et ventilos
gcode:
    TURN_OFF_HEATERS
    M107
${hasLeds ? '    LED_TERMINE\n' : ''}    M117 Refroidissement

# ── Parking / positionnement ────────────────────────────────────────────────
[gcode_macro PARK_CENTER]
description: Monte de 20mm et centre la tête
gcode:
    {% if "xyz" not in printer.toolhead.homed_axes %}
        G28
    {% endif %}
    {% set z = [printer.toolhead.position.z + 20, printer.toolhead.axis_maximum.z]|min %}
    G90
    G1 Z{z} F1500
    G1 X${half} Y${half} F6000

[gcode_macro FRONT]
description: Amène la tête devant (maintenance)
gcode:
    {% if "xyz" not in printer.toolhead.homed_axes %}
        G28
    {% endif %}
    G90
    G1 Z50 F1500
    G1 X${half} Y15 F6000

[gcode_macro BED_BACK]
description: Avance le plateau tout au fond (accès tête)
gcode:
    {% if "xyz" not in printer.toolhead.homed_axes %}
        G28
    {% endif %}
    G90
    G1 Z100 F1500
    G1 X${half} Y${back} F6000

# ── Tests ───────────────────────────────────────────────────────────────────
[gcode_macro TEST_SPEED]
description: Teste vitesse/accel en diagonale (défaut 300mm/s)
gcode:
    {% set speed = params.SPEED|default(300)|int %}
    {% set iterations = params.ITERATIONS|default(5)|int %}
    {% set mn = 30 %}
    {% set mx_x = printer.toolhead.axis_maximum.x - 30 %}
    {% set mx_y = printer.toolhead.axis_maximum.y - 30 %}
    G28
    G90
    {% for i in range(iterations) %}
        G1 X{mn} Y{mn} F{speed*60}
        G1 X{mx_x} Y{mx_y} F{speed*60}
        G1 X{mn} Y{mx_y} F{speed*60}
        G1 X{mx_x} Y{mn} F{speed*60}
    {% endfor %}
    G28
    M117 Test vitesse {speed}mm/s OK

[gcode_macro CALIBRATION_CUBE_PREP]
description: Home + Z-Tilt + mesh, prêt à imprimer
gcode:
    G28
    Z_TILT_ADJUST
    G28 Z
    BED_MESH_CLEAR
    BED_MESH_CALIBRATE
    PARK_CENTER
    M117 Prêt à imprimer
`;
}

// ── resonance-macros.cfg (accéléromètre + input shaper) ─────────────────────

function genResonance(c: PrinterConfig): string {
  const half = Math.round(c.printerSize / 2);
  return `#############################################################################################################
### ACCÉLÉROMÈTRE & COMPENSATION DE RÉSONANCE (Input Shaper)
###
### ⚠️ PRÉREQUIS dans printer.cfg (une seule fois) :
###   [adxl345]                     # ou lis2dw selon ta puce (Cartographer = souvent lis2dw)
###   cs_pin: ...                   # laisse la config existante de ton accéléromètre
###
###   [resonance_tester]
###   accel_chip: adxl345           # doit correspondre au nom de la puce ci-dessus
###   probe_points:
###       ${half}, ${half}, 20        # centre du plateau ${c.printerSize}×${c.printerSize}
###
### ⚠️ Côté logiciel (une fois, en SSH) : sudo apt install python3-numpy python3-matplotlib
###   pour générer les graphiques de résonance.
#############################################################################################################

# ── Vérifier que l'accéléromètre répond ─────────────────────────────────────
[gcode_macro ACCEL_TEST]
description: Lit l'accéléromètre (doit renvoyer x/y/z ~ 0,0,9800)
gcode:
    ACCELEROMETER_QUERY

[gcode_macro ACCEL_NOISE]
description: Mesure le bruit de fond de l'accéléromètre (moteurs à l'arrêt)
gcode:
    MEASURE_AXES_NOISE

# ── Mesure des résonances (génère des .png dans ~/printer_data/config) ───────
[gcode_macro RESONANCE_X]
description: Test résonances axe X
gcode:
    {% if "xyz" not in printer.toolhead.homed_axes %}
        G28
    {% endif %}
    G90
    G1 X${half} Y${half} Z20 F6000
    TEST_RESONANCES AXIS=X
    M117 Résonances X : voir ~/printer_data/config/resonances_x_*.csv

[gcode_macro RESONANCE_Y]
description: Test résonances axe Y
gcode:
    {% if "xyz" not in printer.toolhead.homed_axes %}
        G28
    {% endif %}
    G90
    G1 X${half} Y${half} Z20 F6000
    TEST_RESONANCES AXIS=Y
    M117 Résonances Y : voir ~/printer_data/config/resonances_y_*.csv

# ── Calibration automatique de l'input shaper (le plus simple) ──────────────
[gcode_macro CALIBRATE_SHAPER]
description: Auto-calibre l'input shaper X+Y puis sauvegarde
gcode:
    {% if "xyz" not in printer.toolhead.homed_axes %}
        G28
    {% endif %}
    G90
    G1 X${half} Y${half} Z20 F6000
    M117 Calibration input shaper...
    SHAPER_CALIBRATE
    M117 Fait — SAVE_CONFIG pour enregistrer
    # Décommente la ligne suivante pour sauvegarder+redémarrer automatiquement :
    # SAVE_CONFIG

#############################################################################################################
### MODE D'EMPLOI
### 1. ACCEL_TEST  → doit renvoyer des valeurs (z ~ 9800 = gravité). Si erreur → câblage/config accéléromètre.
### 2. ACCEL_NOISE → bruit doit être faible (< ~50). Sinon, ventilo ou fixation à revoir.
### 3. CALIBRATE_SHAPER → mesure X et Y, propose les filtres (ex: mzv, ei). Puis SAVE_CONFIG.
###    Klipper écrit alors un bloc [input_shaper] avec shaper_type_x/y et shaper_freq_x/y.
#############################################################################################################
`;
}

// ── orcaslicer.cfg (G-code machine à coller dans OrcaSlicer) ─────────────────

function genOrcaSlicer(c: PrinterConfig): string {
  const half = Math.round(c.printerSize / 2);
  return `#############################################################################################################
### ORCASLICER — G-code machine à coller dans le SLICER (pas un vrai .cfg Klipper)
###
### Ce fichier est une AIDE : copie les blocs ci-dessous dans OrcaSlicer.
### Il s'appuie sur START_PRINT / END_PRINT déjà définis dans Macro.cfg
### (qui acceptent BED_TEMP et EXTRUDER_TEMP).
###
### OrcaSlicer → Réglages imprimante → Machine G-code
#############################################################################################################

### ─────────────── « G-code de démarrage machine » ───────────────
### (Machine start G-code) — colle EXACTEMENT ceci :
###
### START_PRINT EXTRUDER_TEMP=[nozzle_temperature_initial_layer] BED_TEMP=[bed_temperature_initial_layer_single]
###
### ⚠️ Laisse OrcaSlicer gérer les températures via START_PRINT.
###    Dans Orca : Réglages filament → décoche « Émettre les commandes de température »
###    n'est PAS nécessaire — START_PRINT chauffe déjà. Mais NE mets PAS de M109/M190
###    en double dans le start gcode.

### ─────────────── « G-code de fin machine » ───────────────
### (Machine end G-code) — colle ceci :
###
### END_PRINT

### ─────────────── Réglages Orca importants pour cette VCore ${c.printerSize}×${c.printerSize} ───────────────
### • Volume d'impression : ${c.printerSize} × ${c.printerSize} × (ta hauteur Z)
### • Origine G-code : coin avant-gauche (0,0)
### • Décalage sonde / palpeur : géré par Klipper (Cartographer), rien à mettre côté Orca
### • Vitesse de déplacement max : cohérente avec printer.cfg (max_velocity)
### • « Rétraction lors des déplacements » : selon ton hotend (Rapido : ~0.5-1 mm)

#############################################################################################################
### Variante avancée (si tu veux passer plus d'infos à START_PRINT depuis Orca) :
###
### START_PRINT EXTRUDER_TEMP=[nozzle_temperature_initial_layer] BED_TEMP=[bed_temperature_initial_layer_single] CHAMBER=[chamber_temperature] MATERIAL=[filament_type]
###
### … à condition d'étendre START_PRINT dans Macro.cfg pour lire CHAMBER / MATERIAL.
### Le START_PRINT actuel gère déjà le heat-soak selon BED_TEMP (PLA/PETG/ABS auto).
###
### Position de purge : PRIME_LINE trace la ligne à X40 Y45 (bord avant du PEI).
### Centre plateau (utile pour l'aperçu) : X${half} Y${half}.
#############################################################################################################
`;
}

// ── ai-detection.cfg (interrupteur de la détection IA n8n) ──────────────────

function genAiDetection(): string {
  return `#############################################################################################################
### INTERRUPTEUR DÉTECTION IA — anti-spaghetti (n8n + GPT-4o Vision)
###
### La variable AI_GUARD.enabled sert d'interrupteur ON/OFF depuis Mainsail.
### Le workflow n8n la LIT via Moonraker et n'analyse l'image que si elle vaut 1 :
###
###   URL du nœud « Moonraker état » :
###     http://<IP>:7125/printer/objects/query?print_stats&gcode_macro AI_GUARD
###   Condition IF (combinateur AND) :
###     {{ $json.result.status['gcode_macro AI_GUARD'].enabled }} == 1
###
### Aucun plugin requis (pas de gcode_shell_command, pas de webhook) : tout est natif.
#############################################################################################################

[gcode_macro AI_GUARD]
variable_enabled: 1              # 1 = surveillance active au démarrage · 0 = coupée
gcode:
    # macro porteuse de la variable — ne fait rien d'autre

[gcode_macro DETECTION_ON]
description: 🧠 Active la surveillance IA anti-spaghetti
gcode:
    SET_GCODE_VARIABLE MACRO=AI_GUARD VARIABLE=enabled VALUE=1
    M117 Surveillance IA ACTIVEE

[gcode_macro DETECTION_OFF]
description: 🧠 Coupe la surveillance IA
gcode:
    SET_GCODE_VARIABLE MACRO=AI_GUARD VARIABLE=enabled VALUE=0
    M117 Surveillance IA coupee

[gcode_macro DETECTION_STATUS]
description: 🧠 Affiche l'état de la surveillance IA
gcode:
    {% set on = printer['gcode_macro AI_GUARD'].enabled %}
    {% if on %}
        M117 Surveillance IA : ACTIVE
    {% else %}
        M117 Surveillance IA : coupee
    {% endif %}
`;
}

// ── leds.cfg (macros d'état, sans le plugin led_effect) ──────────────────────

function genLeds(c: PrinterConfig): string {
  if (!c.hasNeopixel && !c.hasCOBLed) {
    return `# Aucune LED configurée dans l'onglet Matériel.
# Active « Neopixel » et/ou « COB » pour générer les macros d'état.
`;
  }
  const np = c.hasNeopixel;
  const cob = c.hasCOBLed;
  const setNp = (r: number, g: number, b: number) =>
    np ? `    SET_LED LED=chamber_leds RED=${r} GREEN=${g} BLUE=${b} SYNC=0` : '';
  const setCob = (v: number) =>
    cob ? `    SET_PIN PIN=cob_led VALUE=${v}` : '';

  return `#############################################################################################################
### MACROS LED PAR ÉTAT — version simple (SET_LED, sans plugin led_effect)
### Neopixel = couleur d'état · COB = éclairage blanc du caisson.
### SYNC=0 : la couleur s'applique immédiatement (pas en fin de file de mouvement).
#############################################################################################################

[gcode_macro LED_SCAN]
description: Bleu — palpage / sonde
gcode:
${setNp(0, 0, 1.0)}

[gcode_macro LED_CHAUFFE]
description: Orange — chauffe
gcode:
${setNp(1.0, 0.25, 0)}

[gcode_macro LED_TRAVAIL]
description: Blanc + COB — impression en cours
gcode:
${setNp(1.0, 1.0, 1.0)}
${setCob(1.0)}

[gcode_macro LED_TERMINE]
description: Vert — impression terminée
gcode:
${setNp(0, 1.0, 0)}

[gcode_macro LED_PAUSE]
description: Ambre — pause
gcode:
${setNp(1.0, 0.5, 0)}

[gcode_macro LED_ERREUR]
description: Rouge — erreur
gcode:
${setNp(1.0, 0, 0)}
${cob ? `
[gcode_macro LUMIERE_ON]
gcode:
    SET_PIN PIN=cob_led VALUE=1.0

[gcode_macro LUMIERE_OFF]
gcode:
    SET_PIN PIN=cob_led VALUE=0
` : ''}
#############################################################################################################
### Branchement dans mainsail.cfg (hooks PAUSE/RESUME/CANCEL) — à ajouter si tu veux
### que les LED suivent la pause automatiquement :
###
### [gcode_macro _CLIENT_VARIABLE]
### variable_user_pause_macro : "LED_PAUSE"
### variable_user_resume_macro: "LED_TRAVAIL"
### variable_user_cancel_macro: "LED_ERREUR"
### gcode:
#############################################################################################################
`;
}

// ── leds-effects.cfg (LED animées via le plugin led_effect) ──────────────────

function genLedsEffects(c: PrinterConfig): string {
  if (!c.hasNeopixel) {
    return `# Les effets animés nécessitent un bandeau Neopixel/WS2812.
# Active « Neopixel » dans l'onglet Matériel pour générer ce fichier.
`;
  }
  const cob = c.hasCOBLed;
  return `#############################################################################################################
### LED ANIMÉES — inspirées d'une config VCore 3 (effets par état d'impression)
###
### ⚠️ NÉCESSITE le plugin klipper-led_effect (Julian Schill) :
###     cd ~ && git clone https://github.com/julianschill/klipper-led_effect
###     cd klipper-led_effect && ./install-led_effect.sh
###
### ⚠️ À utiliser À LA PLACE de leds.cfg (pas les deux : mêmes noms de macros).
### Le bandeau référencé est [neopixel chamber_leds] défini dans printer.cfg.
#############################################################################################################

[led_effect e_travail]
leds:
    neopixel:chamber_leds
layers:
    static 1 0 top (0.6, 0.6, 0.6)          # blanc doux — impression
autostart: false

[led_effect e_scan]
leds:
    neopixel:chamber_leds
layers:
    chase 0.8 10 top (1.0, 1.0, 1.0)        # chenillard blanc — palpage/homing
autostart: false
frame_rate: 20

[led_effect e_chauffe]
leds:
    neopixel:chamber_leds
layers:
    breathing 3 1 top (1.0, 0.25, 0.0)      # respiration orange — chauffe
autostart: false
frame_rate: 12

[led_effect e_termine]
leds:
    neopixel:chamber_leds
layers:
    static 1 0 top (0.0, 1.0, 0.0)          # vert franc — terminé
autostart: false

[led_effect e_pause]
leds:
    neopixel:chamber_leds
layers:
    breathing 3 1 top (1.0, 0.30, 0.0)      # respiration ambre — pause
autostart: false
frame_rate: 10

[led_effect e_erreur]
leds:
    neopixel:chamber_leds
layers:
    blink 1 0.5 top (1.0, 0.0, 0.0)         # clignotement rouge — erreur
autostart: false
run_on_error: true                          # reste allumé même en shutdown
frame_rate: 10

# ── Point d'entrée unique ───────────────────────────────────────────────────
[gcode_macro _LED]
description: STATE=off|travail|scan|chauffe|termine|pause|erreur
gcode:
    {% set etat = params.STATE|default('travail')|lower %}
    {% if etat == 'off' %}
        STOP_LED_EFFECTS
        SET_LED LED=chamber_leds RED=0 GREEN=0 BLUE=0 SYNC=0
    {% elif etat in ['travail','scan','chauffe','termine','pause','erreur'] %}
        SET_LED_EFFECT EFFECT=e_{etat} REPLACE=1 RESTART=1
    {% else %}
        { action_raise_error("_LED : état inconnu '%s'" % etat) }
    {% endif %}

# ── Alias compatibles avec START_PRINT / END_PRINT ──────────────────────────
[gcode_macro LED_SCAN]
gcode:
    _LED STATE=scan
[gcode_macro LED_CHAUFFE]
gcode:
    _LED STATE=chauffe
[gcode_macro LED_TRAVAIL]
gcode:
    _LED STATE=travail${cob ? '\n    SET_PIN PIN=cob_led VALUE=1.0' : ''}
[gcode_macro LED_TERMINE]
gcode:
    _LED STATE=termine
[gcode_macro LED_PAUSE]
gcode:
    _LED STATE=pause
[gcode_macro LED_ERREUR]
gcode:
    _LED STATE=erreur
`;
}

// ── client-macros.cfg (hooks Mainsail : pause/reprise/annulation → LED) ───────

function genClientHooks(): string {
  return `#############################################################################################################
### HOOKS MAINSAIL — les LED suivent automatiquement PAUSE / RESUME / CANCEL
### À inclure APRÈS mainsail.cfg dans printer.cfg.
#############################################################################################################

[gcode_macro _CLIENT_VARIABLE]
variable_use_custom_pos   : False
variable_custom_park_x    : 0.0
variable_custom_park_y    : 0.0
variable_park_at_cancel   : True
variable_retract          : 1.0
variable_cancel_retract   : 3.0
variable_speed_retract    : 35.0
variable_unretract        : 1.0
variable_speed_unretract  : 35.0
variable_speed_hop        : 15.0
variable_speed_move       : 300.0
variable_user_pause_macro : "LED_PAUSE"
variable_user_resume_macro: "LED_TRAVAIL"
variable_user_cancel_macro: "LED_ERREUR"
gcode:
`;
}

// ── timelapse.cfg (nécessite le plugin moonraker-timelapse) ──────────────────

function genTimelapse(c: PrinterConfig): string {
  const parkX = 20;
  const parkY = c.printerSize - 20;
  return `#############################################################################################################
### TIMELAPSE — nécessite le plugin moonraker-timelapse installé
###     https://github.com/mainsail-crew/moonraker-timelapse
### Le parking est calé sur ce plateau ${c.printerSize}×${c.printerSize}.
#############################################################################################################

[timelapse]
output_path: ~/timelapse/
frame_path: /tmp/timelapse/
ffmpeg_binary_path: /usr/bin/ffmpeg

# Position de parking de la tête pendant la prise de vue (coin arrière-gauche)
[gcode_macro TIMELAPSE_TAKE_FRAME]
rename_existing: _TIMELAPSE_TAKE_FRAME_BASE
gcode:
    {% if printer['gcode_macro _TIMELAPSE_TAKE_FRAME_BASE'] is defined %}
        _TIMELAPSE_TAKE_FRAME_BASE PARK_X=${parkX} PARK_Y=${parkY} {rawparams}
    {% endif %}
`;
}

// ── chamber.cfg (caisson régulé + filtration) ───────────────────────────────

function genChamber(c: PrinterConfig): string {
  if (!c.hasChamberFan && !c.hasChamberSensor) {
    return `# Active « Ventilateur enceinte » et « Capteur température enceinte »
# dans l'onglet Matériel pour générer la régulation du caisson.
`;
  }
  return `#############################################################################################################
### CAISSON — ventilateur régulé en température + filtration
###
### ⚠️ REMPLACE le [fan_generic chamber_fan] et les macros CHAMBER_FAN_ON/OFF
###    de printer.cfg (même broche ${c.chamberFanPin}). Retire-les pour éviter le conflit.
### Capteur : ${c.chamberSensorPin} (NTC 100K — ajuste sensor_type si besoin).
#############################################################################################################

[temperature_fan chamber]
pin: ${c.chamberFanPin}
sensor_type: Generic 3950
sensor_pin: ${c.chamberSensorPin}
control: watermark
gcode_id: C
min_temp: 0
max_temp: 80
target_temp: 40
max_speed: 1.0
min_speed: 0.0

# Filtration douce (à lancer à la main si besoin)
[gcode_macro START_FILTER]
gcode:
    SET_TEMPERATURE_FAN_TARGET TEMPERATURE_FAN=chamber TARGET=5 MIN_SPEED=0.35 MAX_SPEED=0.35

[gcode_macro STOP_FILTER]
gcode:
    SET_TEMPERATURE_FAN_TARGET TEMPERATURE_FAN=chamber TARGET=45 MIN_SPEED=0.0 MAX_SPEED=0.40

# Extraction à fond puis retour en douceur — à lancer avant d'ouvrir la porte
[gcode_macro PURGE_CAISSON]
description: Extraction 3 min avant ouverture
gcode:
    SET_TEMPERATURE_FAN_TARGET TEMPERATURE_FAN=chamber TARGET=5 MIN_SPEED=1.0 MAX_SPEED=1.0
    UPDATE_DELAYED_GCODE ID=_FIN_PURGE_CAISSON DURATION=180

[delayed_gcode _FIN_PURGE_CAISSON]
gcode:
    SET_TEMPERATURE_FAN_TARGET TEMPERATURE_FAN=chamber TARGET=50 MIN_SPEED=0.0 MAX_SPEED=0.40
`;
}

// ── filament-sensor.cfg (BTT Smart Filament Sensor V1.0) ─────────────────────

function genFilamentSensor(c: PrinterConfig): string {
  const hasLeds = c.hasNeopixel || c.hasCOBLed;
  return `#############################################################################################################
### BIGTREETECH SMART FILAMENT SENSOR V1.0 — sur l'Octopus
###
### Capteur combiné : détecte la FIN de filament ET l'ABSENCE DE MOUVEMENT
### (bourrage / extrudeur qui patine). C'est un capteur de MOUVEMENT : il
### déclenche si l'extrudeur pousse « detection_length » mm sans que la roue
### du capteur ne tourne.
###
### CÂBLAGE (Octopus) — connecteur dédié « SENSOR » (VS / GND / PB7) :
###   C'est le port prévu pour un capteur : il apporte les 3 signaux d'un coup.
###   Le connecteur 3 fils du SFS s'y branche directement, pas de 5V à câbler
###   à part. PB7 est libre car la sonde Z est le Cartographer (sur CAN).
###     - VS  → 5V (alimente le SFS)
###     - GND → GND
###     - PB7 → Signal
###
###   Si Klipper signale « runout » en permanence, inverse la logique du pin :
###     ^PB7  <->  ^!PB7
#############################################################################################################

[filament_motion_sensor SFS]
switch_pin: ^PB7
detection_length: 7.0            # mm d'extrusion sans mouvement avant alarme (V1.0 : ~7 mm)
extruder: extruder
pause_on_runout: True
runout_gcode:
    M117 Filament : fin ou bourrage !${hasLeds ? '\n    LED_ERREUR' : ''}
    PAUSE
insert_gcode:
    M117 Filament détecté

# Activer / désactiver à la volée (ex : couper pendant un chargement manuel)
[gcode_macro SFS_ENABLE]
gcode:
    SET_FILAMENT_SENSOR SENSOR=SFS ENABLE=1

[gcode_macro SFS_DISABLE]
gcode:
    SET_FILAMENT_SENSOR SENSOR=SFS ENABLE=0

#############################################################################################################
### Conseil : dans START_PRINT, mets « SFS_ENABLE » juste après PRIME_LINE
### (filament chargé), et « SFS_DISABLE » dans END_PRINT. Évite les fausses
### alertes pendant la purge et les mouvements à vide.
#############################################################################################################
`;
}

// ── moonraker-updates.cfg (gestionnaire de mise à jour des plugins) ──────────

function genMoonrakerUpdates(): string {
  return `#############################################################################################################
### GESTIONNAIRE DE MISE À JOUR — plugins Klipper tiers
### À AJOUTER à la fin de moonraker.conf (ne PAS remplacer le fichier entier).
###
### ⚠️ Rappel : mettre à jour cartographer-klipper écrase les patchs manuels
###    éventuels (voir DEPANNAGE-RATOS.md).
#############################################################################################################

[update_manager cartographer]
type: git_repo
path: ~/cartographer-klipper
origin: https://github.com/Cartographer3D/cartographer-klipper.git
managed_services: klipper
primary_branch: master
install_script: install.sh

[update_manager led_effect]
type: git_repo
path: ~/klipper-led_effect
origin: https://github.com/julianschill/klipper-led_effect.git
managed_services: klipper
primary_branch: master

[update_manager Shake&Tune]
type: git_repo
path: ~/klippain_shaketune
origin: https://github.com/Frix-x/klippain-shaketune.git
managed_services: klipper
primary_branch: main
install_script: install.sh
requirements: requirements.txt

[update_manager timelapse]
type: git_repo
path: ~/moonraker-timelapse
origin: https://github.com/mainsail-crew/moonraker-timelapse.git
primary_branch: main
managed_services: klipper moonraker
`;
}

// ── Shaketune_macros.cfg (générique) ─────────────────────────────────────────

function genShaketune(): string {
  return `#############################################################################################################
### KLIPPAIN SHAKE&TUNE — raccourcis (nécessite le plugin Shake&Tune installé)
#############################################################################################################

[gcode_macro ST_AXES_MAP]
description: S&T - Orientation accéléromètre (à faire en premier)
gcode:
    {% if printer.toolhead.homed_axes != "xyz" %}
        G28
    {% endif %}
    AXES_MAP_CALIBRATION

[gcode_macro ST_BELTS]
description: S&T - Comparaison courroies A/B
gcode:
    {% if printer.toolhead.homed_axes != "xyz" %}
        G28
    {% endif %}
    COMPARE_BELTS_RESPONSES

[gcode_macro ST_SHAPER]
description: S&T - Input shaper X et Y
gcode:
    {% if printer.toolhead.homed_axes != "xyz" %}
        G28
    {% endif %}
    AXES_SHAPER_CALIBRATION

[gcode_macro ST_VIBRATIONS]
description: S&T - Profil vibrations / vitesse
gcode:
    {% if printer.toolhead.homed_axes != "xyz" %}
        G28
    {% endif %}
    CREATE_VIBRATIONS_PROFILE
`;
}

// ── sonar.conf (générique, garde le WiFi actif) ──────────────────────────────

function genSonar(): string {
  return `#### Sonar — WiFi Keepalive daemon
#### https://github.com/mainsail-crew/sonar

[sonar]
enable: true
debug_log: false
persistent_log: false
target: auto
count: 3
interval: 60
restart_threshold: 10
`;
}

// ── Liste des fichiers ───────────────────────────────────────────────────────

const FILES: CfgFile[] = [
  { name: 'Macro.cfg', desc: 'Macros d\'impression : START_PRINT, END_PRINT, PARK_HOTEND, PRIME_LINE', generate: genMacros },
  { name: 'macros-utiles.cfg', desc: 'Confort : LOAD/UNLOAD, M600, préchauffe PLA/PETG/ABS, PARK, TEST_SPEED', hint: 'Boutons Mainsail pratiques au quotidien', generate: genUtilityMacros },
  { name: 'resonance-macros.cfg', desc: 'Accéléromètre + Input Shaper : ACCEL_TEST, RESONANCE_X/Y, CALIBRATE_SHAPER', hint: 'Nécessite [adxl345] + [resonance_tester]', generate: genResonance },
  { name: 'orcaslicer.cfg', desc: 'G-code machine START_PRINT/END_PRINT à coller dans OrcaSlicer', hint: 'Aide slicer — pas un vrai .cfg Klipper', generate: genOrcaSlicer },
  { name: 'ai-detection.cfg', desc: 'Interrupteur détection IA : DETECTION_ON/OFF (porte AI_GUARD lue par n8n)', hint: 'Boutons Mainsail pour piloter la surveillance n8n', generate: genAiDetection },
  { name: 'leds.cfg', desc: 'Macros LED par étape — version simple (SET_LED)', generate: genLeds },
  { name: 'leds-effects.cfg', desc: 'LED animées par état — chenillard, respiration…', hint: 'Nécessite le plugin led_effect · à utiliser au lieu de leds.cfg', generate: genLedsEffects },
  { name: 'client-macros.cfg', desc: 'Hooks Mainsail : pause/reprise/annulation → LED', generate: genClientHooks },
  { name: 'chamber.cfg', desc: 'Caisson régulé en température + filtration', hint: 'Remplace fan_generic chamber_fan', generate: genChamber },
  { name: 'filament-sensor.cfg', desc: 'BTT Smart Filament Sensor V1.0 (fin + bourrage)', hint: 'Connecteur SENSOR (PB7)', generate: genFilamentSensor },
  { name: 'timelapse.cfg', desc: 'Timelapse, parking calé sur le plateau', hint: 'Nécessite le plugin moonraker-timelapse', generate: genTimelapse },
  { name: 'Shaketune_macros.cfg', desc: 'Raccourcis Shake&Tune (input shaper)', hint: 'Nécessite le plugin Shake&Tune', generate: genShaketune },
  { name: 'moonraker-updates.cfg', desc: 'Gestionnaire de mise à jour des plugins', hint: 'À ajouter à moonraker.conf', generate: genMoonrakerUpdates },
  { name: 'sonar.conf', desc: 'Garde la connexion WiFi active', generate: genSonar },
];

// ── Composant ────────────────────────────────────────────────────────────────

export function ConfigFilesGenerator({ config }: Props) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);

  const file = FILES[active];
  const content = file.generate(config);
  const lines = content.split('\n');

  const copy = async () => {
    await navigator.clipboard.writeText(content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const downloadOne = (f: CfgFile) => {
    const blob = new Blob([f.generate(config)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAll = () => {
    FILES.forEach((f, i) => setTimeout(() => downloadOne(f), i * 250));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">Générateur de fichiers .cfg</h2>
          <p className="text-sm text-gray-400">
            Fichiers périphériques calés sur ta machine {config.printerSize}×{config.printerSize}.
            Le <code className="bg-gray-800 px-1 rounded">printer.cfg</code> principal reste dans l'onglet dédié.
          </p>
        </div>
        <button
          onClick={downloadAll}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium transition-all"
        >
          <FolderDown size={15} />
          Tout télécharger
        </button>
      </div>

      <div className="p-4 rounded-lg border border-blue-900/50 bg-blue-950/20 flex gap-3">
        <Info size={15} className="text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-200 space-y-1">
          <p>Chaque fichier va dans <code className="bg-blue-900/30 px-1 rounded">~/printer_data/config/</code>.
            Ajoute l'include correspondant en haut de <code className="bg-blue-900/30 px-1 rounded">printer.cfg</code>, par ex.
            <code className="bg-blue-900/30 px-1 rounded ml-1">[include Macro.cfg]</code>.</p>
          <p className="text-blue-300/80">⚠️ Retire d'abord de <code className="bg-blue-900/30 px-1 rounded">printer.cfg</code> toute macro
            du même nom (START_PRINT, END_PRINT…) pour éviter les doublons.</p>
        </div>
      </div>

      {/* Sélecteur de fichier */}
      <div className="flex flex-wrap gap-2">
        {FILES.map((f, i) => (
          <button
            key={f.name}
            onClick={() => setActive(i)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${
              i === active
                ? 'border-orange-500 bg-orange-500/10 text-orange-300'
                : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:text-gray-200'
            }`}
          >
            <FileCode size={14} className={i === active ? 'text-orange-400' : ''} />
            {f.name}
          </button>
        ))}
      </div>

      {/* Description du fichier actif */}
      <div className="text-sm text-gray-400">
        <span className="text-gray-200 font-medium">{file.name}</span> — {file.desc}
        {file.hint && <span className="ml-2 text-xs text-yellow-500/80">({file.hint})</span>}
      </div>

      {/* Bloc de code */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900">
          <div className="flex items-center gap-2">
            <FileCode size={14} className="text-orange-400" />
            <span className="text-sm text-gray-200 font-mono">{file.name}</span>
            <span className="text-xs text-gray-600">— {lines.length} lignes</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700 text-sm text-gray-300 transition-all"
            >
              {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
              {copied ? 'Copié !' : 'Copier'}
            </button>
            <button
              onClick={() => downloadOne(file)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700 text-sm text-gray-300 transition-all"
            >
              <Download size={13} />
              Télécharger
            </button>
          </div>
        </div>
        <pre className="p-4 overflow-x-auto text-xs leading-relaxed text-gray-300 max-h-[60vh]">
          <code>{content}</code>
        </pre>
      </div>
    </div>
  );
}
