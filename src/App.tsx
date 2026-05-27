import React, { useState } from 'react';
import { PrinterSettings } from './components/PrinterSettings';
import { ProbeConfig } from './components/ProbeConfig';
import { BedMeshMap } from './components/BedMeshMap';
import { KlipperConfigGenerator } from './components/KlipperConfigGenerator';
import { Cpu, Radio, Grid3X3, FileCode, ChevronRight } from 'lucide-react';

export type ProbeType = 'bltouch' | 'crtouch' | 'beacon' | 'klicky' | 'cartographer' | 'euclid';
export type BoardType = 'octopus_pro' | 'octopus' | 'manta_m8p' | 'skr_pro' | 'spider';
export type ExtruderType = 'orbiter2' | 'lgx_lite' | 'bmg' | 'hemera';
export type HotendType = 'dragon_uhf' | 'dragon_standard' | 'revo_voron' | 'rapido';
export type PrinterSize = 300 | 400 | 500;

export interface PrinterConfig {
  size: PrinterSize;
  board: BoardType;
  extruder: ExtruderType;
  hotend: HotendType;
  probe: ProbeType;
  probeXOffset: number;
  probeYOffset: number;
  probeZOffset: number;
  probeSpeed: number;
  probeLifts: number;
  meshMinX: number;
  meshMinY: number;
  meshMaxX: number;
  meshMaxY: number;
  meshPointsX: number;
  meshPointsY: number;
  meshFadeStart: number;
  meshFadeEnd: number;
  meshAlgorithm: 'lagrange' | 'bicubic';
  homingSpeed: number;
  homingRetractDist: number;
  relativeMeshOrigin: boolean;
  adaptiveMesh: boolean;
  bedScrews: boolean;
}

const defaultConfig = (size: PrinterSize): PrinterConfig => ({
  size,
  board: 'octopus_pro',
  extruder: 'orbiter2',
  hotend: 'dragon_uhf',
  probe: 'beacon',
  probeXOffset: 0,
  probeYOffset: 0,
  probeZOffset: 0,
  probeSpeed: 5,
  probeLifts: 2,
  meshMinX: 30,
  meshMinY: 30,
  meshMaxX: size - 30,
  meshMaxY: size - 30,
  meshPointsX: 7,
  meshPointsY: 7,
  meshFadeStart: 0.6,
  meshFadeEnd: 10,
  meshAlgorithm: 'bicubic',
  homingSpeed: 60,
  homingRetractDist: 3,
  relativeMeshOrigin: true,
  adaptiveMesh: true,
  bedScrews: true,
});

const TABS = [
  { id: 'printer', label: 'Imprimante', icon: Cpu },
  { id: 'probe', label: 'Probe & Calibration', icon: Radio },
  { id: 'mesh', label: 'Cartographie Bed', icon: Grid3X3 },
  { id: 'config', label: 'Config Klipper', icon: FileCode },
] as const;

type TabId = typeof TABS[number]['id'];

export default function App() {
  const [config, setConfig] = useState<PrinterConfig>(defaultConfig(300));
  const [activeTab, setActiveTab] = useState<TabId>('printer');

  const updateConfig = (partial: Partial<PrinterConfig>) => {
    setConfig(prev => {
      const next = { ...prev, ...partial };
      if (partial.size && partial.size !== prev.size) {
        next.meshMaxX = partial.size - 30;
        next.meshMaxY = partial.size - 30;
      }
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-orange-500 flex items-center justify-center font-bold text-sm text-white">V3</div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">VCore 3.1 — RatOS v2.1</h1>
              <p className="text-xs text-gray-400">Configurateur Klipper • Probe & Bed Mesh</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-1 rounded bg-green-900/50 text-green-400 border border-green-800">
              RatOS v2.1
            </span>
            <span className="px-2 py-1 rounded bg-orange-900/50 text-orange-400 border border-orange-800">
              VCore 3.1 — {config.size}mm
            </span>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="border-b border-gray-800 bg-gray-900/50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex gap-0">
            {TABS.map((tab, i) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    flex items-center gap-2 px-5 py-3 text-sm border-b-2 transition-all
                    ${active
                      ? 'border-orange-500 text-orange-400 bg-orange-500/5'
                      : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
                    }
                  `}
                >
                  <Icon size={15} />
                  {tab.label}
                  {i < TABS.length - 1 && !active && (
                    <ChevronRight size={12} className="text-gray-700 ml-1" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {activeTab === 'printer' && (
          <PrinterSettings config={config} onChange={updateConfig} />
        )}
        {activeTab === 'probe' && (
          <ProbeConfig config={config} onChange={updateConfig} />
        )}
        {activeTab === 'mesh' && (
          <BedMeshMap config={config} onChange={updateConfig} />
        )}
        {activeTab === 'config' && (
          <KlipperConfigGenerator config={config} />
        )}
      </main>
    </div>
  );
}
