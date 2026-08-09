import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity, Wifi, WifiOff, RefreshCw, AlertTriangle, CheckCircle2,
  XCircle, Thermometer, Cpu, Zap, Clock, Terminal, Info,
  ChevronDown, ChevronUp, Play, HardDrive, BarChart3,
  Shield, Send, GitCompare, Network,
} from 'lucide-react';
import type { PrinterConfig } from '../App';
import { generateConfig } from './ConfigGenerator';

// ─── Types Moonraker ───────────────────────────────────────────────────────────

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
}

interface TempSensor {
  temperature?: number;
  target?: number;
  power?: number;
}

interface ToolheadStatus {
  homed_axes?: string;
}

interface BedMeshStatus {
  profile_name?: string;
  probed_matrix?: number[][];
}

interface PrintStats {
  state?: string;
  filename?: string;
  total_duration?: number;
  print_duration?: number;
}

interface ConfigFileData {
  config?: Record<string, Record<string, string>>;
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
  scanner?: { last_z_result?: number };
  cartographer?: { last_z_result?: number };
  webhooks?: { state?: string; state_message?: string };
  input_shaper?: { shaper_freq_x?: number; shaper_freq_y?: number; shaper_type_x?: string };
  configfile?: ConfigFileData;
}

interface GCodeEntry { type: string; time: number; message: string; }

interface SysInfo {
  can0_bitrate?: number;
  can0_up?: boolean;
  usb_u2c?: boolean;
  cpu_usage?: number;
  mem_total?: number;
  mem_available?: number;
  cpu_model?: string;
}

// ─── Check types ──────────────────────────────────────────────────────────────

type CheckStatus = 'ok' | 'warn' | 'error' | 'info' | 'unknown';
interface Check {
  label: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
  cmd?: string;
}

// ─── Config comparison ────────────────────────────────────────────────────────

interface DiffLine {
  key: string;           // section.param
  label: string;
  expected: string;
  actual: string;
  match: boolean;
  critical: boolean;
}

/** Parse a printer.cfg string into section → key → value */
function parseCfg(text: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  let section = '__top__';
  for (const raw of text.split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) { section = sec[1].trim(); result[section] = result[section] ?? {}; continue; }
    const kv = line.match(/^(\S+)\s*:\s*(.+)$/);
    if (kv) { result[section] = result[section] ?? {}; result[section][kv[1].trim()] = kv[2].trim(); }
  }
  return result;
}

const COMPARE_KEYS: Array<{ section: string; key: string; label: string; critical: boolean }> = [
  { section: 'stepper_z',        key: 'homing_retract_dist', label: 'stepper_z › homing_retract_dist', critical: true  },
  { section: 'stepper_z',        key: 'endstop_pin',         label: 'stepper_z › endstop_pin',         critical: true  },
  { section: 'bed_mesh',         key: 'zero_reference_position', label: 'bed_mesh › zero_reference_position', critical: true },
  { section: 'bed_mesh',         key: 'mesh_min',            label: 'bed_mesh › mesh_min',             critical: false },
  { section: 'bed_mesh',         key: 'mesh_max',            label: 'bed_mesh › mesh_max',             critical: false },
  { section: 'mcu EBB42',        key: 'canbus_interface',    label: 'mcu EBB42 › canbus_interface',    critical: true  },
  { section: 'extruder',         key: 'rotation_distance',   label: 'extruder › rotation_distance',    critical: false },
  { section: 'extruder',         key: 'nozzle_diameter',     label: 'extruder › nozzle_diameter',      critical: false },
  { section: 'printer',          key: 'max_velocity',        label: 'printer › max_velocity',          critical: false },
  { section: 'printer',          key: 'max_accel',           label: 'printer › max_accel',             critical: false },
  { section: 'z_tilt',           key: 'speed',               label: 'z_tilt › speed',                  critical: false },
];

