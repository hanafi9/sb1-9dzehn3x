// ─── Couche d'accès Moonraker partagée ────────────────────────────────────────
// Utilisée par PrinterDiagnostic et PrinterTerminal pour parler à l'imprimante.

import { useState, useEffect, useCallback } from 'react';

export interface GCodeEntry { type: string; time: number; message: string }

const LS_IP = 'ratos.moonraker.ip';
const LS_PORT = 'ratos.moonraker.port';

/** Connexion Moonraker partagée entre les onglets (persistée en localStorage). */
export function useMoonrakerConnection() {
  const [ip, setIpState] = useState<string>(() => {
    try { return localStorage.getItem(LS_IP) ?? '192.168.1.41'; } catch { return '192.168.1.41'; }
  });
  const [port, setPortState] = useState<string>(() => {
    try { return localStorage.getItem(LS_PORT) ?? '80'; } catch { return '80'; }
  });

  const setIp = useCallback((v: string) => {
    setIpState(v);
    try { localStorage.setItem(LS_IP, v); } catch { /* quota / private mode */ }
  }, []);
  const setPort = useCallback((v: string) => {
    setPortState(v);
    try { localStorage.setItem(LS_PORT, v); } catch { /* quota / private mode */ }
  }, []);

  // Se resynchronise si l'autre onglet change l'IP
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_IP && e.newValue) setIpState(e.newValue);
      if (e.key === LS_PORT && e.newValue) setPortState(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { ip, port, setIp, setPort, baseUrl: `http://${ip}:${port}` };
}

// ─── Requêtes ────────────────────────────────────────────────────────────────

async function mrJson<T>(url: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export async function sendGcode(baseUrl: string, script: string, timeoutMs = 15000): Promise<void> {
  await mrJson(`${baseUrl}/printer/gcode/script`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script }),
  }, timeoutMs);
}

export async function fetchGcodeStore(baseUrl: string, count = 100): Promise<GCodeEntry[]> {
  const r = await mrJson<{ result?: { gcode_store?: GCodeEntry[] } }>(
    `${baseUrl}/server/gcode_store?count=${count}`);
  return r.result?.gcode_store ?? [];
}

/** Liste de tous les objets Klipper configurés — révèle ce qui existe réellement. */
export async function fetchObjectsList(baseUrl: string): Promise<string[]> {
  const r = await mrJson<{ result?: { objects?: string[] } }>(`${baseUrl}/printer/objects/list`);
  return r.result?.objects ?? [];
}

/** Télécharge klippy.log brut (peut faire plusieurs Mo). */
export async function fetchKlippyLog(baseUrl: string, timeoutMs = 30000): Promise<string> {
  const res = await fetch(`${baseUrl}/server/files/klippy.log`, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} — klippy.log introuvable`);
  return res.text();
}

// ─── Analyse de klippy.log ───────────────────────────────────────────────────

export interface Traceback {
  /** Lignes brutes du bloc traceback */
  lines: string[];
  /** Dernière ligne = message d'erreur final */
  errorMessage: string;
  /** Fichiers .py impliqués, dans l'ordre d'appel */
  files: Array<{ path: string; line: string; func: string }>;
  /** Modules tiers (hors klipper core) — le coupable le plus probable */
  thirdPartyModules: string[];
}

const CORE_KLIPPY_FILES = new Set([
  'klippy.py', 'configfile.py', 'gcode.py', 'webhooks.py', 'mcu.py',
  'pins.py', 'reactor.py', 'toolhead.py', 'klippy',
]);

/**
 * Extrait les blocs "Traceback (most recent call last):" de klippy.log.
 * Retourne les plus récents en premier.
 */
export function extractTracebacks(log: string): Traceback[] {
  const lines = log.split('\n');
  const out: Traceback[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('Traceback (most recent call last)')) continue;

    const block: string[] = [lines[i]];
    let j = i + 1;
    // Un traceback se poursuit tant que les lignes sont indentées ("  File ...", "    code")
    // et se termine par une ligne non indentée = le message d'erreur.
    for (; j < lines.length && j < i + 200; j++) {
      block.push(lines[j]);
      const l = lines[j];
      if (l.trim() && !l.startsWith(' ') && !l.startsWith('\t')) break; // ligne d'erreur finale
    }

    const files: Traceback['files'] = [];
    for (const l of block) {
      const m = l.match(/File "([^"]+)", line (\d+), in (\S+)/);
      if (m) files.push({ path: m[1], line: m[2], func: m[3] });
    }

    const thirdParty = [...new Set(
      files
        .map(f => f.path)
        .filter(p => p.includes('/extras/') || p.includes('klippy/plugins/'))
        .map(p => p.split('/').pop() ?? p)
        .filter(f => !CORE_KLIPPY_FILES.has(f))
    )];

    const last = block[block.length - 1]?.trim() ?? '';
    out.push({ lines: block, errorMessage: last, files, thirdPartyModules: thirdParty });
    i = j;
  }

  return out.reverse(); // plus récent d'abord
}

/** Extrait les lignes "Config error"/"Unhandled exception" hors traceback. */
export function extractConfigErrors(log: string): string[] {
  const out: string[] = [];
  for (const l of log.split('\n')) {
    if (/^(config error|Config error|Unhandled exception|Internal error|MCU error)/i.test(l.trim())) {
      out.push(l.trim());
    }
  }
  return [...new Set(out)].reverse().slice(0, 20);
}

/** Récupère les N dernières lignes du log (pour affichage). */
export function tailLog(log: string, n = 400): string[] {
  const lines = log.split('\n');
  return lines.slice(Math.max(0, lines.length - n));
}

/** Détecte la version de RatOS / Klipper depuis le log de démarrage. */
export function extractVersions(log: string): { klipper?: string; python?: string; ratos?: string } {
  const klipper = log.match(/Starting Klippy\.\.\.\s*\n?.*?version[:\s]+(\S+)/i)?.[1]
    ?? log.match(/Klipper version[:\s]+(\S+)/i)?.[1]
    ?? log.match(/software_version[=:]\s*'?([\w.\-+]+)'?/i)?.[1];
  const python = log.match(/Python:\s*'?([\d.]+)/)?.[1];
  const ratos = log.match(/RatOS\s+v?([\w.-]+)/i)?.[1];
  return { klipper, python, ratos };
}
