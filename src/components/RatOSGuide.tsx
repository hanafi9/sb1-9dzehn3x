import React, { useState } from 'react';
import {
  Layers, FileCode, AlertTriangle, CheckCircle2, XCircle, Copy,
  ExternalLink, Terminal, ChevronDown, ChevronUp, Info,
} from 'lucide-react';
import type { PrinterConfig } from '../App';

// ─── Faits vérifiés depuis RatOS-configuration v2.1.x ─────────────────────────

const RATOS_REPO = 'https://github.com/Rat-OS/RatOS-configuration/tree/v2.1.x';

/** Sondes Z fournies nativement par RatOS v2.1.x (dossier z-probe/) */
const RATOS_ZPROBES = [
  'beacon.cfg', 'bltouch.cfg', 'euclid.cfg', 'klicky.cfg', 'microprobe.cfg',
  'probe.cfg', 'stowable-probe.cfg', 'superpinda.cfg', 'unklicky.cfg',
];

/** Fichiers présents dans un dossier board RatOS */
const BOARD_FILES = [
  { f: 'board-definition.json',  d: 'Métadonnées : MCU, méthode de flash, nom du firmware' },
  { f: 'config.cfg',             d: 'Alias de pins + section [mcu] — carte mère' },
  { f: 'toolboard-config.cfg',   d: 'Alias de pins + section [mcu toolboard] — toolboard' },
  { f: 'firmware.config',        d: 'Configuration menuconfig figée pour cette carte' },
  { f: 'compile.sh / flash.sh',  d: 'Scripts de compilation et de flash utilisés par le configurateur' },
  { f: 'wiring.drawio.svg',      d: 'Schéma de câblage officiel' },
  { f: '98-<board>.rules',       d: 'Règle udev créant /dev/<board> — évite les chemins by-id instables' },
];

// ─── Générateur de printer.cfg RatOS ──────────────────────────────────────────

