import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity, Wifi, WifiOff, RefreshCw, AlertTriangle, CheckCircle2,
  XCircle, Thermometer, Cpu, Zap, Clock, Terminal, Info, ChevronDown, ChevronUp,
} from 'lucide-react';

// ─── Moonraker API types ───────────────────────────────────────────────────────

interface PrinterInfo {
  state: string;           // ready | error | shutdown | startup | disconnected
  state_message: string;
  hostname: string;
  klipper_version: string;
  software_version: string;
}

interface McuStatus {
  mcu_version?: string;
  last_stats?: string;
  mcu_awake?: number;
  freq?: number;
}

interface TempSensor {
  temperature?: number;
  target?: number;
  power?: number;
  speed?: number;
}

interface ToolheadStatus {
  position?: number[];
  homed_axes?: string;
  max_velocity?: number;
  max_accel?: number;
}

interface BedMeshStatus {
  profile_name?: string;
  mesh_min?: number[];
  mesh_max?: number[];
  probed_matrix?: number[][];
}

interface PrintStats {
  state?: string;
  filename?: string;
  total_duration?: number;
  print_duration?: number;
}

interface ZTiltStatus {
  applied?: boolean;
}

interface CartographerStatus {
  last_z_result?: number;
  last_probe_counts?: string;
}

interface PrinterObjects {
  mcu?: McuStatus;
  'mcu EBB42'?: McuStatus;
  'mcu scanner'?: McuStatus;
  'mcu cartographer'?: McuStatus;
  extruder?: TempSensor;
  heater_bed?: TempSensor;
  'temperature_sensor Chamber'?: TempSensor;
  'temperature_sensor EBB42'?: TempSensor;
  'temperature_sensor Octopus'?: TempSensor;
  toolhead?: ToolheadStatus;
  bed_mesh?: BedMeshStatus;
  print_stats?: PrintStats;
  z_tilt?: ZTiltStatus;
  scanner?: CartographerStatus;
  cartographer?: CartographerStatus;
  webhooks?: { state?: string; state_message?: string };
  stepper_z?: { homing_positive_dir?: boolean; position_endstop?: number };
}

interface GCodeEntry {
  type: string;
  time: number;
  message: string;
}

// ─── Check result ──────────────────────────────────────────────────────────────

type CheckStatus = 'ok' | 'warn' | 'error' | 'info' | 'unknown';

