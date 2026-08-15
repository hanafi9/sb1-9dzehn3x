import React, { useState } from 'react';
import {
  FileSearch, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Info,
  Wifi, ClipboardPaste, ShieldCheck, ShieldAlert, ShieldX,
} from 'lucide-react';
import type { PrinterConfig } from '../App';
import { useMoonrakerConnection } from '../lib/moonraker';
import { runAudit, auditStats, type AuditResult } from '../lib/cfgAudit';

const SEV_ORDER = { error: 0, warn: 1, info: 2, ok: 3 } as const;

export function ConfigAudit({ config }: { config: PrinterConfig }) {
  const { ip, port, setIp, setPort, baseUrl } = useMoonrakerConnection();

  const [source, setSource] = useState<'fetch' | 'paste'>('fetch');
  const [pasted, setPasted] = useState('');
  const [cfgText, setCfgText] = useState<string | null>(null);
  const [cfgOrigin, setCfgOrigin] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOk, setShowOk] = useState(true);

  const fetchCfg = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${baseUrl}/server/files/config/printer.cfg`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setCfgText(text);
      setCfgOrigin(`${baseUrl} · ${new Date().toLocaleTimeString('fr-FR')} · ${(text.length / 1024).toFixed(1)} kB`);
    } catch (e) {
      setError(e instanceof Error
        ? `Impossible de lire printer.cfg : ${e.message} — imprimante allumée et même réseau ?`
        : String(e));
    } finally { setLoading(false); }
  };

  const analyzePasted = () => {
    if (!pasted.trim()) return;
    setCfgText(pasted);
    setCfgOrigin(`collé manuellement · ${(pasted.length / 1024).toFixed(1)} kB`);
    setError(null);
  };

  const results: AuditResult[] = cfgText ? runAudit(cfgText, config) : [];
  const stats = auditStats(results);
  const sorted = [...results].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  const visible = showOk ? sorted : sorted.filter(x => x.severity !== 'ok');

  const verdict = !cfgText ? null
    : stats.errors > 0 ? {
        icon: ShieldX, color: 'text-red-400', border: 'border-red-800', bg: 'bg-red-950/30',
        label: `${stats.errors} problème${stats.errors > 1 ? 's' : ''} bloquant${stats.errors > 1 ? 's' : ''}`,
        sub: 'Ne pas imprimer avant correction — chaque erreur ci-dessous a déjà mis cette machine à l\'arrêt.',
      }
    : stats.warns > 0 ? {
        icon: ShieldAlert, color: 'text-yellow-400', border: 'border-yellow-800', bg: 'bg-yellow-950/30',
        label: `Utilisable — ${stats.warns} point${stats.warns > 1 ? 's' : ''} à surveiller`,
        sub: 'Rien de bloquant, mais les avertissements méritent un passage.',
      }
    : {
        icon: ShieldCheck, color: 'text-green-400', border: 'border-green-800', bg: 'bg-green-950/30',
        label: 'Configuration saine',
        sub: `${stats.oks} contrôles passés — aucun des pièges connus de cette machine n'est présent.`,
      };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Audit printer.cfg</h2>
        <p className="text-sm text-gray-400">
          Vérifie le fichier réel de l'imprimante contre tous les pièges rencontrés sur cette machine :
          UUID permutés, [mcu u2c], doublons, PT1000, sonde, macros d'impression…
        </p>
      </div>

      {/* ── Source ─────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 space-y-3">
        <div className="flex gap-2">
          {([
            { id: 'fetch', label: 'Depuis l\'imprimante', icon: Wifi },
            { id: 'paste', label: 'Coller le fichier', icon: ClipboardPaste },
          ] as const).map(m => (
            <button key={m.id} onClick={() => setSource(m.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                source === m.id
                  ? 'bg-orange-600/20 border-orange-600 text-orange-300'
                  : 'bg-gray-900 border-gray-700 text-gray-500 hover:text-gray-300'
              }`}>
              <m.icon size={12} /> {m.label}
            </button>
          ))}
        </div>

        {source === 'fetch' && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[150px]">
              <label className="block text-xs text-gray-400 mb-1">IP Imprimante</label>
              <input value={ip} onChange={e => setIp(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-orange-500" />
            </div>
            <div className="w-20">
              <label className="block text-xs text-gray-400 mb-1">Port</label>
              <input value={port} onChange={e => setPort(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-orange-500" />
            </div>
            <button onClick={fetchCfg} disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium transition-colors">
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <FileSearch size={14} />}
              {cfgText ? 'Re-vérifier' : 'Vérifier maintenant'}
            </button>
          </div>
        )}

        {source === 'paste' && (
          <div>
            <textarea value={pasted} onChange={e => setPasted(e.target.value)} rows={8}
              placeholder="Colle ici le contenu complet de printer.cfg…"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 font-mono focus:outline-none focus:border-orange-500 resize-y" />
            <button onClick={analyzePasted} disabled={!pasted.trim()}
              className="mt-2 flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white text-sm font-medium transition-colors">
              <FileSearch size={14} /> Analyser
            </button>
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}
        {cfgOrigin && !error && <p className="text-xs text-gray-600">Fichier analysé : {cfgOrigin}</p>}
      </div>

      {/* ── Verdict ────────────────────────────────────────────────────────── */}
      {verdict && (
        <div className={`rounded-xl border ${verdict.border} ${verdict.bg} p-5 flex items-start gap-4`}>
          <verdict.icon size={28} className={`${verdict.color} flex-shrink-0`} />
          <div className="flex-1 min-w-0">
            <div className={`text-base font-bold ${verdict.color}`}>{verdict.label}</div>
            <p className="text-xs text-gray-400 mt-1">{verdict.sub}</p>
          </div>
          <div className="flex gap-3 text-xs flex-shrink-0">
            <span className="text-red-400">{stats.errors} ✗</span>
            <span className="text-yellow-400">{stats.warns} ⚠</span>
            <span className="text-green-400">{stats.oks} ✓</span>
          </div>
        </div>
      )}

      {/* ── Résultats ──────────────────────────────────────────────────────── */}
      {cfgText && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">
              {visible.length} contrôle{visible.length > 1 ? 's' : ''}
            </h3>
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
              <input type="checkbox" checked={showOk} onChange={e => setShowOk(e.target.checked)} className="accent-green-600" />
              Afficher les contrôles passés
            </label>
          </div>

          {visible.map(res => {
            const Icon = res.severity === 'error' ? XCircle
              : res.severity === 'warn' ? AlertTriangle
              : res.severity === 'info' ? Info : CheckCircle2;
            const color = res.severity === 'error' ? 'text-red-400'
              : res.severity === 'warn' ? 'text-yellow-400'
              : res.severity === 'info' ? 'text-blue-400' : 'text-green-400';
            const border = res.severity === 'error' ? 'border-red-900/60 bg-red-950/20'
              : res.severity === 'warn' ? 'border-yellow-900/60 bg-yellow-950/20'
              : res.severity === 'info' ? 'border-blue-900/50 bg-blue-950/20'
              : 'border-green-900/40 bg-green-950/10';
            return (
              <div key={res.id} className={`rounded-lg border p-3.5 ${border}`}>
                <div className="flex items-start gap-2.5">
                  <Icon size={15} className={`${color} flex-shrink-0 mt-0.5`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-semibold ${res.severity === 'ok' ? 'text-gray-400' : 'text-gray-200'}`}>{res.title}</span>
                      {res.lines && res.lines.length > 0 && (
                        <span className="text-xs text-gray-600 font-mono">
                          ligne{res.lines.length > 1 ? 's' : ''} {res.lines.join(', ')}
                        </span>
                      )}
                    </div>
                    <pre className="text-xs text-gray-500 whitespace-pre-wrap font-sans leading-relaxed mt-1">{res.detail}</pre>
                    {res.cmds?.map(c => (
                      <div key={c} className="flex items-start gap-2 mt-1.5">
                        <code className="flex-1 text-xs text-orange-300 font-mono bg-gray-950 border border-gray-800 px-2 py-1.5 rounded break-all">{c}</code>
                        <button onClick={() => navigator.clipboard?.writeText(c)}
                          className="flex-shrink-0 text-gray-600 hover:text-gray-300 px-2 py-1 text-xs transition-colors">📋</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!cfgText && !error && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/30 py-14 text-center">
          <FileSearch size={30} className="mx-auto mb-3 text-gray-700" />
          <p className="text-sm text-gray-500">Clique « Vérifier maintenant » pour analyser le printer.cfg de l'imprimante</p>
          <p className="text-xs text-gray-600 mt-1">ou colle le fichier si l'imprimante n'est pas joignable</p>
        </div>
      )}
    </div>
  );
}
