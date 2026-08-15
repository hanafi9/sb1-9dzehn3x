import React, { useState } from 'react';
import {
  FileSearch, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Info,
  Wifi, ClipboardPaste, ShieldCheck, ShieldAlert, ShieldX,
  Wrench, HardDrive, Eye, Undo2, Copy,
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

  // Correction automatique
  const [selectedFixes, setSelectedFixes] = useState<Record<string, boolean>>({});
  const [stagedText, setStagedText] = useState<string | null>(null);
  const [appliedLabels, setAppliedLabels] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'done' | 'conflict' | 'error'>('idle');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const resetFixState = () => {
    setStagedText(null); setAppliedLabels([]); setShowPreview(false);
    setSaveState('idle'); setSaveMsg(null); setSelectedFixes({});
  };

  const fetchCfg = async () => {
    setLoading(true); setError(null); resetFixState();
    try {
      const res = await fetch(`${baseUrl}/server/files/config/printer.cfg`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
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
    resetFixState();
    setCfgText(pasted);
    setCfgOrigin(`collé manuellement · ${(pasted.length / 1024).toFixed(1)} kB`);
    setError(null);
  };

  const results: AuditResult[] = cfgText ? runAudit(cfgText, config) : [];
  const stats = auditStats(results);
  const sorted = [...results].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  const visible = showOk ? sorted : sorted.filter(x => x.severity !== 'ok');

  // ── Correction automatique ────────────────────────────────────────────────
  const fixable = results.filter(x => x.applyFix && (x.severity === 'error' || x.severity === 'warn'));
  const isSelected = (x: AuditResult) =>
    selectedFixes[x.id] !== undefined ? selectedFixes[x.id] : x.severity === 'error';
  const selectedCount = fixable.filter(isSelected).length;
  const stagedResults = stagedText ? runAudit(stagedText, config) : null;
  const stagedStats = stagedResults ? auditStats(stagedResults) : null;

  const applySelected = () => {
    if (!cfgText) return;
    let out = cfgText;
    const labels: string[] = [];
    for (const f of fixable) {
      if (!isSelected(f) || !f.applyFix) continue;
      const next = f.applyFix(out);
      if (next !== out) { out = next; labels.push(f.fixLabel ?? f.title); }
    }
    setStagedText(out);
    setAppliedLabels(labels);
    setSaveState('idle'); setSaveMsg(null);
  };

  /** Sauvegarde sur le Pi : re-vérifie que le fichier n'a pas bougé,
   *  dépose une copie de l'original, puis écrit le fichier corrigé. */
  const saveToPrinter = async () => {
    if (!stagedText || !cfgText) return;
    setSaveState('saving'); setSaveMsg(null);
    try {
      // 1. Garde anti-écrasement : le fichier sur le Pi doit être IDENTIQUE
      //    à celui qu'on a analysé (protège contre un onglet Mainsail fantôme)
      const cur = await fetch(`${baseUrl}/server/files/config/printer.cfg`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!cur.ok) throw new Error(`relecture impossible (HTTP ${cur.status})`);
      const curText = await cur.text();
      if (curText !== cfgText) {
        setSaveState('conflict');
        setSaveMsg('⚠ Le fichier a été modifié sur l\'imprimante depuis l\'analyse — rien n\'a été écrit. ' +
          'Ferme les autres onglets Mainsail, puis « Re-vérifier » et recommence.');
        return;
      }

      // 2. Copie de sauvegarde de l'original sur le Pi
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const bakName = `printer-avant-audit-${stamp}.cfg`;
      const bakFd = new FormData();
      bakFd.append('root', 'config');
      bakFd.append('path', '');
      bakFd.append('file', new Blob([cfgText], { type: 'text/plain' }), bakName);
      const bakRes = await fetch(`${baseUrl}/server/files/upload`, {
        method: 'POST', body: bakFd, signal: AbortSignal.timeout(15000),
      });
      if (!bakRes.ok) throw new Error(`sauvegarde ${bakName} refusée (HTTP ${bakRes.status}) — rien n'a été écrit`);

      // 3. Écriture du fichier corrigé
      const fd = new FormData();
      fd.append('root', 'config');
      fd.append('path', '');
      fd.append('file', new Blob([stagedText], { type: 'text/plain' }), 'printer.cfg');
      const res = await fetch(`${baseUrl}/server/files/upload`, {
        method: 'POST', body: fd, signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`écriture refusée (HTTP ${res.status})`);

      // 4. Relecture + ré-audit pour confirmer l'état réel sur disque
      const verify = await fetch(`${baseUrl}/server/files/config/printer.cfg`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      const verifyText = verify.ok ? await verify.text() : stagedText;
      setCfgText(verifyText);
      setCfgOrigin(`${baseUrl} · ${new Date().toLocaleTimeString('fr-FR')} · ${(verifyText.length / 1024).toFixed(1)} kB (corrigé)`);
      setStagedText(null); setAppliedLabels([]); setShowPreview(false); setSelectedFixes({});
      setSaveState('done');
      setSaveMsg(`✓ Sauvegardé. Copie de l'original : ${bakName}. Lance maintenant FIRMWARE_RESTART.`);
    } catch (e) {
      setSaveState('error');
      setSaveMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const firmwareRestart = async () => {
    try {
      await fetch(`${baseUrl}/printer/firmware_restart`, { method: 'POST', signal: AbortSignal.timeout(10000) });
      setSaveMsg('✓ FIRMWARE_RESTART envoyé — surveille l\'état Klipper dans Mainsail ou l\'onglet Diagnostic.');
    } catch {
      setSaveMsg('✗ FIRMWARE_RESTART n\'a pas pu être envoyé — le lancer depuis Mainsail.');
    }
  };

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

      {/* ── Correction automatique ─────────────────────────────────────────── */}
      {cfgText && fixable.length > 0 && (
        <div className="rounded-xl border border-orange-900/60 bg-orange-950/20 overflow-hidden">
          <div className="px-5 pt-4 pb-3 flex items-center gap-2">
            <Wrench size={15} className="text-orange-400" />
            <h3 className="text-sm font-bold text-orange-200">
              Correction automatique — {fixable.length} problème{fixable.length > 1 ? 's' : ''} corrigeable{fixable.length > 1 ? 's' : ''}
            </h3>
          </div>
          <div className="border-t border-orange-900/40 p-5 space-y-4">

            {/* Sélection */}
            {!stagedText && (
              <>
                <div className="space-y-1.5">
                  {fixable.map(f => (
                    <label key={f.id} className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      isSelected(f) ? 'border-orange-800 bg-orange-950/30' : 'border-gray-800 bg-gray-900/40'
                    }`}>
                      <input type="checkbox" checked={isSelected(f)}
                        onChange={() => setSelectedFixes(s => ({ ...s, [f.id]: !isSelected(f) }))}
                        className="mt-0.5 accent-orange-600 flex-shrink-0" />
                      <span className="text-xs leading-relaxed">
                        <span className={f.severity === 'error' ? 'text-red-300 font-semibold' : 'text-yellow-300 font-semibold'}>
                          {f.severity === 'error' ? '✗' : '⚠'} {f.title}
                        </span>
                        <span className="block text-gray-400 mt-0.5">→ {f.fixLabel}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <button onClick={applySelected} disabled={selectedCount === 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white text-sm font-medium transition-colors">
                  <Eye size={14} /> Préparer les corrections ({selectedCount}) — aperçu, rien n'est encore écrit
                </button>
              </>
            )}

            {/* Aperçu + sauvegarde */}
            {stagedText && stagedStats && (
              <>
                <div className="p-3 rounded-lg border border-gray-700 bg-gray-900/60">
                  <div className="text-xs font-semibold text-gray-300 mb-2">
                    {appliedLabels.length} correction{appliedLabels.length > 1 ? 's' : ''} préparée{appliedLabels.length > 1 ? 's' : ''} (en mémoire uniquement) :
                  </div>
                  <ul className="space-y-0.5">
                    {appliedLabels.map((l, i) => <li key={i} className="text-xs text-gray-400">• {l}</li>)}
                  </ul>
                  <div className="mt-3 pt-3 border-t border-gray-800 flex items-center gap-4 text-xs">
                    <span className="text-gray-500">Résultat prévu :</span>
                    <span className="text-red-400">{stats.errors} → {stagedStats.errors} ✗</span>
                    <span className="text-yellow-400">{stats.warns} → {stagedStats.warns} ⚠</span>
                    {stagedStats.errors === 0
                      ? <span className="text-green-400 font-semibold">✓ plus aucune erreur bloquante</span>
                      : <span className="text-red-300">⚠ des erreurs resteront (non corrigeables automatiquement)</span>}
                  </div>
                </div>

                <button onClick={() => setShowPreview(v => !v)}
                  className="text-xs text-gray-400 hover:text-gray-200 underline transition-colors">
                  {showPreview ? 'Masquer' : 'Voir'} le fichier corrigé complet
                </button>
                {showPreview && (
                  <pre className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs font-mono text-gray-300 overflow-auto max-h-80 whitespace-pre">
                    {stagedText}
                  </pre>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {source === 'fetch' ? (
                    <button onClick={saveToPrinter} disabled={saveState === 'saving' || saveState === 'done'}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                      {saveState === 'saving' ? <RefreshCw size={14} className="animate-spin" /> : <HardDrive size={14} />}
                      {saveState === 'saving' ? 'Sauvegarde…' : 'Sauvegarder sur l\'imprimante (copie de l\'original conservée)'}
                    </button>
                  ) : (
                    <button onClick={() => navigator.clipboard?.writeText(stagedText)}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-700 hover:bg-green-600 text-white text-sm font-medium transition-colors">
                      <Copy size={14} /> Copier le fichier corrigé
                    </button>
                  )}
                  {saveState !== 'done' && (
                    <button onClick={() => { setStagedText(null); setAppliedLabels([]); setShowPreview(false); }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-gray-200 text-xs transition-colors">
                      <Undo2 size={12} /> Annuler l'aperçu
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Messages d'état */}
            {saveMsg && (
              <div className={`p-3 rounded-lg border text-xs leading-relaxed ${
                saveState === 'done' ? 'border-green-800 bg-green-950/30 text-green-300'
                : saveState === 'conflict' ? 'border-yellow-800 bg-yellow-950/30 text-yellow-200'
                : 'border-red-800 bg-red-950/30 text-red-300'
              }`}>
                {saveMsg}
                {saveState === 'done' && (
                  <button onClick={firmwareRestart}
                    className="block mt-2 px-3 py-1.5 rounded-lg bg-orange-700 hover:bg-orange-600 text-white text-xs font-medium transition-colors">
                    🔄 FIRMWARE_RESTART maintenant
                  </button>
                )}
              </div>
            )}
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
