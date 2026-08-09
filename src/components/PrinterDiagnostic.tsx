import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity, Wifi, WifiOff, RefreshCw, AlertTriangle, CheckCircle2,
  XCircle, Thermometer, Cpu, Zap, Clock, Terminal, Info,
  ChevronDown, ChevronUp, Play, HardDrive, BarChart3, Settings2,
  Shield, Send,
} from 'lucide-react';

// ─── Moonraker API types ───────────────────────────────────────────────────────

interface PrinterInfo {
  state: string;
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
  frequency?: number;
  temp?: number;
}

interface StepperStatus {
  commanded_pos?: number;
  mcu_position?: number;
}

interface InputShaperStatus {
  shaper_freq_x?: number;
  shaper_freq_y?: number;
  shaper_type_x?: string;
  shaper_type_y?: string;
}

interface ConfigFileData {
  config?: {
    stepper_z?: { homing_retract_dist?: string; endstop_pin?: string; position_endstop?: string };
    bed_mesh?: { zero_reference_position?: string; mesh_min?: string; mesh_max?: string };
    input_shaper?: { shaper_freq_x?: string; shaper_freq_y?: string; shaper_type?: string };
    'mcu EBB42'?: { canbus_uuid?: string; canbus_interface?: string };
    scanner?: { canbus_uuid?: string; canbus_interface?: string };
    cartographer?: { canbus_uuid?: string; canbus_interface?: string };
    z_tilt?: { z_positions?: string };
  };
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
  stepper_z?: StepperStatus;
  stepper_z1?: StepperStatus;
  stepper_z2?: StepperStatus;
  input_shaper?: InputShaperStatus;
  configfile?: ConfigFileData;
}

interface GCodeEntry {
  type: string;
  time: number;
  message: string;
}

interface SysInfo {
  cpu_usage?: number;
  mem_total?: number;
  mem_available?: number;
  disk_total?: number;
  disk_used?: number;
  cpu_model?: string;
}

// ─── Check result ──────────────────────────────────────────────────────────────

