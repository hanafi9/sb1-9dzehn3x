import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity, Wifi, WifiOff, RefreshCw, AlertTriangle, CheckCircle2,
  XCircle, Thermometer, Cpu, Zap, Clock, Terminal, Info,
  ChevronDown, ChevronUp, Play, HardDrive, BarChart3,
  Shield, Send, GitCompare, Network, Wrench,
} from 'lucide-react';
import type { PrinterConfig } from '../App';
import { generateConfig } from './ConfigGenerator';

// ─── Types Moonraker ───────────────────────────────────────────────────────────

interface PrinterInfo {
  state: string; state_message: string;
  hostname: string; klipper_version?: string; software_version?: string;
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
  // EBB42 peut s'appeler "EBB42" ou "toolhead" selon la config RatOS
  'mcu EBB42'?: McuStatus;
  'mcu toolhead'?: McuStatus;
  // U2C peut aussi être un MCU Klipper (RatOS style)
  'mcu u2c'?: McuStatus;
  'mcu scanner'?: McuStatus;
  'mcu cartographer'?: McuStatus;
  extruder?: TempSensor;
  heater_bed?: TempSensor;
  'temperature_sensor Chamber'?: TempSensor;
  'temperature_sensor EBB42'?: TempSensor;
  'temperature_sensor toolhead'?: TempSensor;
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

interface DiffLine { key: string; label: string; expected: string; actual: string; match: boolean; critical: boolean; resolvedSection?: string; }

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
  { section: 'mcu toolhead|mcu EBB42',  key: 'canbus_interface',  label: 'toolhead › canbus_interface',  critical: true  },
  { section: 'extruder',   key: 'rotation_distance',       label: 'extruder › rotation_distance',       critical: false },
  { section: 'extruder',   key: 'nozzle_diameter',         label: 'extruder › nozzle_diameter',         critical: false },
  { section: 'printer',    key: 'max_velocity',            label: 'printer › max_velocity',             critical: false },
  { section: 'printer',    key: 'max_accel',               label: 'printer › max_accel',                critical: false },
];

/** Égalité tolérante : "0.4" ≡ "0.400", "200, 200" ≡ "200,200" */
function cfgValuesEqual(a: string, b: string): boolean {
  if (a === b) return true;
  const na = parseFloat(a), nb = parseFloat(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && /^-?[\d.]+$/.test(a.trim()) && /^-?[\d.]+$/.test(b.trim())) {
    return na === nb;
  }
  // Listes de nombres ("200, 200") : comparer élément par élément
  const la = a.split(',').map(s => s.trim()), lb = b.split(',').map(s => s.trim());
  if (la.length === lb.length && la.length > 1) {
    return la.every((v, i) => cfgValuesEqual(v, lb[i]));
  }
  return false;
}

function diffConfigs(generated: string, actual: string): DiffLine[] {
  const gen = parseCfg(generated), act = parseCfg(actual);
  return COMPARE_KEYS.map(({ section, key, label, critical }) => {
    // Support fallback sections via "primary|fallback" notation
    const sections = section.split('|');
    const genSec = sections.find(s => gen[s]?.[key] !== undefined) ?? sections[0];
    const actSec = sections.find(s => act[s]?.[key] !== undefined) ?? sections[0];
    const expected = gen[genSec]?.[key] ?? '—';
    const actualVal = act[actSec]?.[key] ?? '(absent)';
    return {
      key: `${section}.${key}`, label,
      expected, actual: actualVal,
      match: cfgValuesEqual(expected, actualVal),
      critical,
      // Store resolved section names so applyFix targets the right section
      resolvedSection: actSec,
    };
  });
}

// ─── applyFix ─────────────────────────────────────────────────────────────────

/** Modifie cfgText pour mettre à jour (ou insérer) `key: newValue` dans [section]. */
function applyFix(cfgText: string, section: string, key: string, newValue: string): string {
  const lines = cfgText.split('\n');
  let inSection = false;
  let keyLineIdx   = -1;
  let sectionHeaderIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].split('#')[0].trim();
    if (!stripped) continue;

    const secMatch = stripped.match(/^\[(.+)\]$/);
    if (secMatch) {
      if (inSection) break;                              // on quitte la section trouvée
      if (secMatch[1].trim() === section) { inSection = true; sectionHeaderIdx = i; }
      continue;
    }

    if (inSection) {
      const kvMatch = stripped.match(/^([\w]+)\s*:/);
      if (kvMatch && kvMatch[1] === key) keyLineIdx = i;
    }
  }

  if (sectionHeaderIdx === -1) return cfgText;          // section absente — on laisse tel quel

  if (keyLineIdx !== -1) {
    const ws = lines[keyLineIdx].match(/^(\s*)/)?.[1] ?? '';
    lines[keyLineIdx] = `${ws}${key}: ${newValue}`;
  } else {
    // Clé absente → on l'insère juste après l'en-tête de section
    lines.splice(sectionHeaderIdx + 1, 0, `${key}: ${newValue}`);
  }
  return lines.join('\n');
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

// ─── UUID discovery ───────────────────────────────────────────────────────────

/** Extrait tous les UUID CAN (12 chars hex) d'une sortie Katapult / canbus_query */
function parseCanUuids(text: string): string[] {
  const found = new Set<string>();
  // Format Katapult: "Detected UUID: a5aa39f23456"
  // Format canbus_query: "Found canbus_uuid=a5aa39f23456"
  // Fallback: tout bloc de 12 chars hex
  for (const m of text.matchAll(/\b([0-9a-f]{12})\b/gi)) found.add(m[1].toLowerCase());
  return [...found];
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
  // Klipper n'atteint JAMAIS "ready" si un MCU configuré ne répond pas.
  // ready + section présente dans la config ⇒ carte connectée, même si
  // l'objet mcu n'est pas remonté par la requête d'états.
  const cfgSecs = objs.configfile?.config ?? {};
  const ready = ks === 'ready';
  const ebbMcuObj = [objs['mcu toolhead'], objs['mcu EBB42']].find(m => m?.mcu_version);
  const ebbConfigured = !!(cfgSecs['mcu toolhead'] ?? cfgSecs['mcu EBB42']);
  checks.push({ label: 'EBB42 / toolhead (CAN)',
    status: ebbMcuObj ? 'ok' : (ready && ebbConfigured) ? 'ok' : 'error',
    detail: ebbMcuObj?.mcu_version
      ? ebbMcuObj.mcu_version.split('-').slice(0, 2).join('-')
      : (ready && ebbConfigured)
        ? 'Connecté (Klipper ready — un MCU configuré absent bloquerait le démarrage)'
        : 'EBB42 introuvable sur le bus CAN',
    hint: !ebbMcuObj && !(ready && ebbConfigured) ? 'Vérifier canbus_uuid EBB42, alimentation 24V, câbles CAN, résistances 120Ω' : undefined });
  const carto = [objs['mcu scanner'], objs['mcu cartographer']].find(m => m?.mcu_version);
  const cartoConfigured = !!(cfgSecs['cartographer'] ?? cfgSecs['scanner']);
  checks.push({ label: 'Cartographer CAN',
    status: carto ? 'ok' : (ready && cartoConfigured) ? 'ok' : 'error',
    detail: carto?.mcu_version
      ? carto.mcu_version.split('-').slice(0, 2).join('-')
      : (ready && cartoConfigured)
        ? 'Connecté (Klipper ready — un MCU configuré absent bloquerait le démarrage)'
        : 'Cartographer introuvable sur le bus CAN',
    hint: !carto && !(ready && cartoConfigured) ? 'Vérifier canbus_uuid Cartographer, jumper 120Ω, alimentation 3.3V depuis EBB42' : undefined });
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
    { label: 'EBB42 / toolhead canbus_interface = can0',
      status: (c['mcu toolhead'] ?? c['mcu EBB42'])?.['canbus_interface'] === 'can0' ? 'ok' : (c['mcu toolhead'] ?? c['mcu EBB42'])?.['canbus_interface'] ? 'warn' : 'unknown',
      detail: (c['mcu toolhead'] ?? c['mcu EBB42'])?.['canbus_interface'] === 'can0' ? '✓ Interface CAN correcte' : `Actuel : ${(c['mcu toolhead'] ?? c['mcu EBB42'])?.['canbus_interface'] ?? 'non trouvé'}` },
    { label: 'Input Shaper configuré',
      status: c['input_shaper']?.['shaper_freq_x'] ? 'ok' : 'warn',
      detail: c['input_shaper']?.['shaper_freq_x']
        ? `X: ${c['input_shaper']['shaper_freq_x']} Hz — Y: ${c['input_shaper']['shaper_freq_y'] ?? '?'} Hz`
        : 'Non configuré — SHAPER_CALIBRATE recommandé',
      hint: !c['input_shaper']?.['shaper_freq_x'] ? 'Lancer SHAPER_CALIBRATE avec ADXL345 sur EBB42' : undefined },
  ];
}

