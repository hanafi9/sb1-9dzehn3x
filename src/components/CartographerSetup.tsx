import React from 'react';
import { PrinterConfig, CartographerAPI } from '../App';
import { Crosshair, ChevronRight, Info, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface Props {
  config: PrinterConfig;
  onChange: (p: Partial<PrinterConfig>) => void;
  onNext: () => void;
}

function NumInput({
  label, value, onChange, step = 0.1, min, max, unit = 'mm', hint,
}: {
  label: string; value: number; onChange: (v: number) => void;
  step?: number; min?: number; max?: number; unit?: string; hint?: string;
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

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 sm:p-6">
      <div className="flex items-center gap-2 mb-4">
        <Icon size={15} className="text-orange-400" />
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">{title}</h3>
      </div>
      {children}
    </div>
  );
}

const API_OPTIONS: { value: CartographerAPI; label: string; desc: string; tag: string; tagColor: string }[] = [
  {
    value: 'scanner',
    label: '[scanner] — API v5+ (recommandé)',
    desc: 'Nouveau format depuis Cartographer firmware v5. Utilise [mcu scanner] + [scanner] avec sensor: cartographer. Support complet Touch mode.',
    tag: 'Recommandé',
    tagColor: 'bg-green-900/40 text-green-400 border-green-800',
  },
  {
    value: 'classic',
    label: '[cartographer] — API classique',
    desc: 'Ancien format. Compatible avec toutes les versions. Utilise [mcu cartographer] + [cartographer] directement.',
    tag: 'Héritage',
    tagColor: 'bg-gray-800 text-gray-400 border-gray-700',
  },
];

const CALIBRATION_STEPS = [
  {
    cmd: 'CARTOGRAPHER_CALIBRATE',
    desc: 'Calibration principale — détermine le modèle de distance inductif.',
    note: 'Chuffer hotend (150°C) + lit (60°C) avant de lancer. Suivre les instructions à l\'écran.',
    type: 'critical',
  },
  {
    cmd: 'PROBE_ACCURACY',
    desc: 'Test de répétabilité — 10 mesures consécutives.',
    note: 'Résultat attendu : range < 0.005mm. Vérifier le montage si > 0.010mm.',
    type: 'check',
  },
  {
    cmd: 'Z_TILT_ADJUST',
    desc: 'Ajustement des 3 vis Z (VCore 3.1) — mise à niveau motorisée du plateau.',
    note: 'À faire après chaque mise en chauffe. RatOS l\'intègre dans START_PRINT automatiquement.',
    type: 'check',
  },
  {
    cmd: 'BED_MESH_CALIBRATE',
    desc: 'Cartographie du plateau — scan rapide Cartographer.',
    note: 'Le Cartographer scanne en mode continu, 25×25 points en ~2 minutes.',
    type: 'check',
  },
  {
    cmd: 'SAVE_CONFIG',
    desc: 'Sauvegarder toutes les valeurs calibrées dans printer.cfg.',
    note: 'Obligatoire après chaque calibration pour persister les valeurs.',
    type: 'save',
  },
];

export function CartographerSetup({ config, onChange, onNext }: Props) {
  const half = config.printerSize / 2;
  const scale = 80 / (config.printerSize / 2);
  const probeX = config.cartographerXOffset * scale;
  const probeY = config.cartographerYOffset * scale;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Cartographer CAN — Configuration</h2>
        <p className="text-sm text-gray-400">
          Probe inductif via CAN · UUID: {config.cartographerUuid || '(non renseigné)'} · {config.cartographerAPI === 'scanner' ? 'API v5 [scanner]' : 'API classique [cartographer]'}
        </p>
      </div>

      {/* API version */}
      <Section icon={Crosshair} title="Version API Cartographer">
        <div className="space-y-3">
          {API_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => onChange({ cartographerAPI: opt.value })}
              className={`w-full text-left p-4 rounded-lg border transition-all ${
                config.cartographerAPI === opt.value
                  ? 'border-orange-500 bg-orange-500/10'
                  : 'border-gray-700 bg-gray-800/40 hover:border-gray-500'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className={`font-semibold text-sm ${config.cartographerAPI === opt.value ? 'text-orange-300' : 'text-gray-200'}`}>
                  {opt.label}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded border ${opt.tagColor}`}>{opt.tag}</span>
              </div>
              <p className="text-xs text-gray-400">{opt.desc}</p>
            </button>
          ))}
        </div>

        {config.cartographerAPI === 'scanner' && (
          <div className="mt-3 p-3 rounded-lg bg-blue-900/20 border border-blue-800 flex gap-2 text-xs text-blue-300">
            <Info size={12} className="flex-shrink-0 mt-0.5" />
            <span>
              Vérifier la version du firmware : <code className="bg-blue-900/30 px-1 rounded">CARTOGRAPHER_VERSION</code>.
              Si {'<'} 5.0.0, utiliser l'API classique ou mettre à jour le firmware Cartographer.
            </span>
          </div>
        )}
      </Section>

      {/* Offsets */}
      <Section icon={Crosshair} title="Offsets Probe → Buse">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Visual */}
          <div>
            <p className="text-xs text-gray-500 mb-3">Visualisation (vue de dessus) :</p>
            <div className="relative bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden" style={{ width: 180, height: 180 }}>
              <svg width="180" height="180" className="absolute inset-0">
                {/* grid */}
                {[1,2,3,4].map(i => (
                  <React.Fragment key={i}>
                    <line x1={i * 36} y1={0} x2={i * 36} y2={180} stroke="#374151" strokeWidth="0.5" />
                    <line x1={0} y1={i * 36} x2={180} y2={i * 36} stroke="#374151" strokeWidth="0.5" />
                  </React.Fragment>
                ))}
                {/* crosshair at center */}
                <line x1="90" y1="80" x2="90" y2="100" stroke="#f97316" strokeWidth="1.5" />
                <line x1="80" y1="90" x2="100" y2="90" stroke="#f97316" strokeWidth="1.5" />
                {/* line to probe */}
                {(probeX !== 0 || probeY !== 0) && (
                  <line
                    x1="90" y1="90"
                    x2={90 + probeX} y2={90 - probeY}
                    stroke="#60a5fa" strokeWidth="1" strokeDasharray="4 2" opacity="0.7"
                  />
                )}
              </svg>
              {/* Nozzle dot */}
              <div
                className="absolute w-4 h-4 rounded-full bg-orange-500 border-2 border-orange-300"
                style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
              />
              {/* Probe dot */}
              <div
                className="absolute w-5 h-5 rounded-sm bg-blue-500/80 border-2 border-blue-300 flex items-center justify-center"
                style={{
                  left: `calc(50% + ${probeX}px)`,
                  top: `calc(50% - ${probeY}px)`,
                  transform: 'translate(-50%, -50%)',
                }}
              />
              <div className="absolute bottom-1 left-1 text-xs text-orange-400">● buse</div>
              <div className="absolute bottom-1 right-1 text-xs text-blue-400">■ Carto</div>
            </div>
            <div className="mt-2 text-xs text-gray-600">
              Offset: X={config.cartographerXOffset}mm / Y={config.cartographerYOffset}mm
            </div>
          </div>

          {/* Inputs */}
          <div className="space-y-4">
            <NumInput
              label="X Offset (buse → centre bobine)"
              value={config.cartographerXOffset}
              onChange={v => onChange({ cartographerXOffset: v })}
              step={0.1}
              unit="mm"
              hint="Cartographer monté centré = 0.0"
            />
            <NumInput
              label="Y Offset (buse → centre bobine)"
              value={config.cartographerYOffset}
              onChange={v => onChange({ cartographerYOffset: v })}
              step={0.1}
              unit="mm"
              hint="Montage RatOS standard toolhead ≈ 21.1mm"
            />
            <NumInput
              label="Backlash Compensation"
              value={config.cartographerBacklashComp}
              onChange={v => onChange({ cartographerBacklashComp: v })}
              step={0.01}
              min={0}
              max={2}
              unit="mm"
              hint="Jeu de vis Z. Commencer à 0.5, ajuster selon PROBE_ACCURACY"
            />
            <NumInput
              label="Mesh Runs (passes de scan)"
              value={config.cartographerMeshRuns}
              onChange={v => onChange({ cartographerMeshRuns: Math.max(1, Math.round(v)) })}
              step={1}
              min={1}
              max={3}
              unit="×"
              hint="2 passes recommandées pour la précision"
            />
          </div>
        </div>

        <div className="mt-4 p-3 rounded-lg bg-yellow-900/20 border border-yellow-800 flex gap-2">
          <AlertTriangle size={13} className="text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-yellow-300">
            <strong>Position physique :</strong> Le Cartographer doit être à <strong>2.6–3mm au-dessus du niveau de la buse</strong>.
            Mesurer et ajuster mécaniquement avant la calibration.
          </div>
        </div>
      </Section>

      {/* Calibration workflow */}
      <Section icon={CheckCircle2} title="Séquence de calibration">
        <div className="space-y-3">
          {CALIBRATION_STEPS.map((step, i) => (
            <div key={i} className={`p-3 rounded-lg border ${
              step.type === 'critical'
                ? 'border-orange-700 bg-orange-900/15'
                : step.type === 'save'
                ? 'border-green-800 bg-green-900/15'
                : 'border-gray-700 bg-gray-800/30'
            }`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-mono font-bold ${
                  step.type === 'critical' ? 'text-orange-400' : step.type === 'save' ? 'text-green-400' : 'text-blue-300'
                }`}>{i + 1}. {step.cmd}</span>
                {step.type === 'critical' && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-orange-900/50 text-orange-300 border border-orange-800">Critique</span>
                )}
              </div>
              <p className="text-xs text-gray-300">{step.desc}</p>
              <p className="text-xs text-gray-500 mt-1">{step.note}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Touch mode info */}
      <Section icon={Info as React.ElementType} title="Modes Cartographer">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            {
              mode: 'Scan Mode (défaut)',
              desc: 'Scan inductif continu du plateau. Très rapide. Utilisé pour le bed mesh. Précision ≈ 0.001mm.',
              icon: '⚡',
              color: 'border-blue-800 bg-blue-900/20',
            },
            {
              mode: 'Touch Mode',
              desc: 'Contact physique buse-plateau. Utilisé pour Z offset précis. Déclenché par CARTOGRAPHER_CALIBRATE.',
              icon: '🎯',
              color: 'border-purple-800 bg-purple-900/20',
            },
          ].map(item => (
            <div key={item.mode} className={`p-4 rounded-lg border ${item.color}`}>
              <div className="flex items-center gap-2 mb-1.5">
                <span>{item.icon}</span>
                <span className="text-sm font-semibold text-gray-200">{item.mode}</span>
              </div>
              <p className="text-xs text-gray-400">{item.desc}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 p-3 rounded-lg bg-gray-800/50 border border-gray-700 text-xs text-gray-400">
          <strong className="text-gray-300">Commandes utiles :</strong>
          <div className="mt-2 space-y-1 font-mono">
            <div><span className="text-blue-300">CARTOGRAPHER_VERSION</span> — version firmware</div>
            <div><span className="text-blue-300">CARTOGRAPHER_STREAM DURATION=5</span> — données brutes en live</div>
            <div><span className="text-blue-300">PROBE_ACCURACY SAMPLES=10</span> — test répétabilité</div>
            <div><span className="text-blue-300">CARTOGRAPHER_CALIBRATE</span> — calibration complète</div>
          </div>
        </div>
      </Section>

      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-medium text-sm transition-colors"
        >
          Configurer le Bed Mesh <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
