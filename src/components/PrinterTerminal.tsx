import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Terminal as TerminalIcon, Send, Trash2, RefreshCw, Wifi, WifiOff,
  ChevronDown, ChevronUp, FileText, AlertTriangle, Play, Search, Copy,
} from 'lucide-react';
import type { PrinterConfig } from '../App';
import {
  useMoonrakerConnection, sendGcode, fetchGcodeStore, fetchObjectsList,
  fetchKlippyLog, extractTracebacks, extractConfigErrors, tailLog,
  type GCodeEntry, type Traceback,
} from '../lib/moonraker';

// ─── Bibliothèque de commandes ────────────────────────────────────────────────

interface PresetCmd { cmd: string; label: string; danger?: boolean }
interface PresetGroup { name: string; icon: string; cmds: PresetCmd[] }

function buildPresets(config: PrinterConfig): PresetGroup[] {
  return [
    {
      name: 'État & MCU', icon: '🩺',
      cmds: [
        { cmd: 'STATUS',            label: 'État Klipper' },
        { cmd: 'HELP',              label: 'Lister les commandes disponibles' },
        { cmd: 'QUERY_ENDSTOPS',    label: 'État des endstops' },
        { cmd: 'GET_POSITION',      label: 'Position actuelle' },
        { cmd: 'DUMP_TMC STEPPER=stepper_x', label: 'Registres TMC (X)' },
        { cmd: 'FIRMWARE_RESTART',  label: 'Redémarrer le firmware', danger: true },
        { cmd: 'RESTART',           label: 'Recharger la config', danger: true },
      ],
    },
    {
      name: 'Sonde Z / Cartographer', icon: '🎯',
      cmds: [
        { cmd: 'PROBE',                        label: 'Une mesure' },
        { cmd: 'PROBE_ACCURACY SAMPLES=10',    label: 'Répétabilité (10 mesures)' },
        { cmd: 'CARTOGRAPHER_QUERY',           label: 'État du Cartographer' },
        { cmd: 'CARTOGRAPHER_ESTIMATE_BACKLASH', label: 'Estimer le backlash Z' },
        { cmd: 'CARTOGRAPHER_CALIBRATE',       label: 'Calibration (hotend 150°C)', danger: true },
        { cmd: 'BEACON_QUERY',                 label: 'État Beacon (si installé)' },
        { cmd: 'Z_OFFSET_APPLY_PROBE',         label: 'Appliquer le Z offset' },
      ],
    },
    {
      name: 'Toolhead / EBB42', icon: '⚡',
      cmds: [
        { cmd: 'ACCELEROMETER_QUERY CHIP=adxl345', label: 'Lire l\'ADXL345' },
        { cmd: 'MEASURE_AXES_NOISE',   label: 'Bruit des axes' },
        { cmd: 'SHAPER_CALIBRATE',     label: 'Calibration input shaper', danger: true },
        { cmd: 'M106 S128',            label: 'Ventilateur pièce 50 %' },
        { cmd: 'M107',                 label: 'Ventilateur pièce off' },
        { cmd: 'M105',                 label: 'Températures' },
      ],
    },
    {
      name: 'Mouvement & lit', icon: '📐',
      cmds: [
        { cmd: 'G28',                  label: 'Home tous les axes' },
        { cmd: 'Z_TILT_ADJUST',        label: 'Niveler les 3 vis Z' },
        { cmd: 'BED_MESH_CALIBRATE',   label: 'Cartographier le plateau' },
        { cmd: 'BED_MESH_OUTPUT',      label: 'Afficher le mesh actif' },
        { cmd: 'BED_MESH_PROFILE LOAD=default', label: 'Charger le profil default' },
        { cmd: 'SAVE_CONFIG',          label: 'Sauvegarder + redémarrer', danger: true },
      ],
    },
    {
      name: 'RatOS', icon: '🐀',
      cmds: [
        { cmd: 'RATOS_ECHO MSG="test"', label: 'Test console RatOS' },
        { cmd: 'MAYBE_HOME',            label: 'Home si nécessaire' },
        { cmd: 'DUMP_PARAMETERS',       label: 'Vider tous les paramètres' },
        { cmd: `SET_GCODE_OFFSET Z=0`,  label: 'Réinitialiser le Z offset' },
      ],
    },
    {
      name: 'Diagnostic CAN (shell)', icon: '🔌',
      cmds: [
        { cmd: 'ip -details -statistics link show can0', label: 'État complet de can0' },
        { cmd: `sudo ip link set can0 down && sudo ip link set can0 up type can bitrate ${config.canSpeed} restart-ms 100`, label: 'Réinitialiser can0 (sortie BUS-OFF)' },
        { cmd: 'sudo systemctl stop klipper && ~/klippy-env/bin/python ~/klipper/scripts/canbus_query.py can0 ; sudo systemctl start klipper', label: 'Scanner les UUID CAN' },
        { cmd: 'python3 ~/katapult/scripts/flashtool.py -i can0 -q', label: 'Scanner Katapult' },
        { cmd: 'ls -la ~/klipper/klippy/extras/ | grep -E "cartographer|beacon|scanner|probe"', label: 'Plugins de sonde installés' },
        { cmd: 'lsusb', label: 'Périphériques USB' },
        { cmd: 'ls -la /dev/serial/by-id/', label: 'Ports série' },
      ],
    },
  ];
}

