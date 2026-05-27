import React, { useState, useCallback } from 'react';
import { PrinterConfig } from '../App';
import { Grid3X3, RefreshCw, Info, Sliders } from 'lucide-react';

interface Props {
  config: PrinterConfig;
  onChange: (p: Partial<PrinterConfig>) => void;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function generateMeshData(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const rx = (c / (cols - 1) - 0.5) * 2;
      const ry = (r / (rows - 1) - 0.5) * 2;
      const base = Math.sin(rx * 2) * 0.15 + Math.cos(ry * 1.5) * 0.1;
      const noise = (Math.random() - 0.5) * 0.04;
      const edge = (rx * rx + ry * ry) * 0.05;
      return parseFloat((base + noise + edge).toFixed(3));
    })
  );
}

function heatColor(val: number, min: number, max: number): string {
  const t = max === min ? 0.5 : (val - min) / (max - min);
  const r = Math.round(lerp(59, 239, t));
  const g = Math.round(lerp(130, 68, t));
  const b = Math.round(lerp(246, 68, t));
  return `rgb(${r},${g},${b})`;
}

function NumInput({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  unit = 'mm',
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
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
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
        />
        <span className="text-xs text-gray-500 whitespace-nowrap">{unit}</span>
      </div>
    </div>
  );
}