// ─── Config Problem Analysis ──────────────────────────────────────────────────

interface ConfigProblem {
  id: string;
  severity: 'error' | 'warn' | 'info';
  title: string;
  detail: string;
  hint?: string;
  sshCmds?: string[];
  autoFix?: (cfgText: string) => string;
  autoFixLabel?: string;
}

/** Remove duplicate [gcode_macro NAME] sections — keeps first occurrence */
function removeDuplicateMacros(cfgText: string): string {
  const lines = cfgText.split('\n');
  const seenMacros = new Set<string>();
  const result: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const stripped = line.trim();
    const secMatch = stripped.match(/^\[(.+)\]$/);
    if (secMatch) {
      const sName = secMatch[1].trim();
      if (sName.toLowerCase().startsWith('gcode_macro ')) {
        const macroName = sName.toLowerCase().slice('gcode_macro '.length).trim();
        if (seenMacros.has(macroName)) { skipping = true; continue; }
        seenMacros.add(macroName);
        skipping = false;
      } else { skipping = false; }
    }
    if (!skipping) result.push(line);
  }
  return result.join('\n');
}

/** Comment out the [beacon] section entirely */
function commentBeaconSection(cfgText: string): string {
  const lines = cfgText.split('\n');
  const result: string[] = [];
  let inBeacon = false;

  for (const line of lines) {
    const stripped = line.trim();
    if (stripped.match(/^\[beacon\]$/i)) {
      inBeacon = true;
      result.push(`# ${line}  # Désactivé — conflit avec [cartographer]`);
      continue;
    }
    if (inBeacon && stripped.match(/^\[.+\]$/)) inBeacon = false;
    result.push(inBeacon ? `# ${line}` : line);
  }
  return result.join('\n');
}

