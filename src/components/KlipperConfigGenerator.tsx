import React, { useState } from 'react';
import { PrinterConfig } from '../App';
import { FileCode, Copy, Check, Download, AlertTriangle } from 'lucide-react';

interface Props {
  config: PrinterConfig;
}

const BOARD_CONFIG: Record<string, string> = {
  octopus_pro: 'RatOS/boards/btt-octopus-pro-446',
  octopus: 'RatOS/boards/btt-octopus-11',
  manta_m8p: 'RatOS/boards/btt-manta-m8p',
  skr_pro: 'RatOS/boards/btt-skr-pro-12',
  spider: 'RatOS/boards/fysetc-spider-v2',
};

const BOARD_SERIAL: Record<string, string> = {
  octopus_pro: '/dev/serial/by-id/usb-Klipper_stm32f446xx_XXXXXXXXXX-if00',
  octopus: '/dev/serial/by-id/usb-Klipper_stm32f446xx_XXXXXXXXXX-if00',
  manta_m8p: '/dev/serial/by-id/usb-Klipper_stm32g0b1xx_XXXXXXXXXX-if00',
  skr_pro: '/dev/serial/by-id/usb-Klipper_stm32f407xx_XXXXXXXXXX-if00',
  spider: '/dev/serial/by-id/usb-Klipper_stm32f446xx_XXXXXXXXXX-if00',
};

function generatePrinterCfg(config: PrinterConfig): string {
  const { size, board, probe, probeXOffset, probeYOffset, probeZOffset,
    probeSpeed, probeLifts, meshMinX, meshMinY, meshMaxX, meshMaxY,
    meshPointsX, meshPointsY, meshFadeStart, meshFadeEnd, meshAlgorithm,
    homingSpeed, homingRetractDist, relativeMeshOrigin, adaptiveMesh } = config;

  const halfSize = size / 2;
  const relativeIndex = relativeMeshOrigin
    ? `\nrelative_reference_index: ${Math.floor((meshPointsX * meshPointsY) / 2)}`
    : '';

  const probeSection = generateProbeSection(config);
  const homingOverride = generateHomingOverride(config);

  return `########################################
# VCore 3.1 — RatOS v2.1 Configuration
# Taille: ${size}x${size}mm | Probe: ${probe.toUpperCase()}
# Généré par VCore Configurator
########################################

[include RatOS/homing.cfg]
[include RatOS/macros.cfg]
[include RatOS/shell-macros.cfg]
[include RatOS/printers/vcore-3/vcore-3.cfg]
[include ${BOARD_CONFIG[board]}/config.cfg]
[include ${BOARD_CONFIG[board]}/steppers.cfg]
[include ${BOARD_CONFIG[board]}/speed-limits-basic.cfg]
[include ${BOARD_CONFIG[board]}/tmc2209.cfg]
[include ${BOARD_CONFIG[board]}/input-shaper.cfg]

########################################
# MCU
########################################
[mcu]
serial: ${BOARD_SERIAL[board]}

########################################
# Printer kinematics
########################################
[printer]
kinematics: corexy
max_velocity: 300
max_accel: 5000
max_z_velocity: 15
max_z_accel: 100
square_corner_velocity: 5.0

########################################
# Steppers VCore 3.1 — ${size}mm
########################################
[stepper_x]
position_min: 0
position_max: ${size}
position_endstop: ${size}
homing_speed: ${homingSpeed}

[stepper_y]
position_min: 0
position_max: ${size}
position_endstop: ${size}
homing_speed: ${homingSpeed}

[stepper_z]
position_min: -5
position_max: ${size + 10}

########################################
# Hotbed
########################################
[heater_bed]
heater_pin: PA1
sensor_type: NTC 100K MGB18-104F39050L32
sensor_pin: PF3
min_temp: 0
max_temp: 130
control: pid
pid_kp: 68.453
pid_ki: 1.763
pid_kd: 665.198

########################################
${probeSection}
########################################
# Bed Mesh — Cartographie ${meshPointsX}x${meshPointsY} points
########################################
[bed_mesh]
speed: 150
horizontal_move_z: ${probeLifts + 2}
mesh_min: ${meshMinX}, ${meshMinY}
mesh_max: ${meshMaxX}, ${meshMaxY}
probe_count: ${meshPointsX}, ${meshPointsY}
algorithm: ${meshAlgorithm}
fade_start: ${meshFadeStart}
fade_end: ${meshFadeEnd}
fade_target: 0${relativeIndex}

########################################
# Safe Homing
########################################
[safe_z_home]
home_xy_position: ${halfSize}, ${halfSize}
speed: ${homingSpeed}
z_hop: 10
z_hop_speed: 15
move_to_previous: false

########################################
${homingOverride}
########################################
# Bed Screws — Tramage plateau ${size}mm
########################################
[screws_tilt_adjust]
screw1: 30, 30
screw1_name: Avant Gauche
screw2: ${size - 30}, 30
screw2_name: Avant Droit
screw3: ${size - 30}, ${size - 30}
screw3_name: Arrière Droit
screw4: 30, ${size - 30}
screw4_name: Arrière Gauche
horizontal_move_z: 10
speed: 150
screw_thread: CW-M5

########################################
# Input Shaper
########################################
[resonance_tester]
accel_chip: adxl345
probe_points:
  ${halfSize}, ${halfSize}, 20

########################################
# Macros RatOS
########################################
[gcode_macro START_PRINT]
description: Start print macro — RatOS
gcode:
  {% set BED_TEMP = params.BED_TEMP|default(60)|float %}
  {% set EXTRUDER_TEMP = params.EXTRUDER_TEMP|default(200)|float %}
  G28
  M190 S{BED_TEMP}
  ${adaptiveMesh ? 'BED_MESH_CALIBRATE ADAPTIVE=1' : 'BED_MESH_CALIBRATE'}
  M109 S{EXTRUDER_TEMP}
  G92 E0
  G1 Z5 F3000
  G1 X10 Y20 Z0.3 F5000
  G1 X${size - 10} E15 F1500
  G92 E0

[gcode_macro END_PRINT]
description: End print macro — RatOS
gcode:
  G91
  G1 E-4 F1800
  G1 Z10 F3000
  G90
  G1 X${halfSize} Y${size - 10} F6000
  M104 S0
  M140 S0
  M84
`;
}

