import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity, Wifi, WifiOff, RefreshCw, AlertTriangle, CheckCircle2,
  XCircle, Thermometer, Cpu, Zap, Clock, Terminal, Info,
  ChevronDown, ChevronUp, Play, HardDrive, BarChart3,
  Shield, Send, GitCompare, Network, Wrench, Gauge,
} from 'lucide-react';
import type { PrinterConfig } from '../App';
import { generateConfig } from './ConfigGenerator';

// ─── Types Moonraker ───────────────────────────────────────────────────────────

interface PrinterInfo {
  state: string; state_message: string;
  hostname: string; klipper_version: string; software_version: string;
}
interface McuStatus { mcu_version?: string; last_stats?: string; }
interface TempSensor { temperature?: number; target?: number; power?: number; }
interface ToolheadStatus { homed_axes?: string; }
interface BedMeshStatus { profile_name?: string; probed_matrix?: number[][]; }
interface PrintStats { state?: string; filename?: string; total_duration?: number; print_duration?: number; }
interface ConfigFileData { config?: Record<string, Record<string, string>>; }

interface CartographerFull {
  last_z_result?: number;
  last_probe_counts?: number;
  frequency?: number;
  temp?: number;
  estimated_print_surface_temp?: number;
  cal_pos_x?: number;
  cal_pos_y?: number;
  cal_mcu_freq?: number;
  cal_temp?: number;
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
  z_tilt?: { applied?: boolean };
  scanner?: CartographerFull;
  cartographer?: CartographerFull;
  webhooks?: { state?: string; state_message?: string };
  input_shaper?: { shaper_freq_x?: number; shaper_freq_y?: number; shaper_type_x?: string };
  configfile?: ConfigFileData;
}

interface GCodeEntry { type: string; time: number; message: string; }

interface SysInfo {
  can0_bitrate?: number; can0_up?: boolean; usb_u2c?: boolean;
  cpu_usage?: number; mem_total?: number; mem_available?: number; cpu_model?: string;
}

interface TestResult { lines: string[]; ok: boolean; ts: Date; }

// ─── Check types ──────────────────────────────────────────────────────────────

type CheckStatus = 'ok' | 'warn' | 'error' | 'info' | 'unknown';
interface Check { label: string; status: CheckStatus; detail: string; hint?: string; cmd?: string; }

// ─── Config diff ──────────────────────────────────────────────────────────────

interface DiffLine { key: string; label: string; expected: string; actual: string; match: boolean; critical: boolean; }

function parseCfg(text: string): Record<string, Record<string, string>> {
  const r: Record<string, Record<string, string>> = {};
  let sec = '__top__';
  for (const raw of text.split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const s = line.match(/^\[(.+)\]$/);
    if (s) { sec = s[1].trim(); r[sec] = r[sec] ?? {}; continue; }
    const kv = line.match(/^(\S+)\s*:\s*(.+)$/);
    if (kv) { r[sec] = r[sec] ?? {}; r[sec][kv[1].trim()] = kv[2].trim(); }
  }
  return r;
}

const COMPARE_KEYS: Array<{ section: string; key: string; label: string; critical: boolean }> = [
  { section: 'stepper_z',  key: 'homing_retract_dist',    label: 'stepper_z › homing_retract_dist',    critical: true  },
  { section: 'stepper_z',  key: 'endstop_pin',             label: 'stepper_z › endstop_pin',            critical: true  },
  { section: 'bed_mesh',   key: 'zero_reference_position', label: 'bed_mesh › zero_reference_position', critical: true  },
  { section: 'bed_mesh',   key: 'mesh_min',                label: 'bed_mesh › mesh_min',                critical: false },
  { section: 'bed_mesh',   key: 'mesh_max',                label: 'bed_mesh › mesh_max',                critical: false },
  { section: 'mcu EBB42',  key: 'canbus_interface',        label: 'mcu EBB42 › canbus_interface',       critical: true  },
  { section: 'extruder',   key: 'rotation_distance',       label: 'extruder › rotation_distance',       critical: false },
  { section: 'extruder',   key: 'nozzle_diameter',         label: 'extruder › nozzle_diameter',         critical: false },
  { section: 'printer',    key: 'max_velocity',            label: 'printer › max_velocity',             critical: false },
  { section: 'printer',    key: 'max_accel',               label: 'printer › max_accel',                critical: false },
];