interface Check {
  label: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusIcon(s: CheckStatus) {
  if (s === 'ok')      return <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />;
  if (s === 'warn')    return <AlertTriangle size={14} className="text-yellow-400 flex-shrink-0" />;
  if (s === 'error')   return <XCircle size={14} className="text-red-400 flex-shrink-0" />;
  if (s === 'info')    return <Info size={14} className="text-blue-400 flex-shrink-0" />;
  return <Clock size={14} className="text-gray-500 flex-shrink-0" />;
}

function statusColor(s: CheckStatus) {
  if (s === 'ok')    return 'border-green-800 bg-green-900/10';
  if (s === 'warn')  return 'border-yellow-800 bg-yellow-900/10';
  if (s === 'error') return 'border-red-800 bg-red-900/10';
  if (s === 'info')  return 'border-blue-800 bg-blue-900/10';
  return 'border-gray-700 bg-gray-800/30';
}

function tempColor(t: number, target: number) {
  if (target === 0) return 'text-gray-400';
  const diff = Math.abs(t - target);
  if (diff < 2)  return 'text-green-400';
  if (diff < 10) return 'text-yellow-400';
  return 'text-blue-400';
}

function fmtTemp(t?: number) {
  return t !== undefined ? `${t.toFixed(1)}°C` : '—';
}

function fmtDuration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}m` : `${m}m${sec.toString().padStart(2, '0')}s`;
}

// ─── Build diagnostic checks ──────────────────────────────────────────────────

function buildChecks(info: PrinterInfo, objs: PrinterObjects, gcodes: GCodeEntry[]): Check[] {
  const checks: Check[] = [];

  // 1. Klipper state
  const ks = objs.webhooks?.state ?? info.state;
  checks.push({
    label: 'État Klipper',
    status: ks === 'ready' ? 'ok' : ks === 'startup' ? 'warn' : 'error',
    detail: ks === 'ready' ? 'Klipper opérationnel' : objs.webhooks?.state_message ?? info.state_message,
    hint: ks === 'error' ? 'Vérifier les logs Moonraker → klippy.log pour le détail de l\'erreur' : undefined,
  });

  // 2. MCU principal
  const mcuOk = !!objs.mcu?.mcu_version;
  checks.push({
    label: 'MCU Principal (Octopus)',
    status: mcuOk ? 'ok' : 'error',
    detail: mcuOk ? `Version : ${objs.mcu?.mcu_version?.split('-')[0]}` : 'MCU non connecté ou firmware manquant',
    hint: !mcuOk ? 'Vérifier le port série dans printer.cfg → [mcu] serial:' : undefined,
  });

  // 3. EBB42 MCU
  const ebb = objs['mcu EBB42'];
  const ebbOk = !!ebb?.mcu_version;
  checks.push({
    label: 'EBB42 v1.2 (CAN)',
    status: ebbOk ? 'ok' : 'error',
    detail: ebbOk ? `Connecté — v${ebb!.mcu_version?.split('-')[0]}` : 'EBB42 non trouvé sur le bus CAN',
    hint: !ebbOk ? 'Vérifier canbus_uuid EBB42 dans printer.cfg, alimentation 24V, câbles CAN' : undefined,
  });

  // 4. Cartographer MCU (scanner ou cartographer)
  const carto = objs['mcu scanner'] ?? objs['mcu cartographer'];
  const cartoOk = !!carto?.mcu_version;
  checks.push({
    label: 'Cartographer CAN (probe)',
    status: cartoOk ? 'ok' : 'error',
    detail: cartoOk ? `Connecté — ${carto!.mcu_version?.split('-')[0]}` : 'Cartographer non trouvé sur le bus CAN',
    hint: !cartoOk ? 'Vérifier canbus_uuid Cartographer, jumper 120Ω, alimentation 3.3V depuis EBB42' : undefined,
  });

  // 5. Homing
  const homed = objs.toolhead?.homed_axes ?? '';
  checks.push({
    label: 'Homing axes',
    status: homed === 'xyz' ? 'ok' : homed === '' ? 'warn' : 'warn',
    detail: homed === 'xyz' ? 'Tous les axes homés (XYZ)' : homed === '' ? 'Aucun axe homé' : `Axes homés : ${homed || '—'}`,
    hint: homed !== 'xyz' ? 'Lancer G28 pour home tous les axes' : undefined,
  });

  // 6. Z Tilt
  const ztiltApplied = objs.z_tilt?.applied;
  checks.push({
    label: 'Z_TILT_ADJUST (3 vis Z)',
    status: ztiltApplied ? 'ok' : ztiltApplied === false ? 'warn' : 'unknown',
    detail: ztiltApplied ? 'Plateau nivelé via Z_TILT_ADJUST' : ztiltApplied === false ? 'Z_TILT non appliqué' : 'Status inconnu',
    hint: !ztiltApplied ? 'Lancer Z_TILT_ADJUST après G28 pour niveler le plateau' : undefined,
  });

  // 7. Bed mesh
  const mesh = objs.bed_mesh;
  const meshLoaded = !!mesh?.profile_name && mesh.profile_name !== '';
  checks.push({
    label: 'Bed Mesh',
    status: meshLoaded ? 'ok' : 'warn',
    detail: meshLoaded ? `Profil chargé : "${mesh!.profile_name}"` : 'Aucun profil de mesh chargé',
    hint: !meshLoaded ? 'Lancer BED_MESH_CALIBRATE puis BED_MESH_PROFILE SAVE=default + SAVE_CONFIG' : undefined,
  });

  // 8. Cartographer calibration
  const cartoData = objs.scanner ?? objs.cartographer;
  checks.push({
    label: 'Cartographer calibré',
    status: cartoData?.last_z_result !== undefined ? 'ok' : 'warn',
    detail: cartoData?.last_z_result !== undefined
      ? `Dernier Z result : ${cartoData.last_z_result.toFixed(4)}mm`
      : 'Aucune calibration Cartographer détectée',
    hint: !cartoData?.last_z_result ? 'Lancer CARTOGRAPHER_CALIBRATE avec hotend (150°C) + lit (60°C)' : undefined,
  });

  // 9. Température hotend
  const ext = objs.extruder;
  checks.push({
    label: 'Hotend',
    status: ext?.temperature !== undefined ? 'ok' : 'warn',
    detail: ext?.temperature !== undefined
      ? `${fmtTemp(ext.temperature)} / cible ${fmtTemp(ext.target)}`
      : 'Capteur hotend non lisible',
    hint: ext?.temperature === undefined ? 'Vérifier branchement thermistance sur EBB42 PA3' : undefined,
  });

  // 10. Température lit
  const bed = objs.heater_bed;
  checks.push({
    label: 'Lit chauffant',
    status: bed?.temperature !== undefined ? 'ok' : 'warn',
    detail: bed?.temperature !== undefined
      ? `${fmtTemp(bed.temperature)} / cible ${fmtTemp(bed.target)}`
      : 'Capteur lit non lisible',
  });

  // 11. Erreurs récentes dans gcode store
  const recentErrors = gcodes.filter(g =>
    g.type === 'response' && (
      g.message.toLowerCase().includes('error') ||
      g.message.toLowerCase().includes('shutdown') ||
      g.message.toLowerCase().includes('mcu')
    )
  );
  if (recentErrors.length > 0) {
    checks.push({
      label: `Erreurs récentes (${recentErrors.length})`,
      status: 'error',
      detail: recentErrors[0].message.slice(0, 120),
      hint: 'Voir section "Logs récents" ci-dessous',
    });
  }

  return checks;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PrinterDiagnostic() {
  const [ip, setIp] = useState('192.168.1.41');
  const [port, setPort] = useState('80');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [printerInfo, setPrinterInfo] = useState<PrinterInfo | null>(null);
  const [objects, setObjects] = useState<PrinterObjects>({});
  const [gcodes, setGcodes] = useState<GCodeEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [checks, setChecks] = useState<Check[]>([]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const baseUrl = `http://${ip}:${port}`;

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Printer info
      const infoRes = await fetch(`${baseUrl}/printer/info`, { signal: AbortSignal.timeout(5000) });
      if (!infoRes.ok) throw new Error(`HTTP ${infoRes.status}`);
      const info: PrinterInfo = (await infoRes.json()).result;

      // Objects query — request everything useful
      const objKeys = [
        'mcu', 'mcu EBB42', 'mcu scanner', 'mcu cartographer',
        'extruder', 'heater_bed',
        'temperature_sensor Chamber', 'temperature_sensor EBB42', 'temperature_sensor Octopus',
        'toolhead', 'bed_mesh', 'print_stats', 'z_tilt',
        'scanner', 'cartographer', 'webhooks', 'stepper_z',
      ];
      const objRes = await fetch(
        `${baseUrl}/printer/objects/query?${objKeys.map(k => encodeURIComponent(k)).join('&')}`,
        { signal: AbortSignal.timeout(5000) }
      );
      const objData = objRes.ok ? (await objRes.json()).result?.status ?? {} : {};

      // GCode store (recent errors)
      const gcRes = await fetch(`${baseUrl}/server/gcode_store?count=100`, { signal: AbortSignal.timeout(5000) });
      const gcData = gcRes.ok ? (await gcRes.json()).result?.gcode_store ?? [] : [];

      setPrinterInfo(info);
      setObjects(objData);
      setGcodes(gcData);
      setChecks(buildChecks(info, objData, gcData));
      setConnected(true);
      setLastUpdate(new Date());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        msg.includes('Failed to fetch') || msg.includes('NetworkError')
          ? `Impossible de joindre ${baseUrl} — vérifier que l'imprimante est allumée et sur le même réseau`
          : msg.includes('timeout') ? 'Timeout — l\'imprimante ne répond pas'
          : msg
      );
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  // Auto-refresh
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (autoRefresh && connected) {
      intervalRef.current = setInterval(fetchAll, 5000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, connected, fetchAll]);

  const okCount    = checks.filter(c => c.status === 'ok').length;
  const warnCount  = checks.filter(c => c.status === 'warn').length;
  const errorCount = checks.filter(c => c.status === 'error').length;
  const totalChecks = checks.filter(c => c.status !== 'unknown').length;

  const printerState = printerInfo?.state ?? 'disconnected';
  const stateColor = printerState === 'ready' ? 'text-green-400' : printerState === 'error' || printerState === 'shutdown' ? 'text-red-400' : 'text-yellow-400';

  const errorLogs = gcodes.filter(g =>
    g.type === 'response' && (
      g.message.toLowerCase().includes('error') ||
      g.message.toLowerCase().includes('shutdown') ||
      g.message.toLowerCase().includes('mcu') ||
      g.message.toLowerCase().includes('lost')
    )
  ).slice(0, 20);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Diagnostic Imprimante</h2>
        <p className="text-sm text-gray-400">
          Connexion directe à Moonraker API — checks Klipper, CAN bus, Cartographer, températures
        </p>
      </div>

      {/* Connection bar */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-0">
            <label className="block text-xs text-gray-400 mb-1">Adresse IP Imprimante</label>
            <input
              type="text"
              value={ip}
              onChange={e => { setIp(e.target.value); setConnected(false); }}
              placeholder="192.168.1.41"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-orange-500"
            />
          </div>
          <div className="w-24">
            <label className="block text-xs text-gray-400 mb-1">Port</label>
            <input
              type="text"
              value={port}
              onChange={e => setPort(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-orange-500"
            />
          </div>
          <button
            onClick={fetchAll}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-medium text-sm transition-colors"
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : connected ? <Activity size={14} /> : <Wifi size={14} />}
            {loading ? 'Analyse…' : connected ? 'Rafraîchir' : 'Connecter'}
          </button>

          {/* Status indicator */}
          <div className="flex items-center gap-2 text-sm">
            {connected
              ? <><div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /><span className="text-green-400">Connecté</span></>
              : <><div className="w-2 h-2 rounded-full bg-gray-600" /><span className="text-gray-500">Hors ligne</span></>
            }
          </div>

          {/* Auto-refresh toggle */}
          {connected && (
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
              <button
                onClick={() => setAutoRefresh(r => !r)}
                className={`w-8 h-4 rounded-full transition-colors relative ${autoRefresh ? 'bg-orange-500' : 'bg-gray-700'}`}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${autoRefresh ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
              Auto 5s
            </label>
          )}
        </div>

        {lastUpdate && (
          <p className="text-xs text-gray-600 mt-2">
            Dernière mise à jour : {lastUpdate.toLocaleTimeString('fr-FR')}
          </p>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl border border-red-800 bg-red-900/20 flex gap-3">
          <WifiOff size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-300 font-medium">Connexion échouée</p>
            <p className="text-xs text-red-400 mt-1">{error}</p>
            <p className="text-xs text-gray-500 mt-2">
              → L'app doit tourner sur le même réseau que l'imprimante (pas depuis un VPN ou réseau extérieur).
            </p>
          </div>
        </div>
      )}

      {/* Connected dashboard */}
      {connected && printerInfo && (
        <>
          {/* Status header */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label: 'État Klipper',
                value: printerState.toUpperCase(),
                color: stateColor,
                icon: Activity,
              },
              {
                label: 'Version Klipper',
                value: printerInfo.klipper_version?.split('-')[0] ?? '—',
                color: 'text-gray-200',
                icon: Cpu,
              },
              {
                label: 'Hostname',
                value: printerInfo.hostname || ip,
                color: 'text-gray-200',
                icon: Wifi,
              },
              {
                label: 'Checks',
                value: `${okCount} OK · ${warnCount} ⚠ · ${errorCount} ✗`,
                color: errorCount > 0 ? 'text-red-400' : warnCount > 0 ? 'text-yellow-400' : 'text-green-400',
                icon: CheckCircle2,
              },
            ].map(item => (
              <div key={item.label} className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
                <div className="flex items-center gap-1.5 mb-1">
                  <item.icon size={12} className="text-gray-500" />
                  <span className="text-xs text-gray-500">{item.label}</span>
                </div>
                <div className={`text-sm font-bold ${item.color} break-all`}>{item.value}</div>
              </div>
            ))}
          </div>

          {/* Temperatures */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Thermometer size={15} className="text-orange-400" />
              <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Températures</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { label: 'Hotend',   sensor: objects.extruder,                              icon: '🔥' },
                { label: 'Lit',      sensor: objects.heater_bed,                            icon: '♨️' },
                { label: 'Chamber',  sensor: objects['temperature_sensor Chamber'],         icon: '🏠' },
                { label: 'EBB42',    sensor: objects['temperature_sensor EBB42'],           icon: '⚡' },
                { label: 'Octopus',  sensor: objects['temperature_sensor Octopus'],         icon: '🖥️' },
              ].map(item => {
                const t = item.sensor?.temperature;
                const target = item.sensor?.target ?? 0;
                return (
                  <div key={item.label} className="rounded-lg border border-gray-700 bg-gray-800/40 p-3 text-center">
                    <div className="text-lg mb-0.5">{item.icon}</div>
                    <div className="text-xs text-gray-500 mb-1">{item.label}</div>
                    {t !== undefined ? (
                      <>
                        <div className={`text-base font-bold ${tempColor(t, target)}`}>{fmtTemp(t)}</div>
                        {target > 0 && <div className="text-xs text-gray-600 mt-0.5">→ {fmtTemp(target)}</div>}
                        {item.sensor?.power !== undefined && (
                          <div className="text-xs text-gray-600">{(item.sensor.power * 100).toFixed(0)}%</div>
                        )}
                      </>
                    ) : (
                      <div className="text-sm text-gray-600">—</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* MCU / CAN bus status */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={15} className="text-orange-400" />
              <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">MCU & CAN Bus</h3>
            </div>
            <div className="space-y-2">
              {[
                { label: 'MCU Principal (Octopus)',   key: 'mcu'              as keyof PrinterObjects },
                { label: 'EBB42 v1.2 (CAN)',          key: 'mcu EBB42'       as keyof PrinterObjects },
                { label: 'Cartographer ([scanner])',  key: 'mcu scanner'     as keyof PrinterObjects },
                { label: 'Cartographer ([carto…])',   key: 'mcu cartographer' as keyof PrinterObjects },
              ].map(item => {
                const mcu = objects[item.key] as McuStatus | undefined;
                const present = !!mcu?.mcu_version;
                if (item.key === 'mcu cartographer' && objects['mcu scanner']?.mcu_version) return null;
                if (item.key === 'mcu scanner' && !objects['mcu scanner'] && !objects['mcu cartographer']) return null;
                return (
                  <div key={item.key} className={`flex items-center gap-3 p-3 rounded-lg border ${present ? 'border-green-800 bg-green-900/10' : 'border-gray-700 bg-gray-800/30'}`}>
                    {present
                      ? <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />
                      : <XCircle size={14} className="text-gray-600 flex-shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm ${present ? 'text-gray-200' : 'text-gray-500'}`}>{item.label}</div>
                      {present && mcu?.mcu_version && (
                        <div className="text-xs text-gray-500 truncate">{mcu.mcu_version.split(' ')[0]}</div>
                      )}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded border ${present ? 'text-green-400 border-green-800 bg-green-900/20' : 'text-gray-600 border-gray-700'}`}>
                      {present ? 'OK' : 'Absent'}
                    </span>
                  </div>
                );
              }).filter(Boolean)}
            </div>
          </div>

          {/* Print status */}
          {objects.print_stats?.state && objects.print_stats.state !== 'standby' && (
            <div className="rounded-xl border border-blue-800 bg-blue-900/10 p-5">
              <h3 className="text-xs font-bold text-blue-300 uppercase tracking-widest mb-3">Impression en cours</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div><div className="text-xs text-gray-500">Fichier</div><div className="text-gray-200 truncate">{objects.print_stats.filename || '—'}</div></div>
                <div><div className="text-xs text-gray-500">État</div><div className="text-blue-300">{objects.print_stats.state}</div></div>
                <div><div className="text-xs text-gray-500">Durée impression</div><div className="text-gray-200">{objects.print_stats.print_duration ? fmtDuration(objects.print_stats.print_duration) : '—'}</div></div>
                <div><div className="text-xs text-gray-500">Durée totale</div><div className="text-gray-200">{objects.print_stats.total_duration ? fmtDuration(objects.print_stats.total_duration) : '—'}</div></div>
              </div>
            </div>
          )}

          {/* Checks */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={15} className="text-orange-400" />
                <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">
                  Checks ({okCount}/{totalChecks} OK)
                </h3>
              </div>
              <div className="flex gap-2 text-xs">
                <span className="text-green-400">{okCount} ✓</span>
                <span className="text-yellow-400">{warnCount} ⚠</span>
                <span className="text-red-400">{errorCount} ✗</span>
              </div>
            </div>
            <div className="space-y-2">
              {checks.map((check, i) => (
                <div key={i} className={`p-3 rounded-lg border ${statusColor(check.status)}`}>
                  <div className="flex items-start gap-2">
                    {statusIcon(check.status)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-gray-200">{check.label}</span>
                        <span className={`text-xs flex-shrink-0 ${
                          check.status === 'ok' ? 'text-green-400' :
                          check.status === 'warn' ? 'text-yellow-400' :
                          check.status === 'error' ? 'text-red-400' : 'text-gray-500'
                        }`}>
                          {check.status.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{check.detail}</p>
                      {check.hint && (
                        <p className="text-xs text-gray-600 mt-1 italic">→ {check.hint}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Logs */}
          {gcodes.length > 0 && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
              <button
                onClick={() => setShowLogs(l => !l)}
                className="w-full flex items-center justify-between p-5 hover:bg-gray-800/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Terminal size={15} className="text-orange-400" />
                  <span className="text-xs font-bold text-gray-300 uppercase tracking-widest">
                    Logs récents ({errorLogs.length > 0 ? `${errorLogs.length} erreurs` : 'aucune erreur'})
                  </span>
                </div>
                {showLogs ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
              </button>
              {showLogs && (
                <div className="border-t border-gray-800 bg-gray-950 p-4 max-h-72 overflow-y-auto">
                  {(errorLogs.length > 0 ? errorLogs : gcodes.slice(-30)).map((entry, i) => (
                    <div key={i} className={`text-xs font-mono py-0.5 ${
                      entry.message.toLowerCase().includes('error') ? 'text-red-400' :
                      entry.message.toLowerCase().includes('shutdown') ? 'text-red-300' :
                      entry.type === 'command' ? 'text-blue-400' : 'text-gray-400'
                    }`}>
                      <span className="text-gray-700 mr-2">{new Date(entry.time * 1000).toLocaleTimeString('fr-FR')}</span>
                      {entry.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Not connected placeholder */}
      {!connected && !error && !loading && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/30 py-16 text-center">
          <Wifi size={32} className="mx-auto mb-3 text-gray-700" />
          <p className="text-sm text-gray-500">Entrer l'adresse IP de l'imprimante et cliquer "Connecter"</p>
          <p className="text-xs text-gray-700 mt-1">L'app doit tourner sur le même réseau local que l'imprimante</p>
        </div>
      )}
    </div>
  );
}
