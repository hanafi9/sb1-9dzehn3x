import React, { useState } from 'react';
import { HardwareSetup } from './components/HardwareSetup';
import { CANGuide } from './components/CANGuide';
import { CartographerSetup } from './components/CartographerSetup';
import { BedMeshMap } from './components/BedMeshMap';
import { ConfigGenerator } from './components/ConfigGenerator';
import { PrinterDiagnostic } from './components/PrinterDiagnostic';
import { Cpu, Wifi, Crosshair, Grid3X3, FileCode, Activity } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MainBoard = 'octopus_pro_446' | 'octopus_pro_429' | 'octopus_11' | 'manta_m8p';
export type ExtruderType = 'orbiter2' | 'orbiter15' | 'lgx_lite' | 'bmg' | 'sherpa_mini' | 'vz_hextrudort';
export type HotendType = 'dragon_uhf' | 'dragon_std' | 'revo_voron' | 'rapido_uhf' | 'bambu_hotend';
export type CANSpeed = 500000 | 1000000;
export type CartographerAPI = 'scanner' | 'classic';

export interface PrinterConfig {
  // Printer
  printerSize: 300 | 400 | 500;

  // Main board
  mainBoard: MainBoard;
  mainBoardSerial: string;

  // CAN bus
  canSpeed: CANSpeed;
  ebb42Uuid: string;
  cartographerUuid: string;
  hasU2C: boolean;

  // Toolhead
  extruder: ExtruderType;
  hotend: HotendType;
  nozzleDiameter: 0.4 | 0.6 | 0.8;

  // Cartographer
  cartographerAPI: CartographerAPI;
  cartographerXOffset: number;
  cartographerYOffset: number;
  cartographerBacklashComp: number;
  cartographerMeshRuns: number;

  // Bed mesh
  meshMinX: number;
  meshMinY: number;
  meshMaxX: number;
  meshMaxY: number;
  meshPointsX: number;
  meshPointsY: number;
  meshFadeStart: number;
  meshFadeEnd: number;

  // Motion
  maxVelocity: number;
  maxAccel: number;
  pressureAdvance: number;

  // Accessories
  hasChamberSensor: boolean;
  chamberSensorPin: string;
  hasChamberFan: boolean;
  chamberFanPin: string;
  hasCOBLed: boolean;
  cobLedPin: string;
  hasNeopixel: boolean;
  neopixelPin: string;
  neopixelCount: number;
}

export function defaultConfig(size: PrinterConfig['printerSize'] = 400): PrinterConfig {
  return {
    printerSize: size,
    mainBoard: 'octopus_pro_446',
    mainBoardSerial: '/dev/serial/by-id/usb-Klipper_stm32f446xx_XXXXXXXXXX-if00',
    canSpeed: 500000,
    ebb42Uuid: '',
    cartographerUuid: '',
    hasU2C: true,
    extruder: 'orbiter2',
    hotend: 'dragon_uhf',
    nozzleDiameter: 0.4,
    cartographerAPI: 'scanner',
    cartographerXOffset: 0,
    cartographerYOffset: 21.1,
    cartographerBacklashComp: 0.5,
    cartographerMeshRuns: 2,
    meshMinX: 20,
    meshMinY: 20,
    meshMaxX: size - 20,
    meshMaxY: size - 20,
    meshPointsX: 25,
    meshPointsY: 25,
    meshFadeStart: 1.0,
    meshFadeEnd: 10.0,
    maxVelocity: 500,
    maxAccel: 10000,
    pressureAdvance: 0.03,
    hasChamberSensor: true,
    chamberSensorPin: 'PF4',
    hasChamberFan: false,
    chamberFanPin: 'PA8',
    hasCOBLed: false,
    cobLedPin: 'PB10',
    hasNeopixel: false,
    neopixelPin: 'PB0',
    neopixelCount: 24,
  };
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'hardware',    label: 'Matériel & CAN', icon: Cpu,      desc: 'Board, UUID, EBB42' },
  { id: 'can',         label: 'Guide CAN Bus',  icon: Wifi,     desc: 'Katapult, flash, réseau' },
  { id: 'probe',       label: 'Cartographer',   icon: Crosshair,desc: 'Config probe, offsets' },
  { id: 'mesh',        label: 'Bed Mesh',       icon: Grid3X3,  desc: 'Cartographie plateau' },
  { id: 'config',      label: 'printer.cfg',    icon: FileCode, desc: 'Config finale complète' },
  { id: 'diagnostic',  label: 'Diagnostic',     icon: Activity, desc: 'Connexion Moonraker live' },
] as const;

type TabId = typeof TABS[number]['id'];

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [config, setConfig] = useState<PrinterConfig>(defaultConfig(400));
  const [activeTab, setActiveTab] = useState<TabId>('hardware');

  const update = (partial: Partial<PrinterConfig>) =>
    setConfig(prev => {
      const next = { ...prev, ...partial };
      if (partial.printerSize) {
        next.meshMaxX = partial.printerSize - 20;
        next.meshMaxY = partial.printerSize - 20;
        next.mainBoardSerial = prev.mainBoardSerial;
      }
      return next;
    });

  const activeIdx = TABS.findIndex(t => t.id === activeTab);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center font-black text-sm text-white flex-shrink-0 shadow-lg">
              R3
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-white tracking-tight truncate">
                Ratrig VCore 3.1 — Configurateur RatOS v2.1
              </h1>
              <p className="text-xs text-gray-500 truncate">
                CAN Bus · EBB42 v1.2 · Cartographer · U2C v2.1
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="hidden sm:flex px-2 py-1 rounded text-xs bg-green-900/50 text-green-400 border border-green-800">
              RatOS v2.1
            </span>
            <span className="px-2 py-1 rounded text-xs bg-orange-900/50 text-orange-400 border border-orange-800">
              {config.printerSize}×{config.printerSize}mm
            </span>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="border-b border-gray-800 bg-gray-900/70 backdrop-blur sticky top-[57px] z-40">
        <div className="max-w-7xl mx-auto px-2 sm:px-6 overflow-x-auto">
          <div className="flex min-w-max">
            {TABS.map((tab, i) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              const done = i < activeIdx;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    flex items-center gap-2 px-3 sm:px-5 py-3 text-xs sm:text-sm border-b-2 transition-all whitespace-nowrap
                    ${active
                      ? 'border-orange-500 text-orange-400 bg-orange-500/5'
                      : done
                      ? 'border-green-800 text-gray-400 hover:text-gray-200'
                      : 'border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-600'
                    }
                  `}
                >
                  <Icon size={14} className={active ? 'text-orange-400' : done ? 'text-green-500' : ''} />
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {activeTab === 'hardware'   && <HardwareSetup    config={config} onChange={update} onNext={() => setActiveTab('can')} />}
        {activeTab === 'can'        && <CANGuide          config={config} onChange={update} onNext={() => setActiveTab('probe')} />}
        {activeTab === 'probe'      && <CartographerSetup config={config} onChange={update} onNext={() => setActiveTab('mesh')} />}
        {activeTab === 'mesh'       && <BedMeshMap        config={config} onChange={update} onNext={() => setActiveTab('config')} />}
        {activeTab === 'config'     && <ConfigGenerator   config={config} />}
        {activeTab === 'diagnostic' && <PrinterDiagnostic />}
      </main>

      <footer className="border-t border-gray-800 bg-gray-900 mt-8 py-4 text-center text-xs text-gray-600">
        Ratrig VCore 3.1 Config — EBB42 v1.2 + BTT U2C v2.1 + Cartographer CAN — RatOS v2.1
      </footer>
    </div>
  );
}