function diffConfigs(generated: string, actual: string): DiffLine[] {
  const gen = parseCfg(generated);
  const act = parseCfg(actual);
  return COMPARE_KEYS.map(({ section, key, label, critical }) => {
    const expected = gen[section]?.[key] ?? '—';
    const found    = act[section]?.[key] ?? '(absent)';
    return { key: `${section}.${key}`, label, expected, actual: found, match: expected === found, critical };
  });
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
  if (b >= 1048576)    return `${(b / 1048576).toFixed(0)} Mo`;
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

// ─── Build checks ─────────────────────────────────────────────────────────────

function buildRuntimeChecks(info: PrinterInfo, objs: PrinterObjects, gcodes: GCodeEntry[]): Check[] {
  const checks: Check[] = [];
  const ks = objs.webhooks?.state ?? info.state;
  checks.push({
    label: 'État Klipper', status: ks === 'ready' ? 'ok' : ks === 'startup' ? 'warn' : 'error',
    detail: ks === 'ready' ? 'Klipper opérationnel' : objs.webhooks?.state_message ?? info.state_message,
    hint: ks === 'error' ? 'Voir klippy.log — souvent un UUID ou une pin incorrecte' : undefined,
    cmd: ks === 'error' ? 'FIRMWARE_RESTART' : undefined,
  });
  const mcuOk = !!objs.mcu?.mcu_version;
  checks.push({
    label: 'MCU Principal (Octopus)', status: mcuOk ? 'ok' : 'error',
    detail: mcuOk ? `Firmware: ${objs.mcu!.mcu_version!.split('-')[0]}` : 'MCU non connecté — firmware absent ou port série incorrect',
  });
  const ebbOk = !!objs['mcu EBB42']?.mcu_version;
  checks.push({
    label: 'EBB42 v1.2 (CAN)', status: ebbOk ? 'ok' : 'error',
    detail: ebbOk ? `${objs['mcu EBB42']!.mcu_version!.split('-')[0]}` : 'EBB42 introuvable sur le bus CAN',
    hint: !ebbOk ? 'Vérifier canbus_uuid EBB42, alimentation 24V, câbles CAN, résistances 120Ω' : undefined,
  });
  const carto = objs['mcu scanner'] ?? objs['mcu cartographer'];
  const cartoOk = !!carto?.mcu_version;
  checks.push({
    label: 'Cartographer CAN', status: cartoOk ? 'ok' : 'error',
    detail: cartoOk ? `${carto!.mcu_version!.split('-')[0]}` : 'Cartographer introuvable sur le bus CAN',
    hint: !cartoOk ? 'Vérifier canbus_uuid Cartographer, jumper 120Ω, alimentation 3.3V depuis EBB42' : undefined,
  });
  const homed = objs.toolhead?.homed_axes ?? '';
  checks.push({
    label: 'Homing axes', status: homed === 'xyz' ? 'ok' : 'warn',
    detail: homed === 'xyz' ? 'Tous les axes homés (XYZ)' : homed === '' ? 'Aucun axe homé' : `Homés : ${homed}`,
    cmd: homed !== 'xyz' ? 'G28' : undefined,
  });
  const ztilt = objs.z_tilt?.applied;
  checks.push({
    label: 'Z_TILT_ADJUST (3 vis Z)', status: ztilt ? 'ok' : ztilt === false ? 'warn' : 'unknown',
    detail: ztilt ? 'Plateau nivelé — 3 vis Z alignées' : 'Z_TILT non appliqué',
    cmd: !ztilt ? 'Z_TILT_ADJUST' : undefined,
  });
  const mesh = objs.bed_mesh;
  const meshOk = !!mesh?.profile_name && mesh.profile_name !== '';
  checks.push({
    label: 'Bed Mesh', status: meshOk ? 'ok' : 'warn',
    detail: meshOk ? `Profil actif : "${mesh!.profile_name}"` : 'Aucun profil de mesh chargé',
    cmd: !meshOk ? 'BED_MESH_CALIBRATE' : undefined,
  });
  const cartoData = objs.scanner ?? objs.cartographer;
  checks.push({
    label: 'Cartographer calibré', status: cartoData?.last_z_result !== undefined ? 'ok' : 'warn',
    detail: cartoData?.last_z_result !== undefined
      ? `Dernier Z result : ${cartoData.last_z_result.toFixed(4)} mm`
      : 'Aucun résultat de calibration — à faire !',
    hint: !cartoData?.last_z_result ? 'CARTOGRAPHER_CALIBRATE (hotend 150°C, lit 60°C) puis SAVE_CONFIG' : undefined,
  });
  if (objs.extruder?.temperature === undefined)
    checks.push({ label: 'Capteur hotend', status: 'warn', detail: 'Non lisible — vérifier thermistance EBB42 PA3' });
  if (objs.heater_bed?.temperature === undefined)
    checks.push({ label: 'Capteur lit', status: 'warn', detail: 'Non lisible — vérifier câblage lit chauffant' });
  const errs = gcodes.filter(g =>
    g.type === 'response' &&
    (g.message.includes('Error') || g.message.includes('error') ||
     g.message.includes('shutdown') || g.message.includes('mcu '))
  );
  if (errs.length > 0)
    checks.push({ label: `Erreurs récentes (${errs.length})`, status: 'error', detail: errs[0].message.slice(0, 120), hint: 'Voir section Logs ci-dessous' });
  return checks;
}

function buildConfigChecks(cfg: ConfigFileData): Check[] {
  const c = cfg.config ?? {};
  return [
    {
      label: 'homing_retract_dist = 0',
      status: (c['stepper_z']?.['homing_retract_dist'] === '0') ? 'ok' : c['stepper_z']?.['homing_retract_dist'] ? 'error' : 'unknown',
      detail: c['stepper_z']?.['homing_retract_dist'] === '0' ? '✓ Correct — indispensable avec Cartographer' : `Valeur chargée : ${c['stepper_z']?.['homing_retract_dist'] ?? 'non trouvée'} (doit être 0)`,
      hint: c['stepper_z']?.['homing_retract_dist'] !== '0' ? 'Corriger dans [stepper_z] puis FIRMWARE_RESTART' : undefined,
    },
    {
      label: 'endstop_pin = probe:z_virtual_endstop',
      status: (c['stepper_z']?.['endstop_pin'] === 'probe:z_virtual_endstop') ? 'ok' : c['stepper_z']?.['endstop_pin'] ? 'error' : 'unknown',
      detail: c['stepper_z']?.['endstop_pin'] === 'probe:z_virtual_endstop' ? '✓ Z utilise le Cartographer' : `Actuel : ${c['stepper_z']?.['endstop_pin'] ?? 'non trouvé'}`,
    },
    {
      label: 'zero_reference_position (bed_mesh)',
      status: c['bed_mesh']?.['zero_reference_position'] ? 'ok' : 'warn',
      detail: c['bed_mesh']?.['zero_reference_position'] ? `✓ ${c['bed_mesh']['zero_reference_position']}` : 'Non défini dans [bed_mesh]',
      hint: !c['bed_mesh']?.['zero_reference_position'] ? 'Ajouter zero_reference_position: 200, 200 dans [bed_mesh]' : undefined,
    },
    {
      label: 'EBB42 canbus_interface = can0',
      status: c['mcu EBB42']?.['canbus_interface'] === 'can0' ? 'ok' : c['mcu EBB42']?.['canbus_interface'] ? 'warn' : 'unknown',
      detail: c['mcu EBB42']?.['canbus_interface'] === 'can0' ? '✓ Interface CAN correcte' : `Actuel : ${c['mcu EBB42']?.['canbus_interface'] ?? 'non trouvé'}`,
    },
    {
      label: 'Input Shaper configuré',
      status: (c['input_shaper']?.['shaper_freq_x']) ? 'ok' : 'warn',
      detail: c['input_shaper']?.['shaper_freq_x']
        ? `X: ${c['input_shaper']['shaper_freq_x']} Hz — Y: ${c['input_shaper']['shaper_freq_y'] ?? '?'} Hz`
        : 'Non configuré — SHAPER_CALIBRATE recommandé pour VCore 3.1',
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'Home All',        cmd: 'G28',                    color: 'bg-blue-700 hover:bg-blue-600',   icon: '🏠' },
  { label: 'Z Tilt',          cmd: 'Z_TILT_ADJUST',          color: 'bg-purple-700 hover:bg-purple-600', icon: '⚖️' },
  { label: 'Bed Mesh',        cmd: 'BED_MESH_CALIBRATE',     color: 'bg-teal-700 hover:bg-teal-600',  icon: '📐' },
  { label: 'Save Config',     cmd: 'SAVE_CONFIG',            color: 'bg-green-700 hover:bg-green-600', icon: '💾' },
  { label: 'FW Restart',      cmd: 'FIRMWARE_RESTART',       color: 'bg-orange-700 hover:bg-orange-600', icon: '🔄' },
  { label: 'Carto Calibrate', cmd: 'CARTOGRAPHER_CALIBRATE', color: 'bg-pink-700 hover:bg-pink-600',  icon: '🎯' },
] as const;

export function PrinterDiagnostic({ config }: { config: PrinterConfig }) {
  const [ip, setIp]             = useState('192.168.1.41');
  const [port, setPort]         = useState('80');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [sending, setSending]   = useState<string | null>(null);
  const [sendFeedback, setSendFeedback] = useState<string | null>(null);

  const [printerInfo, setPrinterInfo] = useState<PrinterInfo | null>(null);
  const [objects, setObjects]   = useState<PrinterObjects>({});
  const [gcodes, setGcodes]     = useState<GCodeEntry[]>([]);
  const [sysInfo, setSysInfo]   = useState<SysInfo | null>(null);

  // printer.cfg comparison
  const [actualCfg, setActualCfg]       = useState<string | null>(null);
  const [cfgLoading, setCfgLoading]     = useState(false);
  const [cfgError, setCfgError]         = useState<string | null>(null);
  const [showDiff, setShowDiff]         = useState(false);

  const [showLogs, setShowLogs]         = useState(false);
  const [showConfigChecks, setShowConfigChecks] = useState(true);

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

      const canbus = si.canbus ?? {};
      const can0 = canbus['can0'];
      const usbDevs: Array<{ vendor_id?: string; product_id?: string; description?: string }> = si.usb_devices ?? [];
      // BTT U2C v2.1 vendor:product = 1d50:606f
      const u2cFound = usbDevs.some(d =>
        (d.vendor_id === '1d50' && d.product_id === '606f') ||
        (d.description ?? '').toLowerCase().includes('u2c') ||
        (d.description ?? '').toLowerCase().includes('candlelight')
      );

      const cpuUsages: number[] = Object.values(ps.system_cpu_usage ?? {});
      const sysMem = ps.system_memory ?? {};

      setSysInfo({
        can0_up: !!can0,
        can0_bitrate: can0?.bitrate,
        usb_u2c: u2cFound || undefined === u2cFound ? u2cFound : undefined,
        cpu_usage: cpuUsages.length ? cpuUsages.reduce((a, b) => a + b, 0) / cpuUsages.length : undefined,
        mem_total: sysMem.total ? sysMem.total * 1024 : undefined,
        mem_available: sysMem.available ? sysMem.available * 1024 : undefined,
        cpu_model: si.cpu_info?.model_name,
      });

      setPrinterInfo(info); setObjects(objData); setGcodes(gcData);
      setConnected(true); setLastUpdate(new Date());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        msg.includes('Failed to fetch') || msg.includes('NetworkError')
          ? `Impossible de joindre ${baseUrl} — imprimante allumée et même réseau ?`
          : msg.includes('timeout') ? `Timeout — ${baseUrl} ne répond pas` : msg
      );
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: cmd }),
        signal: AbortSignal.timeout(10000),
      });
      setSendFeedback(res.ok ? `✓ ${cmd} envoyé` : `✗ Erreur HTTP ${res.status}`);
    } catch { setSendFeedback(`✗ Impossible d'envoyer`); }
    finally { setSending(null); setTimeout(() => setSendFeedback(null), 4000); }
  };

  const fetchPrinterCfg = async () => {
    setCfgLoading(true); setCfgError(null);
    try {
      const res = await fetch(`${baseUrl}/server/files/config/printer.cfg`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setActualCfg(text);
      setShowDiff(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setCfgError(`Impossible de lire printer.cfg : ${msg}`);
    } finally { setCfgLoading(false); }
  };

  // ─── Derived ─────────────────────────────────────────────────────────────────

  const runtimeChecks = printerInfo ? buildRuntimeChecks(printerInfo, objects, gcodes) : [];
  const configChecks  = objects.configfile ? buildConfigChecks(objects.configfile) : [];
  const meshAnalysis  = analyzeMesh(objects.bed_mesh?.probed_matrix);
  const generatedCfg  = generateConfig(config);
  const diffLines     = actualCfg ? diffConfigs(generatedCfg, actualCfg) : [];

  const ebbStats  = parseMcuStats(objects['mcu EBB42']?.last_stats);
  const cartoMcuKey: keyof PrinterObjects = objects['mcu scanner'] ? 'mcu scanner' : 'mcu cartographer';
  const cartoStats = parseMcuStats((objects[cartoMcuKey] as McuStatus | undefined)?.last_stats);

  const okCount    = runtimeChecks.filter(c => c.status === 'ok').length;
  const warnCount  = runtimeChecks.filter(c => c.status === 'warn').length;
  const errorCount = runtimeChecks.filter(c => c.status === 'error').length;
  const totalChecks = runtimeChecks.filter(c => c.status !== 'unknown').length;
  const configOk  = configChecks.filter(c => c.status === 'ok').length;
  const configErr = configChecks.filter(c => c.status === 'error').length;
  const diffMismatches = diffLines.filter(d => !d.match).length;
  const diffCritical   = diffLines.filter(d => !d.match && d.critical).length;

  const printerState = printerInfo?.state ?? 'disconnected';
  const stateColor   = printerState === 'ready' ? 'text-green-400'
    : printerState === 'error' || printerState === 'shutdown' ? 'text-red-400' : 'text-yellow-400';

  const errorLogs = gcodes.filter(g =>
    g.type === 'response' && (g.message.includes('Error') || g.message.includes('error') || g.message.includes('shutdown'))
  ).slice(0, 25);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Diagnostic Imprimante</h2>
        <p className="text-sm text-gray-400">
          Topologie CAN · Validation config chargée · Comparaison printer.cfg · Actions directes
        </p>
      </div>

      {/* ── Connexion ────────────────────────────────────────────────────────── */}
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
          <p className="text-xs text-gray-700 mt-1">L'app doit tourner sur le même réseau local que l'imprimante</p>
        </div>
      )}

      {connected && printerInfo && (
        <>
          {/* ── Status résumé ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'État Klipper',    value: printerState.toUpperCase(), color: stateColor, icon: Activity },
              { label: 'Version Klipper', value: printerInfo.klipper_version?.split('-')[0] ?? '—', color: 'text-gray-200', icon: Cpu },
              { label: 'Hostname',        value: printerInfo.hostname || ip, color: 'text-gray-200', icon: Wifi },
              { label: 'Checks',          value: `${okCount}✓  ${warnCount}⚠  ${errorCount}✗`,
                color: errorCount > 0 ? 'text-red-400' : warnCount > 0 ? 'text-yellow-400' : 'text-green-400',
                icon: CheckCircle2 },
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

          {/* ── Topologie CAN ──────────────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Network size={15} className="text-orange-400" />
              <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Topologie CAN Bus</h3>
            </div>
            <TopologyDiagram
              sysInfo={sysInfo}
              ebbOk={!!objects['mcu EBB42']?.mcu_version}
              cartoOk={!!(objects['mcu scanner'] ?? objects['mcu cartographer'])?.mcu_version}
              config={config}
            />
          </div>

          {/* ── Actions rapides ──────────────────────────────────────────── */}
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
                <button key={a.cmd} onClick={() => sendGcode(a.cmd)} disabled={sending !== null}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white font-medium transition-colors disabled:opacity-50 ${a.color}`}>
                  {sending === a.cmd ? <RefreshCw size={11} className="animate-spin" /> : <span>{a.icon}</span>}
                  {a.label}
                </button>
              ))}
            </div>
            <CustomGcodeInput onSend={sendGcode} disabled={sending !== null} />
          </div>

          {/* ── Températures ─────────────────────────────────────────────── */}
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

          {/* ── MCU & CAN Health ─────────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={15} className="text-orange-400" />
              <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">MCU & Santé CAN Bus</h3>
            </div>
            <div className="space-y-2">
              {([
                { label: 'MCU Principal (Octopus)',                                      key: 'mcu' as keyof PrinterObjects, stats: {} },
                { label: 'EBB42 v1.2 (CAN)',                                             key: 'mcu EBB42' as keyof PrinterObjects, stats: ebbStats },
                { label: `Cartographer (${objects['mcu scanner'] ? 'scanner' : 'cartographer'})`, key: cartoMcuKey, stats: cartoStats },
              ] as const).map(item => {
                const mcu = objects[item.key] as McuStatus | undefined;
                const present = !!mcu?.mcu_version;
                const s = item.stats as Record<string, number>;
                const retransmit = s.bytes_retransmit ?? 0;
                const badCrc = s.bad_crc ?? 0;
                const outOfOrder = s.out_of_order ?? 0;
                const hasErrors = retransmit > 0 || badCrc > 0 || outOfOrder > 0;
                return (
                  <div key={String(item.key)} className={`flex items-start gap-3 p-3 rounded-lg border ${
                    present ? (hasErrors ? 'border-yellow-800 bg-yellow-900/10' : 'border-green-800 bg-green-900/10') : 'border-gray-700 bg-gray-800/30'}`}>
                    {present ? (hasErrors
                      ? <AlertTriangle size={14} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                      : <CheckCircle2 size={14} className="text-green-400 flex-shrink-0 mt-0.5" />)
                      : <XCircle size={14} className="text-gray-600 flex-shrink-0 mt-0.5" />}
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm ${present ? 'text-gray-200' : 'text-gray-500'}`}>{item.label}</div>
                      {present && mcu?.mcu_version && <div className="text-xs text-gray-500 truncate">{mcu.mcu_version.split(' ')[0]}</div>}
                      {present && Object.keys(item.stats).length > 0 && (
                        <div className="flex flex-wrap gap-3 mt-1.5">
                          <CanStat label="Retransmit" val={retransmit} bad={retransmit > 0} />
                          <CanStat label="Bad CRC" val={badCrc} bad={badCrc > 0} />
                          <CanStat label="Out-of-order" val={outOfOrder} bad={outOfOrder > 0} />
                          {s.mcu_awake !== undefined && <CanStat label="MCU Awake" val={`${(s.mcu_awake * 100).toFixed(1)}%`} bad={false} />}
                        </div>
                      )}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded border flex-shrink-0 ${
                      present ? (hasErrors ? 'text-yellow-400 border-yellow-800' : 'text-green-400 border-green-800') : 'text-gray-600 border-gray-700'}`}>
                      {present ? (hasErrors ? 'Erreurs CAN' : 'OK') : 'Absent'}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-gray-600 mt-2">Retransmit / Bad CRC &gt; 0 → problème câblage CAN ou résistances 120Ω mal placées</p>
          </div>

          {/* ── Bed Mesh Analysis ────────────────────────────────────────── */}
          {meshAnalysis && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 size={15} className="text-orange-400" />
                <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Analyse Bed Mesh</h3>
                <span className={`ml-auto text-sm font-bold ${meshAnalysis.ratingColor}`}>{meshAnalysis.rating}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                {[
                  { label: 'Z min',      value: `${meshAnalysis.min.toFixed(3)} mm` },
                  { label: 'Z max',      value: `${meshAnalysis.max.toFixed(3)} mm` },
                  { label: 'Range (planéité)', value: `${meshAnalysis.range.toFixed(3)} mm`, hi: meshAnalysis.range > 0.6 },
                  { label: 'Écart-type σ', value: `${meshAnalysis.stddev.toFixed(4)} mm` },
                ].map(item => (
                  <div key={item.label} className={`rounded-lg border p-3 text-center ${item.hi ? 'border-orange-800 bg-orange-900/10' : 'border-gray-700 bg-gray-800/40'}`}>
                    <div className="text-xs text-gray-500 mb-1">{item.label}</div>
                    <div className={`text-sm font-bold ${item.hi ? 'text-orange-400' : 'text-gray-200'}`}>{item.value}</div>
                  </div>
                ))}
              </div>
              {meshAnalysis.range > 0.6 && (
                <p className="text-xs text-orange-400 mb-2">⚠ Planéité &gt; 0.6 mm — relancer Z_TILT_ADJUST puis BED_MESH_CALIBRATE</p>
              )}
              <MeshHeatmap matrix={objects.bed_mesh?.probed_matrix} />
            </div>
          )}

          {/* ── Validation config chargée ────────────────────────────────── */}
          {configChecks.length > 0 && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
              <button onClick={() => setShowConfigChecks(v => !v)}
                className="w-full flex items-center justify-between p-5 hover:bg-gray-800/30 transition-colors">
                <div className="flex items-center gap-2">
                  <Shield size={15} className="text-orange-400" />
                  <span className="text-xs font-bold text-gray-300 uppercase tracking-widest">
                    Config chargée — checks ({configOk}/{configChecks.filter(c => c.status !== 'unknown').length} OK)
                  </span>
                  {configErr > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-800">
                      {configErr} erreur{configErr > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {showConfigChecks ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
              </button>
              {showConfigChecks && (
                <div className="border-t border-gray-800 p-5 space-y-2">
                  <p className="text-xs text-gray-500 mb-3">Vérifie les paramètres du firmware actuellement en mémoire (pas le fichier sur disque).</p>
                  {configChecks.map((check, i) => <CheckRow key={i} check={check} onSend={sendGcode} sending={sending} />)}
                </div>
              )}
            </div>
          )}

          {/* ── Comparaison printer.cfg ──────────────────────────────────── */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
            <div className="flex items-center justify-between p-5">
              <div className="flex items-center gap-2">
                <GitCompare size={15} className="text-orange-400" />
                <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">
                  Comparaison printer.cfg
                </h3>
                {diffMismatches > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${diffCritical > 0 ? 'text-red-400 border-red-800 bg-red-900/30' : 'text-yellow-400 border-yellow-800 bg-yellow-900/30'}`}>
                    {diffMismatches} différence{diffMismatches > 1 ? 's' : ''}{diffCritical > 0 ? ` dont ${diffCritical} critique${diffCritical > 1 ? 's' : ''}` : ''}
                  </span>
                )}
                {actualCfg && diffMismatches === 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded border text-green-400 border-green-800 bg-green-900/20">✓ Configs identiques</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={fetchPrinterCfg} disabled={cfgLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-medium transition-colors">
                  {cfgLoading ? <RefreshCw size={11} className="animate-spin" /> : <HardDrive size={11} />}
                  {actualCfg ? 'Recharger' : 'Charger printer.cfg'}
                </button>
                {actualCfg && (
                  <button onClick={() => setShowDiff(d => !d)}
                    className="text-gray-500 hover:text-gray-300 transition-colors">
                    {showDiff ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                )}
              </div>
            </div>
            {cfgError && (
              <div className="border-t border-gray-800 px-5 pb-4">
                <p className="text-xs text-red-400">{cfgError}</p>
                <p className="text-xs text-gray-600 mt-1">URL essayée : {baseUrl}/server/files/config/printer.cfg</p>
              </div>
            )}
            {actualCfg && showDiff && (
              <div className="border-t border-gray-800 p-5">
                <p className="text-xs text-gray-500 mb-3">
                  Colonne "Attendu" = config générée par l'app avec vos réglages actuels.
                  Colonne "Réel" = ce que votre printer.cfg contient.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-800">
                        <th className="text-left py-2 pr-4 font-medium">Paramètre</th>
                        <th className="text-left py-2 pr-4 font-medium">Attendu (app)</th>
                        <th className="text-left py-2 pr-4 font-medium">Réel (printer.cfg)</th>
                        <th className="text-left py-2 font-medium">État</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {diffLines.map(d => (
                        <tr key={d.key} className={d.match ? '' : d.critical ? 'bg-red-900/10' : 'bg-yellow-900/10'}>
                          <td className="py-2 pr-4 font-mono text-gray-400">{d.label}</td>
                          <td className="py-2 pr-4 font-mono text-gray-200">{d.expected}</td>
                          <td className={`py-2 pr-4 font-mono ${d.match ? 'text-gray-200' : d.critical ? 'text-red-300' : 'text-yellow-300'}`}>
                            {d.actual}
                          </td>
                          <td className="py-2">
                            {d.match
                              ? <span className="text-green-400">✓</span>
                              : <span className={d.critical ? 'text-red-400 font-bold' : 'text-yellow-400'}>
                                  {d.critical ? '✗ CRITIQUE' : '≠'}
                                </span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {diffMismatches > 0 && (
                  <div className="mt-3 p-3 rounded-lg border border-orange-800 bg-orange-900/10">
                    <p className="text-xs text-orange-300 font-medium">
                      {diffCritical > 0
                        ? `⚠ ${diffCritical} paramètre${diffCritical > 1 ? 's' : ''} critique${diffCritical > 1 ? 's' : ''} différent${diffCritical > 1 ? 's' : ''} — l'onglet "printer.cfg" de l'app génère la version correcte.`
                        : `${diffMismatches} paramètre${diffMismatches > 1 ? 's' : ''} différent${diffMismatches > 1 ? 's' : ''} — non critique${diffMismatches > 1 ? 's' : ''}.`}
                    </p>
                  </div>
                )}
              </div>
            )}
            {!actualCfg && !cfgError && (
              <div className="border-t border-gray-800 px-5 pb-4 pt-2">
                <p className="text-xs text-gray-600">
                  Cliquer "Charger printer.cfg" pour comparer votre config réelle avec celle générée par l'app.
                </p>
              </div>
            )}
          </div>

          {/* ── Checks runtime ───────────────────────────────────────────── */}
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
              {runtimeChecks.map((check, i) => <CheckRow key={i} check={check} onSend={sendGcode} sending={sending} />)}
            </div>
          </div>

          {/* ── Ressources système ───────────────────────────────────────── */}
          {sysInfo && (sysInfo.cpu_usage !== undefined || sysInfo.mem_total !== undefined) && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
              <div className="flex items-center gap-2 mb-4">
                <HardDrive size={15} className="text-orange-400" />
                <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Ressources Raspberry Pi</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {sysInfo.cpu_usage !== undefined && <ResourceBar label="CPU" value={sysInfo.cpu_usage} warn={70} bad={90} />}
                {sysInfo.mem_total !== undefined && sysInfo.mem_available !== undefined && (
                  <ResourceBar
                    label="RAM"
                    value={((sysInfo.mem_total - sysInfo.mem_available) / sysInfo.mem_total) * 100}
                    warn={75} bad={90}
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

          {/* ── Print en cours ───────────────────────────────────────────── */}
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

          {/* ── Logs ─────────────────────────────────────────────────────── */}
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
                    <div key={i} className={`text-xs font-mono py-0.5 ${
                      entry.message.toLowerCase().includes('error') ? 'text-red-400' :
                      entry.message.includes('shutdown') ? 'text-red-300' :
                      entry.type === 'command' ? 'text-blue-400' : 'text-gray-400'}`}>
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

// ─── Topology Diagram ─────────────────────────────────────────────────────────

function TopologyDiagram({ sysInfo, ebbOk, cartoOk, config }: {
  sysInfo: SysInfo | null;
  ebbOk: boolean;
  cartoOk: boolean;
  config: PrinterConfig;
}) {
  const can0Up = sysInfo?.can0_up;
  const bitrate = sysInfo?.can0_bitrate;
  const u2cOk = sysInfo?.usb_u2c;
  const expectedBitrate = config.canSpeed;
  const bitrateOk = bitrate === undefined || bitrate === expectedBitrate;

  const NodeBox = ({ label, sub, ok, warn }: { label: string; sub?: string; ok?: boolean; warn?: boolean }) => (
    <div className={`rounded-lg border px-4 py-2 text-center min-w-[100px] ${
      ok === false ? 'border-red-800 bg-red-900/20' :
      warn ? 'border-yellow-800 bg-yellow-900/10' :
      ok === true ? 'border-green-800 bg-green-900/10' :
      'border-gray-700 bg-gray-800/30'}`}>
      <div className="text-xs font-medium text-gray-200">{label}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );

  const Arrow = ({ label, ok, warn }: { label?: string; ok?: boolean; warn?: boolean }) => (
    <div className="flex flex-col items-center justify-center px-1 min-w-[50px]">
      {label && <div className={`text-xs mb-0.5 font-medium ${ok === false ? 'text-red-400' : warn ? 'text-yellow-400' : ok ? 'text-green-400' : 'text-gray-500'}`}>{label}</div>}
      <div className={`text-lg ${ok === false ? 'text-red-400' : warn ? 'text-yellow-400' : ok ? 'text-green-400' : 'text-gray-600'}`}>→</div>
    </div>
  );

  const StatusDot = ({ ok }: { ok: boolean | undefined }) => (
    <div className={`w-2 h-2 rounded-full inline-block mr-1 ${ok === true ? 'bg-green-400' : ok === false ? 'bg-red-400' : 'bg-gray-500'}`} />
  );

  return (
    <div className="space-y-4">
      {/* Visual chain */}
      <div className="flex flex-wrap items-center gap-1 overflow-x-auto pb-2">
        <NodeBox label="🖥️ Raspberry Pi" sub="Klipper + Moonraker" ok={true} />
        <Arrow label="USB" ok={u2cOk === undefined ? undefined : u2cOk} />
        <NodeBox label="BTT U2C v2.1" sub={u2cOk === true ? 'Détecté' : u2cOk === false ? 'Non détecté' : '?'} ok={u2cOk} />
        <Arrow label={bitrate ? `CAN ${(bitrate / 1000).toFixed(0)}k` : 'CAN'} ok={can0Up === undefined ? undefined : (can0Up && bitrateOk)} warn={can0Up && !bitrateOk} />
        <div className="flex flex-col gap-1">
          <NodeBox label="EBB42 v1.2" sub={ebbOk ? 'Connecté ✓' : 'Absent ✗'} ok={ebbOk} />
          <NodeBox label="Cartographer" sub={cartoOk ? 'Connecté ✓' : 'Absent ✗'} ok={cartoOk} />
        </div>
      </div>

      {/* Detail table */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
        <div className="flex items-center gap-2 p-2 rounded border border-gray-800 bg-gray-800/30">
          <StatusDot ok={true} />
          <span className="text-gray-400">Raspberry Pi → Moonraker</span>
          <span className="text-green-400 ml-auto font-medium">OK</span>
        </div>
        <div className="flex items-center gap-2 p-2 rounded border border-gray-800 bg-gray-800/30">
          <StatusDot ok={u2cOk} />
          <span className="text-gray-400">USB → U2C v2.1</span>
          <span className={`ml-auto font-medium ${u2cOk === true ? 'text-green-400' : u2cOk === false ? 'text-red-400' : 'text-gray-500'}`}>
            {u2cOk === true ? 'Détecté' : u2cOk === false ? 'Non détecté' : 'Inconnu'}
          </span>
        </div>
        <div className="flex items-center gap-2 p-2 rounded border border-gray-800 bg-gray-800/30">
          <StatusDot ok={can0Up} />
          <span className="text-gray-400">Interface can0</span>
          <span className={`ml-auto font-medium ${can0Up ? 'text-green-400' : can0Up === false ? 'text-red-400' : 'text-gray-500'}`}>
            {can0Up ? 'Active' : can0Up === false ? 'Inactive' : 'Inconnue'}
          </span>
        </div>
        <div className={`flex items-center gap-2 p-2 rounded border ${!bitrateOk ? 'border-orange-800 bg-orange-900/10' : 'border-gray-800 bg-gray-800/30'}`}>
          <StatusDot ok={bitrate !== undefined ? bitrateOk : undefined} />
          <span className="text-gray-400">Vitesse CAN</span>
          <span className={`ml-auto font-medium ${!bitrateOk ? 'text-orange-400' : 'text-gray-300'}`}>
            {bitrate ? `${(bitrate / 1000).toFixed(0)} kbps` : '—'}
            {!bitrateOk && bitrate && ` (attendu: ${(expectedBitrate / 1000).toFixed(0)}k)`}
          </span>
        </div>
        <div className="flex items-center gap-2 p-2 rounded border border-gray-800 bg-gray-800/30">
          <StatusDot ok={ebbOk} />
          <span className="text-gray-400">CAN → EBB42 v1.2</span>
          <span className={`ml-auto font-medium ${ebbOk ? 'text-green-400' : 'text-red-400'}`}>{ebbOk ? 'Connecté' : 'Absent'}</span>
        </div>
        <div className="flex items-center gap-2 p-2 rounded border border-gray-800 bg-gray-800/30">
          <StatusDot ok={cartoOk} />
          <span className="text-gray-400">CAN → Cartographer</span>
          <span className={`ml-auto font-medium ${cartoOk ? 'text-green-400' : 'text-red-400'}`}>{cartoOk ? 'Connecté' : 'Absent'}</span>
        </div>
      </div>

      {!bitrateOk && bitrate && (
        <p className="text-xs text-orange-400">
          ⚠ Vitesse CAN ({(bitrate / 1000).toFixed(0)} kbps) ≠ config app ({(expectedBitrate / 1000).toFixed(0)} kbps) —
          corriger dans systemd-networkd ou dans l'onglet Matériel.
        </p>
      )}
      {can0Up === false && (
        <p className="text-xs text-red-400">
          ✗ Interface can0 absente — vérifier que le U2C est branché en USB et que
          /etc/systemd/network/can0.network est configuré.
        </p>
      )}
    </div>
  );
}

// ─── Mesh analysis ────────────────────────────────────────────────────────────

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
      check.status === 'ok'    ? 'border-green-800 bg-green-900/10' :
      check.status === 'warn'  ? 'border-yellow-800 bg-yellow-900/10' :
      check.status === 'error' ? 'border-red-800 bg-red-900/10' :
      check.status === 'info'  ? 'border-blue-800 bg-blue-900/10' :
      'border-gray-700 bg-gray-800/30'}`}>
      <div className="flex items-start gap-2">
        {check.status === 'ok'    ? <CheckCircle2  size={14} className="text-green-400 flex-shrink-0 mt-0.5" /> :
         check.status === 'warn'  ? <AlertTriangle size={14} className="text-yellow-400 flex-shrink-0 mt-0.5" /> :
         check.status === 'error' ? <XCircle       size={14} className="text-red-400 flex-shrink-0 mt-0.5" /> :
         check.status === 'info'  ? <Info          size={14} className="text-blue-400 flex-shrink-0 mt-0.5" /> :
                                    <Clock         size={14} className="text-gray-500 flex-shrink-0 mt-0.5" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-sm text-gray-200">{check.label}</span>
            <span className={`text-xs flex-shrink-0 ${
              check.status === 'ok'    ? 'text-green-400' :
              check.status === 'warn'  ? 'text-yellow-400' :
              check.status === 'error' ? 'text-red-400' : 'text-gray-500'}`}>
              {check.status.toUpperCase()}
            </span>
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

function ResourceBar({ label, value, warn, bad, extra }: {
  label: string; value: number; warn: number; bad: number; extra?: string;
}) {
  const color = value >= bad ? 'bg-red-500' : value >= warn ? 'bg-yellow-500' : 'bg-green-500';
  const textColor = value >= bad ? 'text-red-400' : value >= warn ? 'text-yellow-400' : 'text-gray-200';
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-gray-500">{label}</span>
        <span className={`text-xs font-bold ${textColor}`}>{value.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      {extra && <div className="text-xs text-gray-600 mt-1">{extra}</div>}
    </div>
  );
}

function MeshHeatmap({ matrix }: { matrix?: number[][] }) {
  if (!matrix?.length) return null;
  const flat = matrix.flat();
  const min = Math.min(...flat), max = Math.max(...flat), range = max - min || 1;
  return (
    <div className="mt-3 overflow-x-auto">
      <p className="text-xs text-gray-600 mb-1.5">Heatmap Z — bleu = bas, rouge = haut</p>
      <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: `repeat(${matrix[0].length}, 1fr)` }}>
        {matrix.map((row, ri) =>
          row.map((val, ci) => {
            const t = (val - min) / range;
            return (
              <div key={`${ri}-${ci}`} title={`${val.toFixed(3)} mm`}
                className="w-3 h-3 rounded-sm cursor-help"
                style={{ backgroundColor: `rgb(${Math.round(t * 220)},40,${Math.round((1 - t) * 220)})` }} />
            );
          })
        )}
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgb(0,40,220)' }} />
        <span className="text-xs text-gray-600">{min.toFixed(3)} mm</span>
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
        placeholder="GCode personnalisé (ex: PROBE_ACCURACY)"
        className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-orange-500 placeholder-gray-600" />
      <button onClick={send} disabled={disabled || !val.trim()}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-xs transition-colors">
        <Send size={11} /> Envoyer
      </button>
    </div>
  );
}