function generateProbeSection(config: PrinterConfig): string {
  const { probe, probeXOffset, probeYOffset, probeZOffset, probeSpeed, probeLifts } = config;

  switch (probe) {
    case 'beacon':
      return `# Beacon Probe — Scan inductif continu
[beacon]
serial: /dev/serial/by-id/usb-Beacon_Beacon_RevX_XXXXXXXX-if00
x_offset: ${probeXOffset}
y_offset: ${probeYOffset}
mesh_main_direction: x
mesh_overscan: 2
mesh_cluster_size: 1
home_xy_position: ${config.size / 2}, ${config.size / 2}

# Commande de calibration: BEACON_CALIBRATE`;

    case 'cartographer':
      return `# Cartographer Probe — Scan inductif rapide
[cartographer]
serial: /dev/serial/by-id/usb-Cartographer_cartographer_XXXXXXXX-if00
x_offset: ${probeXOffset}
y_offset: ${probeYOffset}
z_offset: ${probeZOffset}
speed: ${probeSpeed}
lift_speed: ${probeLifts * 3}
backlash_comp: 0.02
mesh_runs: 2

# Commande de calibration: CARTOGRAPHER_CALIBRATE`;

    case 'bltouch':
    case 'crtouch':
      return `# ${probe === 'bltouch' ? 'BL-Touch' : 'CR-Touch'} Probe
[bltouch]
sensor_pin: ^PB7
control_pin: PB6
x_offset: ${probeXOffset}
y_offset: ${probeYOffset}
z_offset: ${probeZOffset}
speed: ${probeSpeed}
lift_speed: ${probeLifts * 3}
samples: 3
sample_retract_dist: ${probeLifts}
samples_tolerance: 0.01
samples_tolerance_retries: 3
pin_up_touch_mode_reports_triggered: True
probe_with_touch_mode: True

# Commande de calibration: PROBE_CALIBRATE`;

    case 'klicky':
      return `# Klicky Probe — Probe magnétique
[include RatOS/z-probe/klicky/klicky.cfg]

[probe]
pin: ^PB7
x_offset: ${probeXOffset}
y_offset: ${probeYOffset}
z_offset: ${probeZOffset}
speed: ${probeSpeed}
lift_speed: ${probeLifts * 3}
samples: 3
sample_retract_dist: ${probeLifts}
samples_tolerance: 0.006
samples_tolerance_retries: 3

# Commande de calibration: PROBE_CALIBRATE`;

    case 'euclid':
      return `# Euclid Probe — Probe magnétique dockable
[probe]
pin: ^PB7
x_offset: ${probeXOffset}
y_offset: ${probeYOffset}
z_offset: ${probeZOffset}
speed: ${probeSpeed}
lift_speed: ${probeLifts * 3}
samples: 3
sample_retract_dist: ${probeLifts}
samples_tolerance: 0.006
samples_tolerance_retries: 3

# Voir: https://euclidprobe.github.io/05_klipper.html`;

    default:
      return '';
  }
}