export function BedMeshMap({ config, onChange }: Props) {
  const [meshData, setMeshData] = useState<number[][] | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<{ r: number; c: number } | null>(null);

  const generateMesh = useCallback(() => {
    setMeshData(generateMeshData(config.meshPointsY, config.meshPointsX));
  }, [config.meshPointsX, config.meshPointsY]);

  const rows = config.meshPointsY;
  const cols = config.meshPointsX;
  const totalPoints = rows * cols;

  const minVal = meshData ? Math.min(...meshData.flat()) : 0;
  const maxVal = meshData ? Math.max(...meshData.flat()) : 0;
  const range = maxVal - minVal;

  const rangeLabel = range < 0.05 ? '✓ Excellent' : range < 0.1 ? '✓ Bon' : range < 0.2 ? '⚠ Acceptable' : '✗ À corriger';
  const rangeColor = range < 0.05 ? 'text-green-400' : range < 0.1 ? 'text-blue-400' : range < 0.2 ? 'text-yellow-400' : 'text-red-400';

  const MESH_POINTS_OPTIONS = [3, 5, 7, 9, 11];
  const ALGORITHMS = [
    { value: 'lagrange' as const, label: 'Lagrange', desc: '≤ 6×6 points' },
    { value: 'bicubic' as const, label: 'Bicubic', desc: '≥ 4×4 points' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Cartographie Bed Mesh</h2>
        <p className="text-sm text-gray-400">Configurez la grille de sondage et visualisez le nivellement du plateau</p>
      </div>

      {/* Mesh zone config */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Sliders size={16} className="text-orange-400" />
          <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Zone de sondage</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <NumInput label="Min X" value={config.meshMinX} onChange={v => onChange({ meshMinX: v })} min={0} max={config.meshMaxX - 10} unit="mm" />
          <NumInput label="Min Y" value={config.meshMinY} onChange={v => onChange({ meshMinY: v })} min={0} max={config.meshMaxY - 10} unit="mm" />
          <NumInput label="Max X" value={config.meshMaxX} onChange={v => onChange({ meshMaxX: v })} min={config.meshMinX + 10} max={config.size} unit="mm" />
          <NumInput label="Max Y" value={config.meshMaxY} onChange={v => onChange({ meshMaxY: v })} min={config.meshMinY + 10} max={config.size} unit="mm" />
        </div>

        {/* Bed preview with mesh zone */}
        <div className="relative mx-auto rounded-lg border border-gray-700 bg-gray-800/50 overflow-hidden" style={{ width: 240, height: 240 }}>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-xs text-gray-600">{config.size}×{config.size}mm</div>
          </div>
          {/* Mesh zone */}
          <div
            className="absolute border-2 border-orange-500/60 bg-orange-500/10 rounded"
            style={{
              left: `${(config.meshMinX / config.size) * 100}%`,
              top: `${(1 - config.meshMaxY / config.size) * 100}%`,
              width: `${((config.meshMaxX - config.meshMinX) / config.size) * 100}%`,
              height: `${((config.meshMaxY - config.meshMinY) / config.size) * 100}%`,
            }}
          >
            <span className="absolute top-1 left-1 text-xs text-orange-400">Zone mesh</span>
          </div>
          {/* Probe points */}
          {Array.from({ length: rows }, (_, r) =>
            Array.from({ length: cols }, (_, c) => {
              const px = config.meshMinX + (c / (cols - 1)) * (config.meshMaxX - config.meshMinX);
              const py = config.meshMinY + (r / (rows - 1)) * (config.meshMaxY - config.meshMinY);
              return (
                <div
                  key={`${r}-${c}`}
                  className="absolute w-1.5 h-1.5 rounded-full bg-orange-400"
                  style={{
                    left: `${(px / config.size) * 100}%`,
                    top: `${(1 - py / config.size) * 100}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                />
              );
            })
          )}
        </div>
        <p className="text-center text-xs text-gray-500 mt-2">{totalPoints} points — grille {cols}×{rows}</p>
      </div>

      {/* Grid resolution */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Grid3X3 size={16} className="text-orange-400" />
          <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Résolution de la grille</h3>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-xs text-gray-400 mb-2">Points X ({config.meshPointsX})</label>
            <div className="flex gap-2 flex-wrap">
              {MESH_POINTS_OPTIONS.map(n => (
                <button
                  key={n}
                  onClick={() => onChange({ meshPointsX: n })}
                  className={`px-3 py-1.5 rounded text-sm border transition-all ${
                    config.meshPointsX === n
                      ? 'border-orange-500 bg-orange-500/15 text-orange-300'
                      : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-2">Points Y ({config.meshPointsY})</label>
            <div className="flex gap-2 flex-wrap">
              {MESH_POINTS_OPTIONS.map(n => (
                <button
                  key={n}
                  onClick={() => onChange({ meshPointsY: n })}
                  className={`px-3 py-1.5 rounded text-sm border transition-all ${
                    config.meshPointsY === n
                      ? 'border-orange-500 bg-orange-500/15 text-orange-300'
                      : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Algorithm */}
        <div className="mt-4">
          <label className="block text-xs text-gray-400 mb-2">Algorithme d'interpolation</label>
          <div className="flex gap-2">
            {ALGORITHMS.map(a => (
              <button
                key={a.value}
                onClick={() => onChange({ meshAlgorithm: a.value })}
                className={`px-4 py-2 rounded-lg border text-sm transition-all ${
                  config.meshAlgorithm === a.value
                    ? 'border-orange-500 bg-orange-500/15 text-orange-300'
                    : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500'
                }`}
              >
                {a.label}
                <span className="ml-1 text-xs text-gray-500">({a.desc})</span>
              </button>
            ))}
          </div>
        </div>

        {/* Fade */}
        <div className="grid grid-cols-2 gap-4 mt-4">
          <NumInput
            label="Fade Start"
            value={config.meshFadeStart}
            onChange={v => onChange({ meshFadeStart: v })}
            step={0.1}
            min={0}
            unit="mm"
          />
          <NumInput
            label="Fade End"
            value={config.meshFadeEnd}
            onChange={v => onChange({ meshFadeEnd: v })}
            step={1}
            min={1}
            unit="mm"
          />
        </div>
      </div>

      {/* Simulated heatmap */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Carte de chaleur simulée</h3>
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <Info size={11} />
              <span>Simulation — exécutez BED_MESH_CALIBRATE pour les vraies valeurs</span>
            </div>
          </div>
          <button
            onClick={generateMesh}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium transition-colors"
          >
            <RefreshCw size={14} />
            Simuler
          </button>
        </div>

        {meshData ? (
          <div className="space-y-4">
            {/* Heatmap grid */}
            <div className="overflow-x-auto">
              <div
                className="inline-grid gap-1 mx-auto"
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
              >
                {meshData.slice().reverse().map((row, ri) =>
                  row.map((val, ci) => {
                    const isHovered = hoveredPoint?.r === (rows - 1 - ri) && hoveredPoint?.c === ci;
                    return (
                      <div
                        key={`${ri}-${ci}`}
                        onMouseEnter={() => setHoveredPoint({ r: rows - 1 - ri, c: ci })}
                        onMouseLeave={() => setHoveredPoint(null)}
                        className={`
                          relative flex items-center justify-center rounded text-xs font-mono font-bold cursor-default transition-all
                          ${isHovered ? 'ring-2 ring-white z-10 scale-110' : ''}
                        `}
                        style={{
                          width: 52,
                          height: 42,
                          background: heatColor(val, minVal, maxVal),
                          color: Math.abs(val - (minVal + maxVal) / 2) > range * 0.3 ? '#fff' : '#111',
                        }}
                        title={`(${ci}, ${rows - 1 - ri}): ${val.toFixed(3)}mm`}
                      >
                        {val.toFixed(3)}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-3">
              <div
                className="h-4 w-40 rounded"
                style={{
                  background: 'linear-gradient(to right, rgb(59,130,246), rgb(239,68,68))',
                }}
              />
              <div className="flex justify-between w-40 text-xs text-gray-400">
                <span>{minVal.toFixed(3)}</span>
                <span>{maxVal.toFixed(3)}</span>
              </div>
              <span className="text-xs text-gray-500">mm</span>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Min', value: `${minVal.toFixed(3)} mm`, color: 'text-blue-400' },
                { label: 'Max', value: `${maxVal.toFixed(3)} mm`, color: 'text-red-400' },
                { label: 'Range', value: `${range.toFixed(3)} mm`, color: 'text-yellow-400' },
                { label: 'Qualité', value: rangeLabel, color: rangeColor },
              ].map(s => (
                <div key={s.label} className="bg-gray-800/60 rounded-lg p-3 border border-gray-700">
                  <div className="text-xs text-gray-500">{s.label}</div>
                  <div className={`text-sm font-semibold mt-0.5 ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>

            {hoveredPoint && meshData[hoveredPoint.r] && (
              <div className="text-xs text-gray-400 bg-gray-800/60 rounded px-3 py-2 inline-block border border-gray-700">
                Point ({hoveredPoint.c}, {hoveredPoint.r}) ={' '}
                <span className="text-white font-mono">{meshData[hoveredPoint.r][hoveredPoint.c]?.toFixed(3)} mm</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-16 text-gray-500">
            <Grid3X3 size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">Cliquez sur "Simuler" pour générer une carte de chaleur</p>
            <p className="text-xs mt-1">Grille {cols}×{rows} — {totalPoints} points</p>
          </div>
        )}
      </div>

      {/* Klipper commands */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-6">
        <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider mb-3">Commandes Klipper</h3>
        <div className="space-y-2">
          {[
            { cmd: 'BED_MESH_CALIBRATE', desc: 'Lance la calibration du mesh' },
            { cmd: 'BED_MESH_CALIBRATE ADAPTIVE=1', desc: 'Mesh adapté à l\'objet (si activé)' },
            { cmd: 'BED_MESH_PROFILE SAVE=default', desc: 'Sauvegarde le profil de mesh' },
            { cmd: 'BED_MESH_PROFILE LOAD=default', desc: 'Charge le profil sauvegardé' },
            { cmd: 'BED_MESH_OUTPUT PGP=0', desc: 'Affiche les valeurs brutes du mesh' },
          ].map(item => (
            <div key={item.cmd} className="flex items-center gap-3 py-2 border-b border-gray-800 last:border-0">
              <code className="text-xs bg-gray-800 border border-gray-700 text-orange-300 px-2 py-1 rounded font-mono flex-shrink-0">
                {item.cmd}
              </code>
              <span className="text-xs text-gray-500">{item.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
