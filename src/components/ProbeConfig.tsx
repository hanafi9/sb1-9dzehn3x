import React from 'react';
import { PrinterConfig, ProbeType } from '../App';
import { Radio, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';

interface Props {
  config: PrinterConfig;
  onChange: (p: Partial<PrinterConfig>) => void;
}

const PROBES: {
  value: ProbeType;
  label: string;
  desc: string;
  accuracy: string;
  xOff: number;
  yOff: number;
  hasZOffset: boolean;
  tag: string;
  tagColor: string;
}[] = [
  {
    value: 'beacon',
    label: 'Beacon',
    desc: 'Probe inductif par résonance — précision sub-micron',
    accuracy: '< 0.001mm',
    xOff: 0,
    yOff: 20,
    hasZOffset: true,
    tag: 'Recommandé',
    tagColor: 'green',
  },
  {
    value: 'cartographer',
    label: 'Cartographer',
    desc: 'Probe inductif rapide — scan continu du plateau',
    accuracy: '< 0.002mm',
    xOff: 0,
    yOff: 21,
    hasZOffset: true,
    tag: 'Rapide',
    tagColor: 'blue',
  },
  {
    value: 'klicky',
    label: 'Klicky Probe',
    desc: 'Probe magnétique mécanique — fiable, répétable',
    accuracy: '< 0.005mm',
    xOff: -1.5,
    yOff: 35.5,
    hasZOffset: true,
    tag: 'DIY',
    tagColor: 'purple',
  },
  {
    value: 'euclid',
    label: 'Euclid Probe',
    desc: 'Probe magnétique monté par docking',
    accuracy: '< 0.005mm',
    xOff: -2,
    yOff: 30,
    hasZOffset: true,
    tag: 'DIY',
    tagColor: 'purple',
  },
  {
    value: 'bltouch',
    label: 'BL-Touch',
    desc: 'Probe servo électromagnétique — standard',
    accuracy: '< 0.01mm',
    xOff: -31,
    yOff: -36,
    hasZOffset: true,
    tag: 'Standard',
    tagColor: 'orange',
  },
  {
    value: 'crtouch',
    label: 'CR-Touch',
    desc: 'Probe optique — compatible BL-Touch',
    accuracy: '< 0.01mm',
    xOff: -31,
    yOff: -36,
    hasZOffset: true,
    tag: 'Standard',
    tagColor: 'orange',
  },
];

function NumInput({
  label,
  value,
  onChange,
  step = 0.1,
  min,
  max,
  unit = 'mm',
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30"
        />
        <span className="text-xs text-gray-500 whitespace-nowrap">{unit}</span>
      </div>
      {hint && <p className="text-xs text-gray-600 mt-1">{hint}</p>}
    </div>
  );
}

export function ProbeConfig({ config, onChange }: Props) {
  const probe = PROBES.find(p => p.value === config.probe)!;
  const tagColors: Record<string, string> = {
    green: 'bg-green-900/40 text-green-400 border-green-800',
    blue: 'bg-blue-900/40 text-blue-400 border-blue-800',
    purple: 'bg-purple-900/40 text-purple-400 border-purple-800',
    orange: 'bg-orange-900/40 text-orange-400 border-orange-800',
  };

  const applyDefaultOffsets = () => {
    onChange({ probeXOffset: probe.xOff, probeYOffset: probe.yOff });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Probe & Calibration</h2>
        <p className="text-sm text-gray-400">Sélectionnez votre type de sonde et configurez les offsets</p>
      </div>

      {/* Probe selection */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Radio size={16} className="text-orange-400" />
          <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Type de Probe</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {PROBES.map(p => (
            <button
              key={p.value}
              onClick={() => onChange({ probe: p.value, probeXOffset: p.xOff, probeYOffset: p.yOff })}
              className={`
                text-left p-4 rounded-lg border transition-all
                ${config.probe === p.value
                  ? 'border-orange-500 bg-orange-500/10'
                  : 'border-gray-700 bg-gray-800/40 hover:border-gray-500'
                }
              `}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className={`font-semibold text-sm ${config.probe === p.value ? 'text-orange-300' : 'text-gray-200'}`}>
                  {p.label}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded border ${tagColors[p.tagColor]}`}>
                  {p.tag}
                </span>
              </div>
              <p className="text-xs text-gray-400 mb-2">{p.desc}</p>
              <div className="flex items-center gap-1">
                <CheckCircle2 size={11} className="text-green-500" />
                <span className="text-xs text-green-400">{p.accuracy}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Probe info banner */}
      {(config.probe === 'beacon' || config.probe === 'cartographer') && (
        <div className="rounded-lg border border-blue-800 bg-blue-900/20 p-4 flex gap-3">
          <Info size={16} className="text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-300">
            <strong>{probe.label}</strong> utilise un scan continu du plateau. Le z_offset sera calibré via{' '}
            <code className="bg-blue-900/40 px-1 rounded text-xs">BEACON_CALIBRATE</code> /{' '}
            <code className="bg-blue-900/40 px-1 rounded text-xs">CARTOGRAPHER_CALIBRATE</code>.
            Le mesh est généré en un seul passage rapide.
          </div>
        </div>
      )}

      {(config.probe === 'bltouch' || config.probe === 'crtouch') && (
        <div className="rounded-lg border border-yellow-800 bg-yellow-900/20 p-4 flex gap-3">
          <AlertTriangle size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-yellow-300">
            <strong>{probe.label}</strong> nécessite une vérification physique du câblage (5V/GND/IN/SEN/OUT).
            Utilisez <code className="bg-yellow-900/40 px-1 rounded text-xs">BLTOUCH_DEBUG COMMAND=pin_down</code> pour tester.
          </div>
        </div>
      )}

      {/* Offsets */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Offsets Probe → Buse</h3>
          <button
            onClick={applyDefaultOffsets}
            className="text-xs text-orange-400 hover:text-orange-300 underline underline-offset-2"
          >
            Valeurs par défaut {probe.label}
          </button>
        </div>

        {/* Visual offset diagram */}
        <div className="mb-6 bg-gray-800/50 rounded-lg p-4 border border-gray-700">
          <div className="relative w-48 h-48 mx-auto">
            {/* Grid */}
            <div className="absolute inset-0 grid grid-cols-4 grid-rows-4 opacity-10">
              {Array.from({ length: 16 }).map((_, i) => (
                <div key={i} className="border border-gray-400" />
              ))}
            </div>
            {/* Nozzle */}
            <div
              className="absolute w-4 h-4 bg-orange-500 rounded-full border-2 border-orange-300 flex items-center justify-center"
              style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
              title="Buse"
            />
            {/* Probe */}
            {(() => {
              const scale = 96 / (config.size / 2);
              const px = 50 + (config.probeXOffset * scale) / 96 * 50;
              const py = 50 - (config.probeYOffset * scale) / 96 * 50;
              return (
                <>
                  <svg className="absolute inset-0 w-full h-full" viewBox="0 0 192 192">
                    <line
                      x1="96" y1="96"
                      x2={`${96 + config.probeXOffset * scale}`}
                      y2={`${96 - config.probeYOffset * scale}`}
                      stroke="#f97316" strokeWidth="1" strokeDasharray="4 2" opacity="0.5"
                    />
                  </svg>
                  <div
                    className="absolute w-5 h-5 bg-blue-500/80 rounded border-2 border-blue-300 flex items-center justify-center"
                    style={{
                      left: `calc(50% + ${config.probeXOffset * scale}px - 10px)`,
                      top: `calc(50% - ${config.probeYOffset * scale}px - 10px)`,
                    }}
                    title="Probe"
                  />
                </>
              );
            })()}
            <div className="absolute bottom-1 left-1 text-xs text-orange-400">● Buse</div>
            <div className="absolute bottom-1 right-1 text-xs text-blue-400">■ Probe</div>
          </div>
          <p className="text-center text-xs text-gray-500 mt-2">Visualisation offsets (vue de dessus)</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <NumInput
            label="X Offset"
            value={config.probeXOffset}
            onChange={v => onChange({ probeXOffset: v })}
            step={0.1}
            unit="mm"
            hint="Probe à droite de la buse = positif"
          />
          <NumInput
            label="Y Offset"
            value={config.probeYOffset}
            onChange={v => onChange({ probeYOffset: v })}
            step={0.1}
            unit="mm"
            hint="Probe devant la buse = positif"
          />
          <NumInput
            label="Z Offset"
            value={config.probeZOffset}
            onChange={v => onChange({ probeZOffset: v })}
            step={0.001}
            unit="mm"
            hint="Calibré via PROBE_CALIBRATE"
          />
        </div>
      </div>

      {/* Probe parameters */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-6">
        <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider mb-4">Paramètres de sondage</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <NumInput
            label="Vitesse probe"
            value={config.probeSpeed}
            onChange={v => onChange({ probeSpeed: v })}
            step={0.5}
            min={1}
            max={20}
            unit="mm/s"
          />
          <NumInput
            label="Lift distance"
            value={config.probeLifts}
            onChange={v => onChange({ probeLifts: v })}
            step={0.5}
            min={0.5}
            max={10}
            unit="mm"
          />
          <NumInput
            label="Homing speed"
            value={config.homingSpeed}
            onChange={v => onChange({ homingSpeed: v })}
            step={5}
            min={10}
            max={150}
            unit="mm/s"
          />
          <NumInput
            label="Retract dist"
            value={config.homingRetractDist}
            onChange={v => onChange({ homingRetractDist: v })}
            step={0.5}
            min={0}
            max={10}
            unit="mm"
          />
        </div>
      </div>

      {/* Options */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-6">
        <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider mb-4">Options avancées</h3>
        <div className="space-y-3">
          {[
            { key: 'relativeMeshOrigin' as const, label: 'Relative Reference Index', desc: 'Centre du mesh comme point de référence Z' },
            { key: 'adaptiveMesh' as const, label: 'Adaptive Mesh (Klipper)', desc: 'Mesh adapté à la zone de l\'objet imprimé' },
            { key: 'bedScrews' as const, label: 'Vis de plateau (SCREWS_TILT_CALCULATE)', desc: 'Activer l\'assistant de tramage manuel' },
          ].map(opt => (
            <label key={opt.key} className="flex items-center gap-3 cursor-pointer group">
              <div
                onClick={() => onChange({ [opt.key]: !config[opt.key] })}
                className={`
                  w-10 h-5 rounded-full transition-colors flex-shrink-0 relative
                  ${config[opt.key] ? 'bg-orange-500' : 'bg-gray-700'}
                `}
              >
                <div className={`
                  absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform
                  ${config[opt.key] ? 'translate-x-5' : 'translate-x-0.5'}
                `} />
              </div>
              <div>
                <div className="text-sm text-gray-200 group-hover:text-white">{opt.label}</div>
                <div className="text-xs text-gray-500">{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
