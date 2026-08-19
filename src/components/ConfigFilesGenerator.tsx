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
    M117 Impression...

[gcode_macro END_PRINT]
gcode:
    M400
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
  { name: 'leds.cfg', desc: 'Macros LED par étape (scan, chauffe, travail, terminé…)', generate: genLeds },
  { name: 'Shaketune_macros.cfg', desc: 'Raccourcis Shake&Tune (input shaper)', hint: 'Nécessite le plugin Shake&Tune', generate: genShaketune },
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
