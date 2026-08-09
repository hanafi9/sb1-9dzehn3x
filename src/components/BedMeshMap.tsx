import React, { useState, useCallback } from 'react';
import { PrinterConfig } from '../App';
import { Grid3X3, RefreshCw, ChevronRight, Info } from 'lucide-react';

interface Props {
  config: PrinterConfig;
  onChange: (p: Partial<PrinterConfig>) => void;
  onNext: () => void;
}

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function heatColor(val: number, min: number, max: number): string {
  const t = max === min ? 0.5 : (val - min) / (max - min);
  const r = Math.round(lerp(59, 239, t));
  const g = Math.round(lerp(130, 68, t));
  const b = Math.round(lerp(246, 68, t));
  return `rgb(${r},${g},${b})`;
}

function generateMesh(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const rx = (c / (cols - 1) - 0.5) * 2;
      const ry = (r / (rows - 1) - 0.5) * 2;
      const wave = Math.sin(rx * 1.8) * 0.12 + Math.cos(ry * 1.4 + 0.5) * 0.08;
      const bowl = (rx * rx + ry * ry) * 0.04;
      const noise = (Math.random() - 0.5) * 0.025;
      return parseFloat((wave + bowl + noise).toFixed(3));
    })
  );
}

function NumInput({
  label, value, onChange, step = 1, min, max, unit = 'mm',
}: {
  label: string; value: number; onChange: (v: number) => void;
  step?: number; min?: number; max?: number; unit?: string;
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

export function BedMeshMap({ config, onChange, onNext }: Props) {
  const [meshData, setMeshData] = useState<number[][] | null>(null);
  const [hovered, setHovered] = useState<{ r: number; c: number } | null>(null);

  const simulate = useCallback(() => {
    setMeshData(generateMesh(config.meshPointsY, config.meshPointsX));
  }, [config.meshPointsX, config.meshPointsY]);

  const rows = config.meshPointsY;
  const cols = config.meshPointsX;

  const minVal = meshData ? Math.min(...meshData.flat()) : 0;
  const maxVal = meshData ? Math.max(...meshData.flat()) : 0;
  const range = maxVal - minVal;
  const rangeLabel = range < 0.05 ? 'Excellent (< 0.05mm)' : range < 0.1 ? 'Bon (< 0.10mm)' : range < 0.2 ? 'Acceptable (< 0.20mm)' : 'Nécessite tramage (> 0.20mm)';
  const rangeColor = range < 0.05 ? 'text-green-400' : range < 0.1 ? 'text-blue-400' : range < 0.2 ? 'text-yellow-400' : 'text-red-400';

  const MESH_PTS = [5, 9, 15, 20, 25, 30];
  const size = config.printerSize;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Cartographie Bed Mesh</h2>
        <p className="text-sm text-gray-400">
          Plateau {size}×{size}mm · Scan Cartographer CAN · {cols}×{rows} = {cols * rows} points
        </p>
      </div>

      {/* Cartographer scan info */}
      <div className="p-4 rounded-xl border border-blue-800 bg-blue-900/20 flex gap-3">
        <Info size={15} className="text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-300 space-y-1">
          <p><strong>Avantage Cartographer :</strong> scan continu — pas de point-by-point. 25×25 pts ≈ 90 sec, 30×30 pts ≈ 120 sec.</p>
          <p>Plus de points = compensation de gauchissement plus précise. Recommandé : <strong>25×25 minimum</strong> pour 400mm.</p>
        </div>
      </div>

      {/* Zone config */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 sm:p-6">
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest mb-4">Zone de sondage</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <NumInput label="Min X" value={config.meshMinX} onChange={v => onChange({ meshMinX: v })} min={0} max={config.meshMaxX - 20} />
          <NumInput label="Min Y" value={config.meshMinY} onChange={v => onChange({ meshMinY: v })} min={0} max={config.meshMaxY - 20} />
          <NumInput label="Max X" value={config.meshMaxX} onChange={v => onChange({ meshMaxX: v })} min={config.meshMinX + 20} max={size} />
          <NumInput label="Max Y" value={config.meshMaxY} onChange={v => onChange({ meshMaxY: v })} min={config.meshMinY + 20} max={size} />
        </div>

        {/* Bed preview */}
        <div className="relative mx-auto rounded-lg border border-gray-700 bg-gray-800/50"
          style={{ width: 220, height: 220 }}>
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-700 select-none">
            {size}×{size}mm
          </div>
          {/* Mesh zone */}
          <div
            className="absolute border-2 border-orange-500/60 bg-orange-500/10 rounded"
            style={{
              left: `${(config.meshMinX / size) * 100}%`,
              top: `${((size - config.meshMaxY) / size) * 100}%`,
              width: `${((config.meshMaxX - config.meshMinX) / size) * 100}%`,
              height: `${((config.meshMaxY - config.meshMinY) / size) * 100}%`,
            }}
          />
          {/* Points sample (max 15×15 for display) */}
          {Array.from({ length: Math.min(rows, 12) }, (_, r) =>
            Array.from({ length: Math.min(cols, 12) }, (_, c) => {
              const px = config.meshMinX + (c / (Math.min(cols, 12) - 1)) * (config.meshMaxX - config.meshMinX);
              const py = config.meshMinY + (r / (Math.min(rows, 12) - 1)) * (config.meshMaxY - config.meshMinY);
              return (
                <div
                  key={`${r}-${c}`}
                  className="absolute w-1 h-1 rounded-full bg-orange-400"
                  style={{
                    left: `${(px / size) * 100}%`,
                    top: `${((size - py) / size) * 100}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                />
              );
            })
          )}
          {/* Z tilt points */}
          {[
            { x: 35, y: 35, label: 'FL' },
            { x: size - 35, y: 35, label: 'FR' },
            { x: size / 2, y: size - 35, label: 'R' },
          ].map(pt => (
            <div
              key={pt.label}
              className="absolute"
              style={{
                left: `${(pt.x / size) * 100}%`,
                top: `${((size - pt.y) / size) * 100}%`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div className="w-3 h-3 rounded-full border-2 border-purple-400 bg-purple-900/50 flex items-center justify-center">
                <span className="text-purple-300 text-[7px] font-bold">{pt.label}</span>
              </div>
            </div>
          ))}
          <div className="absolute bottom-1 right-1 text-xs text-purple-400">● vis Z</div>
        </div>
        <p className="text-center text-xs text-gray-500 mt-2">
          Zone orange = mesh · Points violets = vis Z (Z_TILT_ADJUST)
        </p>
      </div>

      {/* Grid resolution */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 sm:p-6">
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest mb-4">Résolution de la grille</h3>
        <div className="grid grid-cols-2 gap-6 mb-4">
          {[
            { label: `Points X (${config.meshPointsX})`, key: 'meshPointsX' as const },
            { label: `Points Y (${config.meshPointsY})`, key: 'meshPointsY' as const },
          ].map(axis => (
            <div key={axis.key}>
              <label className="block text-xs text-gray-400 mb-2">{axis.label}</label>
              <div className="flex flex-wrap gap-2">
                {MESH_PTS.map(n => (
                  <button
                    key={n}
                    onClick={() => onChange({ [axis.key]: n })}
                    className={`px-3 py-1.5 rounded text-sm border transition-all ${
                      config[axis.key] === n
                        ? 'border-orange-500 bg-orange-500/15 text-orange-300'
                        : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Fade */}
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-800">
          <NumInput label="Fade Start" value={config.meshFadeStart} onChange={v => onChange({ meshFadeStart: v })} step={0.1} min={0} />
          <NumInput label="Fade End" value={config.meshFadeEnd} onChange={v => onChange({ meshFadeEnd: v })} step={1} min={1} />
        </div>
      </div>

      {/* Z Tilt info */}
      <div className="rounded-xl border border-purple-900 bg-purple-900/10 p-5">
        <h3 className="text-xs font-bold text-purple-300 uppercase tracking-widest mb-3">Z_TILT_ADJUST — VCore 3.1</h3>
        <p className="text-xs text-gray-400 mb-2">
          Le VCore 3.1 a 3 vis de mise à niveau motorisées. <code className="bg-purple-900/30 px-1 rounded text-purple-300">Z_TILT_ADJUST</code> corrige
          l'inclinaison du plateau avant chaque impression.
        </p>
        <div className="grid grid-cols-3 gap-2 text-xs">
          {[
            { label: 'Front Left', pos: `35, 35`, motor: `-51, -13` },
            { label: 'Front Right', pos: `${size - 35}, 35`, motor: `${size + 51}, -13` },
            { label: 'Rear', pos: `${size / 2}, ${size - 35}`, motor: `${size / 2}, ${size + 37}` },
          ].map(pt => (
            <div key={pt.label} className="rounded border border-purple-800 bg-purple-900/20 p-2">
              <div className="text-purple-300 font-medium">{pt.label}</div>
              <div className="text-gray-400 mt-0.5">Probe: {pt.pos}</div>
              <div className="text-gray-600">Motor: {pt.motor}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Tolérance recommandée : <code className="bg-purple-900/30 px-1 rounded">retry_tolerance: 0.0075</code> — ajuster selon la qualité de votre vis.
        </p>
      </div>

      {/* Simulated heatmap */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Grid3X3 size={15} className="text-orange-400" />
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Heatmap simulée</h3>
            <span className="text-xs text-gray-600">— Données synthétiques, pas votre vrai plateau</span>
          </div>
          <button
            onClick={simulate}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium transition-colors"
          >
            <RefreshCw size={12} />
            Simuler
          </button>
        </div>

        {meshData ? (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {meshData.slice().reverse().map((row, ri) =>
                  row.map((val, ci) => {
                    const isH = hovered?.r === (rows - 1 - ri) && hovered?.c === ci;
                    return (
                      <div
                        key={`${ri}-${ci}`}
                        onMouseEnter={() => setHovered({ r: rows - 1 - ri, c: ci })}
                        onMouseLeave={() => setHovered(null)}
                        className={`flex items-center justify-center rounded-sm text-xs font-mono font-bold transition-transform cursor-default ${isH ? 'ring-2 ring-white z-10 scale-110' : ''}`}
                        style={{
                          width: Math.max(28, Math.min(46, Math.floor(560 / cols))),
                          height: 28,
                          background: heatColor(val, minVal, maxVal),
                          color: Math.abs(val - (minVal + maxVal) / 2) > range * 0.3 ? '#fff' : '#111',
                          fontSize: cols > 20 ? 9 : 11,
                        }}
                        title={`(${ci},${rows - 1 - ri}): ${val.toFixed(3)}`}
                      >
                        {cols <= 20 ? val.toFixed(3) : ''}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-3">
              <div className="h-3 w-32 rounded" style={{ background: 'linear-gradient(to right, rgb(59,130,246), rgb(239,68,68))' }} />
              <div className="flex justify-between w-32 text-xs text-gray-400">
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
                  <div className={`text-xs font-semibold mt-0.5 ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>

            {hovered && meshData[hovered.r] && (
              <div className="text-xs text-gray-400 bg-gray-800/60 rounded px-3 py-1.5 inline-block border border-gray-700">
                Pt ({hovered.c}, {hovered.r}) = <span className="text-white font-mono">{meshData[hovered.r][hovered.c]?.toFixed(3)} mm</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-600">
            <Grid3X3 size={28} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">Cliquer "Simuler" pour générer une heatmap de démonstration</p>
            <p className="text-xs mt-1">Grille {cols}×{rows} — {cols * rows} points de sonde</p>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-medium text-sm transition-colors"
        >
          Générer printer.cfg <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
