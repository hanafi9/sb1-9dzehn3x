import React from 'react';
import { PrinterConfig, MainBoard, ExtruderType, HotendType } from '../App';
import { Cpu, Usb, Zap, Layers, ChevronRight, AlertTriangle, Info, Wifi } from 'lucide-react';

interface Props {
  config: PrinterConfig;
  onChange: (p: Partial<PrinterConfig>) => void;
  onNext: () => void;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const BOARDS: { value: MainBoard; label: string; mcu: string; chip: string }[] = [
  { value: 'octopus_pro_446', label: 'BTT Octopus Pro 1.0 (F446)', mcu: 'stm32f446xx', chip: 'STM32F446' },
  { value: 'octopus_pro_429', label: 'BTT Octopus Pro 1.0 (H723)', mcu: 'stm32h723xx', chip: 'STM32H723' },
  { value: 'octopus_11',      label: 'BTT Octopus v1.1',            mcu: 'stm32f446xx', chip: 'STM32F446' },
  { value: 'manta_m8p',       label: 'BTT Manta M8P v2',            mcu: 'stm32g0b1xx', chip: 'STM32G0B1' },
];

const EXTRUDERS: { value: ExtruderType; label: string; rotDist: number; current: number; desc: string }[] = [
  { value: 'orbiter2',      label: 'Orbiter 2.0',        rotDist: 4.637,       current: 0.850, desc: 'LDO 36STH20-1004AHG — Recommandé RatOS' },
  { value: 'orbiter15',     label: 'Orbiter 1.5',        rotDist: 4.637,       current: 0.850, desc: 'Version précédente Orbiter' },
  { value: 'lgx_lite',      label: 'Bondtech LGX Lite',  rotDist: 5.7,         current: 0.700, desc: 'Léger, double engrenage' },
  { value: 'bmg',           label: 'Bondtech BMG',       rotDist: 22.6789511,  current: 0.650, desc: 'Classique fiable' },
  { value: 'sherpa_mini',   label: 'Annex Sherpa Mini',  rotDist: 22.6789511,  current: 0.650, desc: 'Léger et compact' },
  { value: 'vz_hextrudort', label: 'VzBot HextrudORT',  rotDist: 20.0,        current: 0.800, desc: 'Haute vitesse' },
];

const HOTENDS: { value: HotendType; label: string; sensorType: string; maxTemp: number }[] = [
  { value: 'dragon_uhf',   label: 'Phaetus Dragon UHF',   sensorType: 'ATC Semitec 104NT-4-R025H42G', maxTemp: 300 },
  { value: 'dragon_std',   label: 'Phaetus Dragon Standard', sensorType: 'ATC Semitec 104NT-4-R025H42G', maxTemp: 300 },
  { value: 'revo_voron',   label: 'E3D Revo Voron',       sensorType: 'PT1000',                       maxTemp: 300 },
  { value: 'rapido_uhf',   label: 'Phaetus Rapido UHF',   sensorType: 'ATC Semitec 104NT-4-R025H42G', maxTemp: 350 },
  { value: 'bambu_hotend', label: 'Bambu Lab Hotend',     sensorType: 'ATC Semitec 104NT-4-R025H42G', maxTemp: 300 },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ icon: Icon, title, badge, children }: {
  icon: React.ElementType;
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 sm:p-6">
      <div className="flex items-center gap-2 mb-4">
        <Icon size={15} className="text-orange-400" />
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">{title}</h3>
        {badge && (
          <span className="ml-auto text-xs px-2 py-0.5 rounded bg-orange-900/40 text-orange-400 border border-orange-800">
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function CardGrid<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; sub?: string; note?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`
            text-left px-4 py-3 rounded-lg border transition-all group
            ${value === opt.value
              ? 'border-orange-500 bg-orange-500/10 text-orange-300'
              : 'border-gray-700 bg-gray-800/40 text-gray-300 hover:border-gray-500 hover:bg-gray-800'
            }
          `}
        >
          <div className="font-medium text-sm">{opt.label}</div>
          {opt.sub && <div className="text-xs text-gray-500 mt-0.5">{opt.sub}</div>}
          {opt.note && (
            <div className={`text-xs mt-1 ${value === opt.value ? 'text-orange-400' : 'text-gray-600'}`}>
              {opt.note}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  hint,
  mono = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className={`w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 ${mono ? 'font-mono' : ''}`}
      />
      {hint && <p className="text-xs text-gray-600 mt-1">{hint}</p>}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function HardwareSetup({ config, onChange, onNext }: Props) {

  const serialFromBoard = (b: MainBoard) => {
    const m = BOARDS.find(x => x.value === b)!;
    return `/dev/serial/by-id/usb-Klipper_${m.mcu}_XXXXXXXXXX-if00`;
  };

  const uuidsComplete = config.ebb42Uuid.length >= 10 && config.cartographerUuid.length >= 10;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Matériel & Configuration CAN</h2>
        <p className="text-sm text-gray-400">
          VCore 3.1 400×400mm — BTT U2C v2.1 → EBB42 v1.2 → Cartographer CAN
        </p>
      </div>

      {/* Size */}
      <Section icon={Cpu} title="Volume d'impression">
        <div className="flex gap-3">
          {([300, 400, 500] as const).map(s => (
            <button
              key={s}
              onClick={() => onChange({ printerSize: s })}
              className={`flex-1 py-3 rounded-lg border font-bold text-base transition-all
                ${config.printerSize === s
                  ? 'border-orange-500 bg-orange-500/15 text-orange-300'
                  : 'border-gray-700 bg-gray-800/40 text-gray-400 hover:border-gray-500'
                }`}
            >
              {s}mm
              <div className="text-xs font-normal text-gray-500 mt-0.5">{s}×{s}×{s}</div>
            </button>
          ))}
        </div>
      </Section>

      {/* Main board */}
      <Section icon={Cpu} title="Carte mère (Main Board)">
        <CardGrid
          value={config.mainBoard}
          options={BOARDS.map(b => ({
            value: b.value,
            label: b.label,
            sub: b.chip,
            note: b.value === 'octopus_pro_446' ? '★ Recommandé RatOS VCore 3.1' : undefined,
          }))}
          onChange={v => onChange({ mainBoard: v, mainBoardSerial: serialFromBoard(v) })}
        />
        <div className="mt-4">
          <TextInput
            label="Port série MCU principal (à remplacer après ls /dev/serial/by-id/)"
            value={config.mainBoardSerial}
            onChange={v => onChange({ mainBoardSerial: v })}
            placeholder="/dev/serial/by-id/usb-Klipper_stm32f446xx_XXXX-if00"
          />
        </div>
      </Section>

      {/* CAN bus */}
      <Section icon={Wifi} title="Bus CAN" badge="U2C + EBB42 + Cartographer">
        <div className="mb-4 p-4 rounded-lg bg-blue-900/20 border border-blue-800 flex gap-3">
          <Info size={15} className="text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-blue-300 space-y-1">
            <p><strong>BTT U2C v2.1</strong> — Pas de configuration Klipper nécessaire. Il crée l'interface <code className="bg-blue-900/30 px-1 rounded">can0</code> automatiquement.</p>
            <p>Chaque device CAN a un UUID unique à 12 caractères hexadécimaux (ex: <code className="bg-blue-900/30 px-1 rounded">11aa22bb33cc</code>).</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {[500000, 1000000].map(speed => (
            <button
              key={speed}
              onClick={() => onChange({ canSpeed: speed as 500000 | 1000000 })}
              className={`px-4 py-2.5 rounded-lg border text-sm transition-all ${
                config.canSpeed === speed
                  ? 'border-orange-500 bg-orange-500/15 text-orange-300'
                  : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500'
              }`}
            >
              {speed === 500000 ? '500 kbps' : '1 Mbps'}
              <div className="text-xs text-gray-500 mt-0.5">
                {speed === 500000 ? '★ Standard EBB42' : 'EBB42 Gen2 uniquement'}
              </div>
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {/* CAN topology diagram */}
          <div className="rounded-lg border border-gray-700 bg-gray-800/30 p-4">
            <p className="text-xs text-gray-500 mb-3 uppercase tracking-wider">Topologie CAN Bus</p>
            <div className="flex items-center gap-2 flex-wrap text-xs">
              {[
                { label: 'Raspberry Pi', color: 'bg-purple-900/60 border-purple-700', note: 'USB-C' },
                { label: '→', color: '', note: '' },
                { label: 'BTT U2C v2.1', color: 'bg-blue-900/60 border-blue-700', note: '120Ω ✓', tag: 'TERM' },
                { label: '─CAN─', color: '', note: '' },
                { label: 'EBB42 v1.2', color: 'bg-green-900/60 border-green-700', note: 'No term' },
                { label: '─CAN─', color: '', note: '' },
                { label: 'Cartographer', color: 'bg-orange-900/60 border-orange-700', note: '120Ω ✓', tag: 'TERM' },
              ].map((item, i) => (
                item.label.startsWith('─') || item.label === '→' ? (
                  <span key={i} className="text-gray-600 font-bold">{item.label}</span>
                ) : (
                  <div key={i} className={`flex flex-col items-center rounded border px-2 py-1.5 ${item.color}`}>
                    <span className="text-gray-200 font-medium">{item.label}</span>
                    <span className={`text-xs mt-0.5 ${item.note.includes('✓') ? 'text-green-400' : 'text-gray-500'}`}>
                      {item.note}
                    </span>
                    {item.tag && (
                      <span className="text-xs text-yellow-400 font-bold">{item.tag}</span>
                    )}
                  </div>
                )
              ))}
            </div>
            <div className="mt-2 text-xs text-yellow-400 flex items-center gap-1.5">
              <AlertTriangle size={11} />
              <span>Résistances 120Ω aux deux extrémités du bus uniquement (U2C + Cartographer)</span>
            </div>
          </div>

          {/* UUID inputs */}
          <TextInput
            label="UUID EBB42 v1.2 (canbus_uuid)"
            value={config.ebb42Uuid}
            onChange={v => onChange({ ebb42Uuid: v.toLowerCase().replace(/[^0-9a-f]/g, '') })}
            placeholder="11aa22bb33cc (12 caractères hex)"
            hint="Trouvé avec : ~/klippy-env/bin/python ~/klipper/scripts/canbus_query.py can0"
          />
          <TextInput
            label="UUID Cartographer CAN (canbus_uuid)"
            value={config.cartographerUuid}
            onChange={v => onChange({ cartographerUuid: v.toLowerCase().replace(/[^0-9a-f]/g, '') })}
            placeholder="44dd55ee66ff (12 caractères hex)"
            hint="Application: Cartographer — visible dans la sortie canbus_query.py"
          />

          {!uuidsComplete && (
            <div className="p-3 rounded-lg bg-yellow-900/20 border border-yellow-800 flex gap-2 text-xs text-yellow-300">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
              <span>
                UUIDs non renseignés — des placeholders seront utilisés dans le fichier généré.
                Consultez l'onglet <strong>Guide CAN Bus</strong> pour la procédure de découverte.
              </span>
            </div>
          )}
        </div>
      </Section>

      {/* Extruder */}
      <Section icon={Zap} title="Extrudeur">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {EXTRUDERS.map(e => (
            <button
              key={e.value}
              onClick={() => onChange({ extruder: e.value })}
              className={`text-left px-4 py-3 rounded-lg border transition-all ${
                config.extruder === e.value
                  ? 'border-orange-500 bg-orange-500/10 text-orange-300'
                  : 'border-gray-700 bg-gray-800/40 text-gray-300 hover:border-gray-500'
              }`}
            >
              <div className="font-medium text-sm">{e.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{e.desc}</div>
              <div className="flex gap-3 mt-1.5 text-xs">
                <span className={config.extruder === e.value ? 'text-orange-400' : 'text-gray-600'}>
                  rot: {e.rotDist}
                </span>
                <span className={config.extruder === e.value ? 'text-orange-400' : 'text-gray-600'}>
                  {e.current}A
                </span>
              </div>
            </button>
          ))}
        </div>
      </Section>

      {/* Hotend */}
      <Section icon={Layers} title="Hotend">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-4">
          {HOTENDS.map(h => (
            <button
              key={h.value}
              onClick={() => onChange({ hotend: h.value })}
              className={`text-left px-4 py-3 rounded-lg border transition-all ${
                config.hotend === h.value
                  ? 'border-orange-500 bg-orange-500/10 text-orange-300'
                  : 'border-gray-700 bg-gray-800/40 text-gray-300 hover:border-gray-500'
              }`}
            >
              <div className="font-medium text-sm">{h.label}</div>
              <div className="text-xs text-gray-500 mt-0.5 truncate">{h.sensorType.split(' ')[0]}…</div>
              <div className={`text-xs mt-1 ${config.hotend === h.value ? 'text-orange-400' : 'text-gray-600'}`}>
                max {h.maxTemp}°C
              </div>
            </button>
          ))}
        </div>

        {/* Nozzle */}
        <div>
          <label className="block text-xs text-gray-400 mb-2">Diamètre buse</label>
          <div className="flex gap-2">
            {([0.4, 0.6, 0.8] as const).map(d => (
              <button
                key={d}
                onClick={() => onChange({ nozzleDiameter: d })}
                className={`px-4 py-2 rounded-lg border text-sm transition-all ${
                  config.nozzleDiameter === d
                    ? 'border-orange-500 bg-orange-500/15 text-orange-300'
                    : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500'
                }`}
              >
                {d} mm
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* Accessories */}
      <Section icon={Usb} title="Accessoires">
        <div className="space-y-4">
          {[
            { key: 'hasChamberSensor' as const, label: 'Capteur température enceinte', pin: 'chamberSensorPin' as const, pinLabel: 'Pin NTC 100K', defaultPin: 'PF4' },
            { key: 'hasChamberFan'   as const, label: 'Ventilateur enceinte', pin: 'chamberFanPin'   as const, pinLabel: 'Pin PWM fan', defaultPin: 'PA8' },
            { key: 'hasCOBLed'      as const, label: 'LED COB chambre (PWM)', pin: 'cobLedPin'      as const, pinLabel: 'Pin COB LED', defaultPin: 'PB10' },
            { key: 'hasNeopixel'    as const, label: 'Strip Neopixel / WS2812', pin: 'neopixelPin'   as const, pinLabel: 'Pin DATA', defaultPin: 'PB0' },
          ].map(item => (
            <div key={item.key} className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <button
                  onClick={() => onChange({ [item.key]: !config[item.key] })}
                  className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${
                    config[item.key] ? 'bg-orange-500' : 'bg-gray-700'
                  }`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    config[item.key] ? 'translate-x-5' : 'translate-x-0.5'
                  }`} />
                </button>
                <span className="text-sm text-gray-200">{item.label}</span>
              </label>
              {config[item.key] && (
                <div className="ml-13 pl-13">
                  <input
                    type="text"
                    value={config[item.pin]}
                    placeholder={item.defaultPin}
                    onChange={e => onChange({ [item.pin]: e.target.value })}
                    className="w-40 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-orange-300 font-mono focus:outline-none focus:border-orange-500"
                  />
                  <span className="text-xs text-gray-600 ml-2">{item.pinLabel}</span>
                </div>
              )}
              {item.key === 'hasNeopixel' && config.hasNeopixel && (
                <div className="ml-13 pl-13 flex items-center gap-2">
                  <input
                    type="number"
                    value={config.neopixelCount}
                    min={1}
                    max={200}
                    onChange={e => onChange({ neopixelCount: parseInt(e.target.value) || 24 })}
                    className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-orange-500"
                  />
                  <span className="text-xs text-gray-600">LEDs</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* Summary + next */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between p-4 rounded-xl border border-gray-700 bg-gray-800/40">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          {[
            { label: 'Plateau',    value: `${config.printerSize}×${config.printerSize}mm` },
            { label: 'Board',      value: BOARDS.find(b => b.value === config.mainBoard)?.chip ?? '' },
            { label: 'Extrudeur', value: EXTRUDERS.find(e => e.value === config.extruder)?.label ?? '' },
            { label: 'UUIDs',     value: uuidsComplete ? '✓ Renseignés' : '⚠ Manquants' },
          ].map(item => (
            <div key={item.label}>
              <div className="text-xs text-gray-500">{item.label}</div>
              <div className="text-orange-300 font-medium mt-0.5">{item.value}</div>
            </div>
          ))}
        </div>
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-medium text-sm transition-colors flex-shrink-0"
        >
          Guide CAN Bus <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