/** Analyze raw printer.cfg text for common problems */
function analyzeConfigProblems(cfgText: string): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const lines = cfgText.split('\n');

  // ── 1. Duplicate [gcode_macro NAME] sections ──────────────────────────────
  const macroCounts: Record<string, number[]> = {};
  lines.forEach((line, i) => {
    const m = line.trim().match(/^\[gcode_macro\s+(\S+)\]/i);
    if (m) {
      const name = m[1].toLowerCase();
      (macroCounts[name] = macroCounts[name] ?? []).push(i + 1);
    }
  });
  const dups = Object.entries(macroCounts).filter(([, ls]) => ls.length > 1);
  if (dups.length > 0) {
    problems.push({
      id: 'duplicate_macros',
      severity: 'error',
      title: `${dups.length} macro${dups.length > 1 ? 's' : ''} GCode dupliquée${dups.length > 1 ? 's' : ''} — Klipper refusera de démarrer`,
      detail: dups.map(([n, ls]) => `• [gcode_macro ${n.toUpperCase()}] × ${ls.length}  (lignes ${ls.join(', ')})`).join('\n'),
      hint: 'Klipper refuse deux sections avec le même nom. Supprimer les doublons en gardant la première occurrence.',
      autoFix: removeDuplicateMacros,
      autoFixLabel: `Supprimer ${dups.length} doublon${dups.length > 1 ? 's' : ''} (garder le premier)`,
    });
  }

  // ── 2. Deux sondes Z chargées en même temps ───────────────────────────────
  const hasBeaconSec  = lines.some(l => l.trim().match(/^\[beacon\]$/i));
  const hasCartoSec   = lines.some(l => l.trim().match(/^\[cartographer\]$/i));
  const zProbeInclude = lines.find(l => l.trim().match(/^\[include\s+RatOS\/z-probe\//i));
  if (hasBeaconSec && hasCartoSec) {
    problems.push({
      id: 'probe_conflict',
      severity: 'error',
      title: 'Deux sondes Z déclarées — [beacon] et [cartographer]',
      detail: "Les sections [beacon] et [cartographer] sont actives simultanément.\n" +
        "Les deux veulent être la sonde Z de la machine : Klipper ne peut pas trancher.",
      hint: "Garder une seule des deux. Avec un Cartographer monté, commenter [beacon].",
      autoFix: commentBeaconSection,
      autoFixLabel: 'Commenter [beacon] (garder [cartographer])',
    });
  }
  if (hasCartoSec && zProbeInclude) {
    problems.push({
      id: 'zprobe_include_conflict',
      severity: 'error',
      title: 'Un [include RatOS/z-probe/…] cohabite avec [cartographer]',
      detail: `Ligne trouvée :\n  ${zProbeInclude.trim()}\n\n` +
        "RatOS v2.1 ne fournit pas de z-probe/cartographer.cfg — cet include charge donc une AUTRE sonde,\n" +
        "qui entre en concurrence avec ta section [cartographer].",
      hint: "Commenter cette ligne d'include si le Cartographer est ta sonde Z.",
      sshCmds: ["grep -n 'z-probe' ~/printer_data/config/printer.cfg"],
    });
  }

  // ── 3. [mcu u2c] déclaré alors que RatOS ne connaît pas cette carte ───────
  const hasActiveU2c = lines.some(l => l.trim().match(/^\[mcu\s+u2c\]/i));
  if (hasActiveU2c) {
    problems.push({
      id: 'u2c_declared',
      severity: 'warn',
      title: '[mcu u2c] déclaré — inutile et fragile sous RatOS',
      detail: "Le BTT U2C est un pont USB↔CAN : il fait apparaître l'interface réseau can0 sous Linux.\n" +
        "RatOS ne définit aucune carte U2C, car ce n'est pas un microcontrôleur Klipper dans son modèle.\n" +
        "Le déclarer en [mcu] ajoute un nœud qui doit répondre au démarrage — donc un point de panne\n" +
        "supplémentaire, sans rien piloter (ni moteur, ni chauffe, ni capteur).",
      hint: "Commenter la section [mcu u2c] : can0 continuera de fonctionner exactement pareil.",
      sshCmds: ["grep -n 'u2c' ~/printer_data/config/printer.cfg"],
    });
  }

  return problems;
}

// ─── Flash helpers ────────────────────────────────────────────────────────────

function CmdLine({ cmd }: { cmd: string }) {
  return (
    <div className="flex items-start gap-2 my-1">
      <code className="flex-1 text-orange-300 font-mono bg-gray-800/80 px-2 py-1.5 rounded text-xs break-all leading-relaxed">{cmd}</code>
      <button onClick={() => navigator.clipboard?.writeText(cmd)} title="Copier"
        className="flex-shrink-0 text-gray-500 hover:text-gray-200 px-2 py-1.5 rounded border border-gray-700 hover:border-gray-500 transition-colors text-xs">
        📋
      </button>
    </div>
  );
}

function FlashStep({ n, title, warn, children }: { n: number; title: string; warn?: boolean; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border overflow-hidden ${warn ? 'border-yellow-800/60' : 'border-gray-700'}`}>
      <div className={`px-3 py-2 flex items-center gap-2.5 ${warn ? 'bg-yellow-900/20' : 'bg-gray-800/50'}`}>
        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${warn ? 'bg-yellow-700' : 'bg-orange-700'}`}>{n}</span>
        <span className="text-xs font-semibold text-gray-200">{title}</span>
        {warn && <span className="ml-auto text-xs text-yellow-600">⚠ Critique</span>}
      </div>
      <div className="px-3 py-3 text-xs space-y-1.5 text-gray-300">{children}</div>
    </div>
  );
}

function MenuconfigHint({ lines }: { lines: string[] }) {
  return (
    <div className="bg-gray-900 rounded-lg p-3 border border-gray-700 font-mono text-xs space-y-0.5">
      {lines.map((l, i) => (
        <div key={i} className={l.startsWith('  ') ? 'text-orange-300' : l.startsWith('#') ? 'text-gray-500 italic' : 'text-gray-400'}>{l}</div>
      ))}
    </div>
  );
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

export function PrinterDiagnostic({ config, onChange }: { config: PrinterConfig; onChange?: (p: Partial<PrinterConfig>) => void }) {
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

  // Config apply / save
  const [modifiedCfg, setModifiedCfg] = useState<string | null>(null);
  const [saveStatus, setSaveStatus]   = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');
  const [saveMsg, setSaveMsg]         = useState<string | null>(null);

  // UUID discovery
  const [uuidInput, setUuidInput]     = useState('');
  const [foundUuids, setFoundUuids]   = useState<string[]>([]);

  // Flash tools
  const [showFlashTools, setShowFlashTools] = useState(false);
  const [flashDevice, setFlashDevice] = useState<'ebb42' | 'carto'>('ebb42');
  const [flashMethod, setFlashMethod] = useState<'can' | 'usb'>('can');

  // Auto-fetch printer.cfg once on connection
  const hasFetchedCfg = useRef(false);

  // CAN error-rate tracking
  const prevEbbRetransmit  = useRef(0);
  const prevCartoRetransmit = useRef(0);
  const lastFetchTs         = useRef(0);
  const [ebbErrorRate, setEbbErrorRate]     = useState<number | null>(null);
  const [cartoErrorRate, setCartoErrorRate] = useState<number | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const baseUrl = `http://${ip}:${port}`;

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const infoRes = await fetch(`${baseUrl}/printer/info`, { signal: AbortSignal.timeout(5000) });
      if (!infoRes.ok) throw new Error(`HTTP ${infoRes.status}`);
      const info: PrinterInfo = (await infoRes.json()).result;

      const objKeys = [
        'mcu', 'mcu EBB42', 'mcu toolhead', 'mcu u2c',
        'mcu scanner', 'mcu cartographer',
        'extruder', 'heater_bed',
        'temperature_sensor Chamber',
        'temperature_sensor EBB42', 'temperature_sensor toolhead',
        'temperature_sensor Octopus',
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

      // CAN error rates (delta between polls)
      const now = Date.now();
      const dt  = lastFetchTs.current ? (now - lastFetchTs.current) / 60000 : 0; // minutes
      const ebbSt   = parseMcuStats(((objData['mcu EBB42'] ?? objData['mcu toolhead']) as McuStatus | undefined)?.last_stats);
      const cartoSt = parseMcuStats(((objData['mcu scanner'] ?? objData['mcu cartographer']) as McuStatus | undefined)?.last_stats);
      if (dt > 0) {
        const ebbDelta  = (ebbSt.bytes_retransmit ?? 0)  - prevEbbRetransmit.current;
        const cartoDelta = (cartoSt.bytes_retransmit ?? 0) - prevCartoRetransmit.current;
        setEbbErrorRate(Math.max(0, ebbDelta)  / dt);
        setCartoErrorRate(Math.max(0, cartoDelta) / dt);
      }
      prevEbbRetransmit.current  = ebbSt.bytes_retransmit  ?? 0;
      prevCartoRetransmit.current = cartoSt.bytes_retransmit ?? 0;
      lastFetchTs.current = now;

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

  // Auto-charger printer.cfg dès la première connexion (pour l'analyse de problèmes)
  useEffect(() => {
    if (connected && !hasFetchedCfg.current) {
      hasFetchedCfg.current = true;
      fetchPrinterCfg();
    }
    if (!connected) hasFetchedCfg.current = false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

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
      const res = await fetch(`${baseUrl}/server/files/config/printer.cfg`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setActualCfg(text);
      setModifiedCfg(text);   // réinitialise les modifications en attente
      setSaveStatus('idle'); setSaveMsg(null);
      setShowDiff(true);
    } catch (e: unknown) {
      setCfgError(`Impossible de lire printer.cfg : ${e instanceof Error ? e.message : String(e)}`);
    } finally { setCfgLoading(false); }
  };

  /** Applique une correction unitaire sur modifiedCfg (ou actualCfg si modifiedCfg est null). */
  const applyOneFix = (diff: DiffLine) => {
    const base = modifiedCfg ?? actualCfg;
    if (!base) return;
    const dotIdx = diff.key.indexOf('.');
    // Use resolvedSection if present (handles "mcu toolhead|mcu EBB42" fallback sections)
    const sec = diff.resolvedSection ?? diff.key.slice(0, dotIdx);
    const k   = diff.key.slice(dotIdx + 1);
    setModifiedCfg(applyFix(base, sec, k, diff.expected));
    setSaveStatus('idle'); setSaveMsg(null);
  };

  /** Applique toutes les corrections critiques en une passe. */
  const applyAllCriticalFixes = () => {
    let text = modifiedCfg ?? actualCfg;
    if (!text) return;
    for (const diff of diffLines) {
      if (!diff.match && diff.critical) {
        const dotIdx = diff.key.indexOf('.');
        const sec = diff.resolvedSection ?? diff.key.slice(0, dotIdx);
        text = applyFix(text, sec, diff.key.slice(dotIdx + 1), diff.expected);
      }
    }
    setModifiedCfg(text);
    setSaveStatus('idle'); setSaveMsg(null);
  };

  /** Envoie modifiedCfg vers Moonraker (POST /server/files/upload). */
  const saveCfg = async () => {
    if (!modifiedCfg) return;
    setSaveStatus('saving'); setSaveMsg(null);
    try {
      const blob = new Blob([modifiedCfg], { type: 'text/plain' });
      const fd = new FormData();
      fd.append('root', 'config');
      fd.append('path', '');
      fd.append('file', blob, 'printer.cfg');
      const res = await fetch(`${baseUrl}/server/files/upload`, {
        method: 'POST', body: fd, signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveStatus('ok');
      setSaveMsg('✓ printer.cfg sauvegardé — lancez FIRMWARE_RESTART pour appliquer');
      setActualCfg(modifiedCfg);    // la base de référence devient le fichier sauvegardé
    } catch (e: unknown) {
      setSaveStatus('error');
      setSaveMsg(`✗ Erreur lors de la sauvegarde : ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // ─── Derived ─────────────────────────────────────────────────────────────────

  const runtimeChecks  = printerInfo ? buildRuntimeChecks(printerInfo, objects, gcodes) : [];
  const configChecks   = objects.configfile ? buildConfigChecks(objects.configfile) : [];
  const meshAnalysis   = analyzeMesh(objects.bed_mesh?.probed_matrix);
  const generatedCfg   = generateConfig(config);
  const diffLines      = (modifiedCfg ?? actualCfg) ? diffConfigs(generatedCfg, modifiedCfg ?? actualCfg!) : [];

  // Résoudre le MCU toolhead (peut s'appeler "EBB42" ou "toolhead" selon RatOS).
  // On préfère l'instance qui expose réellement des données ("alive-first")
  // pour éviter qu'une clé vide masque la bonne via ??.
  const klipperReady = (objects.webhooks?.state ?? printerInfo?.state) === 'ready';
  const cfgSections  = objects.configfile?.config ?? {};
  const ebbMcu = [objects['mcu toolhead'], objects['mcu EBB42']].find(m => m?.mcu_version)
    ?? objects['mcu toolhead'] ?? objects['mcu EBB42'];
  const ebbConnected = !!ebbMcu?.mcu_version
    || (klipperReady && !!(cfgSections['mcu toolhead'] ?? cfgSections['mcu EBB42']));
  const ebbTempSensor = [objects['temperature_sensor toolhead'], objects['temperature_sensor EBB42']]
    .find(s => s?.temperature !== undefined);
  const ebbStats   = parseMcuStats(ebbMcu?.last_stats);
  const cartoMcuObj = [objects['mcu scanner'], objects['mcu cartographer']]
    .find(m => (m as McuStatus | undefined)?.mcu_version) as McuStatus | undefined;
  const cartoConnected = !!cartoMcuObj?.mcu_version
    || (klipperReady && !!(cfgSections['cartographer'] ?? cfgSections['scanner']));
  const cartoStats = parseMcuStats(cartoMcuObj?.last_stats);
  // UUID réellement chargés par Klipper (pour affichage quand l'app n'est pas configurée)
  const cfgUuidEbb   = (cfgSections['mcu toolhead'] ?? cfgSections['mcu EBB42'])?.['canbus_uuid'];
  const cfgUuidCarto = cfgSections['cartographer']?.['canbus_uuid'];

  const okCount     = runtimeChecks.filter(c => c.status === 'ok').length;
  const warnCount   = runtimeChecks.filter(c => c.status === 'warn').length;
  const errorCount  = runtimeChecks.filter(c => c.status === 'error').length;
  const totalChecks = runtimeChecks.filter(c => c.status !== 'unknown').length;
  const configOk    = configChecks.filter(c => c.status === 'ok').length;
  const configErr   = configChecks.filter(c => c.status === 'error').length;
  const diffMismatches = diffLines.filter(d => !d.match).length;
  const diffCritical   = diffLines.filter(d => !d.match && d.critical).length;

  // Analyse des problèmes config + message d'erreur Klipper courant
  const cfgForAnalysis = modifiedCfg ?? actualCfg;
  const configProblems = cfgForAnalysis ? analyzeConfigProblems(cfgForAnalysis) : [];
  const klipperErrorMsg = objects.webhooks?.state_message ?? printerInfo?.state_message ?? '';
  // Détection de patterns d'erreur connus
  const errorHints = (() => {
    const hints: Array<{ id: string; title: string; detail: string; sshCmds?: string[] }> = [];
    if (klipperErrorMsg.includes("Can't register") && klipperErrorMsg.includes('invalid name')) {
      hints.push({
        id: 'klipper_register_invalid',
        title: "Bug du plugin Cartographer — commande « probe » en minuscules",
        detail: `Klipper refuse de démarrer :\n  "${klipperErrorMsg.slice(0, 200)}"\n\n` +
          "CAUSE EXACTE — ce n'est pas ta configuration.\n\n" +
          "Dans cartographer.py, classe CartographerProbe :\n" +
          '    self.gcode.register_command("probe", self.cmd_PROBE, ...)\n' +
          "                                 ^^^^^ minuscules\n\n" +
          "Dans klippy/gcode.py, register_command() :\n" +
          "    if (cmd.upper() != cmd or not cmd.replace('_', 'A').isalnum()\n" +
          "        or cmd[0].isdigit() or cmd[1:2].isdigit()):\n" +
          '        raise config_error("Can\'t register \'%s\' as it is an invalid name")\n\n' +
          "Klipper exige des commandes en MAJUSCULES. Toutes les autres commandes du plugin\n" +
          "respectent la règle (CARTOGRAPHER_QUERY, PROBE_ACCURACY, Z_OFFSET_APPLY_PROBE) —\n" +
          "seule celle-ci porte la coquille.\n\n" +
          "Pourquoi maintenant : RatOS met Klipper à jour automatiquement, le plugin non.\n" +
          "La validation côté Klipper a fini par rattraper le plugin.\n\n" +
          "CORRECTIF — remplacer \"probe\" par \"PROBE\" dans le fichier du plugin, puis\n" +
          "redémarrer Klipper. À refaire si le plugin se met à jour en écrasant le patch.",
        sshCmds: [
          'grep -rn \'register_command("probe"\' ~/cartographer-klipper/ ~/klipper/klippy/extras/',
          'cp ~/cartographer-klipper/cartographer.py ~/cartographer.py.bak',
          "sed -i 's/register_command(\"probe\"/register_command(\"PROBE\"/' ~/cartographer-klipper/cartographer.py",
          'grep -n \'register_command("PROBE"\' ~/cartographer-klipper/cartographer.py',
          'sudo systemctl restart klipper',
        ],
      });
    }
    if (klipperErrorMsg.includes('mcu') && klipperErrorMsg.includes('Unable to connect')) {
      const mcuMatch = klipperErrorMsg.match(/mcu '([^']+)'/);
      const mcuName = mcuMatch?.[1] ?? 'inconnu';
      hints.push({
        id: 'klipper_mcu_connect',
        title: `MCU '${mcuName}' ne répond pas`,
        detail: `Klipper ne peut pas joindre le MCU '${mcuName}' sur le bus CAN.\n\n` +
          "Vérifications :\n" +
          "  1. Interface can0 active : ip link show can0 (doit afficher UP)\n" +
          "  2. UUID correct dans printer.cfg\n" +
          "  3. Appareil alimenté et câble CAN branché\n" +
          "  4. Si BUS-OFF : sudo ip link set can0 down && sudo ip link set can0 up type can bitrate 1000000 restart-ms 100",
        sshCmds: [
          "ip -details link show can0",
          "sudo systemctl stop klipper && ~/klippy-env/bin/python ~/klipper/scripts/canbus_query.py can0",
        ],
      });
    }
    return hints;
  })();

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
              { label: 'Klipper',         value: (printerInfo.software_version ?? printerInfo.klipper_version)?.split('-').slice(0, 2).join('-') ?? '—', color: 'text-gray-200', icon: Cpu },
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

          {/* ── Erreurs Klipper & Problèmes Config ──────────────────────────── */}
          {(errorHints.length > 0 || configProblems.length > 0) && (
            <div className="rounded-xl border border-red-900/60 bg-red-950/20 overflow-hidden">
              <div className="flex items-center gap-2 px-5 pt-4 pb-3">
                <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
                <h3 className="text-sm font-bold text-red-300">
                  {errorHints.length + configProblems.filter(p => p.severity === 'error').length > 0
                    ? `${errorHints.length + configProblems.filter(p => p.severity === 'error').length} problème${errorHints.length + configProblems.filter(p => p.severity === 'error').length > 1 ? 's' : ''} critique${errorHints.length + configProblems.filter(p => p.severity === 'error').length > 1 ? 's' : ''} détecté${errorHints.length + configProblems.filter(p => p.severity === 'error').length > 1 ? 's' : ''}`
                    : 'Avertissements config détectés'
                  }
                </h3>
                {!cfgForAnalysis && (
                  <span className="ml-auto text-xs text-gray-600">Charger printer.cfg pour analyse complète</span>
                )}
              </div>
              <div className="border-t border-red-900/40 px-5 py-4 space-y-4">

                {/* Erreurs runtime Klipper */}
                {errorHints.map(hint => (
                  <div key={hint.id} className="rounded-lg border border-red-800 bg-red-900/10 p-4">
                    <div className="flex items-start gap-3">
                      <XCircle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-red-200 mb-2">{hint.title}</div>
                        <pre className="text-xs text-gray-400 whitespace-pre-wrap font-mono leading-relaxed mb-3">{hint.detail}</pre>
                        {hint.sshCmds && hint.sshCmds.length > 0 && (
                          <div>
                            <div className="text-xs text-gray-500 mb-1.5">Commandes SSH pour diagnostiquer :</div>
                            {hint.sshCmds.map(cmd => <CmdLine key={cmd} cmd={cmd} />)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {/* Problèmes dans printer.cfg */}
                {configProblems.map(problem => (
                  <div key={problem.id} className={`rounded-lg border p-4 ${
                    problem.severity === 'error' ? 'border-red-800 bg-red-900/10'
                    : problem.severity === 'warn' ? 'border-yellow-800 bg-yellow-900/10'
                    : 'border-blue-800 bg-blue-900/10'
                  }`}>
                    <div className="flex items-start gap-3">
                      {problem.severity === 'error'
                        ? <XCircle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
                        : problem.severity === 'warn'
                        ? <AlertTriangle size={15} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                        : <Info size={15} className="text-blue-400 flex-shrink-0 mt-0.5" />}
                      <div className="flex-1 min-w-0">
                        <div className={`font-semibold text-sm mb-2 ${problem.severity === 'error' ? 'text-red-200' : problem.severity === 'warn' ? 'text-yellow-200' : 'text-blue-200'}`}>
                          {problem.title}
                        </div>
                        <pre className="text-xs text-gray-400 whitespace-pre-wrap font-mono leading-relaxed mb-2">{problem.detail}</pre>
                        {problem.hint && <p className="text-xs text-gray-500 italic mb-2">→ {problem.hint}</p>}
                        {problem.sshCmds && problem.sshCmds.length > 0 && (
                          <div className="mb-3">
                            <div className="text-xs text-gray-500 mb-1.5">Commandes SSH :</div>
                            {problem.sshCmds.map(cmd => <CmdLine key={cmd} cmd={cmd} />)}
                          </div>
                        )}
                        {problem.autoFix && cfgForAnalysis && (
                          <button
                            onClick={() => {
                              const fixed = problem.autoFix!(cfgForAnalysis);
                              setModifiedCfg(fixed);
                              setSaveStatus('idle'); setSaveMsg(null);
                            }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-medium transition-colors ${
                              problem.severity === 'error'
                                ? 'bg-red-700 hover:bg-red-600'
                                : 'bg-yellow-700 hover:bg-yellow-600'
                            }`}>
                            ⚡ {problem.autoFixLabel}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {/* Save + restart reminder */}
                {configProblems.some(p => p.autoFix) && (
                  <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-gray-800">
                    {modifiedCfg && modifiedCfg !== actualCfg && (
                      <button onClick={saveCfg} disabled={saveStatus === 'saving'}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs font-medium transition-colors">
                        {saveStatus === 'saving' ? <RefreshCw size={11} className="animate-spin" /> : <HardDrive size={11} />}
                        {saveStatus === 'saving' ? 'Sauvegarde…' : 'Sauvegarder printer.cfg'}
                      </button>
                    )}
                    {saveMsg && (
                      <span className={`text-xs px-2 py-1 rounded ${saveStatus === 'ok' ? 'text-green-400 bg-green-900/30' : 'text-red-400 bg-red-900/30'}`}>{saveMsg}</span>
                    )}
                    <p className="text-xs text-gray-600">Après sauvegarde → <code className="bg-gray-800 px-1 rounded">FIRMWARE_RESTART</code> dans "Actions rapides"</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Topologie CAN ───────────────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Network size={15} className="text-orange-400" />
              <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Topologie CAN Bus</h3>
            </div>
            <TopologyDiagram sysInfo={sysInfo} ebbOk={ebbConnected}
              cartoOk={cartoConnected} config={config} />
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
                      <div className="mb-2">
                        ⚠ L'imprimante tourne à <strong>{(sysInfo.can0_bitrate / 1000).toFixed(0)}k</strong>,
                        l'app est réglée sur <strong>{(config.canSpeed / 1000).toFixed(0)}k</strong>.
                      </div>
                      <p className="text-gray-400 mb-2.5">
                        C'est la valeur réelle de can0 qui fait foi. Si {(sysInfo.can0_bitrate / 1000).toFixed(0)}k est
                        bien ce que tu veux, aligne l'app — sinon corrige BitRate dans
                        <code className="bg-gray-800 px-1 rounded mx-1">/etc/systemd/network/can0.network</code>
                        puis reflashe les cartes CAN à la même vitesse.
                      </p>
                      {onChange && (sysInfo.can0_bitrate === 500000 || sysInfo.can0_bitrate === 1000000) && (
                        <button
                          onClick={() => onChange({ canSpeed: sysInfo.can0_bitrate as PrinterConfig['canSpeed'] })}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-700 hover:bg-orange-600 text-white text-xs font-medium transition-colors">
                          ⚡ Aligner l'app sur {(sysInfo.can0_bitrate / 1000).toFixed(0)}k (valeur détectée)
                        </button>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <TestBtn id="u2c_ping" label="Vérifier connectivité CAN" icon="📡" waitMs={2000} runningTest={runningTest}
                      onRun={() => runAndCapture('u2c_ping', 'STATUS', 2000)} />
                  </div>
                  <TestOutput result={testResults['u2c_ping']} />
                </DeviceSection>

                {/* ─ Découverte UUID CAN ──────────────────────────────────── */}
                <DeviceSection title="🔍 Découverte UUID CAN" subtitle="Identifier les canbus_uuid de l'EBB42 et du Cartographer">
                  {/* UUID actuellement configurés */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                    {[
                      { label: 'UUID EBB42 (app)', value: config.ebb42Uuid, key: 'ebb42Uuid' as const },
                      { label: 'UUID Cartographer (app)', value: config.cartographerUuid, key: 'cartographerUuid' as const },
                    ].map(item => (
                      <div key={item.key} className={`p-3 rounded-lg border text-xs ${item.value ? 'border-green-800 bg-green-900/10' : 'border-red-800 bg-red-900/10'}`}>
                        <div className="text-gray-500 mb-1">{item.label}</div>
                        <code className={`font-mono text-sm ${item.value ? 'text-green-400' : 'text-red-400'}`}>
                          {item.value || '⚠ non configuré'}
                        </code>
                      </div>
                    ))}
                  </div>

                  {/* Commandes SSH */}
                  <div className="p-3 rounded-lg border border-gray-700 bg-gray-900/60 mb-4 text-xs">
                    <div className="text-gray-400 mb-2 font-medium">Exécutez sur le Raspberry Pi (SSH) :</div>
                    {[
                      'python3 ~/katapult/scripts/flashtool.py -i can0 -q',
                      'python3 ~/klipper/scripts/canbus_query.py can0',
                    ].map(cmd => (
                      <div key={cmd} className="flex items-center gap-2 mb-1.5">
                        <code className="flex-1 text-orange-300 font-mono bg-gray-800 px-2 py-1.5 rounded text-xs">{cmd}</code>
                        <button onClick={() => navigator.clipboard?.writeText(cmd)}
                          title="Copier"
                          className="text-gray-500 hover:text-gray-200 px-2 py-1.5 rounded border border-gray-700 hover:border-gray-500 transition-colors text-xs">
                          📋
                        </button>
                      </div>
                    ))}
                    <div className="text-gray-600 mt-2">
                      Si can0 est inactif : <code className="text-gray-400 bg-gray-800 px-1 rounded">ip link show can0</code> doit afficher "UP" et le bitrate {config.canSpeed / 1000}k
                    </div>
                  </div>

                  {/* Zone de collage */}
                  <div className="mb-3">
                    <label className="text-xs text-gray-400 mb-1 block">Collez le résultat ici :</label>
                    <textarea
                      value={uuidInput}
                      onChange={e => { setUuidInput(e.target.value); setFoundUuids([]); }}
                      rows={5}
                      placeholder={"Detected UUID: a5aa39f23456, Application: Klipper\nDetected UUID: b4bb48d34567, Application: Katapult"}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 font-mono focus:outline-none focus:border-orange-500 resize-none"
                    />
                    <button onClick={() => setFoundUuids(parseCanUuids(uuidInput))} disabled={!uuidInput.trim()}
                      className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-700 hover:bg-orange-600 disabled:opacity-40 text-white text-xs font-medium transition-colors">
                      🔍 Analyser les UUIDs
                    </button>
                  </div>

                  {/* Résultats */}
                  {foundUuids.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs text-gray-400 font-medium">{foundUuids.length} UUID{foundUuids.length > 1 ? 's' : ''} trouvé{foundUuids.length > 1 ? 's' : ''} :</div>
                      {foundUuids.map((uuid, i) => (
                        <div key={uuid} className="flex flex-wrap items-center gap-2 p-2 rounded-lg border border-gray-700 bg-gray-800/40">
                          <span className="text-xs text-gray-500 w-4">{i + 1}.</span>
                          <code className="text-sm font-mono text-orange-300 flex-1">{uuid}</code>
                          {onChange && (
                            <>
                              <button onClick={() => onChange({ ebb42Uuid: uuid })}
                                className="text-xs px-2 py-1 rounded bg-blue-800 hover:bg-blue-700 text-white transition-colors">
                                → EBB42
                              </button>
                              <button onClick={() => onChange({ cartographerUuid: uuid })}
                                className="text-xs px-2 py-1 rounded bg-purple-800 hover:bg-purple-700 text-white transition-colors">
                                → Cartographer
                              </button>
                            </>
                          )}
                          <button onClick={() => navigator.clipboard?.writeText(uuid)}
                            className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors">
                            📋
                          </button>
                        </div>
                      ))}
                      <p className="text-xs text-gray-600">Cliquer "→ EBB42" ou "→ Cartographer" copie l'UUID dans l'onglet Matériel et le reporte dans le printer.cfg généré.</p>
                    </div>
                  )}
                  {foundUuids.length === 0 && uuidInput.trim() && (
                    <div className="p-3 rounded-lg border border-yellow-800 bg-yellow-900/10 text-xs text-yellow-300">
                      ⚠ Aucun UUID trouvé — vérifier que can0 est UP, que les appareils sont alimentés, et que le câble CAN est branché des deux côtés.
                    </div>
                  )}
                </DeviceSection>

                {/* ─ EBB42 v1.2 ───────────────────────────────────────────── */}
                <DeviceSection title="⚡ BTT EBB42 v1.2" subtitle="CAN toolhead board — STM32G0B1">
                  {/* Statut connexion + UUID */}
                  <div className={`mb-4 p-3 rounded-lg border text-xs ${ebbConnected ? 'border-green-800 bg-green-900/10' : 'border-red-800 bg-red-900/10'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      {ebbConnected
                        ? <span className="text-green-400 font-medium">✓ EBB42 connecté sur can0 (nommé {cfgSections['mcu toolhead'] ? '[mcu toolhead]' : '[mcu EBB42]'})</span>
                        : <span className="text-red-400 font-medium">✗ EBB42 non visible sur le bus CAN</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-gray-500">canbus_uuid :</span>
                      <code className={`font-mono ${(config.ebb42Uuid || cfgUuidEbb) ? 'text-gray-200' : 'text-red-400'}`}>
                        {config.ebb42Uuid || cfgUuidEbb || '⚠ vide — utiliser l\'outil "Découverte UUID" ci-dessus'}
                      </code>
                      {!config.ebb42Uuid && cfgUuidEbb && (
                        <>
                          <span className="text-gray-600">(lu dans printer.cfg)</span>
                          {onChange && (
                            <button onClick={() => onChange({ ebb42Uuid: cfgUuidEbb })}
                              className="text-xs px-2 py-0.5 rounded bg-blue-800 hover:bg-blue-700 text-white transition-colors">
                              → Enregistrer dans l'app
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    {!ebbConnected && (
                      <div className="mt-2 text-yellow-300 leading-relaxed">
                        Causes possibles : UUID incorrect ou vide · Interface can0 inactive · EBB42 non alimenté (24V) ·
                        Câble CAN débranché ou inversé · Firmware Katapult/Klipper non flashé ·
                        Résistances de terminaison 120Ω manquantes (U2C + Cartographer uniquement, EBB42 = nœud milieu)
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                    <StatCell label="Firmware" value={ebbMcu?.mcu_version?.split('-')[0] ?? '—'}
                      color={ebbMcu?.mcu_version ? 'text-green-400' : 'text-red-400'} />
                    <StatCell label="Retransmit total" value={String(ebbStats.bytes_retransmit ?? '—')}
                      color={(ebbStats.bytes_retransmit ?? 0) > 0 ? 'text-yellow-400' : 'text-green-400'} />
                    <StatCell label="Erreurs/min (live)"
                      value={ebbErrorRate !== null ? (ebbErrorRate < 0.1 ? '0 ✓' : `${ebbErrorRate.toFixed(1)} ⚠`) : '—'}
                      color={ebbErrorRate !== null ? (ebbErrorRate < 0.1 ? 'text-green-400' : 'text-orange-400') : 'text-gray-500'} />
                    <StatCell label="MCU Awake" value={ebbStats.mcu_awake !== undefined ? `${(ebbStats.mcu_awake * 100).toFixed(1)}%` : '—'}
                      color="text-gray-400" />
                  </div>
                  {ebbTempSensor?.temperature !== undefined && (
                    <div className="mb-4 p-3 rounded-lg border border-gray-700 bg-gray-800/40 text-xs">
                      <span className="text-gray-500">Température MCU EBB42 : </span>
                      <span className="text-gray-200 font-medium">{fmtTemp(ebbTempSensor?.temperature)}</span>
                      {(ebbTempSensor?.temperature ?? 0) > 60 && (
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
                    const cartoMcu = cartoMcuObj;
                    const isCalibrated = carto?.cal_pos_x !== undefined || carto?.last_z_result !== undefined;
                    return (
                      <>
                        {/* Statut connexion + UUID */}
                        <div className={`mb-4 p-3 rounded-lg border text-xs ${cartoConnected ? 'border-green-800 bg-green-900/10' : 'border-red-800 bg-red-900/10'}`}>
                          <div className="flex items-center gap-2 mb-2">
                            {cartoConnected
                              ? <span className="text-green-400 font-medium">✓ Cartographer connecté sur can0</span>
                              : <span className="text-red-400 font-medium">✗ Cartographer non visible sur le bus CAN</span>}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-gray-500">canbus_uuid :</span>
                            <code className={`font-mono ${(config.cartographerUuid || cfgUuidCarto) ? 'text-gray-200' : 'text-red-400'}`}>
                              {config.cartographerUuid || cfgUuidCarto || '⚠ vide — utiliser l\'outil "Découverte UUID" ci-dessus'}
                            </code>
                            {!config.cartographerUuid && cfgUuidCarto && (
                              <>
                                <span className="text-gray-600">(lu dans printer.cfg)</span>
                                {onChange && (
                                  <button onClick={() => onChange({ cartographerUuid: cfgUuidCarto })}
                                    className="text-xs px-2 py-0.5 rounded bg-purple-800 hover:bg-purple-700 text-white transition-colors">
                                    → Enregistrer dans l'app
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                          {!cartoConnected && (
                            <div className="mt-2 text-yellow-300 leading-relaxed">
                              Causes possibles : UUID incorrect ou vide · Cartographer non alimenté (3.3V depuis EBB42) ·
                              Câble CAN Cartographer→EBB42 débranché · Jumper 120Ω Cartographer manquant (il est au bout de la chaîne) ·
                              EBB42 lui-même non connecté (prérequis)
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                          <StatCell label="Firmware" value={cartoMcu?.mcu_version?.split('-')[0] ?? '—'}
                            color={cartoMcu?.mcu_version ? 'text-green-400' : 'text-red-400'} />
                          <StatCell label="Retransmit total" value={String(cartoStats.bytes_retransmit ?? '—')}
                            color={(cartoStats.bytes_retransmit ?? 0) > 0 ? 'text-yellow-400' : 'text-green-400'} />
                          <StatCell label="Erreurs/min (live)"
                            value={cartoErrorRate !== null ? (cartoErrorRate < 0.1 ? '0 ✓' : `${cartoErrorRate.toFixed(1)} ⚠`) : '—'}
                            color={cartoErrorRate !== null ? (cartoErrorRate < 0.1 ? 'text-green-400' : 'text-orange-400') : 'text-gray-500'} />
                          <StatCell label="Temp capteur" value={carto?.temp !== undefined ? fmtTemp(carto.temp) : '—'}
                            color="text-gray-400" />
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                          <StatCell label="Fréquence capteur" value={carto?.frequency !== undefined ? `${(carto.frequency / 1_000_000).toFixed(3)} MHz` : '—'}
                            color="text-blue-400" />
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

          {/* ── Flash Firmware ───────────────────────────────────────────────── */}
          <div className="rounded-xl border border-yellow-900/40 bg-gray-900/60 overflow-hidden">
            <button onClick={() => setShowFlashTools(v => !v)}
              className="w-full flex items-center justify-between p-5 hover:bg-gray-800/30 transition-colors">
              <div className="flex items-center gap-2">
                <Zap size={15} className="text-yellow-400" />
                <span className="text-xs font-bold text-yellow-300 uppercase tracking-widest">Flash Firmware — EBB42 · Cartographer</span>
                <span className="hidden sm:inline text-xs text-yellow-700 font-normal ml-1">⚠ Opération avancée</span>
              </div>
              {showFlashTools ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
            </button>

            {showFlashTools && (
              <div className="border-t border-gray-800 p-5 space-y-5">
                {/* Avertissement global */}
                <div className="p-3 rounded-lg border border-yellow-800 bg-yellow-900/10 text-xs text-yellow-300 leading-relaxed">
                  ⚠ Ne jamais couper l'alimentation ni le câble CAN pendant un flash. Un flash interrompu nécessite une intervention DFU/USB pour récupérer l'appareil.
                </div>

                {/* Sélection appareil */}
                <div>
                  <div className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Appareil à flasher</div>
                  <div className="flex gap-2">
                    {(['ebb42', 'carto'] as const).map(d => (
                      <button key={d} onClick={() => setFlashDevice(d)}
                        className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors border ${
                          flashDevice === d
                            ? 'bg-yellow-700 border-yellow-600 text-white'
                            : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'
                        }`}>
                        {d === 'ebb42' ? '⚡ EBB42 v1.2' : '📡 Cartographer CAN'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sélection méthode */}
                <div>
                  <div className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Méthode</div>
                  <div className="flex gap-2">
                    {(['can', 'usb'] as const).map(m => (
                      <button key={m} onClick={() => setFlashMethod(m)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                          flashMethod === m
                            ? 'bg-gray-600 border-gray-500 text-white'
                            : 'bg-gray-900 border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600'
                        }`}>
                        {m === 'can' ? '🔌 Via CAN (Katapult installé)' : '💻 Via USB/DFU (première install)'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── EBB42 — Via CAN ──────────────────────────────────────────── */}
                {flashDevice === 'ebb42' && flashMethod === 'can' && (
                  <div className="space-y-3">
                    <div className="p-3 rounded-lg border border-gray-700 bg-gray-800/40 text-xs">
                      <span className="text-gray-400">Prérequis : </span>
                      <span className="text-gray-300">Katapult est déjà installé sur l'EBB42 · UUID configuré : </span>
                      <code className={`font-mono ${config.ebb42Uuid ? 'text-orange-300' : 'text-red-400'}`}>
                        {config.ebb42Uuid || '⚠ non configuré — Découverte UUID d\'abord'}
                      </code>
                    </div>

                    <FlashStep n={1} title="Arrêter Klipper">
                      <CmdLine cmd="sudo systemctl stop klipper" />
                    </FlashStep>

                    <FlashStep n={2} title="Mettre l'EBB42 en mode bootloader Katapult" warn>
                      <p className="text-gray-400">Envoie un signal reset via CAN pour activer le bootloader :</p>
                      <CmdLine cmd={`python3 ~/katapult/scripts/flashtool.py -i can0 -r -u ${config.ebb42Uuid || '<UUID_EBB42>'}`} />
                    </FlashStep>

                    <FlashStep n={3} title="Vérifier que Katapult répond">
                      <CmdLine cmd="python3 ~/katapult/scripts/flashtool.py -i can0 -q" />
                      <p className="text-gray-500">✓ Doit afficher l'UUID avec "Application: Katapult"</p>
                    </FlashStep>

                    <FlashStep n={4} title="Compiler Klipper pour EBB42 (STM32G0B1)">
                      <p className="text-gray-400 mb-1">Configurer dans menuconfig :</p>
                      <CmdLine cmd="cd ~/klipper && make menuconfig" />
                      <MenuconfigHint lines={[
                        '# Paramètres make menuconfig pour EBB42 v1.2 :',
                        '  [*] Enable extra low-level configuration options',
                        '  Micro-controller: STMicroelectronics STM32',
                        '  Processor model: STM32G0B1',
                        '  Bootloader offset: 8KiB bootloader',
                        '  Clock Reference: 8 MHz crystal',
                        '  Communication: CAN bus (on PB0/PB1)',
                        `  CAN bus speed: ${config.canSpeed}`,
                      ]} />
                      <p className="text-gray-400 mt-2">Puis compiler :</p>
                      <CmdLine cmd="make clean && make" />
                    </FlashStep>

                    <FlashStep n={5} title="Flasher Klipper sur l'EBB42" warn>
                      <CmdLine cmd={`python3 ~/katapult/scripts/flashtool.py -i can0 -f ~/klipper/out/klipper.bin -u ${config.ebb42Uuid || '<UUID_EBB42>'}`} />
                      <p className="text-gray-500">✓ Doit afficher "CAN Flash Success"</p>
                    </FlashStep>

                    <FlashStep n={6} title="Redémarrer Klipper">
                      <CmdLine cmd="sudo systemctl start klipper" />
                      <p className="text-gray-500">✓ Vérifier dans le Diagnostic que l'EBB42 est de nouveau connecté</p>
                    </FlashStep>
                  </div>
                )}

                {/* ── EBB42 — Via USB/DFU ──────────────────────────────────────── */}
                {flashDevice === 'ebb42' && flashMethod === 'usb' && (
                  <div className="space-y-3">
                    <div className="p-3 rounded-lg border border-gray-700 bg-gray-800/40 text-xs">
                      <span className="text-gray-400">Utiliser pour : </span>
                      <span className="text-gray-300">Première installation de Katapult · Récupération si le flash CAN a échoué.</span>
                      <br /><span className="text-gray-400 mt-1 block">Brancher un câble USB-C directement entre l'EBB42 et le Raspberry Pi.</span>
                    </div>

                    <FlashStep n={1} title="Brancher l'EBB42 en USB sur le Raspberry Pi">
                      <p>Port USB-C de l'EBB42 → port USB du Pi. Maintenir le câble CAN déconnecté pendant cette étape.</p>
                    </FlashStep>

                    <FlashStep n={2} title="Passer en mode DFU" warn>
                      <p className="text-gray-400"><strong className="text-white">EBB42 v1.2 :</strong> Maintenir le bouton <strong className="text-white">BOOT</strong>, appuyer brièvement sur <strong className="text-white">RESET</strong>, relâcher BOOT.</p>
                      <p className="text-gray-500">Alternative : placer le jumper BOOT0 avant de brancher le câble USB.</p>
                    </FlashStep>

                    <FlashStep n={3} title="Vérifier la détection DFU">
                      <CmdLine cmd='lsusb | grep "0483:df11"' />
                      <p className="text-gray-500">✓ Doit afficher "STMicroelectronics STM Device in DFU Mode"</p>
                    </FlashStep>

                    <FlashStep n={4} title="Compiler Katapult pour EBB42">
                      <CmdLine cmd="cd ~/katapult && make menuconfig" />
                      <MenuconfigHint lines={[
                        '# Paramètres make menuconfig Katapult pour EBB42 v1.2 :',
                        '  Micro-controller: STMicroelectronics STM32',
                        '  Processor model: STM32G0B1',
                        '  Build Katapult deployment application: (none)',
                        '  Clock Reference: 8 MHz crystal',
                        '  Communication interface: CAN bus (on PB0/PB1)',
                        `  CAN bus speed: ${config.canSpeed}`,
                        '  [*] Support bootloader entry on rapid double click of reset',
                        '  [*] Enable status LED   GPIO pin: PA13',
                      ]} />
                      <CmdLine cmd="make clean && make" />
                    </FlashStep>

                    <FlashStep n={5} title="Flasher Katapult sur l'EBB42 via DFU" warn>
                      <CmdLine cmd="sudo dfu-util -a 0 -D ~/katapult/out/katapult.bin -s 0x08000000:force:leave" />
                      <p className="text-gray-500">✓ Doit afficher "File downloaded successfully"</p>
                    </FlashStep>

                    <FlashStep n={6} title="Reconnecter à CAN + flasher Klipper">
                      <p>Débrancher USB, rebrancher les câbles CAN, puis suivre la méthode <strong className="text-yellow-400">Via CAN (Katapult)</strong> pour flasher Klipper.</p>
                    </FlashStep>
                  </div>
                )}

                {/* ── Cartographer — Via CAN ────────────────────────────────────── */}
                {flashDevice === 'carto' && flashMethod === 'can' && (
                  <div className="space-y-3">
                    <div className="p-3 rounded-lg border border-gray-700 bg-gray-800/40 text-xs">
                      <span className="text-gray-400">Prérequis : </span>
                      <span className="text-gray-300">Katapult est déjà installé sur le Cartographer · UUID : </span>
                      <code className={`font-mono ${config.cartographerUuid ? 'text-orange-300' : 'text-red-400'}`}>
                        {config.cartographerUuid || '⚠ non configuré — utiliser Découverte UUID d\'abord'}
                      </code>
                    </div>

                    <FlashStep n={1} title="Télécharger le firmware Cartographer">
                      <p className="text-gray-400 mb-1">Consulter les releases pour la version de votre matériel (v2, v3, K1, Survey…) :</p>
                      <a href="https://github.com/Cartographer3D/cartographer-klipper/releases"
                        target="_blank" rel="noreferrer"
                        className="text-orange-400 hover:text-orange-300 underline text-xs inline-block mb-1">
                        github.com/Cartographer3D/cartographer-klipper/releases ↗
                      </a>
                      <p className="text-gray-500">Copier le .bin sur le Pi avec SCP depuis votre PC :</p>
                      <CmdLine cmd="scp cartographer-firmware.bin pi@192.168.1.41:~/" />
                    </FlashStep>

                    <FlashStep n={2} title="Arrêter Klipper">
                      <CmdLine cmd="sudo systemctl stop klipper" />
                    </FlashStep>

                    <FlashStep n={3} title="Mettre le Cartographer en mode bootloader Katapult" warn>
                      <CmdLine cmd={`python3 ~/katapult/scripts/flashtool.py -i can0 -r -u ${config.cartographerUuid || '<UUID_CARTO>'}`} />
                    </FlashStep>

                    <FlashStep n={4} title="Vérifier que Katapult répond">
                      <CmdLine cmd="python3 ~/katapult/scripts/flashtool.py -i can0 -q" />
                      <p className="text-gray-500">✓ Doit afficher l'UUID du Cartographer avec "Application: Katapult"</p>
                    </FlashStep>

                    <FlashStep n={5} title="Flasher le firmware Cartographer" warn>
                      <CmdLine cmd={`python3 ~/katapult/scripts/flashtool.py -i can0 -f ~/cartographer-firmware.bin -u ${config.cartographerUuid || '<UUID_CARTO>'}`} />
                      <p className="text-gray-500">✓ Doit afficher "CAN Flash Success"</p>
                    </FlashStep>

                    <FlashStep n={6} title="Redémarrer Klipper">
                      <CmdLine cmd="sudo systemctl start klipper" />
                      <p className="text-gray-500">✓ Le Cartographer doit apparaître connecté dans le Diagnostic</p>
                    </FlashStep>
                  </div>
                )}

                {/* ── Cartographer — Via USB/DFU ────────────────────────────────── */}
                {flashDevice === 'carto' && flashMethod === 'usb' && (
                  <div className="space-y-3">
                    <div className="p-3 rounded-lg border border-gray-700 bg-gray-800/40 text-xs">
                      <span className="text-gray-400">Utiliser si : </span>
                      <span className="text-gray-300">Le Cartographer n'est pas visible sur CAN · Première installation · Récupération.</span>
                      <br /><span className="text-gray-400 mt-1 block">Brancher le Cartographer directement en USB sur le Raspberry Pi.</span>
                    </div>

                    <FlashStep n={1} title="Télécharger le firmware Cartographer">
                      <a href="https://github.com/Cartographer3D/cartographer-klipper/releases"
                        target="_blank" rel="noreferrer"
                        className="text-orange-400 hover:text-orange-300 underline text-xs inline-block mb-1">
                        github.com/Cartographer3D/cartographer-klipper/releases ↗
                      </a>
                      <p className="text-gray-500">Télécharger le <strong>.bin</strong> (MCU STM32) ou <strong>.uf2</strong> (MCU RP2040) selon votre modèle.</p>
                    </FlashStep>

                    <FlashStep n={2} title="Identifier le type de MCU">
                      <CmdLine cmd="lsusb" />
                      <div className="mt-1 grid grid-cols-2 gap-2">
                        <div className="p-2 rounded border border-gray-700 bg-gray-800/40">
                          <code className="text-yellow-400">0483:df11</code>
                          <div className="text-gray-500 mt-0.5">STM32 → méthode DFU</div>
                        </div>
                        <div className="p-2 rounded border border-gray-700 bg-gray-800/40">
                          <code className="text-yellow-400">2e8a:0003</code>
                          <div className="text-gray-500 mt-0.5">RP2040 → méthode UF2</div>
                        </div>
                      </div>
                    </FlashStep>

                    <FlashStep n={3} title="Flash STM32 — Mode DFU" warn>
                      <p className="text-gray-400 mb-1">Maintenir <strong className="text-white">BOOT</strong>, appuyer sur <strong className="text-white">RESET</strong>, relâcher BOOT. Puis :</p>
                      <CmdLine cmd="sudo dfu-util -a 0 -D cartographer-firmware.bin -s 0x08000000:force:leave" />
                    </FlashStep>

                    <FlashStep n={4} title="Flash RP2040 — Mode UF2" warn>
                      <p className="text-gray-400 mb-1">Maintenir BOOT, brancher USB → le Cartographer apparaît comme clé USB RPI-RP2 :</p>
                      <CmdLine cmd="ls /media/pi/ | grep RPI" />
                      <CmdLine cmd="cp cartographer-firmware.uf2 /media/pi/RPI-RP2/" />
                    </FlashStep>

                    <FlashStep n={5} title="Vérifier l'UUID sur CAN après flash">
                      <CmdLine cmd="sudo systemctl stop klipper" />
                      <CmdLine cmd="~/klippy-env/bin/python ~/klipper/scripts/canbus_query.py can0" />
                      <p className="text-gray-500">✓ Le Cartographer doit maintenant apparaître avec son UUID. Utiliser l'outil "Découverte UUID" pour l'assigner dans la config.</p>
                      <CmdLine cmd="sudo systemctl start klipper" />
                    </FlashStep>
                  </div>
                )}

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
              <div className="border-t border-gray-800 p-5 space-y-4">
                {/* Action bar */}
                <div className="flex flex-wrap items-center gap-2">
                  {diffLines.some(d => !d.match && d.critical) && (
                    <button onClick={applyAllCriticalFixes}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-medium transition-colors">
                      ⚡ Appliquer corrections critiques
                    </button>
                  )}
                  {modifiedCfg && modifiedCfg !== actualCfg && (
                    <button onClick={saveCfg} disabled={saveStatus === 'saving'}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs font-medium transition-colors">
                      {saveStatus === 'saving' ? <RefreshCw size={11} className="animate-spin" /> : <HardDrive size={11} />}
                      {saveStatus === 'saving' ? 'Sauvegarde…' : 'Sauvegarder sur le Pi'}
                    </button>
                  )}
                  {modifiedCfg && modifiedCfg !== actualCfg && (
                    <button onClick={() => { setModifiedCfg(actualCfg); setSaveStatus('idle'); setSaveMsg(null); }}
                      className="px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-gray-200 text-xs transition-colors">
                      Annuler modifications
                    </button>
                  )}
                  {saveMsg && (
                    <span className={`text-xs px-2 py-1 rounded ${saveStatus === 'ok' ? 'text-green-400 bg-green-900/30' : 'text-red-400 bg-red-900/30'}`}>
                      {saveMsg}
                    </span>
                  )}
                  {modifiedCfg && modifiedCfg !== actualCfg && saveStatus !== 'saving' && !saveMsg && (
                    <span className="text-xs text-yellow-400">⚠ Modifications non sauvegardées</span>
                  )}
                </div>

                {/* Diff table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-gray-500 border-b border-gray-800">
                      <th className="text-left py-2 pr-4 font-medium">Paramètre</th>
                      <th className="text-left py-2 pr-4 font-medium">Attendu (app)</th>
                      <th className="text-left py-2 pr-4 font-medium">Réel (printer.cfg)</th>
                      <th className="text-left py-2 pr-4 font-medium">État</th>
                      <th className="text-left py-2 font-medium">Action</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {diffLines.map(d => (
                        <tr key={d.key} className={d.match ? '' : d.critical ? 'bg-red-900/10' : 'bg-yellow-900/10'}>
                          <td className="py-2 pr-4 font-mono text-gray-400">{d.label}</td>
                          <td className="py-2 pr-4 font-mono text-gray-200">{d.expected}</td>
                          <td className={`py-2 pr-4 font-mono ${d.match ? 'text-gray-200' : d.critical ? 'text-red-300' : 'text-yellow-300'}`}>{d.actual}</td>
                          <td className="py-2 pr-4">
                            {d.match
                              ? <span className="text-green-400">✓</span>
                              : <span className={d.critical ? 'text-red-400 font-bold' : 'text-yellow-400'}>{d.critical ? '✗ CRITIQUE' : '≠'}</span>
                            }
                          </td>
                          <td className="py-2">
                            {!d.match && (
                              <button onClick={() => applyOneFix(d)}
                                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                                  d.critical
                                    ? 'bg-red-800 hover:bg-red-700 text-white'
                                    : 'bg-yellow-800 hover:bg-yellow-700 text-white'
                                }`}>
                                Remplacer
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {saveStatus === 'ok' && (
                  <div className="p-3 rounded-lg border border-blue-800 bg-blue-900/10 text-xs text-blue-300">
                    💡 Config sauvegardée. Lance <span className="font-mono bg-blue-900/30 px-1 rounded">FIRMWARE_RESTART</span> dans le panneau "Actions rapides" (ou via Mainsail) pour que les changements prennent effet.
                  </div>
                )}
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
