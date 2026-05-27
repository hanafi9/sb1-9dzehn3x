import React from 'react';
import { PrinterConfig, BoardType, ExtruderType, HotendType, PrinterSize } from '../App';
import { Cpu, Layers, Zap, Box } from 'lucide-react';

interface Props {
  config: PrinterConfig;
  onChange: (p: Partial<PrinterConfig>) => void;
}

const SIZES: PrinterSize[] = [300, 400, 500];

const BOARDS: { value: BoardType; label: string; desc: string }[] = [
  { value: 'octopus_pro', label: 'BTT Octopus Pro', desc: 'F446/H723 — Recommandé RatOS' },
  { value: 'octopus', label: 'BTT Octopus v1.1', desc: 'STM32F446' },
  { value: 'manta_m8p', label: 'BTT Manta M8P', desc: 'CB1/CM4 intégré' },
  { value: 'skr_pro', label: 'BTT SKR Pro 1.2', desc: 'STM32F407' },
  { value: 'spider', label: 'Fysetc Spider v2', desc: 'STM32F446' },
];

const EXTRUDERS: { value: ExtruderType; label: string; desc: string }[] = [
  { value: 'orbiter2', label: 'Orbiter 2.0', desc: 'BMG + moteur LDO' },
  { value: 'lgx_lite', label: 'Bondtech LGX Lite', desc: 'Léger, haute performance' },
  { value: 'bmg', label: 'Bondtech BMG', desc: 'Double engrenage' },
  { value: 'hemera', label: 'E3D Hemera', desc: 'Direct drive intégré' },
];

const HOTENDS: { value: HotendType; label: string; desc: string }[] = [
  { value: 'dragon_uhf', label: 'Dragon UHF', desc: 'Ultra Haut Flux — recommandé' },
  { value: 'dragon_standard', label: 'Dragon Standard', desc: 'Polyvalent' },
  { value: 'revo_voron', label: 'Revo Voron', desc: 'Buse sans outil' },
  { value: 'rapido', label: 'Phaetus Rapido', desc: 'Haut débit' },
];

function SelectCard<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; desc: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`
            text-left px-4 py-3 rounded-lg border transition-all
            ${value === opt.value
              ? 'border-orange-500 bg-orange-500/10 text-orange-300'
              : 'border-gray-700 bg-gray-800/50 text-gray-300 hover:border-gray-500 hover:bg-gray-800'
            }
          `}
        >
          <div className="font-medium text-sm">{opt.label}</div>
          <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
        </button>
      ))}
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-6">
      <div className="flex items-center gap-2 mb-4">
        <Icon size={16} className="text-orange-400" />
        <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export function PrinterSettings({ config, onChange }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Configuration Imprimante</h2>
        <p className="text-sm text-gray-400">VCore 3.1 CoreXY — sélectionnez votre matériel</p>
      </div>

      {/* Size */}
      <Section icon={Box} title="Volume d'impression">
        <div className="flex gap-3">
          {SIZES.map(s => (
            <button
              key={s}
              onClick={() => onChange({ size: s })}
              className={`
                flex-1 py-4 rounded-lg border text-center font-bold text-lg transition-all
                ${config.size === s
                  ? 'border-orange-500 bg-orange-500/15 text-orange-300'
                  : 'border-gray-700 bg-gray-800/40 text-gray-400 hover:border-gray-500'
                }
              `}
            >
              {s}mm
              <div className="text-xs font-normal text-gray-500 mt-1">{s}×{s}×{s}</div>
            </button>
          ))}
        </div>
      </Section>

      {/* Board */}
      <Section icon={Cpu} title="Carte mère (Board)">
        <SelectCard value={config.board} options={BOARDS} onChange={v => onChange({ board: v })} />
      </Section>

      {/* Extruder */}
      <Section icon={Zap} title="Extrudeur">
        <SelectCard value={config.extruder} options={EXTRUDERS} onChange={v => onChange({ extruder: v })} />
      </Section>

      {/* Hotend */}
      <Section icon={Layers} title="Hotend">
        <SelectCard value={config.hotend} options={HOTENDS} onChange={v => onChange({ hotend: v })} />
      </Section>

      {/* Summary */}
      <div className="rounded-xl border border-gray-700 bg-gray-800/30 p-5">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Résumé configuration</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Volume', value: `${config.size}×${config.size}mm` },
            { label: 'Board', value: BOARDS.find(b => b.value === config.board)?.label ?? '' },
            { label: 'Extrudeur', value: EXTRUDERS.find(e => e.value === config.extruder)?.label ?? '' },
            { label: 'Hotend', value: HOTENDS.find(h => h.value === config.hotend)?.label ?? '' },
          ].map(item => (
            <div key={item.label}>
              <div className="text-xs text-gray-500">{item.label}</div>
              <div className="text-sm text-orange-300 font-medium mt-0.5">{item.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