function generateHomingOverride(config: PrinterConfig): string {
  const { probe, probeXOffset, probeYOffset, size, homingRetractDist } = config;

  if (probe === 'klicky' || probe === 'euclid') {
    return `# Homing Override — Probe dockable
[homing_override]
axes: z
gcode:
  {% if 'x' not in printer.toolhead.homed_axes %}
    G28 X
  {% endif %}
  {% if 'y' not in printer.toolhead.homed_axes %}
    G28 Y
  {% endif %}
  G1 X${size / 2 - probeXOffset} Y${size / 2 - probeYOffset} F9000
  G28 Z
  G1 Z${homingRetractDist}`;
  }
  return `# Homing Z — ${probe}
[homing_override]
axes: z
gcode:
  G28 X Y
  G1 X${size / 2 - probeXOffset} Y${size / 2 - probeYOffset} F9000
  G28 Z
  G1 Z${homingRetractDist}`;
}

const SECTIONS = [
  { id: 'printer', label: 'printer.cfg', desc: 'Configuration principale' },
];

export function KlipperConfigGenerator({ config }: Props) {
  const [copied, setCopied] = useState(false);

  const configContent = generatePrinterCfg(config);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(configContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const download = () => {
    const blob = new Blob([configContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'printer.cfg';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Configuration Klipper générée</h2>
        <p className="text-sm text-gray-400">
          Fichier <code className="bg-gray-800 px-1 rounded text-orange-300">printer.cfg</code> compatible RatOS v2.1 pour VCore 3.1 — {config.size}mm
        </p>
      </div>

      {/* Warning */}
      <div className="rounded-lg border border-yellow-800 bg-yellow-900/20 p-4 flex gap-3">
        <AlertTriangle size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-yellow-300 space-y-1">
          <p><strong>Avant d'utiliser cette configuration :</strong></p>
          <ul className="list-disc list-inside space-y-0.5 text-xs text-yellow-400">
            <li>Remplacez le serial USB par votre identifiant réel (<code className="bg-yellow-900/40 px-1 rounded">ls /dev/serial/by-id/</code>)</li>
            <li>Calibrez le Z offset avec <code className="bg-yellow-900/40 px-1 rounded">PROBE_CALIBRATE</code> ou <code className="bg-yellow-900/40 px-1 rounded">BEACON_CALIBRATE</code></li>
            <li>Ajustez les PID heater_bed et extruder avec <code className="bg-yellow-900/40 px-1 rounded">PID_CALIBRATE</code></li>
            <li>Vérifiez le sens de rotation de chaque moteur</li>
          </ul>
        </div>
      </div>

      {/* Config summary chips */}
      <div className="flex flex-wrap gap-2">
        {[
          `VCore 3.1 — ${config.size}mm`,
          config.board.replace('_', ' ').toUpperCase(),
          `Probe: ${config.probe.toUpperCase()}`,
          `Mesh: ${config.meshPointsX}×${config.meshPointsY}`,
          config.meshAlgorithm,
          config.adaptiveMesh ? 'Adaptive Mesh' : '',
          config.relativeMeshOrigin ? 'Relative Origin' : '',
        ].filter(Boolean).map(chip => (
          <span key={chip} className="text-xs px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-300">
            {chip}
          </span>
        ))}
      </div>

      {/* File header */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900">
          <div className="flex items-center gap-2">
            <FileCode size={14} className="text-orange-400" />
            <span className="text-sm text-gray-200 font-mono">printer.cfg</span>
            <span className="text-xs text-gray-500">— RatOS v2.1</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyToClipboard}
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
        <pre className="p-4 text-xs text-gray-300 font-mono overflow-x-auto max-h-[600px] overflow-y-auto leading-5 whitespace-pre">
          {configContent.split('\n').map((line, i) => (
            <div key={i} className="hover:bg-gray-800/40 px-1 rounded">
              <span className="text-gray-700 select-none mr-4 text-right inline-block w-6">{i + 1}</span>
              {line.startsWith('#') ? (
                <span className="text-gray-500">{line}</span>
              ) : line.includes(':') && !line.startsWith(' ') ? (
                <span className="text-orange-300">{line}</span>
              ) : line.startsWith('[') ? (
                <span className="text-blue-400">{line}</span>
              ) : (
                <span>{line}</span>
              )}
            </div>
          ))}
        </pre>
      </div>

      {/* Instructions */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-6">
        <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider mb-4">Guide de mise en service</h3>
        <ol className="space-y-3">
          {[
            { n: 1, title: 'Installer Mainsail / Fluidd via RatOS', desc: 'Flashez l\'image RatOS v2.1 sur votre Raspberry Pi' },
            { n: 2, title: 'Flasher le firmware Klipper', desc: `Utilisez le RatOS configurator pour flasher la ${config.board}` },
            { n: 3, title: 'Copier printer.cfg', desc: 'Placez le fichier dans ~/printer_data/config/' },
            { n: 4, title: 'Trouver le serial USB', desc: 'SSH → ls /dev/serial/by-id/ et remplacez dans le config' },
            { n: 5, title: 'Tester les axes', desc: 'QUERY_ENDSTOPS → SET_KINEMATIC_POSITION Z=0 → tester G28' },
            { n: 6, title: 'Calibrer le Z offset', desc: probe_calibration_cmd(config.probe) },
            { n: 7, title: 'Lancer la calibration bed mesh', desc: 'BED_MESH_CALIBRATE → BED_MESH_PROFILE SAVE=default' },
            { n: 8, title: 'Calibrer Input Shaper', desc: 'SHAPER_CALIBRATE → redémarrer → vérifier les fréquences' },
          ].map(step => (
            <li key={step.n} className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-orange-500/20 border border-orange-500/40 text-orange-400 text-xs flex items-center justify-center font-bold">
                {step.n}
              </span>
              <div>
                <div className="text-sm text-gray-200">{step.title}</div>
                <div className="text-xs text-gray-500">{step.desc}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function probe_calibration_cmd(probe: string): string {
  if (probe === 'beacon') return 'BEACON_CALIBRATE → ajustez z_offset dans printer.cfg';
  if (probe === 'cartographer') return 'CARTOGRAPHER_CALIBRATE → sauvegarder';
  return 'PROBE_CALIBRATE → ACCEPT → SAVE_CONFIG';
}