// ─── Composant ────────────────────────────────────────────────────────────────

type Mode = 'gcode' | 'shell' | 'log';

export function PrinterTerminal({ config }: { config: PrinterConfig }) {
  const { ip, port, setIp, setPort, baseUrl } = useMoonrakerConnection();

  const [mode, setMode] = useState<Mode>('gcode');
  const [connected, setConnected] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);

  // Console
  const [entries, setEntries] = useState<GCodeEntry[]>([]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const seenKeys = useRef<Set<string>>(new Set());
  const outputRef = useRef<HTMLDivElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Shell
  const [shellObjects, setShellObjects] = useState<string[]>([]);
  const [shellScanned, setShellScanned] = useState(false);

  // Log
  const [logText, setLogText] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState('');

  const [showPresets, setShowPresets] = useState(true);
  const presets = buildPresets(config);

  // ── Connexion + polling de la console ────────────────────────────────────
  const pull = useCallback(async () => {
    try {
      const store = await fetchGcodeStore(baseUrl, 100);
      setEntries(prev => {
        const fresh = store.filter(e => {
          const k = `${e.time}|${e.message}`;
          if (seenKeys.current.has(k)) return false;
          seenKeys.current.add(k);
          return true;
        });
        return fresh.length ? [...prev, ...fresh].slice(-600) : prev;
      });
      setConnected(true); setConnError(null);
    } catch (e) {
      setConnected(false);
      setConnError(e instanceof Error ? e.message : String(e));
    }
  }, [baseUrl]);

  const connect = useCallback(async () => {
    seenKeys.current.clear();
    setEntries([]);
    await pull();
    // Découvre les [gcode_shell_command] réellement configurés sur CETTE machine
    try {
      const objs = await fetchObjectsList(baseUrl);
      setShellObjects(objs.filter(o => o.startsWith('gcode_shell_command ')).map(o => o.slice(20)));
      setShellScanned(true);
    } catch { setShellScanned(true); }
  }, [baseUrl, pull]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (connected) pollRef.current = setInterval(pull, 1000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [connected, pull]);

  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [entries, autoScroll]);

  // ── Envoi ────────────────────────────────────────────────────────────────
  const run = async (raw: string) => {
    const cmd = raw.trim();
    if (!cmd || busy) return;
    setBusy(true);
    setHistory(h => (h[h.length - 1] === cmd ? h : [...h, cmd]).slice(-100));
    setHistIdx(-1);
    // Écho local immédiat (le store Moonraker met ~1 s à le renvoyer)
    setEntries(prev => [...prev, { type: 'command', time: Date.now() / 1000, message: cmd }]);
    seenKeys.current.add(`${Date.now() / 1000}|${cmd}`);
    try {
      await sendGcode(baseUrl, cmd);
      await new Promise(r => setTimeout(r, 400));
      await pull();
    } catch (e) {
      setEntries(prev => [...prev, {
        type: 'response', time: Date.now() / 1000,
        message: `!! Échec d'envoi : ${e instanceof Error ? e.message : String(e)}`,
      }]);
    } finally { setBusy(false); }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { run(input); setInput(''); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!history.length) return;
      const next = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(next); setInput(history[next]);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx < 0) return;
      const next = histIdx + 1;
      if (next >= history.length) { setHistIdx(-1); setInput(''); }
      else { setHistIdx(next); setInput(history[next]); }
    }
  };

  // ── klippy.log ───────────────────────────────────────────────────────────
  const loadLog = async () => {
    setLogLoading(true); setLogError(null);
    try {
      setLogText(await fetchKlippyLog(baseUrl));
    } catch (e) {
      setLogError(e instanceof Error ? e.message : String(e));
    } finally { setLogLoading(false); }
  };

  const tracebacks: Traceback[] = logText ? extractTracebacks(logText).slice(0, 5) : [];
  const cfgErrors = logText ? extractConfigErrors(logText) : [];
  const logLines = logText ? tailLog(logText, 600) : [];
  const filteredLog = logFilter
    ? logLines.filter(l => l.toLowerCase().includes(logFilter.toLowerCase()))
    : logLines;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Terminal</h2>
        <p className="text-sm text-gray-400">
          Console G-code temps réel · Commandes shell · Lecteur de klippy.log avec analyse des tracebacks
        </p>
      </div>

      {/* ── Connexion ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[150px]">
            <label className="block text-xs text-gray-400 mb-1">IP Imprimante</label>
            <input value={ip} onChange={e => { setIp(e.target.value); setConnected(false); }}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-orange-500" />
          </div>
          <div className="w-20">
            <label className="block text-xs text-gray-400 mb-1">Port</label>
            <input value={port} onChange={e => { setPort(e.target.value); setConnected(false); }}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-orange-500" />
          </div>
          <button onClick={connect}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium transition-colors">
            {connected ? <RefreshCw size={14} /> : <Wifi size={14} />}
            {connected ? 'Reconnecter' : 'Connecter'}
          </button>
          <div className="flex items-center gap-2 text-sm">
            {connected
              ? <><div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /><span className="text-green-400">En ligne</span></>
              : <><div className="w-2 h-2 rounded-full bg-gray-600" /><span className="text-gray-500">Hors ligne</span></>}
          </div>
        </div>
        {connError && (
          <div className="mt-3 flex items-start gap-2 text-xs text-red-400">
            <WifiOff size={13} className="mt-0.5 flex-shrink-0" />
            <span>{connError} — L'app doit tourner sur le même réseau que l'imprimante.</span>
          </div>
        )}
      </div>

      {/* ── Sélecteur de mode ─────────────────────────────────────────────── */}
      <div className="flex gap-2">
        {([
          { id: 'gcode', label: 'Console G-code', icon: TerminalIcon },
          { id: 'shell', label: 'Commandes shell', icon: Play },
          { id: 'log',   label: 'klippy.log',      icon: FileText },
        ] as const).map(m => (
          <button key={m.id} onClick={() => setMode(m.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium border transition-colors ${
              mode === m.id
                ? 'bg-orange-600/20 border-orange-600 text-orange-300'
                : 'bg-gray-900 border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600'
            }`}>
            <m.icon size={13} /> {m.label}
          </button>
        ))}
      </div>

      {/* ══ MODE CONSOLE G-CODE ═══════════════════════════════════════════ */}
      {mode === 'gcode' && (
        <>
          <div className="rounded-xl border border-gray-800 bg-gray-950 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-900/60">
              <div className="flex items-center gap-2">
                <TerminalIcon size={13} className="text-orange-400" />
                <span className="text-xs font-bold text-gray-300 uppercase tracking-widest">Console</span>
                <span className="text-xs text-gray-600">{entries.length} lignes</span>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                  <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)}
                    className="accent-orange-500" />
                  Auto-scroll
                </label>
                <button onClick={() => { setEntries([]); seenKeys.current.clear(); }}
                  className="text-gray-500 hover:text-gray-300 transition-colors" title="Vider">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            <div ref={outputRef} className="h-[420px] overflow-y-auto p-3 font-mono text-xs space-y-0.5">
              {entries.length === 0 && (
                <div className="text-gray-600 py-8 text-center">
                  {connected ? 'Console vide — tape une commande ci-dessous' : 'Connecte-toi pour voir la sortie'}
                </div>
              )}
              {entries.map((e, i) => {
                const msg = e.message;
                const isErr = /error|!!|shutdown|unable|invalid/i.test(msg);
                const isCmd = e.type === 'command';
                return (
                  <div key={`${e.time}-${i}`} className="flex gap-2 leading-relaxed">
                    <span className="text-gray-700 flex-shrink-0 select-none">
                      {new Date(e.time * 1000).toLocaleTimeString('fr-FR')}
                    </span>
                    <span className={`flex-shrink-0 select-none ${isCmd ? 'text-blue-500' : 'text-gray-700'}`}>
                      {isCmd ? '>' : ' '}
                    </span>
                    <span className={`whitespace-pre-wrap break-all ${
                      isErr ? 'text-red-400' : isCmd ? 'text-blue-300' : 'text-gray-300'
                    }`}>{msg}</span>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-gray-800 p-3 flex gap-2 bg-gray-900/40">
              <span className="text-orange-500 font-mono text-sm self-center select-none">❯</span>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={!connected || busy}
                placeholder={connected ? 'Commande G-code…  (↑/↓ historique)' : 'Connecte-toi d\'abord'}
                spellCheck={false}
                className="flex-1 bg-transparent text-sm text-gray-100 font-mono focus:outline-none disabled:opacity-40 placeholder:text-gray-700"
              />
              <button onClick={() => { run(input); setInput(''); }} disabled={!connected || busy || !input.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-30 text-white text-xs font-medium transition-colors">
                {busy ? <RefreshCw size={11} className="animate-spin" /> : <Send size={11} />} Envoyer
              </button>
            </div>
          </div>

          {/* Bibliothèque de commandes */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
            <button onClick={() => setShowPresets(v => !v)}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-800/30 transition-colors">
              <span className="text-xs font-bold text-gray-300 uppercase tracking-widest">
                Bibliothèque de commandes
              </span>
              {showPresets ? <ChevronUp size={15} className="text-gray-500" /> : <ChevronDown size={15} className="text-gray-500" />}
            </button>
            {showPresets && (
              <div className="border-t border-gray-800 p-4 grid gap-4 sm:grid-cols-2">
                {presets.filter(g => !g.name.includes('shell')).map(group => (
                  <div key={group.name}>
                    <div className="text-xs font-semibold text-gray-400 mb-2">{group.icon} {group.name}</div>
                    <div className="space-y-1">
                      {group.cmds.map(c => (
                        <button key={c.cmd}
                          onClick={() => { setInput(c.cmd); }}
                          disabled={!connected}
                          title={`Insérer : ${c.cmd}`}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg border text-xs transition-colors disabled:opacity-40 ${
                            c.danger
                              ? 'border-orange-900/60 bg-orange-950/20 hover:border-orange-700 text-orange-300'
                              : 'border-gray-800 bg-gray-800/30 hover:border-gray-600 text-gray-300'
                          }`}>
                          <span className="font-mono text-xs">{c.cmd}</span>
                          <span className="block text-gray-600 mt-0.5">{c.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ══ MODE SHELL ════════════════════════════════════════════════════ */}
      {mode === 'shell' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-blue-900/50 bg-blue-950/20 text-xs text-blue-200 leading-relaxed">
            <strong className="text-blue-100">Comment ça marche.</strong> Moonraker n'expose pas de shell — c'est
            volontaire. Pour exécuter des commandes système depuis l'interface, Klipper doit avoir des sections{' '}
            <code className="bg-blue-900/40 px-1 rounded">[gcode_shell_command]</code> déclarées dans la config.
            L'app interroge <code className="bg-blue-900/40 px-1 rounded">/printer/objects/list</code> pour découvrir
            celles qui existent réellement sur ta machine.
          </div>

          {/* Shell commands détectées */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-gray-300 uppercase tracking-widest">
                Commandes shell détectées
              </span>
              <button onClick={connect} disabled={!ip}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-gray-200 text-xs transition-colors">
                <RefreshCw size={11} /> Re-scanner
              </button>
            </div>

            {!shellScanned && <p className="text-xs text-gray-600">Connecte-toi pour scanner.</p>}
            {shellScanned && shellObjects.length === 0 && (
              <div className="text-xs text-gray-500 space-y-2">
                <p>Aucune section <code className="bg-gray-800 px-1 rounded">[gcode_shell_command]</code> trouvée sur cette imprimante.</p>
                <p className="text-gray-600">Utilise le bloc ci-dessous pour en ajouter, ou passe par SSH.</p>
              </div>
            )}
            {shellObjects.length > 0 && (
              <div className="space-y-1.5">
                {shellObjects.map(name => (
                  <div key={name} className="flex items-center gap-2 p-2 rounded-lg border border-gray-800 bg-gray-800/30">
                    <code className="flex-1 text-xs font-mono text-green-400">{name}</code>
                    <button onClick={() => run(`RUN_SHELL_COMMAND CMD=${name}`)} disabled={!connected || busy}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-green-800 hover:bg-green-700 disabled:opacity-40 text-white text-xs transition-colors">
                      <Play size={10} /> Exécuter
                    </button>
                  </div>
                ))}
                <p className="text-xs text-gray-600 pt-1">
                  La sortie apparaît dans l'onglet <strong className="text-gray-400">Console G-code</strong>.
                </p>
              </div>
            )}
          </div>

          {/* Bloc à ajouter dans printer.cfg */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
            <div className="text-xs font-bold text-gray-300 uppercase tracking-widest mb-1">
              Ajouter des commandes de diagnostic CAN
            </div>
            <p className="text-xs text-gray-500 mb-3">
              À coller à la fin de <code className="bg-gray-800 px-1 rounded">printer.cfg</code>, puis{' '}
              <code className="bg-gray-800 px-1 rounded">FIRMWARE_RESTART</code>. RatOS inclut déjà le module{' '}
              <code className="bg-gray-800 px-1 rounded">gcode_shell_command.py</code>.
            </p>
            <CopyBlock text={SHELL_CFG_SNIPPET.replace('{{BITRATE}}', String(config.canSpeed))} />
            <div className="mt-3 p-2.5 rounded-lg border border-yellow-900/60 bg-yellow-950/20 text-xs text-yellow-300">
              ⚠ Chaque commande shell tourne avec les droits de l'utilisateur Klipper. N'y mets que des
              commandes de lecture ; garde les opérations destructrices pour SSH.
            </div>
          </div>

          {/* Commandes SSH de référence */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
            <div className="text-xs font-bold text-gray-300 uppercase tracking-widest mb-3">
              🔌 À lancer en SSH (copie/colle)
            </div>
            <div className="space-y-1.5">
              {presets.find(g => g.name.includes('shell'))?.cmds.map(c => (
                <div key={c.cmd} className="p-2 rounded-lg border border-gray-800 bg-gray-800/30">
                  <div className="text-xs text-gray-500 mb-1">{c.label}</div>
                  <div className="flex items-start gap-2">
                    <code className="flex-1 text-xs font-mono text-orange-300 break-all">{c.cmd}</code>
                    <button onClick={() => navigator.clipboard?.writeText(c.cmd)}
                      className="flex-shrink-0 text-gray-600 hover:text-gray-300 transition-colors" title="Copier">
                      <Copy size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══ MODE KLIPPY.LOG ═══════════════════════════════════════════════ */}
      {mode === 'log' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={loadLog} disabled={logLoading}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-medium transition-colors">
                {logLoading ? <RefreshCw size={12} className="animate-spin" /> : <FileText size={12} />}
                {logText ? 'Recharger klippy.log' : 'Charger klippy.log'}
              </button>
              {logText && (
                <span className="text-xs text-gray-500">
                  {(logText.length / 1024).toFixed(0)} Ko · {tracebacks.length} traceback{tracebacks.length > 1 ? 's' : ''} · {cfgErrors.length} erreur{cfgErrors.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
            {logError && <p className="text-xs text-red-400 mt-2">{logError}</p>}
            {!logText && !logError && (
              <p className="text-xs text-gray-600 mt-2">
                klippy.log contient la trace exacte de l'erreur de démarrage — c'est la source de vérité
                quand Klipper refuse de se lancer.
              </p>
            )}
          </div>

          {/* Tracebacks analysés */}
          {tracebacks.map((tb, i) => (
            <div key={i} className="rounded-xl border border-red-900/60 bg-red-950/20 overflow-hidden">
              <div className="px-4 py-3 border-b border-red-900/40 flex items-start gap-2">
                <AlertTriangle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-red-200 break-words">{tb.errorMessage}</div>
                  <div className="text-xs text-red-400/70 mt-0.5">
                    Traceback {i === 0 ? '(le plus récent)' : `#${i + 1}`}
                  </div>
                </div>
              </div>

              {tb.thirdPartyModules.length > 0 && (
                <div className="px-4 py-3 border-b border-red-900/40 bg-red-900/10">
                  <div className="text-xs text-gray-400 mb-1.5">
                    Module(s) tiers impliqué(s) — <strong className="text-red-300">coupable le plus probable</strong> :
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {tb.thirdPartyModules.map(m => (
                      <code key={m} className="px-2 py-0.5 rounded bg-red-900/40 border border-red-800 text-red-200 text-xs font-mono">
                        {m}
                      </code>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-gray-950 p-3 max-h-64 overflow-auto">
                {tb.lines.map((l, j) => (
                  <div key={j} className={`text-xs font-mono whitespace-pre leading-relaxed ${
                    l.includes('File "') ? 'text-blue-400'
                    : j === tb.lines.length - 1 ? 'text-red-400 font-semibold'
                    : 'text-gray-500'
                  }`}>{l}</div>
                ))}
              </div>
            </div>
          ))}

          {/* Erreurs de config sans traceback */}
          {cfgErrors.length > 0 && (
            <div className="rounded-xl border border-orange-900/60 bg-orange-950/20 p-4">
              <div className="text-xs font-bold text-orange-300 uppercase tracking-widest mb-2">
                Erreurs de configuration
              </div>
              <div className="space-y-1">
                {cfgErrors.map((e, i) => (
                  <div key={i} className="text-xs font-mono text-orange-200 break-all">• {e}</div>
                ))}
              </div>
            </div>
          )}

          {/* Log brut */}
          {logText && (
            <div className="rounded-xl border border-gray-800 bg-gray-950 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-gray-900/60">
                <Search size={12} className="text-gray-500" />
                <input value={logFilter} onChange={e => setLogFilter(e.target.value)}
                  placeholder="Filtrer les lignes…"
                  className="flex-1 bg-transparent text-xs text-gray-200 font-mono focus:outline-none placeholder:text-gray-700" />
                <span className="text-xs text-gray-600">{filteredLog.length} lignes</span>
              </div>
              <div className="h-80 overflow-auto p-3">
                {filteredLog.map((l, i) => (
                  <div key={i} className={`text-xs font-mono whitespace-pre leading-relaxed ${
                    /error|traceback|shutdown|invalid/i.test(l) ? 'text-red-400'
                    : /warn/i.test(l) ? 'text-yellow-400'
                    : 'text-gray-500'
                  }`}>{l}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Snippet de config shell ──────────────────────────────────────────────────

const SHELL_CFG_SNIPPET = `# ── Diagnostic CAN depuis l'interface web ──────────────────────
# Commandes en LECTURE SEULE, exécutables via RUN_SHELL_COMMAND CMD=<nom>

[gcode_shell_command can_status]
command: ip -details -statistics link show can0
timeout: 5.
verbose: True

[gcode_shell_command can_uuids]
command: /home/pi/klippy-env/bin/python /home/pi/klipper/scripts/canbus_query.py can0
timeout: 20.
verbose: True

[gcode_shell_command probe_plugins]
command: ls -la /home/pi/klipper/klippy/extras/
timeout: 5.
verbose: True

[gcode_shell_command usb_devices]
command: lsusb
timeout: 5.
verbose: True

# Wrappers G-code (optionnel — pour appeler par un nom lisible)
[gcode_macro CAN_STATUS]
gcode:
    RUN_SHELL_COMMAND CMD=can_status

[gcode_macro CAN_UUIDS]
gcode:
    { action_respond_info("Klipper doit être arrêté pour que le scan aboutisse.") }
    RUN_SHELL_COMMAND CMD=can_uuids

[gcode_macro PROBE_PLUGINS]
gcode:
    RUN_SHELL_COMMAND CMD=probe_plugins`;

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs font-mono text-gray-300 overflow-x-auto max-h-72 overflow-y-auto whitespace-pre">
        {text}
      </pre>
      <button
        onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs transition-colors">
        <Copy size={11} /> {copied ? 'Copié' : 'Copier'}
      </button>
    </div>
  );
}