function diffConfigs(generated: string, actual: string): DiffLine[] {
  const gen = parseCfg(generated), act = parseCfg(actual);
  return COMPARE_KEYS.map(({ section, key, label, critical }) => ({
    key: `${section}.${key}`, label,
    expected: gen[section]?.[key] ?? '—',
    actual: act[section]?.[key] ?? '(absent)',
    match: (gen[section]?.[key] ?? '—') === (act[section]?.[key] ?? '(absent)'),
    critical,
  }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTemp(t?: number) { return t !== undefined ? `${t.toFixed(1)}°C` : '—'; }
function fmtDuration(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}m` : `${m}m${sec.toString().padStart(2, '0')}s`;
}
function fmtBytes(b?: number) {
  if (b === undefined) return '—';
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} Go`;
  if (b >= 1048576) return `${(b / 1048576).toFixed(0)} Mo`;
  return `${(b / 1024).toFixed(0)} Ko`;
}
function parseMcuStats(s?: string): Record<string, number> {
  if (!s) return {};
  const r: Record<string, number> = {};
  for (const m of s.matchAll(/(\w+)=([\d.]+)/g)) r[m[1]] = parseFloat(m[2]);
  return r;
}
function tempColor(t: number, target: number) {
  if (target === 0) return 'text-gray-400';
  return Math.abs(t - target) < 2 ? 'text-green-400' : Math.abs(t - target) < 10 ? 'text-yellow-400' : 'text-blue-400';
}

function analyzeMesh(matrix?: number[][]): {
  min: number; max: number; range: number; stddev: number; rating: string; ratingColor: string;
} | null {
  if (!matrix?.length) return null;
  const flat = matrix.flat();
  if (!flat.length) return null;
  const min = Math.min(...flat), max = Math.max(...flat), range = max - min;
  const mean = flat.reduce((a, b) => a + b, 0) / flat.length;
  const stddev = Math.sqrt(flat.reduce((a, b) => a + (b - mean) ** 2, 0) / flat.length);
  const [rating, ratingColor] =
    range < 0.15 ? ['Excellent', 'text-green-300'] :
    range < 0.30 ? ['Très bon', 'text-green-400'] :
    range < 0.60 ? ['Bon', 'text-yellow-400'] :
    range < 1.20 ? ['À améliorer', 'text-orange-400'] :
    ['Mauvais', 'text-red-400'];
  return { min, max, range, stddev, rating, ratingColor };
}

// Parse PROBE_ACCURACY output line
function parseProbeAccuracy(lines: string[]): { range?: number; stddev?: number; avg?: number } | null {
  const summaryLine = lines.find(l => l.includes('probe accuracy results'));
  if (!summaryLine) return null;
  const range  = summaryLine.match(/range\s+([\d.]+)/)?.[1];
  const stddev = summaryLine.match(/standard deviation\s+([\d.]+)/)?.[1];
  const avg    = summaryLine.match(/average\s+([\d.]+)/)?.[1];
  return {
    range:  range  !== undefined ? parseFloat(range)  : undefined,
    stddev: stddev !== undefined ? parseFloat(stddev) : undefined,
    avg:    avg    !== undefined ? parseFloat(avg)    : undefined,
  };
}

// Parse ACCELEROMETER_QUERY output
function parseAdxl(lines: string[]): { x?: number; y?: number; z?: number } | null {
  const l = lines.find(l => l.includes('values (x, y, z)'));
  if (!l) return null;
  const nums = l.match(/:\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)/);
  if (!nums) return null;
  return { x: parseFloat(nums[1]), y: parseFloat(nums[2]), z: parseFloat(nums[3]) };
}

// Parse PROBE output
function parseSingleProbe(lines: string[]): number | null {
  const l = lines.find(l => l.match(/probe at .* is z=/));
  if (!l) return null;
  const m = l.match(/is z=([-\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

// Parse MEASURE_AXES_NOISE output
function parseAxesNoise(lines: string[]): { x?: number; y?: number; z?: number } | null {
  const l = lines.find(l => l.includes('Axes noise'));
  if (!l) return null;
  return {
    x: parseFloat(l.match(/X=([\d.]+)/)?.[1] ?? 'NaN'),
    y: parseFloat(l.match(/Y=([\d.]+)/)?.[1] ?? 'NaN'),
    z: parseFloat(l.match(/Z=([\d.]+)/)?.[1] ?? 'NaN'),
  };
}

// ─── Check builders ───────────────────────────────────────────────────────────

function buildRuntimeChecks(info: PrinterInfo, objs: PrinterObjects, gcodes: GCodeEntry[]): Check[] {
  const checks: Check[] = [];
  const ks = objs.webhooks?.state ?? info.state;
  checks.push({ label: 'État Klipper', status: ks === 'ready' ? 'ok' : ks === 'startup' ? 'warn' : 'error',
    detail: ks === 'ready' ? 'Klipper opérationnel' : objs.webhooks?.state_message ?? info.state_message,
    cmd: ks === 'error' ? 'FIRMWARE_RESTART' : undefined });
  checks.push({ label: 'MCU Principal (Octopus)',
    status: objs.mcu?.mcu_version ? 'ok' : 'error',
    detail: objs.mcu?.mcu_version ? `Firmware: ${objs.mcu.mcu_version.split('-')[0]}` : 'MCU non connecté ou firmware absent' });
  checks.push({ label: 'EBB42 v1.2 (CAN)',
    status: objs['mcu EBB42']?.mcu_version ? 'ok' : 'error',
    detail: objs['mcu EBB42']?.mcu_version ? objs['mcu EBB42']!.mcu_version!.split('-')[0] : 'EBB42 introuvable sur le bus CAN',
    hint: !objs['mcu EBB42']?.mcu_version ? 'Vérifier canbus_uuid EBB42, alimentation 24V, câbles CAN, résistances 120Ω' : undefined });
  const carto = objs['mcu scanner'] ?? objs['mcu cartographer'];
  checks.push({ label: 'Cartographer CAN',
    status: carto?.mcu_version ? 'ok' : 'error',
    detail: carto?.mcu_version ? carto.mcu_version.split('-')[0] : 'Cartographer introuvable sur le bus CAN',
    hint: !carto?.mcu_version ? 'Vérifier canbus_uuid Cartographer, jumper 120Ω, alimentation 3.3V depuis EBB42' : undefined });
  const homed = objs.toolhead?.homed_axes ?? '';
  checks.push({ label: 'Homing axes', status: homed === 'xyz' ? 'ok' : 'warn',
    detail: homed === 'xyz' ? 'Tous les axes homés (XYZ)' : homed === '' ? 'Aucun axe homé' : `Homés : ${homed}`, cmd: homed !== 'xyz' ? 'G28' : undefined });
  const ztilt = objs.z_tilt?.applied;
  checks.push({ label: 'Z_TILT_ADJUST', status: ztilt ? 'ok' : ztilt === false ? 'warn' : 'unknown',
    detail: ztilt ? 'Plateau nivelé — 3 vis Z alignées' : 'Z_TILT non appliqué', cmd: !ztilt ? 'Z_TILT_ADJUST' : undefined });
  const mesh = objs.bed_mesh;
  checks.push({ label: 'Bed Mesh', status: mesh?.profile_name ? 'ok' : 'warn',
    detail: mesh?.profile_name ? `Profil actif : "${mesh.profile_name}"` : 'Aucun profil de mesh chargé', cmd: !mesh?.profile_name ? 'BED_MESH_CALIBRATE' : undefined });
  const cartoData = objs.scanner ?? objs.cartographer;
  checks.push({ label: 'Cartographer calibré', status: cartoData?.last_z_result !== undefined ? 'ok' : 'warn',
    detail: cartoData?.last_z_result !== undefined ? `Dernier Z result : ${cartoData.last_z_result.toFixed(4)} mm` : 'Aucun résultat — calibration à faire',
    hint: !cartoData?.last_z_result ? 'CARTOGRAPHER_CALIBRATE (hotend 150°C, lit 60°C) puis SAVE_CONFIG' : undefined });
  const errs = gcodes.filter(g => g.type === 'response' && (g.message.includes('Error') || g.message.includes('shutdown') || g.message.includes('mcu ')));
  if (errs.length) checks.push({ label: `Erreurs récentes (${errs.length})`, status: 'error', detail: errs[0].message.slice(0, 130), hint: 'Voir section Logs ci-dessous' });
  return checks;
}

function buildConfigChecks(cfg: ConfigFileData): Check[] {
  const c = cfg.config ?? {};
  return [
    { label: 'homing_retract_dist = 0',
      status: c['stepper_z']?.['homing_retract_dist'] === '0' ? 'ok' : c['stepper_z']?.['homing_retract_dist'] ? 'error' : 'unknown',
      detail: c['stepper_z']?.['homing_retract_dist'] === '0' ? '✓ Correct — indispensable avec Cartographer' : `Valeur : ${c['stepper_z']?.['homing_retract_dist'] ?? 'non trouvée'} (doit être 0)` },
    { label: 'endstop_pin = probe:z_virtual_endstop',
      status: c['stepper_z']?.['endstop_pin'] === 'probe:z_virtual_endstop' ? 'ok' : c['stepper_z']?.['endstop_pin'] ? 'error' : 'unknown',
      detail: c['stepper_z']?.['endstop_pin'] === 'probe:z_virtual_endstop' ? '✓ Z utilise le Cartographer' : `Actuel : ${c['stepper_z']?.['endstop_pin'] ?? 'non trouvé'}` },
    { label: 'zero_reference_position (bed_mesh)',
      status: c['bed_mesh']?.['zero_reference_position'] ? 'ok' : 'warn',
      detail: c['bed_mesh']?.['zero_reference_position'] ? `✓ ${c['bed_mesh']['zero_reference_position']}` : 'Non défini — à ajouter dans [bed_mesh]',
      hint: !c['bed_mesh']?.['zero_reference_position'] ? 'Ajouter zero_reference_position: 200, 200 dans [bed_mesh]' : undefined },
    { label: 'EBB42 canbus_interface = can0',
      status: c['mcu EBB42']?.['canbus_interface'] === 'can0' ? 'ok' : c['mcu EBB42']?.['canbus_interface'] ? 'warn' : 'unknown',
      detail: c['mcu EBB42']?.['canbus_interface'] === 'can0' ? '✓ Interface CAN correcte' : `Actuel : ${c['mcu EBB42']?.['canbus_interface'] ?? 'non trouvé'}` },
    { label: 'Input Shaper configuré',
      status: c['input_shaper']?.['shaper_freq_x'] ? 'ok' : 'warn',
      detail: c['input_shaper']?.['shaper_freq_x']
        ? `X: ${c['input_shaper']['shaper_freq_x']} Hz — Y: ${c['input_shaper']['shaper_freq_y'] ?? '?'} Hz`
        : 'Non configuré — SHAPER_CALIBRATE recommandé',
      hint: !c['input_shaper']?.['shaper_freq_x'] ? 'Lancer SHAPER_CALIBRATE avec ADXL345 sur EBB42' : undefined },
  ];
}

// ─── Quick actions ────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'Home All',        cmd: 'G28',                    color: 'bg-blue-700 hover:bg-blue-600',    icon: '🏠' },
  { label: 'Z Tilt',          cmd: 'Z_TILT_ADJUST',          color: 'bg-purple-700 hover:bg-purple-600', icon: '⚖️' },
  { label: 'Bed Mesh',        cmd: 'BED_MESH_CALIBRATE',     color: 'bg-teal-700 hover:bg-teal-600',   icon: '📐' },
  { label: 'Save Config',     cmd: 'SAVE_CONFIG',            color: 'bg-green-700 hover:bg-green-600',  icon: '💾' },
  { label: 'FW Restart',      cmd: 'FIRMWARE_RESTART',       color: 'bg-orange-700 hover:bg-orange-600', icon: '🔄' },
  { label: 'Carto Calibrate', cmd: 'CARTOGRAPHER_CALIBRATE', color: 'bg-pink-700 hover:bg-pink-600',   icon: '🎯' },
] as const;

// ─── Main component ───────────────────────────────────────────────────────────

export function PrinterDiagnostic({ config }: { config: PrinterConfig }) {
  const [ip, setIp]     = useState('192.168.1.41');
  const [port, setPort] = useState('80');
  const [connected, setConnected]   = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [sending, setSending]       = useState<string | null>(null);
  const [sendFeedback, setSendFeedback] = useState<string | null>(null);

  const [printerInfo, setPrinterInfo] = useState<PrinterInfo | null>(null);
  const [objects, setObjects]     = useState<PrinterObjects>({});
  const [gcodes, setGcodes]       = useState<GCodeEntry[]>([]);
  const [sysInfo, setSysInfo]     = useState<SysInfo | null>(null);
  const [endstopData, setEndstopData] = useState<Record<string, string> | null>(null);

  // Hardware tests
  const [testResults, setTestResults]   = useState<Record<string, TestResult>>({});
  const [runningTest, setRunningTest]   = useState<string | null>(null);

  // Config comparison
  const [actualCfg, setActualCfg]   = useState<string | null>(null);
  const [cfgLoading, setCfgLoading] = useState(false);
  const [cfgError, setCfgError]     = useState<string | null>(null);
  const [showDiff, setShowDiff]     = useState(false);

  const [showLogs, setShowLogs]           = useState(false);
  const [showConfigChecks, setShowConfigChecks] = useState(true);
  const [showHWTests, setShowHWTests]     = useState(true);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const baseUrl = `http://${ip}:${port}`;

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const infoRes = await fetch(`${baseUrl}/printer/info`, { signal: AbortSignal.timeout(5000) });
      if (!infoRes.ok) throw new Error(`HTTP ${infoRes.status}`);
      const info: PrinterInfo = (await infoRes.json()).result;

      const objKeys = [
        'mcu', 'mcu EBB42', 'mcu scanner', 'mcu cartographer',
        'extruder', 'heater_bed',
        'temperature_sensor Chamber', 'temperature_sensor EBB42', 'temperature_sensor Octopus',
        'toolhead', 'bed_mesh', 'print_stats', 'z_tilt',
        'scanner', 'cartographer', 'webhooks', 'input_shaper', 'configfile',
      ];
      const objRes = await fetch(
        `${baseUrl}/printer/objects/query?${objKeys.map(k => encodeURIComponent(k)).join('&')}`,
        { signal: AbortSignal.timeout(5000) }
      );
      const objData: PrinterObjects = objRes.ok ? (await objRes.json()).result?.status ?? {} : {};

      const gcRes = await fetch(`${baseUrl}/server/gcode_store?count=80`, { signal: AbortSignal.timeout(5000) });
      const gcData: GCodeEntry[] = gcRes.ok ? (await gcRes.json()).result?.gcode_store ?? [] : [];

      // System info (topology + resources)
      const siRes = await fetch(`${baseUrl}/machine/system_info`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      const psRes = await fetch(`${baseUrl}/machine/proc_stats`,  { signal: AbortSignal.timeout(5000) }).catch(() => null);
      const si = siRes?.ok ? (await siRes.json()).result?.system_info ?? {} : {};
      const ps = psRes?.ok ? (await psRes.json()).result ?? {} : {};
      const can0 = (si.canbus ?? {})['can0'];
      const usbDevs: Array<{ vendor_id?: string; product_id?: string; description?: string }> = si.usb_devices ?? [];
      const u2cFound = usbDevs.some(d =>
        (d.vendor_id === '1d50' && d.product_id === '606f') ||
        (d.description ?? '').toLowerCase().includes('u2c') ||
        (d.description ?? '').toLowerCase().includes('candlelight')
      );
      const cpuUsages: number[] = Object.values(ps.system_cpu_usage ?? {});
      const sysMem = ps.system_memory ?? {};
      setSysInfo({
        can0_up: !!can0, can0_bitrate: can0?.bitrate,
        usb_u2c: usbDevs.length > 0 ? u2cFound : undefined,
        cpu_usage: cpuUsages.length ? cpuUsages.reduce((a, b) => a + b, 0) / cpuUsages.length : undefined,
        mem_total: sysMem.total ? sysMem.total * 1024 : undefined,
        mem_available: sysMem.available ? sysMem.available * 1024 : undefined,
        cpu_model: si.cpu_info?.model_name,
      });

      setPrinterInfo(info); setObjects(objData); setGcodes(gcData);
      setConnected(true); setLastUpdate(new Date());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes('Failed to fetch') || msg.includes('NetworkError')
        ? `Impossible de joindre ${baseUrl} — imprimante allumée et même réseau ?`
        : msg.includes('timeout') ? `Timeout — ${baseUrl} ne répond pas` : msg);
      setConnected(false);
    } finally { setLoading(false); }
  }, [baseUrl]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (autoRefresh && connected) intervalRef.current = setInterval(fetchAll, 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, connected, fetchAll]);

  const sendGcode = async (cmd: string) => {
    setSending(cmd); setSendFeedback(null);
    try {
      const res = await fetch(`${baseUrl}/printer/gcode/script`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: cmd }), signal: AbortSignal.timeout(10000),
      });
      setSendFeedback(res.ok ? `✓ ${cmd} envoyé` : `✗ Erreur HTTP ${res.status}`);
    } catch { setSendFeedback(`✗ Impossible d'envoyer`); }
    finally { setSending(null); setTimeout(() => setSendFeedback(null), 4000); }
  };

  /** Send a GCode command and capture the response lines from the GCode store */
  const runAndCapture = useCallback(async (testId: string, cmd: string, waitMs = 3000) => {
    setRunningTest(testId);
    const t0 = Date.now() / 1000 - 0.5;
    try {
      const sendRes = await fetch(`${baseUrl}/printer/gcode/script`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: cmd }), signal: AbortSignal.timeout(10000),
      });
      if (!sendRes.ok) throw new Error(`HTTP ${sendRes.status}`);
      await new Promise(r => setTimeout(r, waitMs));
      const gcRes = await fetch(`${baseUrl}/server/gcode_store?count=100`, { signal: AbortSignal.timeout(5000) });
      const allGcodes: GCodeEntry[] = gcRes.ok ? (await gcRes.json()).result?.gcode_store ?? [] : [];
      const relevant = allGcodes.filter(g => g.time >= t0);
      const lines = relevant.map(g => g.message);
      const hasError = lines.some(l => l.toLowerCase().includes('error') || l.toLowerCase().includes('unknown command'));
      setTestResults(prev => ({ ...prev, [testId]: { lines, ok: !hasError, ts: new Date() } }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setTestResults(prev => ({ ...prev, [testId]: { lines: [`Erreur: ${msg}`], ok: false, ts: new Date() } }));
    } finally { setRunningTest(null); }
  }, [baseUrl]);

  const queryEndstops = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/printer/query_endstops/status`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) setEndstopData((await res.json()).result ?? {});
    } catch { /* ignore */ }
  }, [baseUrl]);

  const fetchPrinterCfg = async () => {
    setCfgLoading(true); setCfgError(null);
    try {
      const res = await fetch(`${baseUrl}/server/files/config/printer.cfg`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setActualCfg(await res.text()); setShowDiff(true);
    } catch (e: unknown) {
      setCfgError(`Impossible de lire printer.cfg : ${e instanceof Error ? e.message : String(e)}`);
    } finally { setCfgLoading(false); }
  };

  // ─── Derived ─────────────────────────────────────────────────────────────────

  const runtimeChecks  = printerInfo ? buildRuntimeChecks(printerInfo, objects, gcodes) : [];
  const configChecks   = objects.configfile ? buildConfigChecks(objects.configfile) : [];
  const meshAnalysis   = analyzeMesh(objects.bed_mesh?.probed_matrix);
  const generatedCfg   = generateConfig(config);
  const diffLines      = actualCfg ? diffConfigs(generatedCfg, actualCfg) : [];

  const ebbStats   = parseMcuStats(objects['mcu EBB42']?.last_stats);
  const cartoMcuKey: keyof PrinterObjects = objects['mcu scanner'] ? 'mcu scanner' : 'mcu cartographer';
  const cartoStats = parseMcuStats((objects[cartoMcuKey] as McuStatus | undefined)?.last_stats);

  const okCount     = runtimeChecks.filter(c => c.status === 'ok').length;
  const warnCount   = runtimeChecks.filter(c => c.status === 'warn').length;
  const errorCount  = runtimeChecks.filter(c => c.status === 'error').length;
  const totalChecks = runtimeChecks.filter(c => c.status !== 'unknown').length;
  const configOk    = configChecks.filter(c => c.status === 'ok').length;
  const configErr   = configChecks.filter(c => c.status === 'error').length;
  const diffMismatches = diffLines.filter(d => !d.match).length;
  const diffCritical   = diffLines.filter(d => !d.match && d.critical).length;

  const printerState = printerInfo?.state ?? 'disconnected';
  const stateColor = printerState === 'ready' ? 'text-green-400'
    : printerState === 'error' || printerState === 'shutdown' ? 'text-red-400' : 'text-yellow-400';
  const errorLogs = gcodes.filter(g =>
    g.type === 'response' && (g.message.includes('Error') || g.message.includes('error') || g.message.includes('shutdown'))
  ).slice(0, 25);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Diagnostic Imprimante</h2>
        <p className="text-sm text-gray-400">Topologie CAN · Tests matériel · Comparaison config · Actions directes</p>
      </div>

      {/* ── Connexion ─────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs text-gray-400 mb-1">IP Imprimante</label>
            <input type="text" value={ip} onChange={e => { setIp(e.target.value); setConnected(false); }}
              placeholder="192.168.1.41"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-orange-500" />
          </div>
          <div className="w-20">
            <label className="block text-xs text-gray-400 mb-1">Port</label>
            <input type="text" value={port} onChange={e => setPort(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-orange-500" />
          </div>
          <button onClick={fetchAll} disabled={loading}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-medium text-sm transition-colors">
            {loading ? <RefreshCw size={14} className="animate-spin" /> : connected ? <Activity size={14} /> : <Wifi size={14} />}
            {loading ? 'Analyse…' : connected ? 'Rafraîchir' : 'Connecter'}
          </button>
          <div className="flex items-center gap-2 text-sm">
            {connected
              ? <><div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /><span className="text-green-400">Connecté</span></>
              : <><div className="w-2 h-2 rounded-full bg-gray-600" /><span className="text-gray-500">Hors ligne</span></>}
          </div>
          {connected && (
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
              <button onClick={() => setAutoRefresh(r => !r)}
                className={`w-8 h-4 rounded-full relative transition-colors ${autoRefresh ? 'bg-orange-500' : 'bg-gray-700'}`}>
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${autoRefresh ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
              Auto 5s
            </label>
          )}
        </div>
        {lastUpdate && <p className="text-xs text-gray-600 mt-2">Mise à jour : {lastUpdate.toLocaleTimeString('fr-FR')}</p>}
      </div>

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
      {!connected && !error && !loading && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/30 py-16 text-center">
          <Wifi size={32} className="mx-auto mb-3 text-gray-700" />
          <p className="text-sm text-gray-500">Entrer l'IP et cliquer "Connecter"</p>
        </div>
      )}

      {connected && printerInfo && (
        <>
          {/* ── Résumé ──────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'État Klipper',    value: printerState.toUpperCase(), color: stateColor, icon: Activity },
              { label: 'Klipper',         value: printerInfo.klipper_version?.split('-')[0] ?? '—', color: 'text-gray-200', icon: Cpu },
              { label: 'Hostname',        value: printerInfo.hostname || ip, color: 'text-gray-200', icon: Wifi },
              { label: 'Checks',          value: `${okCount}✓  ${warnCount}⚠  ${errorCount}✗`,
                color: errorCount > 0 ? 'text-red-400' : warnCount > 0 ? 'text-yellow-400' : 'text-green-400', icon: CheckCircle2 },
            ].map(item => (
              <div key={item.label} className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
                <div className="flex items-center gap-1.5 mb-1"><item.icon size={12} className="text-gray-500" /><span className="text-xs text-gray-500">{item.label}</span></div>
                <div className={`text-sm font-bold ${item.color} break-all`}>{item.value}</div>
              </div>
            ))}
          </div>

          {/* ── Topologie CAN ───────────────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Network size={15} className="text-orange-400" />
              <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Topologie CAN Bus</h3>
            </div>
            <TopologyDiagram sysInfo={sysInfo} ebbOk={!!objects['mcu EBB42']?.mcu_version}
              cartoOk={!!(objects['mcu scanner'] ?? objects['mcu cartographer'])?.mcu_version} config={config} />
          </div>

          {/* ── TESTS MATÉRIEL ──────────────────────────────────────────────── */}
          <div className="rounded-xl border border-orange-900/50 bg-gray-900/60 overflow-hidden">
            <button onClick={() => setShowHWTests(v => !v)}
              className="w-full flex items-center justify-between p-5 hover:bg-gray-800/30 transition-colors">
              <div className="flex items-center gap-2">
                <Wrench size={15} className="text-orange-400" />
                <span className="text-xs font-bold text-orange-300 uppercase tracking-widest">Tests Matériel — U2C · EBB42 · Cartographer</span>
              </div>
              {showHWTests ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
            </button>
            {showHWTests && (
              <div className="border-t border-gray-800 p-5 space-y-6">

                {/* ─ U2C v2.1 ─────────────────────────────────────────────── */}
                <DeviceSection title="🔌 BTT U2C v2.1" subtitle="USB ↔ CAN bridge">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                    <StatCell label="USB détecté" value={sysInfo?.usb_u2c === true ? 'Oui ✓' : sysInfo?.usb_u2c === false ? 'Non ✗' : '?'}
                      color={sysInfo?.usb_u2c ? 'text-green-400' : sysInfo?.usb_u2c === false ? 'text-red-400' : 'text-gray-500'} />
                    <StatCell label="Interface can0" value={sysInfo?.can0_up ? 'Active ✓' : sysInfo?.can0_up === false ? 'Inactive ✗' : '?'}
                      color={sysInfo?.can0_up ? 'text-green-400' : sysInfo?.can0_up === false ? 'text-red-400' : 'text-gray-500'} />
                    <StatCell label="Vitesse CAN" value={sysInfo?.can0_bitrate ? `${(sysInfo.can0_bitrate / 1000).toFixed(0)} kbps` : '—'}
                      color={sysInfo?.can0_bitrate === config.canSpeed ? 'text-green-400' : sysInfo?.can0_bitrate ? 'text-orange-400' : 'text-gray-500'} />
                    <StatCell label="Config attendue" value={`${(config.canSpeed / 1000).toFixed(0)} kbps`} color="text-gray-400" />
                  </div>
                  {sysInfo?.can0_up === false && (
                    <div className="p-3 rounded-lg border border-red-800 bg-red-900/10 text-xs text-red-300 mb-3">
                      ✗ Interface can0 inactive — Vérifier que le U2C est branché USB et que
                      /etc/systemd/network/can0.network est configuré avec BitRate={config.canSpeed / 1000}K
                    </div>
                  )}
                  {sysInfo?.can0_bitrate && sysInfo.can0_bitrate !== config.canSpeed && (
                    <div className="p-3 rounded-lg border border-orange-800 bg-orange-900/10 text-xs text-orange-300 mb-3">
                      ⚠ Vitesse CAN ({(sysInfo.can0_bitrate / 1000).toFixed(0)}k) ≠ config ({(config.canSpeed / 1000).toFixed(0)}k) —
                      corriger BitRate dans /etc/systemd/network/can0.network
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <TestBtn id="u2c_ping" label="Vérifier connectivité CAN" icon="📡" waitMs={2000} runningTest={runningTest}
                      onRun={() => runAndCapture('u2c_ping', 'STATUS', 2000)} />
                  </div>
                  <TestOutput result={testResults['u2c_ping']} />
                </DeviceSection>

                {/* ─ EBB42 v1.2 ───────────────────────────────────────────── */}
                <DeviceSection title="⚡ BTT EBB42 v1.2" subtitle="CAN toolhead board — STM32G0B1">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                    <StatCell label="Firmware" value={objects['mcu EBB42']?.mcu_version?.split('-')[0] ?? '—'}
                      color={objects['mcu EBB42']?.mcu_version ? 'text-green-400' : 'text-red-400'} />
                    <StatCell label="Retransmit CAN" value={String(ebbStats.bytes_retransmit ?? '—')}
                      color={(ebbStats.bytes_retransmit ?? 0) > 0 ? 'text-yellow-400' : 'text-green-400'} />
                    <StatCell label="Bad CRC" value={String(ebbStats.bad_crc ?? '—')}
                      color={(ebbStats.bad_crc ?? 0) > 0 ? 'text-yellow-400' : 'text-green-400'} />
                    <StatCell label="MCU Awake" value={ebbStats.mcu_awake !== undefined ? `${(ebbStats.mcu_awake * 100).toFixed(1)}%` : '—'}
                      color="text-gray-400" />
                  </div>
                  {objects['temperature_sensor EBB42']?.temperature !== undefined && (
                    <div className="mb-4 p-3 rounded-lg border border-gray-700 bg-gray-800/40 text-xs">
                      <span className="text-gray-500">Température MCU EBB42 : </span>
                      <span className="text-gray-200 font-medium">{fmtTemp(objects['temperature_sensor EBB42']?.temperature)}</span>
                      {(objects['temperature_sensor EBB42']?.temperature ?? 0) > 60 && (
                        <span className="text-orange-400 ml-2">⚠ Chaud — vérifier ventilation boîtier</span>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 mb-3">
                    <TestBtn id="adxl" label="Test ADXL345" icon="📳" waitMs={3000} runningTest={runningTest}
                      onRun={() => runAndCapture('adxl', 'ACCELEROMETER_QUERY CHIP=adxl345', 3000)} />
                    <TestBtn id="axes_noise" label="Mesure bruit axes" icon="📊" waitMs={8000} runningTest={runningTest}
                      onRun={() => runAndCapture('axes_noise', 'MEASURE_AXES_NOISE', 8000)} />
                    <button onClick={async () => { await queryEndstops(); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white font-medium bg-indigo-700 hover:bg-indigo-600 transition-colors">
                      🔌 Lire endstops
                    </button>
                    <TestBtn id="fan_test" label="Test ventilateur (3s)" icon="💨" waitMs={4500} runningTest={runningTest}
                      onRun={() => runAndCapture('fan_test', 'M106 S128\nG4 P3000\nM107', 5000)} />
                  </div>

                  {/* ADXL result */}
                  {testResults['adxl'] && (() => {
                    const r = parseAdxl(testResults['adxl'].lines);
                    const norm = r ? Math.sqrt(r.x! ** 2 + r.y! ** 2 + r.z! ** 2) : null;
                    return (
                      <div className={`mb-2 p-3 rounded-lg border text-xs ${testResults['adxl'].ok ? 'border-green-800 bg-green-900/10' : 'border-red-800 bg-red-900/10'}`}>
                        <div className="font-medium text-gray-300 mb-1">📳 ADXL345 — {testResults['adxl'].ok ? '✓ Opérationnel' : '✗ Erreur'}</div>
                        {r && (
                          <>
                            <div className="flex gap-4 font-mono mt-1">
                              <span className="text-blue-400">X: {r.x?.toFixed(1)}</span>
                              <span className="text-green-400">Y: {r.y?.toFixed(1)}</span>
                              <span className="text-orange-400">Z: {r.z?.toFixed(1)}</span>
                            </div>
                            {norm && <div className="text-gray-500 mt-0.5">Norme : {norm.toFixed(1)} mm/s²
                              {Math.abs(norm - 9806.65) > 2000 ? ' ⚠ Valeur inhabituelle' : ' (≈ 9.8 m/s² attendu au repos)'}
                            </div>}
                          </>
                        )}
                        {!r && <TestOutput result={testResults['adxl']} compact />}
                      </div>
                    );
                  })()}

                  {/* Axes noise result */}
                  {testResults['axes_noise'] && (() => {
                    const r = parseAxesNoise(testResults['axes_noise'].lines);
                    return (
                      <div className={`mb-2 p-3 rounded-lg border text-xs ${testResults['axes_noise'].ok ? 'border-green-800 bg-green-900/10' : 'border-red-800 bg-red-900/10'}`}>
                        <div className="font-medium text-gray-300 mb-1">📊 Bruit axes — {testResults['axes_noise'].ok ? '✓ Mesuré' : '✗ Erreur'}</div>
                        {r && (
                          <div className="flex gap-4 font-mono mt-1">
                            <span className={Number(r.x) > 200 ? 'text-orange-400' : 'text-blue-400'}>X: {r.x?.toFixed(1)}</span>
                            <span className={Number(r.y) > 200 ? 'text-orange-400' : 'text-green-400'}>Y: {r.y?.toFixed(1)}</span>
                            <span className={Number(r.z) > 50 ? 'text-orange-400' : 'text-gray-400'}>Z: {r.z?.toFixed(1)}</span>
                          </div>
                        )}
                        {r && (Math.max(r.x ?? 0, r.y ?? 0) > 200) && (
                          <p className="text-orange-400 mt-1">Bruit XY élevé → vérifier fixations courroies et roues</p>
                        )}
                        {!r && <TestOutput result={testResults['axes_noise']} compact />}
                      </div>
                    );
                  })()}

                  {/* Fan test result */}
                  {testResults['fan_test'] && (
                    <div className={`mb-2 p-3 rounded-lg border text-xs ${testResults['fan_test'].ok ? 'border-green-800 bg-green-900/10' : 'border-red-800 bg-red-900/10'}`}>
                      <div className="font-medium text-gray-300">💨 Ventilateur — {testResults['fan_test'].ok ? '✓ Commande envoyée (50% 3s)' : '✗ Erreur'}</div>
                      {!testResults['fan_test'].ok && <TestOutput result={testResults['fan_test']} compact />}
                    </div>
                  )}

                  {/* Endstops */}
                  {endstopData && (
                    <div className="p-3 rounded-lg border border-gray-700 bg-gray-800/40">
                      <div className="text-xs font-medium text-gray-300 mb-2">🔌 États endstops</div>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(endstopData).map(([axis, state]) => (
                          <div key={axis} className={`px-2 py-1 rounded border text-xs font-mono ${state === 'TRIGGERED' ? 'border-orange-700 bg-orange-900/20 text-orange-300' : 'border-gray-700 bg-gray-800 text-gray-300'}`}>
                            {axis.toUpperCase()}: <span className="font-bold">{state}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </DeviceSection>

                {/* ─ Cartographer ─────────────────────────────────────────── */}
                <DeviceSection title="🎯 Cartographer CAN" subtitle="Inductive probe + temperature compensation">
                  {(() => {
                    const carto: CartographerFull | undefined = objects.scanner ?? objects.cartographer;
                    const cartoMcu = objects['mcu scanner'] ?? objects['mcu cartographer'];
                    const isCalibrated = carto?.cal_pos_x !== undefined || carto?.last_z_result !== undefined;
                    return (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                          <StatCell label="Firmware" value={cartoMcu?.mcu_version?.split('-')[0] ?? '—'}
                            color={cartoMcu?.mcu_version ? 'text-green-400' : 'text-red-400'} />
                          <StatCell label="Retransmit CAN" value={String(cartoStats.bytes_retransmit ?? '—')}
                            color={(cartoStats.bytes_retransmit ?? 0) > 0 ? 'text-yellow-400' : 'text-green-400'} />
                          <StatCell label="Fréquence capteur" value={carto?.frequency !== undefined ? `${(carto.frequency / 1_000_000).toFixed(3)} MHz` : '—'}
                            color="text-blue-400" />
                          <StatCell label="Temp capteur" value={carto?.temp !== undefined ? fmtTemp(carto.temp) : '—'}
                            color="text-gray-400" />
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                          <StatCell label="Dernier Z result" value={carto?.last_z_result !== undefined ? `${carto.last_z_result.toFixed(4)} mm` : '—'}
                            color={carto?.last_z_result !== undefined ? 'text-green-400' : 'text-gray-500'} />
                          <StatCell label="Calibration position" value={carto?.cal_pos_x !== undefined ? `X:${carto.cal_pos_x.toFixed(1)} Y:${carto.cal_pos_y?.toFixed(1)}` : 'Non calibré'}
                            color={isCalibrated ? 'text-green-400' : 'text-yellow-400'} />
                          <StatCell label="Temp calibration" value={carto?.cal_temp !== undefined ? fmtTemp(carto.cal_temp) : '—'}
                            color="text-gray-400" />
                        </div>
                        {!isCalibrated && (
                          <div className="mb-4 p-3 rounded-lg border border-yellow-800 bg-yellow-900/10 text-xs text-yellow-300">
                            ⚠ Cartographer non calibré — Lancer CARTOGRAPHER_CALIBRATE avec hotend à 150°C et lit à 60°C, puis SAVE_CONFIG
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2 mb-3">
                          <TestBtn id="probe_single" label="PROBE (simple)" icon="📍" waitMs={5000} runningTest={runningTest}
                            onRun={() => runAndCapture('probe_single', 'PROBE', 5000)} />
                          <TestBtn id="probe_accuracy" label="PROBE_ACCURACY (5 probes)" icon="🔬" waitMs={20000} runningTest={runningTest}
                            onRun={() => runAndCapture('probe_accuracy', 'PROBE_ACCURACY SAMPLES=5', 20000)} />
                          <TestBtn id="probe_accuracy10" label="PROBE_ACCURACY (10 probes)" icon="🔬🔬" waitMs={35000} runningTest={runningTest}
                            onRun={() => runAndCapture('probe_accuracy10', 'PROBE_ACCURACY SAMPLES=10', 35000)} />
                          <TestBtn id="carto_backlash" label="Estimer backlash" icon="📏" waitMs={10000} runningTest={runningTest}
                            onRun={() => runAndCapture('carto_backlash', 'CARTOGRAPHER_ESTIMATE_BACKLASH', 10000)} />
                        </div>

                        {/* Single probe result */}
                        {testResults['probe_single'] && (() => {
                          const z = parseSingleProbe(testResults['probe_single'].lines);
                          return (
                            <div className={`mb-2 p-3 rounded-lg border text-xs ${testResults['probe_single'].ok ? 'border-green-800 bg-green-900/10' : 'border-red-800 bg-red-900/10'}`}>
                              <div className="font-medium text-gray-300 mb-1">📍 PROBE — {testResults['probe_single'].ok ? '✓ OK' : '✗ Erreur'}</div>
                              {z !== null && <div className="text-xl font-bold text-green-400 font-mono">{z.toFixed(4)} mm</div>}
                              {!testResults['probe_single'].ok && <TestOutput result={testResults['probe_single']} compact />}
                            </div>
                          );
                        })()}

                        {/* Probe accuracy result (5 or 10) */}
                        {(['probe_accuracy', 'probe_accuracy10'] as const).map(id =>
                          testResults[id] && (() => {
                            const r = parseProbeAccuracy(testResults[id].lines);
                            const label = id === 'probe_accuracy' ? '5 probes' : '10 probes';
                            return (
                              <div key={id} className={`mb-2 p-3 rounded-lg border text-xs ${testResults[id].ok ? 'border-green-800 bg-green-900/10' : 'border-red-800 bg-red-900/10'}`}>
                                <div className="font-medium text-gray-300 mb-2">🔬 PROBE_ACCURACY ({label}) — {testResults[id].ok ? '✓ OK' : '✗ Erreur'}</div>
                                {r && (
                                  <div className="grid grid-cols-3 gap-3">
                                    <div>
                                      <div className="text-gray-500">Range (planéité)</div>
                                      <div className={`text-base font-bold font-mono ${(r.range ?? 99) < 0.010 ? 'text-green-400' : (r.range ?? 99) < 0.025 ? 'text-yellow-400' : 'text-red-400'}`}>
                                        {r.range?.toFixed(4) ?? '—'} mm
                                      </div>
                                      <div className="text-gray-600">(&lt;0.010 excellent)</div>
                                    </div>
                                    <div>
                                      <div className="text-gray-500">Std deviation</div>
                                      <div className={`text-base font-bold font-mono ${(r.stddev ?? 99) < 0.005 ? 'text-green-400' : (r.stddev ?? 99) < 0.010 ? 'text-yellow-400' : 'text-red-400'}`}>
                                        {r.stddev?.toFixed(4) ?? '—'} mm
                                      </div>
                                      <div className="text-gray-600">(&lt;0.005 excellent)</div>
                                    </div>
                                    <div>
                                      <div className="text-gray-500">Moyenne Z</div>
                                      <div className="text-base font-bold font-mono text-gray-200">{r.avg?.toFixed(4) ?? '—'} mm</div>
                                    </div>
                                  </div>
                                )}
                                {r && (r.range ?? 0) > 0.025 && (
                                  <p className="text-orange-400 mt-2">Range élevé — vibrations ? Hotend/lit chauds lors du test ?</p>
                                )}
                                {!r && <TestOutput result={testResults[id]} compact />}
                              </div>
                            );
                          })()
                        )}

                        {/* Backlash result */}
                        {testResults['carto_backlash'] && (
                          <div className={`mb-2 p-3 rounded-lg border text-xs ${testResults['carto_backlash'].ok ? 'border-green-800 bg-green-900/10' : 'border-red-800 bg-red-900/10'}`}>
                            <div className="font-medium text-gray-300 mb-1">📏 Backlash Z — {testResults['carto_backlash'].ok ? '✓ Mesuré' : '✗ Erreur'}</div>
                            <TestOutput result={testResults['carto_backlash']} compact />
                          </div>
                        )}
                      </>
                    );
                  })()}
                </DeviceSection>
              </div>
            )}
          </div>

          {/* ── Actions rapides ──────────────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Play size={15} className="text-orange-400" />
              <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Actions rapides</h3>
              {sendFeedback && (
                <span className={`text-xs ml-auto px-2 py-0.5 rounded ${sendFeedback.startsWith('✓') ? 'text-green-400 bg-green-900/30' : 'text-red-400 bg-red-900/30'}`}>{sendFeedback}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK_ACTIONS.map(a => (
                <button key={a.cmd} onClick={() => sendGcode(a.cmd)} disabled={sending !== null}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white font-medium transition-colors disabled:opacity-50 ${a.color}`}>
                  {sending === a.cmd ? <RefreshCw size={11} className="animate-spin" /> : <span>{a.icon}</span>}
                  {a.label}
                </button>
              ))}
            </div>
            <CustomGcodeInput onSend={sendGcode} disabled={sending !== null} />
          </div>

          {/* ── Températures ─────────────────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Thermometer size={15} className="text-orange-400" />
              <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Températures</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {([
                { label: 'Hotend',  sensor: objects.extruder, icon: '🔥' },
                { label: 'Lit',     sensor: objects.heater_bed, icon: '♨️' },
                { label: 'Chamber', sensor: objects['temperature_sensor Chamber'], icon: '🏠' },
                { label: 'EBB42',   sensor: objects['temperature_sensor EBB42'],   icon: '⚡' },
                { label: 'Octopus', sensor: objects['temperature_sensor Octopus'], icon: '🖥️' },
              ] as const).map(item => {
                const t = item.sensor?.temperature, target = item.sensor?.target ?? 0;
                return (
                  <div key={item.label} className="rounded-lg border border-gray-700 bg-gray-800/40 p-3 text-center">
                    <div className="text-lg mb-0.5">{item.icon}</div>
                    <div className="text-xs text-gray-500 mb-1">{item.label}</div>
                    {t !== undefined ? (<>
                      <div className={`text-base font-bold ${tempColor(t, target)}`}>{fmtTemp(t)}</div>
                      {target > 0 && <div className="text-xs text-gray-600 mt-0.5">→ {fmtTemp(target)}</div>}
                      {item.sensor?.power !== undefined && <div className="text-xs text-gray-600">{(item.sensor.power * 100).toFixed(0)}%</div>}
                    </>) : <div className="text-sm text-gray-600">—</div>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Bed Mesh ─────────────────────────────────────────────────────── */}
          {meshAnalysis && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 size={15} className="text-orange-400" />
                <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Analyse Bed Mesh</h3>
                <span className={`ml-auto text-sm font-bold ${meshAnalysis.ratingColor}`}>{meshAnalysis.rating}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                {[
                  { label: 'Z min',   value: `${meshAnalysis.min.toFixed(3)} mm` },
                  { label: 'Z max',   value: `${meshAnalysis.max.toFixed(3)} mm` },
                  { label: 'Range',   value: `${meshAnalysis.range.toFixed(3)} mm`, hi: meshAnalysis.range > 0.6 },
                  { label: 'Écart-type σ', value: `${meshAnalysis.stddev.toFixed(4)} mm` },
                ].map(item => (
                  <div key={item.label} className={`rounded-lg border p-3 text-center ${item.hi ? 'border-orange-800 bg-orange-900/10' : 'border-gray-700 bg-gray-800/40'}`}>
                    <div className="text-xs text-gray-500 mb-1">{item.label}</div>
                    <div className={`text-sm font-bold ${item.hi ? 'text-orange-400' : 'text-gray-200'}`}>{item.value}</div>
                  </div>
                ))}
              </div>
              <MeshHeatmap matrix={objects.bed_mesh?.probed_matrix} />
            </div>
          )}

          {/* ── Config Validation ────────────────────────────────────────────── */}
          {configChecks.length > 0 && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
              <button onClick={() => setShowConfigChecks(v => !v)}
                className="w-full flex items-center justify-between p-5 hover:bg-gray-800/30 transition-colors">
                <div className="flex items-center gap-2">
                  <Shield size={15} className="text-orange-400" />
                  <span className="text-xs font-bold text-gray-300 uppercase tracking-widest">
                    Config chargée ({configOk}/{configChecks.filter(c => c.status !== 'unknown').length} OK)
                  </span>
                  {configErr > 0 && <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-800">{configErr} erreur{configErr > 1 ? 's' : ''}</span>}
                </div>
                {showConfigChecks ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
              </button>
              {showConfigChecks && (
                <div className="border-t border-gray-800 p-5 space-y-2">
                  {configChecks.map((check, i) => <CheckRow key={i} check={check} onSend={sendGcode} sending={sending} />)}
                </div>
              )}
            </div>
          )}

          {/* ── Checks Runtime ───────────────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={15} className="text-orange-400" />
                <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Checks Runtime ({okCount}/{totalChecks} OK)</h3>
              </div>
              <div className="flex gap-3 text-xs">
                <span className="text-green-400">{okCount} ✓</span>
                <span className="text-yellow-400">{warnCount} ⚠</span>
                <span className="text-red-400">{errorCount} ✗</span>
              </div>
            </div>
            <div className="space-y-2">
              {runtimeChecks.map((check, i) => <CheckRow key={i} check={check} onSend={sendGcode} sending={sending} />)}
            </div>
          </div>

          {/* ── Comparaison printer.cfg ──────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
            <div className="flex items-center justify-between p-5">
              <div className="flex items-center gap-2">
                <GitCompare size={15} className="text-orange-400" />
                <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Comparaison printer.cfg</h3>
                {diffMismatches > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${diffCritical > 0 ? 'text-red-400 border-red-800 bg-red-900/30' : 'text-yellow-400 border-yellow-800 bg-yellow-900/30'}`}>
                    {diffMismatches} différence{diffMismatches > 1 ? 's' : ''}{diffCritical > 0 ? ` dont ${diffCritical} critique${diffCritical > 1 ? 's' : ''}` : ''}
                  </span>
                )}
                {actualCfg && diffMismatches === 0 && <span className="text-xs px-1.5 py-0.5 rounded border text-green-400 border-green-800 bg-green-900/20">✓ Configs identiques</span>}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={fetchPrinterCfg} disabled={cfgLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-medium transition-colors">
                  {cfgLoading ? <RefreshCw size={11} className="animate-spin" /> : <HardDrive size={11} />}
                  {actualCfg ? 'Recharger' : 'Charger printer.cfg'}
                </button>
                {actualCfg && <button onClick={() => setShowDiff(d => !d)} className="text-gray-500 hover:text-gray-300">{showDiff ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>}
              </div>
            </div>
            {cfgError && <div className="border-t border-gray-800 px-5 pb-4 text-xs text-red-400">{cfgError}</div>}
            {!actualCfg && !cfgError && <div className="border-t border-gray-800 px-5 pb-4 pt-2 text-xs text-gray-600">Cliquer "Charger printer.cfg" pour comparer votre config réelle avec celle générée par l'app.</div>}
            {actualCfg && showDiff && (
              <div className="border-t border-gray-800 p-5">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-gray-500 border-b border-gray-800">
                      <th className="text-left py-2 pr-4 font-medium">Paramètre</th>
                      <th className="text-left py-2 pr-4 font-medium">Attendu (app)</th>
                      <th className="text-left py-2 pr-4 font-medium">Réel (printer.cfg)</th>
                      <th className="text-left py-2 font-medium">État</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {diffLines.map(d => (
                        <tr key={d.key} className={d.match ? '' : d.critical ? 'bg-red-900/10' : 'bg-yellow-900/10'}>
                          <td className="py-2 pr-4 font-mono text-gray-400">{d.label}</td>
                          <td className="py-2 pr-4 font-mono text-gray-200">{d.expected}</td>
                          <td className={`py-2 pr-4 font-mono ${d.match ? 'text-gray-200' : d.critical ? 'text-red-300' : 'text-yellow-300'}`}>{d.actual}</td>
                          <td className="py-2">{d.match ? <span className="text-green-400">✓</span> : <span className={d.critical ? 'text-red-400 font-bold' : 'text-yellow-400'}>{d.critical ? '✗ CRITIQUE' : '≠'}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* ── Ressources Pi ────────────────────────────────────────────────── */}
          {sysInfo && (sysInfo.cpu_usage !== undefined || sysInfo.mem_total !== undefined) && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
              <div className="flex items-center gap-2 mb-4">
                <HardDrive size={15} className="text-orange-400" />
                <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Ressources Raspberry Pi</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {sysInfo.cpu_usage !== undefined && <ResourceBar label="CPU" value={sysInfo.cpu_usage} warn={70} bad={90} />}
                {sysInfo.mem_total !== undefined && sysInfo.mem_available !== undefined && (
                  <ResourceBar label="RAM" value={((sysInfo.mem_total - sysInfo.mem_available) / sysInfo.mem_total) * 100} warn={75} bad={90}
                    extra={`${fmtBytes(sysInfo.mem_available)} libre`} />
                )}
                {sysInfo.cpu_model && <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-3"><div className="text-xs text-gray-500 mb-1">CPU</div><div className="text-xs text-gray-300 truncate">{sysInfo.cpu_model}</div></div>}
              </div>
            </div>
          )}

          {/* ── Print en cours ───────────────────────────────────────────────── */}
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

          {/* ── Logs ─────────────────────────────────────────────────────────── */}
          {gcodes.length > 0 && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
              <button onClick={() => setShowLogs(l => !l)}
                className="w-full flex items-center justify-between p-5 hover:bg-gray-800/30 transition-colors">
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
                    <div key={i} className={`text-xs font-mono py-0.5 ${entry.message.toLowerCase().includes('error') ? 'text-red-400' : entry.message.includes('shutdown') ? 'text-red-300' : entry.type === 'command' ? 'text-blue-400' : 'text-gray-400'}`}>
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

// ─── Topology ─────────────────────────────────────────────────────────────────

function TopologyDiagram({ sysInfo, ebbOk, cartoOk, config }: { sysInfo: SysInfo | null; ebbOk: boolean; cartoOk: boolean; config: PrinterConfig }) {
  const can0Up = sysInfo?.can0_up, bitrate = sysInfo?.can0_bitrate, u2cOk = sysInfo?.usb_u2c;
  const bitrateOk = bitrate === undefined || bitrate === config.canSpeed;
  const StatDot = ({ ok }: { ok: boolean | undefined }) => (
    <div className={`w-2 h-2 rounded-full inline-block mr-1.5 ${ok === true ? 'bg-green-400' : ok === false ? 'bg-red-400' : 'bg-gray-500'}`} />
  );
  return (
    <div className="space-y-4">
      {/* Visual chain */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 text-sm">
        <div className="rounded-lg border border-green-800 bg-green-900/10 px-3 py-2 text-center whitespace-nowrap">
          <div className="text-xs font-medium text-gray-200">🖥️ Raspberry Pi</div>
          <div className="text-xs text-gray-500">Klipper</div>
        </div>
        <div className={`flex flex-col items-center px-1 ${u2cOk === false ? 'text-red-400' : u2cOk ? 'text-green-400' : 'text-gray-500'}`}>
          <div className="text-xs">USB</div><div className="text-base">→</div>
        </div>
        <div className={`rounded-lg border px-3 py-2 text-center whitespace-nowrap ${u2cOk ? 'border-green-800 bg-green-900/10' : u2cOk === false ? 'border-red-800 bg-red-900/10' : 'border-gray-700 bg-gray-800/30'}`}>
          <div className="text-xs font-medium text-gray-200">BTT U2C v2.1</div>
          <div className="text-xs text-gray-500">{u2cOk ? 'Détecté ✓' : u2cOk === false ? 'Non détecté ✗' : '?'}</div>
        </div>
        <div className={`flex flex-col items-center px-1 ${can0Up ? (bitrateOk ? 'text-green-400' : 'text-orange-400') : 'text-red-400'}`}>
          <div className="text-xs">{bitrate ? `${(bitrate / 1000).toFixed(0)}k` : 'CAN'}</div><div className="text-base">→</div>
        </div>
        <div className="flex flex-col gap-1">
          <div className={`rounded-lg border px-3 py-1.5 text-center whitespace-nowrap ${ebbOk ? 'border-green-800 bg-green-900/10' : 'border-red-800 bg-red-900/10'}`}>
            <div className="text-xs font-medium text-gray-200">EBB42 v1.2</div>
            <div className="text-xs text-gray-500">{ebbOk ? 'Connecté ✓' : 'Absent ✗'}</div>
          </div>
          <div className={`rounded-lg border px-3 py-1.5 text-center whitespace-nowrap ${cartoOk ? 'border-green-800 bg-green-900/10' : 'border-red-800 bg-red-900/10'}`}>
            <div className="text-xs font-medium text-gray-200">Cartographer</div>
            <div className="text-xs text-gray-500">{cartoOk ? 'Connecté ✓' : 'Absent ✗'}</div>
          </div>
        </div>
      </div>
      {/* Detail grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        {[
          { label: 'USB → U2C v2.1',      ok: u2cOk, value: u2cOk === true ? 'Détecté (1d50:606f)' : u2cOk === false ? 'Non détecté' : 'Inconnu' },
          { label: 'Interface can0',       ok: can0Up, value: can0Up ? 'Active' : can0Up === false ? 'Inactive' : 'Inconnue' },
          { label: 'Vitesse CAN',          ok: bitrate !== undefined ? bitrateOk : undefined, value: bitrate ? `${(bitrate / 1000).toFixed(0)} kbps${!bitrateOk ? ` ≠ ${(config.canSpeed / 1000).toFixed(0)}k` : ''}` : '—' },
          { label: 'CAN → EBB42 v1.2',    ok: ebbOk,   value: ebbOk ? 'Connecté' : 'Absent' },
          { label: 'CAN → Cartographer',   ok: cartoOk, value: cartoOk ? 'Connecté' : 'Absent' },
        ].map(item => (
          <div key={item.label} className="flex items-center gap-2 p-2 rounded border border-gray-800 bg-gray-800/30">
            <StatDot ok={item.ok} />
            <span className="text-gray-400 flex-1">{item.label}</span>
            <span className={`font-medium ${item.ok === true ? 'text-green-400' : item.ok === false ? 'text-red-400' : 'text-gray-500'}`}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DeviceSection({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900/40 p-4">
      <div className="mb-4">
        <div className="text-sm font-bold text-gray-200">{title}</div>
        <div className="text-xs text-gray-500">{subtitle}</div>
      </div>
      {children}
    </div>
  );
}

function StatCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-2.5">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-xs font-bold font-mono truncate ${color}`}>{value}</div>
    </div>
  );
}

function TestBtn({ id, label, icon, waitMs, runningTest, onRun }: {
  id: string; label: string; icon: string; waitMs: number; runningTest: string | null; onRun: () => void;
}) {
  const isRunning = runningTest === id;
  const anyRunning = runningTest !== null;
  return (
    <button onClick={onRun} disabled={anyRunning}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-50 transition-colors">
      {isRunning ? <RefreshCw size={11} className="animate-spin" /> : <span>{icon}</span>}
      {isRunning ? `${label} (${(waitMs / 1000).toFixed(0)}s…)` : label}
    </button>
  );
}

function TestOutput({ result, compact }: { result: TestResult; compact?: boolean }) {
  if (!result) return null;
  const lines = compact ? result.lines.filter(l => l.trim()) : result.lines;
  if (!lines.length) return <div className="text-xs text-gray-600 mt-1">Aucun output</div>;
  return (
    <div className="mt-2 bg-gray-950 rounded border border-gray-800 p-2 max-h-32 overflow-y-auto">
      {lines.map((l, i) => (
        <div key={i} className={`text-xs font-mono py-0.5 ${l.toLowerCase().includes('error') ? 'text-red-400' : l.startsWith('//') || l.startsWith('>') ? 'text-gray-300' : 'text-gray-500'}`}>
          {l}
        </div>
      ))}
    </div>
  );
}

function CheckRow({ check, onSend, sending }: { check: Check; onSend: (cmd: string) => void; sending: string | null }) {
  return (
    <div className={`p-3 rounded-lg border ${check.status === 'ok' ? 'border-green-800 bg-green-900/10' : check.status === 'warn' ? 'border-yellow-800 bg-yellow-900/10' : check.status === 'error' ? 'border-red-800 bg-red-900/10' : 'border-gray-700 bg-gray-800/30'}`}>
      <div className="flex items-start gap-2">
        {check.status === 'ok' ? <CheckCircle2 size={14} className="text-green-400 flex-shrink-0 mt-0.5" /> :
         check.status === 'warn' ? <AlertTriangle size={14} className="text-yellow-400 flex-shrink-0 mt-0.5" /> :
         check.status === 'error' ? <XCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" /> :
         check.status === 'info' ? <Info size={14} className="text-blue-400 flex-shrink-0 mt-0.5" /> :
         <Clock size={14} className="text-gray-500 flex-shrink-0 mt-0.5" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-sm text-gray-200">{check.label}</span>
            <span className={`text-xs flex-shrink-0 ${check.status === 'ok' ? 'text-green-400' : check.status === 'warn' ? 'text-yellow-400' : check.status === 'error' ? 'text-red-400' : 'text-gray-500'}`}>{check.status.toUpperCase()}</span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{check.detail}</p>
          {check.hint && <p className="text-xs text-gray-600 mt-1 italic">→ {check.hint}</p>}
          {check.cmd && (
            <button onClick={() => onSend(check.cmd!)} disabled={sending !== null}
              className="mt-1.5 flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-orange-800 text-orange-400 hover:bg-orange-900/30 disabled:opacity-50 transition-colors">
              <Send size={10} /> Envoyer : {check.cmd}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ResourceBar({ label, value, warn, bad, extra }: { label: string; value: number; warn: number; bad: number; extra?: string }) {
  const color = value >= bad ? 'bg-red-500' : value >= warn ? 'bg-yellow-500' : 'bg-green-500';
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-gray-500">{label}</span>
        <span className={`text-xs font-bold ${value >= bad ? 'text-red-400' : value >= warn ? 'text-yellow-400' : 'text-gray-200'}`}>{value.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      {extra && <div className="text-xs text-gray-600 mt-1">{extra}</div>}
    </div>
  );
}

function MeshHeatmap({ matrix }: { matrix?: number[][] }) {
  if (!matrix?.length) return null;
  const flat = matrix.flat(), min = Math.min(...flat), max = Math.max(...flat), range = max - min || 1;
  return (
    <div className="mt-3 overflow-x-auto">
      <p className="text-xs text-gray-600 mb-1.5">Heatmap Z — bleu=bas, rouge=haut</p>
      <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: `repeat(${matrix[0].length}, 1fr)` }}>
        {matrix.map((row, ri) => row.map((val, ci) => {
          const t = (val - min) / range;
          return <div key={`${ri}-${ci}`} title={`${val.toFixed(3)} mm`} className="w-3 h-3 rounded-sm cursor-help"
            style={{ backgroundColor: `rgb(${Math.round(t * 220)},40,${Math.round((1 - t) * 220)})` }} />;
        }))}
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgb(0,40,220)' }} />
        <span className="text-xs text-gray-600">{min.toFixed(3)}</span>
        <div className="flex-1 h-1 rounded-full" style={{ background: 'linear-gradient(to right,rgb(0,40,220),rgb(110,40,110),rgb(220,40,0))' }} />
        <span className="text-xs text-gray-600">{max.toFixed(3)} mm</span>
        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgb(220,40,0)' }} />
      </div>
    </div>
  );
}

function CustomGcodeInput({ onSend, disabled }: { onSend: (cmd: string) => void; disabled: boolean }) {
  const [val, setVal] = useState('');
  const send = () => { const cmd = val.trim().toUpperCase(); if (!cmd) return; onSend(cmd); setVal(''); };
  return (
    <div className="flex gap-2 mt-3">
      <input type="text" value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
        placeholder="GCode personnalisé (ex: PROBE_ACCURACY SAMPLES=3)"
        className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-orange-500 placeholder-gray-600" />
      <button onClick={send} disabled={disabled || !val.trim()}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-xs transition-colors">
        <Send size={11} /> Envoyer
      </button>
    </div>
  );
}
