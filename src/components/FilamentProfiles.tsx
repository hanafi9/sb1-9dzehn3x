import { useState } from 'react';
import { Copy, Check, Download, FileJson, FolderDown, Info } from 'lucide-react';
import type { PrinterConfig } from '../App';

// ═══════════════════════════════════════════════════════════════════════════
//  Générateur de PROFILS FILAMENT OrcaSlicer — format .json VALIDE (importable).
//
//  Le piège classique (celui qui donne « 0 configuration importée ») :
//   - OrcaSlicer veut "type":"filament", "from":"User", "instantiation":"true"
//   - TOUTES les valeurs sont des TABLEAUX de CHAÎNES : ["240"], pas 240
//   - "inherits" pointe vers un profil de base système (fdm_filament_pla…)
//   - "compatible_printers": []  → compatible avec TOUTES les imprimantes
//  Réglés pour VCore 3.1 + Rapido HF + Orbiter (direct drive), buse 0.4.
// ═══════════════════════════════════════════════════════════════════════════

interface Props {
  config: PrinterConfig;
}

interface Mat {
  key: string;
  label: string;
  color: string;
  desc: string;
  build: (c: PrinterConfig) => Record<string, unknown>;
}

// Base commune à tous les profils (direct drive Orbiter + Rapido).
// La rétraction est volontairement courte (direct drive). Le Pressure Advance
// est DÉSACTIVÉ côté Orca car c'est Klipper qui le gère (sinon double effet).
function common(name: string, inherits: string, extra: Record<string, unknown>) {
  return {
    type: 'filament',
    name,
    from: 'User',
    instantiation: 'true',
    inherits,
    filament_vendor: ['Generic'],
    filament_diameter: ['1.75'],
    // rétraction direct drive (override filament)
    filament_retraction_length: ['0.8'],
    filament_retraction_speed: ['35'],
    // Pressure Advance géré par Klipper → coupé côté Orca
    enable_pressure_advance: ['0'],
    // compatible avec toutes les imprimantes → jamais rejeté à l'import
    compatible_printers: [] as string[],
    ...extra,
  };
}

const MATERIALS: Mat[] = [
  {
    key: 'pla',
    label: 'PLA',
    color: 'text-green-400',
    desc: 'Facile, pas de warping — refroidissement à fond',
    build: () =>
      common('Generic PLA — VCore3 Rapido', 'fdm_filament_pla', {
        filament_type: ['PLA'],
        nozzle_temperature_initial_layer: ['215'],
        nozzle_temperature: ['210'],
        hot_plate_temp_initial_layer: ['60'],
        hot_plate_temp: ['60'],
        cool_plate_temp_initial_layer: ['35'],
        cool_plate_temp: ['35'],
        filament_max_volumetric_speed: ['15'],
        filament_flow_ratio: ['0.98'],
        fan_min_speed: ['100'],
        fan_max_speed: ['100'],
        overhang_fan_speed: ['100'],
        overhang_fan_threshold: ['25%'],
        fan_cooling_layer_time: ['4'],
        slow_down_layer_time: ['4'],
        slow_down_min_speed: ['15'],
        close_fan_the_first_x_layers: ['1'],
        filament_notes: ['PLA generique VCore3.1 + Rapido HF + Orbiter direct drive. Refroidissement maximal des la couche 2.'],
      }),
  },
  {
    key: 'petg',
    label: 'PETG',
    color: 'text-cyan-400',
    desc: 'Solide mais colle — refroidissement modéré, sèche-le !',
    build: () =>
      common('Generic PETG — VCore3 Rapido', 'fdm_filament_pet', {
        filament_type: ['PETG'],
        nozzle_temperature_initial_layer: ['240'],
        nozzle_temperature: ['240'],
        hot_plate_temp_initial_layer: ['80'],
        hot_plate_temp: ['80'],
        filament_max_volumetric_speed: ['12'],
        filament_flow_ratio: ['0.95'],
        fan_min_speed: ['30'],
        fan_max_speed: ['50'],
        overhang_fan_speed: ['60'],
        overhang_fan_threshold: ['25%'],
        fan_cooling_layer_time: ['6'],
        slow_down_layer_time: ['8'],
        slow_down_min_speed: ['12'],
        close_fan_the_first_x_layers: ['3'],
        filament_notes: ['PETG : SECHER le filament (65C 4-6h) contre le stringing. Buse 240, lit 80. Trop de ventilo = delamination. Baton de colle sur PEI (le PETG arrache le PEI nu).'],
      }),
  },
  {
    key: 'abs',
    label: 'ABS',
    color: 'text-orange-400',
    desc: 'Warping — caisson FERMÉ obligatoire, ventilo quasi off',
    build: () =>
      common('Generic ABS — VCore3 Rapido', 'fdm_filament_abs', {
        filament_type: ['ABS'],
        nozzle_temperature_initial_layer: ['250'],
        nozzle_temperature: ['245'],
        hot_plate_temp_initial_layer: ['105'],
        hot_plate_temp: ['100'],
        filament_max_volumetric_speed: ['14'],
        filament_flow_ratio: ['0.95'],
        fan_min_speed: ['0'],
        fan_max_speed: ['20'],
        overhang_fan_speed: ['30'],
        overhang_fan_threshold: ['25%'],
        fan_cooling_layer_time: ['0'],
        slow_down_layer_time: ['8'],
        slow_down_min_speed: ['10'],
        close_fan_the_first_x_layers: ['3'],
        filament_notes: ['ABS : CAISSON FERME + chaud (40-50C) obligatoire. Lit 100-105, buse 245-250. Ventilo 0-20% max (refroidissement = warping). Brim 8mm + baton de colle. Zero courant dair.'],
      }),
  },
  {
    key: 'absplus',
    label: 'ABS+',
    color: 'text-amber-400',
    desc: 'Comme ABS, un peu plus chaud et souple',
    build: () =>
      common('Generic ABS+ — VCore3 Rapido', 'fdm_filament_abs', {
        filament_type: ['ABS'],
        nozzle_temperature_initial_layer: ['255'],
        nozzle_temperature: ['250'],
        hot_plate_temp_initial_layer: ['105'],
        hot_plate_temp: ['100'],
        filament_max_volumetric_speed: ['13'],
        filament_flow_ratio: ['0.96'],
        fan_min_speed: ['0'],
        fan_max_speed: ['15'],
        overhang_fan_speed: ['25'],
        overhang_fan_threshold: ['25%'],
        fan_cooling_layer_time: ['0'],
        slow_down_layer_time: ['10'],
        slow_down_min_speed: ['10'],
        close_fan_the_first_x_layers: ['4'],
        filament_notes: ['ABS+ : idem ABS mais buse 250-255, ventilo encore plus bas (0-15%). Caisson ferme et chaud imperatif. Excellente resistance mecanique, moins cassant que lABS standard.'],
      }),
  },
];

