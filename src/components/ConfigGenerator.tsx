import { useState } from 'react';
import { PrinterConfig } from '../App';
import { FileCode, Copy, Check, Download, AlertTriangle } from 'lucide-react';

interface Props { config: PrinterConfig; }

// ─── Board data ───────────────────────────────────────────────────────────────

const EXTRUDER_DATA: Record<string, { rotDist: number; current: number; microsteps: number }> = {
  orbiter2:      { rotDist: 4.637,       current: 0.850, microsteps: 16 },
  orbiter15:     { rotDist: 4.637,       current: 0.850, microsteps: 16 },
  lgx_lite:      { rotDist: 5.7,         current: 0.700, microsteps: 16 },
  hgx_lite:      { rotDist: 5.56,        current: 0.650, microsteps: 16 },
  bmg:           { rotDist: 22.6789511,  current: 0.650, microsteps: 16 },
  sherpa_mini:   { rotDist: 22.6789511,  current: 0.650, microsteps: 16 },
  vz_hextrudort: { rotDist: 20.0,        current: 0.800, microsteps: 16 },
};

const HOTEND_DATA: Record<string, { sensor: string; maxTemp: number }> = {
  dragon_uhf:   { sensor: 'ATC Semitec 104NT-4-R025H42G', maxTemp: 300 },
  dragon_std:   { sensor: 'ATC Semitec 104NT-4-R025H42G', maxTemp: 300 },
  revo_voron:   { sensor: 'PT1000',                       maxTemp: 300 },
  rapido_uhf:   { sensor: 'ATC Semitec 104NT-4-R025H42G', maxTemp: 350 },
  bambu_hotend: { sensor: 'ATC Semitec 104NT-4-R025H42G', maxTemp: 300 },
};

// ─── Config generation ────────────────────────────────────────────────────────