type CheckStatus = 'ok' | 'warn' | 'error' | 'info' | 'unknown';
interface Check {
  label: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
  cmd?: string; // GCode to fix
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusIcon(s: CheckStatus) {
  if (s === 'ok')    return <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />;
  if (s === 'warn')  return <AlertTriangle size={14} className="text-yellow-400 flex-shrink-0" />;
  if (s === 'error') return <XCircle size={14} className="text-red-400 flex-shrink-0" />;
  if (s === 'info')  return <Info size={14} className="text-blue-400 flex-shrink-0" />;
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

function fmtBytes(b: number) {
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} Go`;
  if (b >= 1048576)    return `${(b / 1048576).toFixed(0)} Mo`;
  if (b >= 1024)       return `${(b / 1024).toFixed(0)} Ko`;
  return `${b} o`;
}

// Parse MCU last_stats string into key=value map
function parseMcuStats(stats?: string): Record<string, number> {
  if (!stats) return {};
  const result: Record<string, number> = {};
  for (const m of stats.matchAll(/(\w+)=([\d.]+)/g)) {
    result[m[1]] = parseFloat(m[2]);
  }
  return result;
}

// Analyze bed mesh matrix
function analyzeMesh(matrix?: number[][]): {
  min: number; max: number; range: number; stddev: number;
  rating: string; ratingColor: string;
} | null {
  if (!matrix || matrix.length === 0) return null;
  const flat = matrix.flat();
  if (flat.length === 0) return null;
  const min = Math.min(...flat);
  const max = Math.max(...flat);
  const range = max - min;
  const mean = flat.reduce((a, b) => a + b, 0) / flat.length;
  const variance = flat.reduce((a, b) => a + (b - mean) ** 2, 0) / flat.length;
  const stddev = Math.sqrt(variance);
  let rating: string; let ratingColor: string;
  if (range < 0.15)      { rating = 'Excellent';    ratingColor = 'text-green-300'; }
  else if (range < 0.30) { rating = 'Très bon';     ratingColor = 'text-green-400'; }
  else if (range < 0.60) { rating = 'Bon';          ratingColor = 'text-yellow-400'; }
  else if (range < 1.20) { rating = 'À améliorer';  ratingColor = 'text-orange-400'; }
  else                   { rating = 'Mauvais';       ratingColor = 'text-red-400'; }
  return { min, max, range, stddev, rating, ratingColor };
}

// ─── Diagnostic checks ────────────────────────────────────────────────────────

function buildRuntimeChecks(info: PrinterInfo, objs: PrinterObjects, gcodes: GCodeEntry[]): Check[] {
  const checks: Check[] = [];

  // Klipper state
  const ks = objs.webhooks?.state ?? info.state;
  checks.push({
    label: 'État Klipper',
    status: ks === 'ready' ? 'ok' : ks === 'startup' ? 'warn' : 'error',
    detail: ks === 'ready' ? 'Klipper opérationnel' : objs.webhooks?.state_message ?? info.state_message,
    hint: ks === 'error' ? 'Voir klippy.log pour le détail — souvent un UUID ou une pin incorrecte' : undefined,
    cmd: ks === 'error' ? 'FIRMWARE_RESTART' : undefined,
  });

  // MCU principal
  const mcuOk = !!objs.mcu?.mcu_version;
  checks.push({
    label: 'MCU Principal (Octopus)',
    status: mcuOk ? 'ok' : 'error',
    detail: mcuOk ? `Firmware: ${objs.mcu?.mcu_version?.split('-')[0] ?? '—'}` : 'MCU non connecté ou firmware absent',
    hint: !mcuOk ? 'Vérifier serial: dans [mcu] et que le firmware Klipper est flashé sur l\'Octopus' : undefined,
  });

  // EBB42
  const ebb = objs['mcu EBB42'];
  const ebbOk = !!ebb?.mcu_version;
  checks.push({
    label: 'EBB42 v1.2 (CAN)',
    status: ebbOk ? 'ok' : 'error',
    detail: ebbOk ? `Connecté — ${ebb!.mcu_version?.split('-')[0]}` : 'EBB42 introuvable sur le bus CAN',
    hint: !ebbOk ? 'Vérifier canbus_uuid EBB42, alimentation 24V, câbles CAN, résistance 120Ω sur U2C et Cartographer' : undefined,
  });

  // Cartographer
  const carto = objs['mcu scanner'] ?? objs['mcu cartographer'];
  const cartoOk = !!carto?.mcu_version;
  checks.push({
    label: 'Cartographer CAN (probe)',
    status: cartoOk ? 'ok' : 'error',
    detail: cartoOk ? `Connecté — ${carto!.mcu_version?.split('-')[0]}` : 'Cartographer introuvable sur le bus CAN',
    hint: !cartoOk ? 'Vérifier canbus_uuid Cartographer, jumper 120Ω, alimentation 3.3V via EBB42' : undefined,
  });

  // Homing
  const homed = objs.toolhead?.homed_axes ?? '';
  checks.push({
    label: 'Homing axes',
    status: homed === 'xyz' ? 'ok' : 'warn',
    detail: homed === 'xyz' ? 'Tous les axes homés (XYZ)' : homed === '' ? 'Aucun axe homé' : `Homés : ${homed}`,
    cmd: homed !== 'xyz' ? 'G28' : undefined,
  });

  // Z_TILT
  const ztiltApplied = objs.z_tilt?.applied;
  checks.push({
    label: 'Z_TILT_ADJUST (3 vis Z)',
    status: ztiltApplied ? 'ok' : ztiltApplied === false ? 'warn' : 'unknown',
    detail: ztiltApplied ? 'Plateau nivelé (3 vis Z alignées)' : 'Z_TILT non appliqué depuis le dernier home',
    cmd: !ztiltApplied ? 'Z_TILT_ADJUST' : undefined,
  });

  // Bed mesh
  const mesh = objs.bed_mesh;
  const meshLoaded = !!mesh?.profile_name && mesh.profile_name !== '';
  checks.push({
    label: 'Bed Mesh',
    status: meshLoaded ? 'ok' : 'warn',
    detail: meshLoaded ? `Profil actif : "${mesh!.profile_name}"` : 'Aucun profil de mesh chargé',
    cmd: !meshLoaded ? 'BED_MESH_CALIBRATE' : undefined,
  });

  // Cartographer calibration
  const cartoData = objs.scanner ?? objs.cartographer;
  checks.push({
    label: 'Cartographer calibré',
    status: cartoData?.last_z_result !== undefined ? 'ok' : 'warn',
    detail: cartoData?.last_z_result !== undefined
      ? `Dernier Z result : ${cartoData.last_z_result.toFixed(4)} mm`
      : 'Aucun résultat de calibration disponible',
    hint: !cartoData?.last_z_result ? 'Lancer CARTOGRAPHER_CALIBRATE (hotend 150°C, lit 60°C) puis SAVE_CONFIG' : undefined,
  });

  // Hotend sensor
  const ext = objs.extruder;
  checks.push({
    label: 'Capteur hotend',
    status: ext?.temperature !== undefined ? 'ok' : 'warn',
    detail: ext?.temperature !== undefined
      ? `${fmtTemp(ext.temperature)}${ext.target ? ` → ${fmtTemp(ext.target)}` : ''}`
      : 'Capteur non lisible',
    hint: ext?.temperature === undefined ? 'Vérifier thermistance sur EBB42 PA3' : undefined,
  });

  // Bed sensor
  const bed = objs.heater_bed;
  checks.push({
    label: 'Capteur lit chauffant',
    status: bed?.temperature !== undefined ? 'ok' : 'warn',
    detail: bed?.temperature !== undefined
      ? `${fmtTemp(bed.temperature)}${bed.target ? ` → ${fmtTemp(bed.target)}` : ''}`
      : 'Capteur non lisible',
  });

  // Errors in gcode store
  const errs = gcodes.filter(g =>
    g.type === 'response' &&
    (g.message.includes('Error') || g.message.includes('error') ||
     g.message.includes('shutdown') || g.message.includes('mcu '))
  );
  if (errs.length > 0) {
    checks.push({
      label: `Erreurs récentes (${errs.length})`,
      status: 'error',
      detail: errs[0].message.slice(0, 130),
      hint: 'Voir section "Logs" ci-dessous pour le détail complet',
    });
  }

  return checks;
}

function buildConfigChecks(cfg: ConfigFileData): Check[] {
  const c = cfg.config ?? {};
  const checks: Check[] = [];

  // homing_retract_dist
  const hrd = c.stepper_z?.homing_retract_dist;
  checks.push({
    label: 'homing_retract_dist = 0',
    status: hrd === '0' ? 'ok' : hrd === undefined ? 'unknown' : 'error',
    detail: hrd === '0' ? '✓ Correct — indispensable pour Cartographer' : `Valeur chargée : ${hrd ?? 'non trouvée'} (doit être 0)`,
    hint: hrd !== '0' ? 'Ajouter/corriger homing_retract_dist: 0 dans [stepper_z] puis FIRMWARE_RESTART' : undefined,
  });

  // endstop_pin
  const ep = c.stepper_z?.endstop_pin;
  const epOk = ep === 'probe:z_virtual_endstop';
  checks.push({
    label: 'endstop_pin = probe:z_virtual_endstop',
    status: epOk ? 'ok' : ep === undefined ? 'unknown' : 'error',
    detail: epOk ? '✓ Z utilise le Cartographer comme endstop' : `Actuel : ${ep ?? 'non trouvé'}`,
    hint: !epOk ? 'Mettre endstop_pin: probe:z_virtual_endstop dans [stepper_z]' : undefined,
  });

  // zero_reference_position
  const zrp = c.bed_mesh?.zero_reference_position;
  checks.push({
    label: 'zero_reference_position (bed_mesh)',
    status: zrp ? 'ok' : 'warn',
    detail: zrp ? `✓ ${zrp}` : 'Non défini dans [bed_mesh]',
    hint: !zrp ? 'Ajouter zero_reference_position: 200, 200 (centre plateau) dans [bed_mesh]' : undefined,
  });

  // EBB42 canbus_interface
  const ebbIface = c['mcu EBB42']?.canbus_interface;
  checks.push({
    label: 'EBB42 canbus_interface = can0',
    status: ebbIface === 'can0' ? 'ok' : ebbIface === undefined ? 'unknown' : 'warn',
    detail: ebbIface === 'can0' ? '✓ Interface CAN correcte' : `Actuel : ${ebbIface ?? 'non trouvé'}`,
    hint: ebbIface && ebbIface !== 'can0' ? 'Corriger canbus_interface: can0 dans [mcu EBB42]' : undefined,
  });

  // Input shaper
  const is = c.input_shaper;
  checks.push({
    label: 'Input Shaper configuré',
    status: is?.shaper_freq_x ? 'ok' : 'warn',
    detail: is?.shaper_freq_x
      ? `X: ${is.shaper_freq_x} Hz — Y: ${is.shaper_freq_y ?? '?'} Hz (${is.shaper_type ?? 'mzv'})`
      : 'Non configuré (recommandé pour VCore 3.1)',
    hint: !is?.shaper_freq_x ? 'Lancer SHAPER_CALIBRATE avec ADXL345 sur EBB42 pour mesurer les résonances' : undefined,
  });

  return checks;
}

// ─── Component ────────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'Home All',        cmd: 'G28',                        color: 'bg-blue-700 hover:bg-blue-600',   icon: '🏠' },
  { label: 'Z Tilt',          cmd: 'Z_TILT_ADJUST',              color: 'bg-purple-700 hover:bg-purple-600', icon: '⚖️' },
  { label: 'Bed Mesh',        cmd: 'BED_MESH_CALIBRATE',         color: 'bg-teal-700 hover:bg-teal-600',  icon: '📐' },
  { label: 'Save Config',     cmd: 'SAVE_CONFIG',                color: 'bg-green-700 hover:bg-green-600', icon: '💾' },
  { label: 'FW Restart',      cmd: 'FIRMWARE_RESTART',           color: 'bg-orange-700 hover:bg-orange-600', icon: '🔄' },
  { label: 'Carto Calibrate', cmd: 'CARTOGRAPHER_CALIBRATE',     color: 'bg-pink-700 hover:bg-pink-600',  icon: '🎯' },
] as const;

export function PrinterDiagnostic() {
  const [ip, setIp] = useState('192.168.1.41');
  const [port, setPort] = useState('80');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [sending, setSending] = useState<string | null>(null);
  const [sendFeedback, setSendFeedback] = useState<string | null>(null);

  const [printerInfo, setPrinterInfo] = useState<PrinterInfo | null>(null);
  const [objects, setObjects] = useState<PrinterObjects>({});
  const [gcodes, setGcodes] = useState<GCodeEntry[]>([]);
  const [sysInfo, setSysInfo] = useState<SysInfo | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [showConfigChecks, setShowConfigChecks] = useState(true);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const baseUrl = `http://${ip}:${port}`;

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const infoRes = await fetch(`${baseUrl}/printer/info`, { signal: AbortSignal.timeout(5000) });
      if (!infoRes.ok) throw new Error(`HTTP ${infoRes.status}`);
      const info: PrinterInfo = (await infoRes.json()).result;

      const objKeys = [
        'mcu', 'mcu EBB42', 'mcu scanner', 'mcu cartographer',
        'extruder', 'heater_bed',
        'temperature_sensor Chamber', 'temperature_sensor EBB42', 'temperature_sensor Octopus',
        'toolhead', 'bed_mesh', 'print_stats', 'z_tilt',
        'scanner', 'cartographer', 'webhooks',
        'stepper_z', 'stepper_z1', 'stepper_z2',
        'input_shaper', 'configfile',
      ];
      const objRes = await fetch(
        `${baseUrl}/printer/objects/query?${objKeys.map(k => encodeURIComponent(k)).join('&')}`,
        { signal: AbortSignal.timeout(5000) }
      );
      const objData: PrinterObjects = objRes.ok ? (await objRes.json()).result?.status ?? {} : {};

      const gcRes = await fetch(`${baseUrl}/server/gcode_store?count=80`, { signal: AbortSignal.timeout(5000) });
      const gcData: GCodeEntry[] = gcRes.ok ? (await gcRes.json()).result?.gcode_store ?? [] : [];

      // System info
      const sysRes = await fetch(`${baseUrl}/machine/proc_stats`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (sysRes?.ok) {
        const sysData = (await sysRes.json()).result ?? {};
        const moonStats = sysData.moonraker_stats;
        const lastStat = Array.isArray(moonStats) ? moonStats[moonStats.length - 1] : null;
        const sysMem = sysData.system_memory ?? {};
        const cpuUsages: number[] = Object.values(sysData.system_cpu_usage ?? {});
        const avgCpu = cpuUsages.length ? cpuUsages.reduce((a, b) => a + b, 0) / cpuUsages.length : undefined;

        // Disk info via /machine/system_info
        const siRes = await fetch(`${baseUrl}/machine/system_info`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
        const siData = siRes?.ok ? (await siRes.json()).result ?? {} : {};

        setSysInfo({
          cpu_usage: avgCpu,
          mem_total: sysMem.total ? sysMem.total * 1024 : undefined,
          mem_available: sysMem.available ? sysMem.available * 1024 : undefined,
          cpu_model: siData.system_info?.cpu_info?.model_name,
        });
      }

      setPrinterInfo(info);
      setObjects(objData);
      setGcodes(gcData);
      setConnected(true);
      setLastUpdate(new Date());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        msg.includes('Failed to fetch') || msg.includes('NetworkError')
          ? `Impossible de joindre ${baseUrl} — imprimante allumée et même réseau ?`
          : msg.includes('timeout') ? `Timeout — ${baseUrl} ne répond pas`
          : msg
      );
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (autoRefresh && connected) {
      intervalRef.current = setInterval(fetchAll, 5000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, connected, fetchAll]);

  const sendGcode = async (cmd: string) => {
    setSending(cmd);
    setSendFeedback(null);
    try {
      const res = await fetch(`${baseUrl}/printer/gcode/script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: cmd }),
        signal: AbortSignal.timeout(10000),
      });
      setSendFeedback(res.ok ? `✓ ${cmd} envoyé` : `✗ Erreur HTTP ${res.status}`);
    } catch {
      setSendFeedback(`✗ Impossible d'envoyer (imprimante déconnectée ?)`);
    } finally {
      setSending(null);
      setTimeout(() => setSendFeedback(null), 4000);
    }
  };

  // ─── Derived data ────────────────────────────────────────────────────────────

  const runtimeChecks = printerInfo ? buildRuntimeChecks(printerInfo, objects, gcodes) : [];
  const configChecks = objects.configfile ? buildConfigChecks(objects.configfile) : [];
  const meshAnalysis = analyzeMesh(objects.bed_mesh?.probed_matrix);

  const ebbStats = parseMcuStats(objects['mcu EBB42']?.last_stats);
  const cartoMcuKey: keyof PrinterObjects = objects['mcu scanner'] ? 'mcu scanner' : 'mcu cartographer';
  const cartoStats = parseMcuStats((objects[cartoMcuKey] as McuStatus | undefined)?.last_stats);

  const okCount    = runtimeChecks.filter(c => c.status === 'ok').length;
  const warnCount  = runtimeChecks.filter(c => c.status === 'warn').length;
  const errorCount = runtimeChecks.filter(c => c.status === 'error').length;
  const totalChecks = runtimeChecks.filter(c => c.status !== 'unknown').length;

  const configOk   = configChecks.filter(c => c.status === 'ok').length;
  const configErr  = configChecks.filter(c => c.status === 'error').length;

  const printerState = printerInfo?.state ?? 'disconnected';
  const stateColor = printerState === 'ready' ? 'text-green-400'
    : printerState === 'error' || printerState === 'shutdown' ? 'text-red-400' : 'text-yellow-400';

  const errorLogs = gcodes.filter(g =>
    g.type === 'response' &&
    (g.message.toLowerCase().includes('error') || g.message.includes('shutdown') || g.message.includes('mcu '))
  ).slice(0, 25);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Diagnostic Imprimante</h2>
        <p className="text-sm text-gray-400">
          Validation config Klipper · Santé CAN bus · Analyse bed mesh · Actions directes
        </p>
      </div>

      {/* ── Connection bar ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs text-gray-400 mb-1">Adresse IP Imprimante</label>
            <input
              type="text"
              value={ip}
              onChange={e => { setIp(e.target.value); setConnected(false); }}
              placeholder="192.168.1.41"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-orange-500"
            />
          </div>
          <div className="w-20">
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
          <div className="flex items-center gap-2 text-sm">
            {connected
              ? <><div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /><span className="text-green-400">Connecté</span></>
              : <><div className="w-2 h-2 rounded-full bg-gray-600" /><span className="text-gray-500">Hors ligne</span></>
            }
          </div>
          {connected && (
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
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
          <p className="text-xs text-gray-600 mt-2">Mise à jour : {lastUpdate.toLocaleTimeString('fr-FR')}</p>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl border border-red-800 bg-red-900/20 flex gap-3">
          <WifiOff size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-300 font-medium">Connexion échouée</p>
            <p className="text-xs text-red-400 mt-1">{error}</p>
            <p className="text-xs text-gray-500 mt-2">L'app doit tourner sur le même réseau local que l'imprimante.</p>
          </div>
        </div>
      )}

      {/* Not connected placeholder */}
      {!connected && !error && !loading && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/30 py-16 text-center">
          <Wifi size={32} className="mx-auto mb-3 text-gray-700" />
          <p className="text-sm text-gray-500">Entrer l'IP et cliquer "Connecter"</p>
          <p className="text-xs text-gray-700 mt-1">L'app doit tourner sur le même réseau local que l'imprimante</p>
        </div>
      )}

      {/* ── Connected dashboard ─────────────────────────────────────────────────── */}
      {connected && printerInfo && (
        <>
          {/* Status summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'État Klipper',     value: printerState.toUpperCase(), color: stateColor, icon: Activity },
              { label: 'Version Klipper',  value: printerInfo.klipper_version?.split('-')[0] ?? '—', color: 'text-gray-200', icon: Cpu },
              { label: 'Hostname',         value: printerInfo.hostname || ip, color: 'text-gray-200', icon: Wifi },
              {
                label: 'Checks runtime',
                value: `${okCount} ✓  ${warnCount} ⚠  ${errorCount} ✗`,
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

          {/* ── Quick Actions ──────────────────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Play size={15} className="text-orange-400" />
              <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Actions rapides</h3>
              {sendFeedback && (
                <span className={`text-xs ml-auto px-2 py-0.5 rounded ${sendFeedback.startsWith('✓') ? 'text-green-400 bg-green-900/30' : 'text-red-400 bg-red-900/30'}`}>
                  {sendFeedback}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK_ACTIONS.map(a => (
                <button
                  key={a.cmd}
                  onClick={() => sendGcode(a.cmd)}
                  disabled={sending !== null}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white font-medium transition-colors disabled:opacity-50 ${a.color}`}
                >
                  {sending === a.cmd ? <RefreshCw size={11} className="animate-spin" /> : <span>{a.icon}</span>}
                  {a.label}
                </button>
              ))}
            </div>

            {/* Custom gcode input */}
            <CustomGcodeInput onSend={sendGcode} disabled={sending !== null} />
          </div>

          {/* ── Temperatures ──────────────────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Thermometer size={15} className="text-orange-400" />
              <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Températures</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { label: 'Hotend',   sensor: objects.extruder,                         icon: '🔥' },
                { label: 'Lit',      sensor: objects.heater_bed,                       icon: '♨️' },
                { label: 'Chamber',  sensor: objects['temperature_sensor Chamber'],    icon: '🏠' },
                { label: 'EBB42',    sensor: objects['temperature_sensor EBB42'],      icon: '⚡' },
                { label: 'Octopus',  sensor: objects['temperature_sensor Octopus'],    icon: '🖥️' },
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
                    ) : <div className="text-sm text-gray-600">—</div>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── MCU & CAN Health ──────────────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={15} className="text-orange-400" />
              <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">MCU & Santé CAN Bus</h3>
            </div>
            <div className="space-y-2">
              {([
                { label: 'MCU Principal (Octopus)', key: 'mcu' as keyof PrinterObjects, stats: {} },
                { label: 'EBB42 v1.2 (CAN)',         key: 'mcu EBB42' as keyof PrinterObjects, stats: ebbStats },
                { label: `Cartographer (${objects['mcu scanner'] ? 'scanner' : 'cartographer'})`,
                  key: cartoMcuKey,
                  stats: cartoStats },
              ] as const).map(item => {
                const mcu = objects[item.key] as McuStatus | undefined;
                const present = !!mcu?.mcu_version;
                const s = item.stats;
                const retransmit = (s as Record<string, number>).bytes_retransmit ?? 0;
                const badCrc = (s as Record<string, number>).bad_crc ?? 0;
                const outOfOrder = (s as Record<string, number>).out_of_order ?? 0;
                const hasErrors = retransmit > 0 || badCrc > 0 || outOfOrder > 0;
                return (
                  <div key={String(item.key)} className={`flex items-start gap-3 p-3 rounded-lg border ${present ? (hasErrors ? 'border-yellow-800 bg-yellow-900/10' : 'border-green-800 bg-green-900/10') : 'border-gray-700 bg-gray-800/30'}`}>
                    {present
                      ? (hasErrors ? <AlertTriangle size={14} className="text-yellow-400 flex-shrink-0 mt-0.5" /> : <CheckCircle2 size={14} className="text-green-400 flex-shrink-0 mt-0.5" />)
                      : <XCircle size={14} className="text-gray-600 flex-shrink-0 mt-0.5" />
                    }
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm ${present ? 'text-gray-200' : 'text-gray-500'}`}>{item.label}</div>
                      {present && mcu?.mcu_version && (
                        <div className="text-xs text-gray-500 truncate">{mcu.mcu_version.split(' ')[0]}</div>
                      )}
                      {present && Object.keys(item.stats).length > 0 && (
                        <div className="flex flex-wrap gap-3 mt-1.5">
                          <CanStat label="Retransmit" val={retransmit} bad={retransmit > 0} />
                          <CanStat label="Bad CRC" val={badCrc} bad={badCrc > 0} />
                          <CanStat label="Out-of-order" val={outOfOrder} bad={outOfOrder > 0} />
                          {(s as Record<string, number>).mcu_awake !== undefined && (
                            <CanStat label="MCU Awake" val={((s as Record<string, number>).mcu_awake * 100).toFixed(1) + '%'} bad={false} />
                          )}
                        </div>
                      )}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded border flex-shrink-0 ${present ? (hasErrors ? 'text-yellow-400 border-yellow-800' : 'text-green-400 border-green-800') : 'text-gray-600 border-gray-700'}`}>
                      {present ? (hasErrors ? 'Erreurs' : 'OK') : 'Absent'}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-gray-600 mt-2">Retransmit/Bad CRC = erreurs de trame CAN. Valeurs &gt; 0 → problème de câblage ou résistances 120Ω</p>
          </div>

          {/* ── Bed Mesh Analysis ─────────────────────────────────────────────── */}
          {meshAnalysis && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 size={15} className="text-orange-400" />
                <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Analyse Bed Mesh</h3>
                <span className={`ml-auto text-sm font-bold ${meshAnalysis.ratingColor}`}>{meshAnalysis.rating}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                {[
                  { label: 'Z min', value: `${meshAnalysis.min.toFixed(3)} mm` },
                  { label: 'Z max', value: `${meshAnalysis.max.toFixed(3)} mm` },
                  { label: 'Planéité (range)', value: `${meshAnalysis.range.toFixed(3)} mm`, highlight: meshAnalysis.range > 0.6 },
                  { label: 'Écart-type (σ)', value: `${meshAnalysis.stddev.toFixed(4)} mm` },
                ].map(item => (
                  <div key={item.label} className={`rounded-lg border p-3 text-center ${item.highlight ? 'border-orange-800 bg-orange-900/10' : 'border-gray-700 bg-gray-800/40'}`}>
                    <div className="text-xs text-gray-500 mb-1">{item.label}</div>
                    <div className={`text-sm font-bold ${item.highlight ? 'text-orange-400' : 'text-gray-200'}`}>{item.value}</div>
                  </div>
                ))}
              </div>
              {meshAnalysis.range > 0.6 && (
                <p className="text-xs text-orange-400">
                  ⚠ Planéité &gt; 0.6 mm — relancer Z_TILT_ADJUST plusieurs fois puis BED_MESH_CALIBRATE
                </p>
              )}
              {/* Mini heatmap */}
              <MeshHeatmap matrix={objects.bed_mesh?.probed_matrix} />
            </div>
          )}

          {/* ── Config Validation ─────────────────────────────────────────────── */}
          {configChecks.length > 0 && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
              <button
                onClick={() => setShowConfigChecks(v => !v)}
                className="w-full flex items-center justify-between p-5 hover:bg-gray-800/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Shield size={15} className="text-orange-400" />
                  <span className="text-xs font-bold text-gray-300 uppercase tracking-widest">
                    Validation Config ({configOk}/{configChecks.filter(c => c.status !== 'unknown').length} OK)
                  </span>
                  {configErr > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-800">{configErr} erreur{configErr > 1 ? 's' : ''}</span>
                  )}
                </div>
                {showConfigChecks ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
              </button>
              {showConfigChecks && (
                <div className="border-t border-gray-800 p-5 space-y-2">
                  <p className="text-xs text-gray-500 mb-3">Vérifie la config chargée sur le firmware — pas uniquement ce qu'il y a dans printer.cfg sur disque.</p>
                  {configChecks.map((check, i) => (
                    <CheckRow key={i} check={check} onSend={sendGcode} sending={sending} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Runtime Checks ────────────────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={15} className="text-orange-400" />
                <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">
                  Checks Runtime ({okCount}/{totalChecks} OK)
                </h3>
              </div>
              <div className="flex gap-3 text-xs">
                <span className="text-green-400">{okCount} ✓</span>
                <span className="text-yellow-400">{warnCount} ⚠</span>
                <span className="text-red-400">{errorCount} ✗</span>
              </div>
            </div>
            <div className="space-y-2">
              {runtimeChecks.map((check, i) => (
                <CheckRow key={i} check={check} onSend={sendGcode} sending={sending} />
              ))}
            </div>
          </div>

          {/* ── System Info ───────────────────────────────────────────────────── */}
          {sysInfo && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
              <div className="flex items-center gap-2 mb-4">
                <HardDrive size={15} className="text-orange-400" />
                <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Ressources Système</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {sysInfo.cpu_usage !== undefined && (
                  <ResourceBar label="CPU" value={sysInfo.cpu_usage} unit="%" warn={70} bad={90} />
                )}
                {sysInfo.mem_total !== undefined && sysInfo.mem_available !== undefined && (
                  <ResourceBar
                    label="RAM"
                    value={((sysInfo.mem_total - sysInfo.mem_available) / sysInfo.mem_total) * 100}
                    unit="%" warn={75} bad={90}
                    extra={`${fmtBytes(sysInfo.mem_available)} libre`}
                  />
                )}
                {sysInfo.cpu_model && (
                  <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-3">
                    <div className="text-xs text-gray-500 mb-1">CPU</div>
                    <div className="text-xs text-gray-300 truncate">{sysInfo.cpu_model}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Print Status ──────────────────────────────────────────────────── */}
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

          {/* ── Logs ──────────────────────────────────────────────────────────── */}
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
                      entry.message.includes('shutdown') ? 'text-red-300' :
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
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CanStat({ label, val, bad }: { label: string; val: number | string; bad: boolean }) {
  return (
    <div className="text-xs">
      <span className="text-gray-600">{label}: </span>
      <span className={bad ? 'text-yellow-400 font-bold' : 'text-gray-400'}>{val}</span>
    </div>
  );
}

function CheckRow({ check, onSend, sending }: { check: Check; onSend: (cmd: string) => void; sending: string | null }) {
  return (
    <div className={`p-3 rounded-lg border ${
      check.status === 'ok' ? 'border-green-800 bg-green-900/10' :
      check.status === 'warn' ? 'border-yellow-800 bg-yellow-900/10' :
      check.status === 'error' ? 'border-red-800 bg-red-900/10' :
      check.status === 'info' ? 'border-blue-800 bg-blue-900/10' :
      'border-gray-700 bg-gray-800/30'
    }`}>
      <div className="flex items-start gap-2">
        {check.status === 'ok' ? <CheckCircle2 size={14} className="text-green-400 flex-shrink-0 mt-0.5" /> :
         check.status === 'warn' ? <AlertTriangle size={14} className="text-yellow-400 flex-shrink-0 mt-0.5" /> :
         check.status === 'error' ? <XCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" /> :
         check.status === 'info' ? <Info size={14} className="text-blue-400 flex-shrink-0 mt-0.5" /> :
         <Clock size={14} className="text-gray-500 flex-shrink-0 mt-0.5" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-sm text-gray-200">{check.label}</span>
            <span className={`text-xs flex-shrink-0 ${
              check.status === 'ok' ? 'text-green-400' :
              check.status === 'warn' ? 'text-yellow-400' :
              check.status === 'error' ? 'text-red-400' : 'text-gray-500'
            }`}>{check.status.toUpperCase()}</span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{check.detail}</p>
          {check.hint && <p className="text-xs text-gray-600 mt-1 italic">→ {check.hint}</p>}
          {check.cmd && (
            <button
              onClick={() => onSend(check.cmd!)}
              disabled={sending !== null}
              className="mt-1.5 flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-orange-800 text-orange-400 hover:bg-orange-900/30 disabled:opacity-50 transition-colors"
            >
              <Send size={10} />
              Envoyer : {check.cmd}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ResourceBar({ label, value, unit, warn, bad, extra }: {
  label: string; value: number; unit: string; warn: number; bad: number; extra?: string;
}) {
  const color = value >= bad ? 'bg-red-500' : value >= warn ? 'bg-yellow-500' : 'bg-green-500';
  const textColor = value >= bad ? 'text-red-400' : value >= warn ? 'text-yellow-400' : 'text-gray-200';
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-gray-500">{label}</span>
        <span className={`text-xs font-bold ${textColor}`}>{value.toFixed(0)}{unit}</span>
      </div>
      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      {extra && <div className="text-xs text-gray-600 mt-1">{extra}</div>}
    </div>
  );
}

function MeshHeatmap({ matrix }: { matrix?: number[][] }) {
  if (!matrix || matrix.length === 0) return null;
  const flat = matrix.flat();
  const min = Math.min(...flat);
  const max = Math.max(...flat);
  const range = max - min || 1;
  return (
    <div className="mt-3 overflow-x-auto">
      <p className="text-xs text-gray-600 mb-1.5">Heatmap Z (bleu=bas, rouge=haut)</p>
      <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: `repeat(${matrix[0].length}, 1fr)` }}>
        {matrix.map((row, ri) =>
          row.map((val, ci) => {
            const t = (val - min) / range;
            const r = Math.round(t * 220);
            const b = Math.round((1 - t) * 220);
            return (
              <div
                key={`${ri}-${ci}`}
                title={`${val.toFixed(3)} mm`}
                className="w-3 h-3 rounded-sm cursor-help"
                style={{ backgroundColor: `rgb(${r}, 40, ${b})` }}
              />
            );
          })
        )}
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgb(0,40,220)' }} />
        <span className="text-xs text-gray-600">{min.toFixed(3)} mm</span>
        <div className="flex-1 h-1 rounded-full" style={{ background: 'linear-gradient(to right, rgb(0,40,220), rgb(110,40,110), rgb(220,40,0))' }} />
        <span className="text-xs text-gray-600">{max.toFixed(3)} mm</span>
        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgb(220,40,0)' }} />
      </div>
    </div>
  );
}

function CustomGcodeInput({ onSend, disabled }: { onSend: (cmd: string) => void; disabled: boolean }) {
  const [val, setVal] = useState('');
  const send = () => {
    const cmd = val.trim().toUpperCase();
    if (!cmd) return;
    onSend(cmd);
    setVal('');
  };
  return (
    <div className="flex gap-2 mt-3">
      <input
        type="text"
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && send()}
        placeholder="GCode personnalisé (ex: PROBE_ACCURACY)"
        className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-orange-500 placeholder-gray-600"
      />
      <button
        onClick={send}
        disabled={disabled || !val.trim()}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-xs transition-colors"
      >
        <Send size={11} />
        Envoyer
      </button>
    </div>
  );
}