export function FilamentProfiles({ config }: Props) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);

  const mat = MATERIALS[active];
  const json = JSON.stringify(mat.build(config), null, 2);
  const fileName = `${mat.label}_VCore3_Rapido.json`;

  const copy = async () => {
    await navigator.clipboard.writeText(json).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const downloadOne = (m: Mat) => {
    const blob = new Blob([JSON.stringify(m.build(config), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${m.label}_VCore3_Rapido.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAll = () => MATERIALS.forEach((m, i) => setTimeout(() => downloadOne(m), i * 250));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">Profils Filament OrcaSlicer</h2>
          <p className="text-sm text-gray-400">
            Fichiers <code className="bg-gray-800 px-1 rounded">.json</code> au <strong>vrai format OrcaSlicer</strong>,
            réglés pour ta VCore 3.1 + Rapido + Orbiter direct drive.
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
          <p><strong>Import dans OrcaSlicer</strong> : Fichier → Importer → <em>Importer des configurations</em> → choisis le
            <code className="bg-blue-900/30 px-1 rounded mx-1">.json</code>. Il apparaît dans <em>Filament → Filaments personnalisés</em>.</p>
          <p className="text-blue-300/80">Pourquoi ça marche (et pas les fichiers de Copilot) : structure
            <code className="bg-blue-900/30 px-1 rounded mx-1">type:filament</code>,
            valeurs en <code className="bg-blue-900/30 px-1 rounded">["240"]</code>,
            <code className="bg-blue-900/30 px-1 rounded mx-1">compatible_printers: []</code> (toutes imprimantes),
            héritage d'un profil de base système.</p>
        </div>
      </div>

      {/* Sélecteur matériau */}
      <div className="flex flex-wrap gap-2">
        {MATERIALS.map((m, i) => (
          <button
            key={m.key}
            onClick={() => setActive(i)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition-all ${
              i === active
                ? 'border-orange-500 bg-orange-500/10 text-orange-300'
                : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:text-gray-200'
            }`}
          >
            <FileJson size={14} className={i === active ? 'text-orange-400' : m.color} />
            {m.label}
          </button>
        ))}
      </div>

      <div className="text-sm text-gray-400">
        <span className={`font-medium ${mat.color}`}>{mat.label}</span> — {mat.desc}
      </div>

      {/* Bloc JSON */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900">
          <div className="flex items-center gap-2">
            <FileJson size={14} className="text-orange-400" />
            <span className="text-sm text-gray-200 font-mono">{fileName}</span>
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
              onClick={() => downloadOne(mat)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700 text-sm text-gray-300 transition-all"
            >
              <Download size={13} />
              Télécharger
            </button>
          </div>
        </div>
        <pre className="p-4 overflow-x-auto text-xs leading-relaxed text-gray-300 max-h-[55vh]">
          <code>{json}</code>
        </pre>
      </div>

      <div className="p-4 rounded-lg border border-gray-800 bg-gray-900/40 text-xs text-gray-400 space-y-1">
        <p className="text-gray-200 font-medium mb-1">Rappels par matériau</p>
        <p>🟢 <strong>PLA</strong> : lit 60, buse 210, ventilo 100%. Le plus simple, aucun warping.</p>
        <p>🔵 <strong>PETG</strong> : lit 80, buse 240, ventilo 30-50%. <strong>Sécher le filament</strong> (anti-stringing) + bâton de colle sur PEI.</p>
        <p>🟠 <strong>ABS / ABS+</strong> : lit 100-105, buse 245-255, ventilo 0-20%. <strong>Caisson fermé et chaud obligatoire</strong> + brim.</p>
      </div>
    </div>
  );
}