export function generateConfig(c: PrinterConfig): string {
  const half = c.printerSize / 2;
  const ext = EXTRUDER_DATA[c.extruder];
  const hotend = HOTEND_DATA[c.hotend];
  const ebb42Uuid = c.ebb42Uuid || 'REPLACE_EBB42_UUID';
  const cartoUuid = c.cartographerUuid || 'REPLACE_CARTOGRAPHER_UUID';

  // Z tilt positions for VCore 3.1
  const zpos = c.printerSize === 300
    ? { motors: '-38, 5\n  200, 310\n  438, 5', points: '30, 30\n  150, 265\n  270, 30' }
    : c.printerSize === 400
    ? { motors: '-38, 5\n  200, 410\n  438, 5', points: '30, 30\n  200, 360\n  370, 30' }
    : { motors: '-38, 5\n  250, 510\n  538, 5', points: '30, 30\n  250, 460\n  470, 30' };

  const scannerBlock = c.cartographerAPI === 'scanner'
    ? `\n[mcu scanner]
canbus_uuid: ${cartoUuid}

[scanner]
mcu: scanner
x_offset: ${c.cartographerXOffset}
y_offset: ${c.cartographerYOffset}
backlash_comp: ${c.cartographerBacklashComp}
sensor: cartographer
sensor_alt: carto
mesh_main_direction: x
mesh_overscan: 2
mesh_cluster_size: 1
mesh_runs: ${c.cartographerMeshRuns}`
    : `\n[mcu cartographer]
canbus_uuid: ${cartoUuid}

[cartographer]
mcu: cartographer
x_offset: ${c.cartographerXOffset}
y_offset: ${c.cartographerYOffset}
speed: 40.0
lift_speed: 5.0
backlash_comp: ${c.cartographerBacklashComp}
trigger_distance: 2.0
trigger_dive_threshold: 1.5
trigger_hysteresis: 0.006
cal_nozzle_z: 0.1
cal_floor: 0.1
cal_ceil: 5.0
cal_speed: 1.0
cal_move_speed: 10.0
default_model_name: default
mesh_main_direction: x
mesh_runs: ${c.cartographerMeshRuns}`;

  const chamberSensor = c.hasChamberSensor ? `
[temperature_sensor Chamber]
sensor_type: Generic 3950
sensor_pin: ${c.chamberSensorPin}
min_temp: 0
max_temp: 100
gcode_id: chamber
` : '';

  const chamberFan = c.hasChamberFan ? `
[fan_generic chamber_fan]
pin: ${c.chamberFanPin}
max_power: 1.0
shutdown_speed: 0
kick_start_time: 0.5

[gcode_macro CHAMBER_FAN_ON]
description: Allumer ventilateur enceinte
gcode:
    {% set SPEED = params.SPEED|default(1.0)|float %}
    SET_FAN_SPEED FAN=chamber_fan SPEED={SPEED}

[gcode_macro CHAMBER_FAN_OFF]
description: Éteindre ventilateur enceinte
gcode:
    SET_FAN_SPEED FAN=chamber_fan SPEED=0
` : '';

  const cobLed = c.hasCOBLed ? `
[output_pin cob_led]
pin: ${c.cobLedPin}
pwm: true
cycle_time: 0.01
value: 0
shutdown_value: 0

[gcode_macro LED_ON]
gcode: SET_PIN PIN=cob_led VALUE=1.0

[gcode_macro LED_OFF]
gcode: SET_PIN PIN=cob_led VALUE=0

[gcode_macro LED_DIM]
gcode: SET_PIN PIN=cob_led VALUE=0.2
` : '';

  const neopixel = c.hasNeopixel ? `
[neopixel chamber_leds]
pin: ${c.neopixelPin}
chain_count: ${c.neopixelCount}
color_order: GRB
initial_RED: 0.5
initial_GREEN: 0.5
initial_BLUE: 0.5
` : '';

  const ledMacros = (c.hasCOBLed || c.hasNeopixel) && !(c.hasCOBLed && c.hasNeopixel) ? '' : c.hasNeopixel ? `
[gcode_macro LED_ON]
gcode:
    SET_LED LED=chamber_leds RED=1.0 GREEN=1.0 BLUE=1.0

[gcode_macro LED_OFF]
gcode:
    SET_LED LED=chamber_leds RED=0 GREEN=0 BLUE=0

[gcode_macro LED_DIM]
gcode:
    SET_LED LED=chamber_leds RED=0.2 GREEN=0.2 BLUE=0.2
` : '';

  const startLed = c.hasCOBLed || c.hasNeopixel ? '\n    LED_ON' : '';
  const startFan = c.hasChamberFan ? '\n    CHAMBER_FAN_ON SPEED=0.5' : '';
  const endFan   = c.hasChamberFan ? '\n    CHAMBER_FAN_ON SPEED=1.0' : '';
  const endLed   = c.hasCOBLed || c.hasNeopixel ? '\n    LED_DIM' : '';

  return `############################################################################################################
# RatOS v2.1 — Ratrig V-Core 3.1 ${c.printerSize}×${c.printerSize}mm
# Hardware: ${c.mainBoard.replace('_', ' ').toUpperCase()} + BTT U2C v2.1 + EBB42 v1.2 + Cartographer CAN
# Généré par VCore 3.1 Configurateur
# ${new Date().toLocaleDateString('fr-FR')}
############################################################################################################

############################################################################################################
### RATOS v2.1 — Includes de base
############################################################################################################
[include RatOS/printers/v-core-3/v-core-3.cfg]
[include RatOS/printers/v-core-3/${c.printerSize}.cfg]
[include RatOS/homing.cfg]
[include RatOS/macros.cfg]
[include RatOS/shell-macros.cfg]
[include RatOS/printers/v-core-3/macros.cfg]

# Toolboard EBB42 v1.2
[include RatOS/boards/btt-ebb42-12/toolboard-config.cfg]

############################################################################################################
### MCU Principal — ${c.mainBoard.replace('_', ' ').toUpperCase()}
############################################################################################################
[mcu]
serial: ${c.mainBoardSerial}
restart_method: command

############################################################################################################
### TOOLHEAD MCU — BTT EBB42 v1.2 (CAN Bus)
############################################################################################################
# U2C v2.1 = pont USB→CAN (pas de [mcu u2c] nécessaire !)
# UUID trouvé avec : ~/klippy-env/bin/python ~/klipper/scripts/canbus_query.py can0
[mcu EBB42]
canbus_uuid: ${ebb42Uuid}
canbus_interface: can0

############################################################################################################
### CARTOGRAPHER PROBE — CAN Bus (API ${c.cartographerAPI === 'scanner' ? 'v5 [scanner]' : 'classique [cartographer]'})
############################################################################################################
${scannerBlock}

############################################################################################################
### PRINTER — Paramètres cinématiques
############################################################################################################
[printer]
kinematics: corexy
max_velocity: ${c.maxVelocity}
max_accel: ${c.maxAccel}
max_z_velocity: 15
max_z_accel: 300
square_corner_velocity: 5.0

############################################################################################################
### STEPPER Z — Endstop virtuel Cartographer
############################################################################################################
# IMPORTANT: homing_retract_dist DOIT être 0 avec Cartographer
[stepper_z]
endstop_pin: probe:z_virtual_endstop
homing_retract_dist: 0
position_min: -5

############################################################################################################
### SAFE Z HOME — Centre du plateau
############################################################################################################
[safe_z_home]
home_xy_position: ${half}, ${half}
speed: 80
z_hop: 10
z_hop_speed: 15
move_to_previous: false

############################################################################################################
### Z TILT ADJUST — 3 vis Z VCore 3.1 (${c.printerSize}mm)
############################################################################################################
[z_tilt]
z_positions:
  ${zpos.motors}
points:
  ${zpos.points}
speed: 150
horizontal_move_z: 15
retries: 5
retry_tolerance: 0.0075

############################################################################################################
### BED MESH — Cartographie Cartographer ${c.meshPointsX}×${c.meshPointsY} pts
############################################################################################################
[bed_mesh]
speed: 300
horizontal_move_z: 5
mesh_min: ${c.meshMinX}, ${c.meshMinY}
mesh_max: ${c.meshMaxX}, ${c.meshMaxY}
probe_count: ${c.meshPointsX}, ${c.meshPointsY}
algorithm: bicubic
fade_start: ${c.meshFadeStart}
fade_end: ${c.meshFadeEnd}
fade_target: 0
zero_reference_position: ${half}, ${half}

############################################################################################################
### EXTRUDEUR — ${c.extruder} sur EBB42 v1.2
############################################################################################################
[extruder]
step_pin: EBB42:PD0
dir_pin: EBB42:PD1
enable_pin: !EBB42:PD2
rotation_distance: ${ext.rotDist}
microsteps: ${ext.microsteps}
nozzle_diameter: ${c.nozzleDiameter}
filament_diameter: 1.750
heater_pin: EBB42:PB13
sensor_type: ${hotend.sensor}
sensor_pin: EBB42:PA3
min_temp: 0
max_temp: ${hotend.maxTemp}
max_extrude_only_distance: 500
max_extrude_cross_section: 5
pressure_advance: ${c.pressureAdvance}
pressure_advance_smooth_time: 0.040

[tmc2209 extruder]
uart_pin: EBB42:PA15
run_current: ${ext.current}
sense_resistor: 0.110
stealthchop_threshold: 0
interpolate: false

############################################################################################################
### HOTEND FAN & PART COOLING — EBB42 v1.2
############################################################################################################
[heater_fan hotend_fan]
pin: EBB42:PA1
heater: extruder
heater_temp: 50.0
fan_speed: 1.0

[fan]
pin: EBB42:PA0
kick_start_time: 0.5
off_below: 0.1

############################################################################################################
### ACCELEROMETRE ADXL345 — Input Shaper (EBB42)
############################################################################################################
[adxl345]
cs_pin: EBB42:PB12
spi_software_sclk_pin: EBB42:PB10
spi_software_mosi_pin: EBB42:PB11
spi_software_miso_pin: EBB42:PB2
axes_map: x, y, z

[resonance_tester]
accel_chip: adxl345
probe_points:
    ${half}, ${half}, 20

############################################################################################################
### CAPTEURS DE TEMPÉRATURE
############################################################################################################
[temperature_sensor EBB42]
sensor_type: temperature_mcu
sensor_mcu: EBB42
min_temp: 0
max_temp: 100

[temperature_sensor ${c.mainBoard.includes('octopus') ? 'Octopus' : 'Board'}]
sensor_type: temperature_mcu
sensor_mcu: mcu
min_temp: 0
max_temp: 100
${chamberSensor}
############################################################################################################
### ACCESSOIRES${c.hasChamberFan || c.hasCOBLed || c.hasNeopixel ? '' : ' — (aucun activé)'}
############################################################################################################
${chamberFan}${cobLed}${neopixel}${ledMacros}
############################################################################################################
### MACROS UTILISATEUR — Hooks RatOS v2.1
############################################################################################################
# Ces macros sont appelées automatiquement par START_PRINT / END_PRINT de RatOS

[gcode_macro _USER_START_PRINT_BEFORE_HOMING]
description: Exécuté avant le homing
gcode:${startLed}${startFan}
    # Ajouter vos commandes personnalisées ici

[gcode_macro _USER_START_PRINT_AFTER_HEATING_BED]
description: Exécuté après la chauffe du lit
gcode:
    # Z_TILT_ADJUST est appelé automatiquement par RatOS

[gcode_macro _USER_START_PRINT_BEFORE_HEATING_EXTRUDER]
description: Exécuté avant la chauffe hotend
gcode:
    # Commandes avant chauffe extrudeur

[gcode_macro _USER_END_PRINT_AFTER_HEATERS_OFF]
description: Exécuté après extinction chauffe
gcode:${endFan}${endLed}
    # Ajouter vos commandes de fin

[gcode_macro _USER_END_PRINT_PARK]
description: Position de parking fin d'impression
gcode:
    # La position par défaut RatOS est utilisée si vide

############################################################################################################
### MACROS UTILITAIRES
############################################################################################################
[gcode_macro PROBE_ACCURACY_TEST]
description: Test répétabilité Cartographer (10 mesures)
gcode:
    PROBE_ACCURACY SAMPLES=10

[gcode_macro CALIBRATE_FULL]
description: Calibration complète VCore 3.1 + Cartographer
gcode:
    G28
    Z_TILT_ADJUST
    G28 Z
    CARTOGRAPHER_CALIBRATE
    BED_MESH_CALIBRATE
    SAVE_CONFIG

############################################################################################################
### SLICER — Configuration START/END G-code
############################################################################################################
#
# START G-code (OrcaSlicer / SuperSlicer / PrusaSlicer) :
#   START_PRINT EXTRUDER_TEMP=[first_layer_temperature] BED_TEMP=[first_layer_bed_temperature]
#
# START G-code (Cura) :
#   START_PRINT EXTRUDER_TEMP={material_print_temperature_layer_0} BED_TEMP={material_bed_temperature_layer_0}
#
# END G-code :
#   END_PRINT
#
############################################################################################################
### SETUP — Rappel de mise en service
############################################################################################################
#
# 1. Remplacer le serial MCU :
#    ls /dev/serial/by-id/
#    Mettre à jour [mcu] serial:
#
# 2. Remplacer les UUIDs CAN :
#    sudo systemctl stop klipper
#    ~/klippy-env/bin/python ~/klipper/scripts/canbus_query.py can0
#    Mettre à jour [mcu EBB42] et [mcu scanner/cartographer]
#
# 3. Première mise en route :
#    STEPPER_BUZZ STEPPER=stepper_x  → vérifier direction
#    STEPPER_BUZZ STEPPER=stepper_y
#    G28                             → premier homing
#    Z_TILT_ADJUST                   → nivellement 3 vis Z
#    CARTOGRAPHER_CALIBRATE          → calibration probe
#    PID_CALIBRATE_BED               → PID lit
#    PID_CALIBRATE_HOTEND            → PID hotend
#    BED_MESH_CALIBRATE              → mesh plateau
#    SHAPER_CALIBRATE                → input shaping
#    SAVE_CONFIG                     → sauvegarder tout
#
############################################################################################################
`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConfigGenerator({ config }: Props) {
  const [copied, setCopied] = useState(false);
  const content = generateConfig(config);
  const lines = content.split('\n');

  const copy = async () => {
    await navigator.clipboard.writeText(content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const download = () => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'printer.cfg';
    a.click();
    URL.revokeObjectURL(url);
  };

  const uuidsOk = config.ebb42Uuid.length >= 10 && config.cartographerUuid.length >= 10;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">printer.cfg — Configuration complète</h2>
        <p className="text-sm text-gray-400">
          Générée pour VCore 3.1 {config.printerSize}×{config.printerSize}mm · RatOS v2.1 ·
          EBB42 v1.2 + Cartographer CAN ({config.cartographerAPI === 'scanner' ? 'API v5' : 'API classique'})
        </p>
      </div>

      {/* Warnings */}
      {!uuidsOk && (
        <div className="p-4 rounded-lg border border-yellow-800 bg-yellow-900/20 flex gap-3">
          <AlertTriangle size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-yellow-300">
            <strong>UUIDs manquants</strong> — des placeholders <code className="bg-yellow-900/30 px-1 rounded">REPLACE_EBB42_UUID</code> et{' '}
            <code className="bg-yellow-900/30 px-1 rounded">REPLACE_CARTOGRAPHER_UUID</code> sont utilisés.
            Renseignez-les dans l'onglet <strong>Matériel & CAN</strong>.
          </div>
        </div>
      )}

      <div className="p-4 rounded-lg border border-orange-800 bg-orange-900/10 flex gap-3">
        <AlertTriangle size={15} className="text-orange-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-orange-300 space-y-1">
          <p><strong>Avant de démarrer :</strong></p>
          <ul className="list-disc list-inside space-y-0.5 text-orange-400">
            <li>Remplacer le serial MCU (<code className="bg-orange-900/30 px-1 rounded">ls /dev/serial/by-id/</code>)</li>
            <li>Remplacer les UUIDs CAN EBB42 et Cartographer</li>
            <li>Vérifier le sens de rotation de chaque moteur avec STEPPER_BUZZ</li>
            <li>Calibrer PID hotend + lit avant la première impression</li>
            <li>Lancer CARTOGRAPHER_CALIBRATE avec hotend + lit chauds</li>
          </ul>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2">
        {[
          `VCore 3.1 — ${config.printerSize}mm`,
          config.mainBoard.replace(/_/g, ' ').toUpperCase(),
          `CAN ${config.canSpeed === 500000 ? '500K' : '1M'}`,
          `EBB42 v1.2`,
          `Cartographer CAN`,
          `API ${config.cartographerAPI === 'scanner' ? 'v5 [scanner]' : 'classique'}`,
          `Mesh ${config.meshPointsX}×${config.meshPointsY}`,
          config.extruder,
          uuidsOk ? '✓ UUIDs OK' : '⚠ UUIDs manquants',
        ].map(chip => (
          <span key={chip} className={`text-xs px-2 py-1 rounded border ${
            chip.startsWith('⚠') ? 'bg-yellow-900/20 border-yellow-800 text-yellow-400' :
            chip.startsWith('✓') ? 'bg-green-900/20 border-green-800 text-green-400' :
            'bg-gray-800 border-gray-700 text-gray-300'
          }`}>
            {chip}
          </span>
        ))}
      </div>

      {/* Code block */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900 sticky top-[105px] z-30">
          <div className="flex items-center gap-2">
            <FileCode size={14} className="text-orange-400" />
            <span className="text-sm text-gray-200 font-mono">printer.cfg</span>
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
              onClick={download}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium transition-colors"
            >
              <Download size={13} />
              Télécharger
            </button>
          </div>
        </div>
        <pre className="p-4 text-xs font-mono overflow-x-auto max-h-[650px] overflow-y-auto leading-5 bg-gray-950">
          {lines.map((line, i) => (
            <div key={i} className="hover:bg-gray-900/60 rounded">
              <span className="text-gray-700 select-none mr-3 inline-block w-6 text-right text-[10px]">{i + 1}</span>
              {line.startsWith('#') ? (
                <span className={
                  line.startsWith('######')
                    ? 'text-orange-900'
                    : line.startsWith('### ')
                    ? 'text-orange-500'
                    : line.startsWith('# ')
                    ? 'text-gray-600'
                    : 'text-gray-500'
                }>{line}</span>
              ) : line.startsWith('[') ? (
                <span className="text-blue-400">{line}</span>
              ) : line.match(/^[a-z_]+:/) ? (
                <>
                  <span className="text-cyan-400">{line.split(':')[0]}</span>
                  <span className="text-gray-300">:{line.slice(line.indexOf(':') + 1)}</span>
                </>
              ) : (
                <span className="text-gray-300">{line}</span>
              )}
            </div>
          ))}
        </pre>
      </div>

      {/* Installation guide */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest mb-4">Résumé mise en service</h3>
        <ol className="space-y-2">
          {[
            'Installer RatOS v2.1 sur Raspberry Pi (image officielle)',
            `Flasher Klipper sur ${config.mainBoard.replace(/_/g, ' ').toUpperCase()} via SDcard (make menuconfig → USB)`,
            'Configurer CAN bus (systemd-networkd) + brancher U2C v2.1',
            'Installer Katapult sur EBB42 v1.2 via DFU (USB), puis Klipper via CAN',
            'Scanner les UUIDs : canbus_query.py can0 → noter EBB42 + Cartographer',
            'Copier ce printer.cfg → ~/printer_data/config/',
            'Mettre à jour serial MCU + UUIDs CAN dans printer.cfg',
            'FIRMWARE_RESTART → STEPPER_BUZZ pour vérifier les moteurs',
            'G28 → Z_TILT_ADJUST → G28 Z',
            'CARTOGRAPHER_CALIBRATE (hotend 150°C, lit 60°C)',
            'PID_CALIBRATE_BED → PID_CALIBRATE_HOTEND → SAVE_CONFIG',
            'BED_MESH_CALIBRATE → SAVE_CONFIG',
            'SHAPER_CALIBRATE → SAVE_CONFIG',
            'Première impression test !',
          ].map((step, i) => (
            <li key={i} className="flex gap-3 text-xs">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-orange-500/20 border border-orange-500/40 text-orange-400 text-[10px] flex items-center justify-center font-bold">
                {i + 1}
              </span>
              <span className="text-gray-400 mt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