function generateRatOSConfig(config: PrinterConfig): string {
  const size = config.printerSize;
  const canLine = config.ebb42Uuid
    ? `canbus_uuid: ${config.ebb42Uuid}`
    : `canbus_uuid: <UUID_EBB42>   # ← lance CAN_UUIDS pour le trouver`;
  const cartoUuid = config.cartographerUuid || '<UUID_CARTOGRAPHER>';

  return `# ═══════════════════════════════════════════════════════════════════
#  printer.cfg — Ratrig VCore 3.1 ${size}×${size}
#  Octopus Pro 446 · EBB42 v1.1 (CAN) · Cartographer (CAN via U2C)
# ═══════════════════════════════════════════════════════════════════
#
#  RÈGLE D'OR RatOS : ne jamais modifier les fichiers sous RatOS/.
#  Ils sont gérés par git et écrasés à chaque mise à jour.
#  Tous tes réglages personnels vont dans CE fichier, APRÈS les includes.
#
# ── 1. Base RatOS ──────────────────────────────────────────────────
[include RatOS/printers/v-core-3/v-core-3.cfg]
[include RatOS/printers/v-core-3/${size}.cfg]

# ── 2. Cartes ──────────────────────────────────────────────────────
# Carte mère — USB série, PAS de CAN bridge
[include RatOS/boards/btt-octopus-pro-446/config.cfg]

# Toolboard EBB42 v1.1 — nœud sur le bus CAN
[include RatOS/boards/btt-ebb42-11/toolboard-config.cfg]

# ⚠ Aucune ligne pour le U2C : ce n'est pas un MCU.
#   Il crée l'interface can0 au niveau du noyau Linux, rien de plus.

# ── 3. Cinématique / extrudeur / hotend ────────────────────────────
# ⚠ Vérifie les noms exacts disponibles sur TA machine :
#     ls ~/printer_data/config/RatOS/steppers/
#     ls ~/printer_data/config/RatOS/extruders/
#     ls ~/printer_data/config/RatOS/hotends/
[include RatOS/extruders/<ton-extrudeur>.cfg]
[include RatOS/hotends/<ton-hotend>.cfg]

# ── 4. Macros RatOS ────────────────────────────────────────────────
[include RatOS/homing.cfg]
[include RatOS/macros.cfg]

# ── 5. Sonde Z ─────────────────────────────────────────────────────
# ⚠ RatOS v2.1 ne fournit PAS de z-probe/cartographer.cfg.
#   Le Cartographer se configure donc à la main, ci-dessous.
#   NE PAS inclure de RatOS/z-probe/*.cfg en même temps :
#   deux sondes = conflit d'enregistrement au démarrage.

# ═══════════════════════════════════════════════════════════════════
#  OVERRIDES — tout ce qui suit écrase les includes ci-dessus
# ═══════════════════════════════════════════════════════════════════

# ── MCU toolboard en CAN ───────────────────────────────────────────
# Le toolboard-config.cfg de RatOS déclare une liaison USB par défaut.
# On la remplace par du CAN :
[mcu toolboard]
canbus_interface: can0
${canLine}
serial:              # ← neutralise le serial hérité de l'include

# ── Cartographer ───────────────────────────────────────────────────
[cartographer]
canbus_interface: can0
canbus_uuid: ${cartoUuid}
speed: 40.0
lift_speed: 5.0
backlash_comp: ${config.cartographerBacklashComp}
x_offset: ${config.cartographerXOffset}
y_offset: ${config.cartographerYOffset}
trigger_distance: 2.0
mesh_runs: ${config.cartographerMeshRuns}

# Z piloté par la sonde virtuelle
[stepper_z]
endstop_pin: probe:z_virtual_endstop
homing_retract_dist: 0

[bed_mesh]
zero_reference_position: ${size / 2}, ${size / 2}
mesh_min: ${config.meshMinX}, ${config.meshMinY}
mesh_max: ${config.meshMaxX}, ${config.meshMaxY}
probe_count: ${config.meshPointsX}, ${config.meshPointsY}
fade_start: ${config.meshFadeStart}
fade_end: ${config.meshFadeEnd}
algorithm: bicubic

# ── Vitesses ───────────────────────────────────────────────────────
[printer]
max_velocity: ${config.maxVelocity}
max_accel: ${config.maxAccel}

[extruder]
nozzle_diameter: ${config.nozzleDiameter}
pressure_advance: ${config.pressureAdvance}

# ── Variables RatOS ────────────────────────────────────────────────
[gcode_macro RatOS]
variable_relative_extrusion: False
variable_preheat_extruder: True
variable_calibrate_bed_mesh: True
variable_nozzle_priming: "primeblob"
variable_start_print_park_in: "back"
variable_start_print_park_z_height: 50
variable_macro_travel_speed: 300

# ── Blocs auto-générés ─────────────────────────────────────────────
# Ne rien écrire sous cette ligne : SAVE_CONFIG la gère.
`;
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function RatOSGuide({ config }: { config: PrinterConfig }) {
  const [openSection, setOpenSection] = useState<string | null>('architecture');
  const [copied, setCopied] = useState(false);

  const cfg = generateRatOSConfig(config);
  const copy = (t: string) => {
    navigator.clipboard?.writeText(t);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const Section = ({ id, title, icon: Icon, children }: {
    id: string; title: string; icon: React.ElementType; children: React.ReactNode;
  }) => {
    const open = openSection === id;
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
        <button onClick={() => setOpenSection(open ? null : id)}
          className="w-full flex items-center justify-between p-5 hover:bg-gray-800/30 transition-colors">
          <div className="flex items-center gap-2">
            <Icon size={15} className="text-orange-400" />
            <span className="text-xs font-bold text-gray-300 uppercase tracking-widest">{title}</span>
          </div>
          {open ? <ChevronUp size={15} className="text-gray-500" /> : <ChevronDown size={15} className="text-gray-500" />}
        </button>
        {open && <div className="border-t border-gray-800 p-5">{children}</div>}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">RatOS</h2>
        <p className="text-sm text-gray-400">
          Comment RatOS structure la config, et où brancher chacun de tes composants
        </p>
      </div>

      {/* ── L'essentiel ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-orange-900/50 bg-orange-950/20 p-5">
        <div className="flex items-start gap-3">
          <Info size={16} className="text-orange-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-orange-200 mb-2">Ce qui change par rapport à Klipper vanilla</h3>
            <p className="text-xs text-gray-300 leading-relaxed">
              Sous Klipper classique, <code className="bg-gray-800 px-1 rounded">printer.cfg</code> décrit
              la machine entière. Sous RatOS, il ne fait presque que <strong className="text-white">choisir des
              briques</strong> déjà écrites et en <strong className="text-white">surcharger</strong> quelques
              valeurs. Les pins, les macros et la cinématique viennent du dossier{' '}
              <code className="bg-gray-800 px-1 rounded">RatOS/</code>, qui est un dépôt git mis à jour
              automatiquement — <strong className="text-orange-300">toute modification qu'on y fait est perdue
              à la prochaine mise à jour</strong>.
            </p>
          </div>
        </div>
      </div>

      {/* ── Architecture ──────────────────────────────────────────────────── */}
      <Section id="architecture" title="Architecture en couches" icon={Layers}>
        <div className="space-y-4">
          <div className="space-y-2">
            {[
              {
                layer: '1',
                name: 'RatOS/ — le dépôt en lecture seule',
                edit: false,
                items: ['boards/ — alias de pins et sections [mcu]', 'printers/ — cinématique et dimensions', 'macros/ — START_PRINT, parking, mesh…', 'z-probe/ — sondes supportées nativement', 'extruders/, hotends/, steppers/, sensors/'],
              },
              {
                layer: '2',
                name: 'printer.cfg — ton fichier',
                edit: true,
                items: ['Les [include] qui sélectionnent les briques', 'Tes overrides, APRÈS les includes', 'Les sections que RatOS ne fournit pas (ex. [cartographer])', 'Les variables [gcode_macro RatOS]'],
              },
              {
                layer: '3',
                name: 'Bloc SAVE_CONFIG — géré par Klipper',
                edit: false,
                items: ['Résultats de PID_CALIBRATE', 'Z offset de la sonde', 'Données de calibration Cartographer', 'Ne jamais éditer à la main'],
              },
            ].map(l => (
              <div key={l.layer} className={`rounded-lg border p-4 ${l.edit ? 'border-green-800 bg-green-950/20' : 'border-gray-700 bg-gray-800/30'}`}>
                <div className="flex items-center gap-2.5 mb-2">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${l.edit ? 'bg-green-700' : 'bg-gray-700'}`}>
                    {l.layer}
                  </span>
                  <span className="text-sm font-semibold text-gray-200">{l.name}</span>
                  {l.edit
                    ? <span className="ml-auto flex items-center gap-1 text-xs text-green-400"><CheckCircle2 size={12} /> à éditer</span>
                    : <span className="ml-auto flex items-center gap-1 text-xs text-red-400"><XCircle size={12} /> ne pas toucher</span>}
                </div>
                <ul className="space-y-0.5 ml-8">
                  {l.items.map(it => (
                    <li key={it} className="text-xs text-gray-400">• {it}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="p-3 rounded-lg border border-blue-900/60 bg-blue-950/20">
            <div className="text-xs font-semibold text-blue-200 mb-1.5">L'ordre des includes compte</div>
            <p className="text-xs text-gray-400 leading-relaxed">
              Klipper lit le fichier de haut en bas : la <strong className="text-gray-200">dernière</strong> définition
              d'une clé gagne. C'est pour ça que tes overrides doivent venir <strong className="text-gray-200">après</strong>{' '}
              tous les <code className="bg-gray-800 px-1 rounded">[include]</code>. Si tu mets un{' '}
              <code className="bg-gray-800 px-1 rounded">[stepper_z]</code> avant l'include de la cinématique,
              il sera silencieusement écrasé.
            </p>
          </div>
        </div>
      </Section>

      {/* ── Contenu d'un dossier board ────────────────────────────────────── */}
      <Section id="boards" title="Anatomie d'un dossier board" icon={FileCode}>
        <p className="text-xs text-gray-400 mb-3">
          Chaque carte supportée a son dossier sous <code className="bg-gray-800 px-1 rounded">RatOS/boards/</code>.
          Pour ton matériel : <code className="text-orange-300">btt-octopus-pro-446</code> et{' '}
          <code className="text-orange-300">btt-ebb42-11</code>.
        </p>
        <div className="space-y-1.5">
          {BOARD_FILES.map(f => (
            <div key={f.f} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 p-2.5 rounded-lg border border-gray-800 bg-gray-800/30">
              <code className="text-xs text-orange-300 font-mono">{f.f}</code>
              <span className="text-xs text-gray-500">{f.d}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 p-3 rounded-lg border border-yellow-900/60 bg-yellow-950/20">
          <div className="flex items-start gap-2">
            <AlertTriangle size={13} className="text-yellow-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-yellow-200 leading-relaxed">
              <strong>Il n'existe pas de dossier board pour le U2C.</strong> Dans le modèle RatOS, le U2C n'est
              pas un microcontrôleur Klipper : c'est un adaptateur qui fait apparaître l'interface réseau{' '}
              <code className="bg-yellow-900/40 px-1 rounded">can0</code> sous Linux. Une section{' '}
              <code className="bg-yellow-900/40 px-1 rounded">[mcu u2c]</code> dans printer.cfg n'est pas
              nécessaire, et devient un point de panne supplémentaire si le firmware du U2C change.
            </div>
          </div>
        </div>
      </Section>

      {/* ── Ton matériel → RatOS ──────────────────────────────────────────── */}
      <Section id="mapping" title="Tes composants dans RatOS" icon={CheckCircle2}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left py-2 pr-3 font-medium">Composant</th>
                <th className="text-left py-2 pr-3 font-medium">Support RatOS</th>
                <th className="text-left py-2 font-medium">Comment l'intégrer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {[
                {
                  c: 'Octopus Pro 446',
                  s: 'natif', ok: true,
                  h: <><code className="text-orange-300">[include RatOS/boards/btt-octopus-pro-446/config.cfg]</code> — rien d'autre à faire</>,
                },
                {
                  c: 'EBB42 v1.1',
                  s: 'natif', ok: true,
                  h: <><code className="text-orange-300">[include RatOS/boards/btt-ebb42-11/toolboard-config.cfg]</code>, puis surcharger <code className="text-orange-300">[mcu toolboard]</code> avec <code>canbus_uuid</code> pour passer d'USB à CAN</>,
                },
                {
                  c: 'BTT U2C v2.1',
                  s: 'hors modèle', ok: null,
                  h: <>Aucune section Klipper. Il fournit <code className="text-orange-300">can0</code> ; c'est tout ce dont Klipper a besoin</>,
                },
                {
                  c: 'Cartographer',
                  s: 'non fourni', ok: false,
                  h: <>Plugin tiers : installer <code className="text-orange-300">cartographer-klipper</code>, puis écrire <code className="text-orange-300">[cartographer]</code> à la main dans printer.cfg</>,
                },
              ].map(r => (
                <tr key={r.c}>
                  <td className="py-2.5 pr-3 font-semibold text-gray-200 whitespace-nowrap">{r.c}</td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded text-xs border ${
                      r.ok === true ? 'text-green-400 border-green-800 bg-green-950/40'
                      : r.ok === false ? 'text-red-400 border-red-800 bg-red-950/40'
                      : 'text-gray-400 border-gray-700 bg-gray-800/40'
                    }`}>{r.s}</span>
                  </td>
                  <td className="py-2.5 text-gray-400 leading-relaxed">{r.h}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── La question Cartographer ──────────────────────────────────────── */}
      <Section id="cartographer" title="Le cas Cartographer — à lire" icon={AlertTriangle}>
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-red-900/60 bg-red-950/20">
            <p className="text-xs text-gray-300 leading-relaxed">
              RatOS v2.1 fournit ces sondes nativement :
            </p>
            <div className="flex flex-wrap gap-1.5 my-2.5">
              {RATOS_ZPROBES.map(z => (
                <code key={z} className="px-2 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-300 text-xs">
                  {z}
                </code>
              ))}
            </div>
            <p className="text-xs text-red-200 leading-relaxed">
              <strong>Le Cartographer n'y est pas.</strong> Beacon oui, Cartographer non. Ton Cartographer
              fonctionne donc via un plugin tiers installé séparément, qui pose des liens symboliques dans{' '}
              <code className="bg-red-900/40 px-1 rounded">~/klipper/klippy/extras/</code>.
            </p>
          </div>

          <div>
            <div className="text-xs font-semibold text-gray-300 mb-2">Ce que ça implique</div>
            <div className="space-y-2">
              {[
                'Le plugin doit rester compatible avec ta version de Klipper. RatOS met Klipper à jour tout seul — le plugin, non. C\'est la source de panne la plus fréquente après une mise à jour.',
                'Beacon et Cartographer ne doivent jamais être chargés en même temps : les deux veulent être la sonde Z.',
                'Aucun [include RatOS/z-probe/*.cfg] ne doit rester actif si tu utilises le Cartographer.',
                'Une erreur au démarrage citant « probe » vient presque toujours du plugin, pas de ta config. Le traceback dans klippy.log nomme le module fautif — l\'onglet Terminal le lit et le met en évidence.',
              ].map((t, i) => (
                <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg border border-gray-800 bg-gray-800/30">
                  <span className="text-orange-500 text-xs mt-0.5 flex-shrink-0">▸</span>
                  <span className="text-xs text-gray-400 leading-relaxed">{t}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-gray-300 mb-2">Vérifier l'état des plugins de sonde</div>
            {[
              'ls -la ~/klipper/klippy/extras/ | grep -E "cartographer|beacon|scanner"',
              'cd ~/cartographer-klipper && git log --oneline -3 && git status -sb',
              'grep -rn "z-probe\\|beacon\\|cartographer" ~/printer_data/config/printer.cfg',
            ].map(c => (
              <div key={c} className="flex items-start gap-2 my-1.5">
                <code className="flex-1 text-xs text-orange-300 font-mono bg-gray-950 border border-gray-800 px-2 py-1.5 rounded break-all">{c}</code>
                <button onClick={() => copy(c)} title="Copier"
                  className="flex-shrink-0 text-gray-600 hover:text-gray-300 px-2 py-1.5 transition-colors">
                  <Copy size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── printer.cfg généré ────────────────────────────────────────────── */}
      <Section id="generated" title="printer.cfg façon RatOS — généré pour ta machine" icon={FileCode}>
        <div className="space-y-3">
          <p className="text-xs text-gray-400 leading-relaxed">
            Squelette respectant la structure RatOS, rempli avec tes réglages actuels. Les emplacements
            marqués <code className="bg-gray-800 px-1 rounded">&lt;…&gt;</code> dépendent de ce qui est réellement
            installé sur ta machine — les commandes plus bas te donnent la liste exacte.
          </p>
          <div className="relative">
            <pre className="bg-gray-950 border border-gray-800 rounded-lg p-4 text-xs font-mono text-gray-300 overflow-auto max-h-[520px] whitespace-pre">
              {cfg}
            </pre>
            <button onClick={() => copy(cfg)}
              className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs transition-colors">
              <Copy size={11} /> {copied ? 'Copié' : 'Copier'}
            </button>
          </div>
          <div className="p-3 rounded-lg border border-yellow-900/60 bg-yellow-950/20 text-xs text-yellow-200 leading-relaxed">
            ⚠ Sauvegarde ton fichier actuel avant de remplacer quoi que ce soit :{' '}
            <code className="bg-yellow-900/40 px-1 rounded">cp ~/printer_data/config/printer.cfg ~/printer.cfg.bak</code>
          </div>
        </div>
      </Section>

      {/* ── Commandes de découverte ───────────────────────────────────────── */}
      <Section id="discover" title="Découvrir ce qui existe sur ta machine" icon={Terminal}>
        <p className="text-xs text-gray-400 mb-3">
          Plutôt que de deviner les noms de fichiers, demande-les à ta propre installation.
        </p>
        <div className="space-y-3">
          {[
            { label: 'Briques RatOS disponibles', cmds: [
              'ls ~/printer_data/config/RatOS/printers/v-core-3/',
              'ls ~/printer_data/config/RatOS/extruders/',
              'ls ~/printer_data/config/RatOS/hotends/',
              'ls ~/printer_data/config/RatOS/z-probe/',
              'ls ~/printer_data/config/RatOS/boards/ | grep -E "octopus|ebb42"',
            ]},
            { label: 'Ce que ta config inclut réellement', cmds: [
              'grep -n "include" ~/printer_data/config/printer.cfg',
              'grep -n "^\\[" ~/printer_data/config/printer.cfg',
            ]},
            { label: 'Version de RatOS et état git', cmds: [
              'cat ~/printer_data/config/RatOS/.git/HEAD 2>/dev/null; cd ~/printer_data/config/RatOS && git describe --tags 2>/dev/null',
              'cd ~/klipper && git log --oneline -1',
            ]},
          ].map(g => (
            <div key={g.label}>
              <div className="text-xs font-semibold text-gray-400 mb-1.5">{g.label}</div>
              {g.cmds.map(c => (
                <div key={c} className="flex items-start gap-2 mb-1.5">
                  <code className="flex-1 text-xs text-orange-300 font-mono bg-gray-950 border border-gray-800 px-2 py-1.5 rounded break-all">{c}</code>
                  <button onClick={() => copy(c)} title="Copier"
                    className="flex-shrink-0 text-gray-600 hover:text-gray-300 px-2 py-1.5 transition-colors">
                    <Copy size={12} />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Section>

      {/* ── Liens ─────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest mb-3">Sources</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { url: RATOS_REPO, label: 'RatOS-configuration (v2.1.x) — le dépôt de référence' },
            { url: `${RATOS_REPO}/boards`, label: 'Toutes les cartes supportées' },
            { url: `${RATOS_REPO}/z-probe`, label: 'Sondes Z fournies nativement' },
            { url: `${RATOS_REPO}/templates`, label: 'Templates de printer.cfg' },
            { url: 'https://github.com/Cartographer3D/cartographer-klipper', label: 'Plugin Cartographer' },
            { url: 'https://www.klipper3d.org/Config_Reference.html', label: 'Référence de configuration Klipper' },
          ].map(l => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer"
              className="flex items-center justify-between gap-2 p-3 rounded-lg border border-gray-800 bg-gray-800/30 hover:border-gray-600 transition-colors">
              <span className="text-xs text-gray-300">{l.label}</span>
              <ExternalLink size={12} className="text-gray-600 flex-shrink-0" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
