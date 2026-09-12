// ─── Moteur d'audit de printer.cfg ────────────────────────────────────────────
// Vérifie le fichier réel de l'imprimante contre toutes les pannes rencontrées
// sur cette machine + les règles générales Klipper/Cartographer.

import type { PrinterConfig } from '../App';

export type AuditSeverity = 'error' | 'warn' | 'ok' | 'info';

export interface AuditResult {
  id: string;
  severity: AuditSeverity;
  title: string;
  detail: string;
  lines?: number[];
  cmds?: string[];
  /** Correction automatique disponible */
  fixLabel?: string;
  applyFix?: (text: string) => string;
}

// UUIDs vérifiés de CETTE machine (session de dépannage du 13/08/2026)
export const KNOWN = {
  uuidEbb42: '564fed93e397',
  uuidCarto: '4973681e12df',
  uuidU2c: '6092d36469e1',
};

// ─── Parsing ──────────────────────────────────────────────────────────────────

interface SectionInstance { name: string; line: number }
interface Parsed {
  /** Toutes les instances de sections, dans l'ordre (doublons inclus) */
  instances: SectionInstance[];
  /** Section → clés fusionnées (dernière valeur gagne, comme Klipper) */
  merged: Record<string, Record<string, { value: string; line: number }>>;
  /** Lignes actives [include ...] */
  includes: Array<{ target: string; line: number }>;
  /** Le bloc SAVE_CONFIG (#*#) est-il présent ? */
  hasSaveConfig: boolean;
  /** Nombre total de lignes */
  lineCount: number;
}

export function parseForAudit(raw: string): Parsed {
  const instances: SectionInstance[] = [];
  const merged: Parsed['merged'] = {};
  const includes: Parsed['includes'] = [];
  let hasSaveConfig = false;
  let current = '';

  const lines = raw.split('\n');
  lines.forEach((rawLine, i) => {
    const n = i + 1;
    if (rawLine.startsWith('#*#')) { hasSaveConfig = true; return; }
    const line = rawLine.split(/[#;]/)[0].trimEnd();
    const trimmed = line.trim();
    if (!trimmed) return;

    const sec = trimmed.match(/^\[(.+)\]$/);
    if (sec) {
      const name = sec[1].trim();
      const inc = name.match(/^include\s+(.+)$/i);
      if (inc) { includes.push({ target: inc[1].trim(), line: n }); current = ''; return; }
      instances.push({ name, line: n });
      current = name;
      merged[name] = merged[name] ?? {};
      return;
    }

    // Klipper accepte "clé: valeur" et "clé = valeur", et les continuations indentées
    if (current && !rawLine.match(/^\s/)) {
      const kv = trimmed.match(/^([\w.]+)\s*[:=]\s*(.*)$/);
      if (kv) merged[current][kv[1]] = { value: kv[2].trim(), line: n };
    } else if (current && rawLine.match(/^\s/) === null) {
      // ligne non indentée sans forme clé:valeur — ignorée
    } else if (current) {
      // continuation (gcode multi-lignes) — ignorée pour l'audit clé/valeur
    }
  });

  return { instances, merged, includes, hasSaveConfig, lineCount: lines.length };
}

// ─── Correcteurs de texte ─────────────────────────────────────────────────────
// Chaque fonction est pure : texte → texte. Le bloc SAVE_CONFIG (#*#) n'est
// jamais touché — toutes les insertions se font au-dessus.

/** Index de la première ligne du bloc SAVE_CONFIG, ou length si absent */
function saveConfigStart(lines: string[]): number {
  const i = lines.findIndex(l => l.startsWith('#*#'));
  return i === -1 ? lines.length : i;
}

/** Plages de chaque instance de section (header → dernière ligne avant la suivante) */
function sectionRanges(lines: string[]): Array<{ name: string; start: number; end: number }> {
  const limit = saveConfigStart(lines);
  const out: Array<{ name: string; start: number; end: number }> = [];
  for (let i = 0; i < limit; i++) {
    const m = lines[i].split(/[#;]/)[0].trim().match(/^\[(.+)\]$/);
    if (m && !m[1].trim().match(/^include\s/i)) {
      if (out.length) out[out.length - 1].end = i - 1;
      out.push({ name: m[1].trim(), start: i, end: limit - 1 });
    }
  }
  return out;
}

/** Remplace (ou insère) `key: value` dans la PREMIÈRE instance de [section] */
export function fixSetKey(text: string, section: string, key: string, value: string): string {
  const lines = text.split('\n');
  const inst = sectionRanges(lines).find(r => r.name === section);
  if (!inst) return text;
  for (let i = inst.start + 1; i <= inst.end; i++) {
    const kv = lines[i].split(/[#;]/)[0].match(/^(\s*)([\w.]+)\s*[:=]/);
    if (kv && kv[2] === key) {
      lines[i] = `${kv[1]}${key}: ${value}`;
      return lines.join('\n');
    }
  }
  lines.splice(inst.start + 1, 0, `${key}: ${value}`);
  return lines.join('\n');
}

/** Commente toutes les instances de [section] (header + clés) */
export function fixCommentSection(text: string, section: string): string {
  const lines = text.split('\n');
  const targets = sectionRanges(lines).filter(r => r.name === section);
  for (const t of targets.reverse()) {
    for (let i = t.start; i <= t.end; i++) {
      const stripped = lines[i].trim();
      if (!stripped || stripped.startsWith('#')) continue;
      // Ne commente que le header et les clés, pas les lignes déjà commentées
      const isHeader = i === t.start;
      const isKey = /^\s*[\w.]+\s*[:=]/.test(lines[i]) || /^\s+\S/.test(lines[i]);
      if (isHeader || isKey) lines[i] = `#${lines[i]}`;
      // Une nouvelle section non ciblée arrête le bloc (sécurité)
      if (!isHeader && stripped.match(/^\[.+\]$/)) break;
    }
  }
  return lines.join('\n');
}

/** Commente une ligne [include …] qui matche le motif */
export function fixCommentInclude(text: string, pattern: RegExp): string {
  return text.split('\n').map(l => {
    const t = l.trim();
    return t.match(/^\[include\s/i) && pattern.test(t) ? `#${l}  # désactivé par l'audit` : l;
  }).join('\n');
}

/** Supprime les instances dupliquées d'une section en GARDANT LA DERNIÈRE
 *  (c'est celle que Klipper applique — le comportement actuel est préservé) */
export function fixRemoveEarlierDuplicates(text: string): string {
  const lines = text.split('\n');
  const ranges = sectionRanges(lines);
  const byName = new Map<string, typeof ranges>();
  for (const r of ranges) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
  const toRemove = [...byName.values()]
    .filter(rs => rs.length > 1)
    .flatMap(rs => rs.slice(0, -1));          // toutes sauf la dernière
  toRemove.sort((a, b) => b.start - a.start); // suppression de bas en haut
  for (const r of toRemove) lines.splice(r.start, r.end - r.start + 1);
  return lines.join('\n');
}

/** Insère une ligne tout en haut du fichier */
export function fixInsertTop(text: string, line: string): string {
  return `${line}\n${text}`;
}

/** Ajoute un bloc juste AVANT le bloc SAVE_CONFIG (ou en fin de fichier) */
export function fixAppendBlock(text: string, block: string): string {
  const lines = text.split('\n');
  const at = saveConfigStart(lines);
  lines.splice(at, 0, '', block, '');
  return lines.join('\n');
}

function startPrintBlock(withLeds: boolean): string {
  const s = (m: string) => (withLeds ? `    ${m}\n` : '');
  return `[gcode_macro START_PRINT]
gcode:
    {% set BED = params.BED_TEMP|default(60)|float %}
    {% set HOTEND = params.EXTRUDER_TEMP|default(230)|float %}
${s('STATUS_LOADING')}    CLEAR_PAUSE
    G90
    M83
    _USER_START_PRINT_BEFORE_HOMING
${s('STATUS_HEATING_BED')}    M140 S{BED}
    M190 S{BED}
    _USER_START_PRINT_AFTER_HEATING_BED
${s('STATUS_HOMING')}    G28
${s('STATUS_LEVELING')}    Z_TILT_ADJUST
    G28 Z
${s('STATUS_MESHING')}    BED_MESH_CALIBRATE
    _USER_START_PRINT_BEFORE_HEATING_EXTRUDER
${s('STATUS_HEATING_NOZZLE')}    M109 S{HOTEND}
    _USER_START_PRINT_PARK
${s('STATUS_PRINTING')}    G1 X10 Y10 Z0.3 F6000
    G1 X150 Y10 E15 F1200
    G1 Z2 F600`;
}

function endPrintBlock(withLeds: boolean): string {
  return `[gcode_macro END_PRINT]
gcode:
    M400
    G91
    G1 E-3 F1800
    G1 Z10 F600
    G90
    TURN_OFF_HEATERS
    _USER_END_PRINT_AFTER_HEATERS_OFF
    M107
    _USER_END_PRINT_PARK
    G1 X10 Y{printer.toolhead.axis_maximum.y - 10} F6000
${withLeds ? '    STATUS_DONE\n' : ''}    M84`;
}

// ─── Règles ───────────────────────────────────────────────────────────────────

export function runAudit(raw: string, config: PrinterConfig): AuditResult[] {
  const p = parseForAudit(raw);
  const r: AuditResult[] = [];
  const rawLines = raw.split('\n');

  const expectEbb = config.ebb42Uuid || KNOWN.uuidEbb42;
  const expectCarto = config.cartographerUuid || KNOWN.uuidCarto;

  const has = (s: string) => p.merged[s] !== undefined;
  const val = (s: string, k: string) => p.merged[s]?.[k]?.value;
  const lineOf = (s: string, k: string) => p.merged[s]?.[k]?.line;

  // ── 1. Sections dupliquées ──────────────────────────────────────────────
  const seen = new Map<string, number[]>();
  for (const inst of p.instances) {
    seen.set(inst.name, [...(seen.get(inst.name) ?? []), inst.line]);
  }
  const dups = [...seen.entries()].filter(([, ls]) => ls.length > 1);
  if (dups.length) {
    r.push({
      id: 'dup_sections', severity: 'error',
      title: `${dups.length} section(s) déclarée(s) plusieurs fois`,
      detail: dups.map(([n, ls]) => `[${n}] × ${ls.length} — lignes ${ls.join(', ')}`).join('\n') +
        '\nKlipper fusionne silencieusement : la dernière définition écrase les précédentes. ' +
        'Les premières sont du code mort.',
      lines: dups.flatMap(([, ls]) => ls),
      fixLabel: 'Supprimer les doublons (garde la dernière définition — le comportement actuel est conservé)',
      applyFix: fixRemoveEarlierDuplicates,
    });
  } else {
    r.push({ id: 'dup_sections', severity: 'ok', title: 'Aucune section dupliquée', detail: 'Chaque section n\'est déclarée qu\'une fois.' });
  }

  // ── 2. UUID : permutation et valeurs ────────────────────────────────────
  const toolheadSec = has('mcu toolhead') ? 'mcu toolhead' : has('mcu EBB42') ? 'mcu EBB42' : null;
  const thUuid = toolheadSec ? val(toolheadSec, 'canbus_uuid') : undefined;
  const caUuid = val('cartographer', 'canbus_uuid');

  if (thUuid === expectCarto && caUuid === expectEbb) {
    r.push({
      id: 'uuid_swap', severity: 'error',
      title: '⚠ UUID PERMUTÉS — le toolhead pointe vers le Cartographer',
      detail: `[${toolheadSec}] a l'UUID du Cartographer (${thUuid}) et [cartographer] celui de l'EBB42 (${caUuid}).\n` +
        `Symptôme au démarrage : "Unknown command: tmcuart_send".\n` +
        `Correct : [${toolheadSec}] → ${expectEbb} · [cartographer] → ${expectCarto}.\n` +
        `NE JAMAIS flasher en CAN avec des UUID permutés.`,
      lines: [lineOf(toolheadSec!, 'canbus_uuid'), lineOf('cartographer', 'canbus_uuid')].filter((x): x is number => !!x),
      fixLabel: `Rétablir : [${toolheadSec}] → ${expectEbb} · [cartographer] → ${expectCarto}`,
      applyFix: t => fixSetKey(fixSetKey(t, toolheadSec!, 'canbus_uuid', expectEbb), 'cartographer', 'canbus_uuid', expectCarto),
    });
  } else {
    if (toolheadSec) {
      if (thUuid === expectEbb) {
        r.push({ id: 'uuid_th', severity: 'ok', title: `[${toolheadSec}] → UUID EBB42 correct`, detail: `canbus_uuid: ${thUuid}` });
      } else if (!thUuid) {
        r.push({
          id: 'uuid_th', severity: 'error', title: `[${toolheadSec}] sans canbus_uuid`,
          detail: 'La section existe mais aucun UUID n\'est défini.',
          fixLabel: `Définir canbus_uuid: ${expectEbb}`,
          applyFix: t => fixSetKey(t, toolheadSec!, 'canbus_uuid', expectEbb),
        });
      } else {
        r.push({
          id: 'uuid_th', severity: 'warn',
          title: `[${toolheadSec}] a un UUID inattendu`,
          detail: `Trouvé : ${thUuid} — attendu pour cette machine : ${expectEbb}.\nSi le matériel a changé, mettre à jour l'app (onglet Matériel).`,
          lines: [lineOf(toolheadSec, 'canbus_uuid')!],
          cmds: ['sudo systemctl stop klipper && ~/klippy-env/bin/python ~/klipper/scripts/canbus_query.py can0 ; sudo systemctl start klipper'],
          fixLabel: `Remplacer par l'UUID connu de la machine (${expectEbb})`,
          applyFix: t => fixSetKey(t, toolheadSec!, 'canbus_uuid', expectEbb),
        });
      }
    } else {
      r.push({ id: 'uuid_th', severity: 'error', title: 'Aucune section [mcu toolhead] / [mcu EBB42]', detail: 'La toolboard CAN n\'est pas déclarée.' });
    }

    if (has('cartographer')) {
      if (caUuid === expectCarto) {
        r.push({ id: 'uuid_ca', severity: 'ok', title: '[cartographer] → UUID Cartographer correct', detail: `canbus_uuid: ${caUuid}` });
      } else if (!caUuid || !caUuid.match(/^[0-9a-f]{12}$/i) || caUuid === '000000000000') {
        r.push({
          id: 'uuid_ca', severity: 'error',
          title: '[cartographer] : canbus_uuid invalide',
          detail: `Valeur : "${caUuid ?? '(absente)'}" — Klipper refusera avec "Invalid CAN uuid".`,
          lines: lineOf('cartographer', 'canbus_uuid') ? [lineOf('cartographer', 'canbus_uuid')!] : undefined,
          fixLabel: `Définir canbus_uuid: ${expectCarto}`,
          applyFix: t => fixSetKey(t, 'cartographer', 'canbus_uuid', expectCarto),
        });
      } else {
        r.push({
          id: 'uuid_ca', severity: 'warn',
          title: '[cartographer] a un UUID inattendu',
          detail: `Trouvé : ${caUuid} — attendu : ${expectCarto}.`,
          lines: [lineOf('cartographer', 'canbus_uuid')!],
          fixLabel: `Remplacer par l'UUID connu de la machine (${expectCarto})`,
          applyFix: t => fixSetKey(t, 'cartographer', 'canbus_uuid', expectCarto),
        });
      }
    }
  }

  // ── 3. Même UUID dans deux sections actives ─────────────────────────────
  const uuidUse = new Map<string, string[]>();
  for (const [sec, keys] of Object.entries(p.merged)) {
    const u = keys['canbus_uuid']?.value;
    if (u) uuidUse.set(u, [...(uuidUse.get(u) ?? []), sec]);
  }
  const shared = [...uuidUse.entries()].filter(([, secs]) => secs.length > 1);
  if (shared.length) {
    r.push({
      id: 'uuid_dup', severity: 'error',
      title: 'Le même UUID est utilisé par plusieurs sections',
      detail: shared.map(([u, secs]) => `${u} → [${secs.join('], [')}]`).join('\n') +
        '\nKlipper refuse : "Duplicate canbus_uuid".',
    });
  }

  // ── 4. [mcu u2c] actif ───────────────────────────────────────────────────
  if (has('mcu u2c')) {
    const l = p.instances.find(i => i.name === 'mcu u2c')?.line;
    r.push({
      id: 'u2c', severity: 'error',
      title: '[mcu u2c] est actif — point de panne inutile',
      detail: 'Le U2C est un pont USB↔CAN : il crée can0 côté Linux et ne pilote rien. ' +
        'Le déclarer en [mcu] ajoute un nœud qui doit répondre au démarrage. ' +
        'RatOS ne définit aucune carte U2C. → Commenter la section.',
      lines: l ? [l] : undefined,
      fixLabel: 'Commenter la section [mcu u2c]',
      applyFix: t => fixCommentSection(t, 'mcu u2c'),
    });
  } else {
    r.push({ id: 'u2c', severity: 'ok', title: 'Pas de [mcu u2c] actif', detail: 'Le U2C n\'est pas déclaré comme MCU — correct.' });
  }

  // ── 5. Conflits de sonde ─────────────────────────────────────────────────
  const zprobeInc = p.includes.find(i => i.target.match(/z-probe\//i));
  if (has('beacon') && has('cartographer')) {
    r.push({
      id: 'probe_conflict', severity: 'error',
      title: '[beacon] et [cartographer] actifs en même temps',
      detail: 'Deux sondes Z déclarées — Klipper ne peut pas trancher. Commenter [beacon].',
      fixLabel: 'Commenter [beacon] (garder [cartographer])',
      applyFix: t => fixCommentSection(t, 'beacon'),
    });
  } else if (zprobeInc && has('cartographer')) {
    r.push({
      id: 'probe_conflict', severity: 'error',
      title: `Un include z-probe cohabite avec [cartographer] (ligne ${zprobeInc.line})`,
      detail: `"${zprobeInc.target}" charge une autre sonde en plus du Cartographer. À commenter.`,
      lines: [zprobeInc.line],
      fixLabel: 'Commenter cette ligne d\'include',
      applyFix: t => fixCommentInclude(t, /z-probe\//i),
    });
  } else if (has('cartographer')) {
    r.push({ id: 'probe_conflict', severity: 'ok', title: 'Une seule sonde Z ([cartographer])', detail: 'Pas de conflit beacon / z-probe.' });
  }

  // ── 6. stepper_z pour Cartographer ──────────────────────────────────────
  if (has('cartographer')) {
    const ep = val('stepper_z', 'endstop_pin');
    const hrd = val('stepper_z', 'homing_retract_dist');
    if (ep === 'probe:z_virtual_endstop') {
      r.push({ id: 'z_endstop', severity: 'ok', title: 'Z homé par la sonde virtuelle', detail: 'endstop_pin: probe:z_virtual_endstop' });
    } else {
      r.push({
        id: 'z_endstop', severity: 'error',
        title: `stepper_z › endstop_pin = "${ep ?? '(absent)'}"`,
        detail: 'Avec un Cartographer, le Z doit se homer sur probe:z_virtual_endstop.',
        lines: lineOf('stepper_z', 'endstop_pin') ? [lineOf('stepper_z', 'endstop_pin')!] : undefined,
        fixLabel: 'Définir endstop_pin: probe:z_virtual_endstop',
        applyFix: t => fixSetKey(t, 'stepper_z', 'endstop_pin', 'probe:z_virtual_endstop'),
      });
    }
    if (hrd === '0') {
      r.push({ id: 'z_retract', severity: 'ok', title: 'homing_retract_dist = 0', detail: 'Indispensable avec une sonde sans contact.' });
    } else {
      r.push({
        id: 'z_retract', severity: 'error',
        title: `stepper_z › homing_retract_dist = "${hrd ?? '(absent)'}"`,
        detail: 'Doit valoir 0 avec le Cartographer.',
        lines: lineOf('stepper_z', 'homing_retract_dist') ? [lineOf('stepper_z', 'homing_retract_dist')!] : undefined,
        fixLabel: 'Définir homing_retract_dist: 0',
        applyFix: t => fixSetKey(t, 'stepper_z', 'homing_retract_dist', '0'),
      });
    }
  }

  // ── 7. Thermistance (Rapido = PT1000) ───────────────────────────────────
  const sensorType = val('extruder', 'sensor_type');
  const expectsPt1000 = config.hotend === 'rapido_uhf' || config.hotend === 'dragon_uhf';
  if (sensorType === 'PT1000') {
    r.push({ id: 'thermistor', severity: 'ok', title: 'Thermistance PT1000', detail: 'Cohérent avec un Rapido.' });
  } else if (expectsPt1000 && sensorType) {
    r.push({
      id: 'thermistor', severity: 'error',
      title: `sensor_type = "${sensorType}" — un Rapido embarque un PT1000`,
      detail: 'Symptôme typique : ~158 °C affichés à froid (résistance PT1000 lue avec une courbe NTC). ' +
        'DANGER : les températures affichées sont fausses, les protections aussi. ' +
        'Remplacer par sensor_type: PT1000, puis refaire PID_CALIBRATE.',
      lines: lineOf('extruder', 'sensor_type') ? [lineOf('extruder', 'sensor_type')!] : undefined,
      fixLabel: 'Remplacer par sensor_type: PT1000 (⚠ refaire PID_CALIBRATE ensuite)',
      applyFix: t => fixSetKey(t, 'extruder', 'sensor_type', 'PT1000'),
    });
  } else if (sensorType) {
    r.push({ id: 'thermistor', severity: 'info', title: `sensor_type = "${sensorType}"`, detail: 'Vérifier que ça correspond au capteur réellement monté dans le hotend.' });
  }

  // ── 8. mainsail.cfg / virtual_sdcard ─────────────────────────────────────
  const hasMainsail = p.includes.some(i => i.target.toLowerCase().includes('mainsail'));
  const hasVsd = has('virtual_sdcard');
  if (hasMainsail || hasVsd) {
    r.push({ id: 'mainsail', severity: 'ok', title: hasMainsail ? 'mainsail.cfg inclus' : '[virtual_sdcard] défini', detail: 'Impression depuis l\'interface possible, pause/reprise disponibles.' });
  } else {
    r.push({
      id: 'mainsail', severity: 'error',
      title: 'Ni [include mainsail.cfg] ni [virtual_sdcard]',
      detail: 'Sans virtual_sdcard, AUCUNE impression depuis Mainsail n\'est possible. Ajouter [include mainsail.cfg].',
      fixLabel: 'Ajouter [include mainsail.cfg] en tête de fichier',
      applyFix: t => fixInsertTop(t, '[include mainsail.cfg]'),
    });
  }

  // ── 9. START_PRINT / END_PRINT et hooks orphelins ────────────────────────
  const hasStart = has('gcode_macro START_PRINT');
  const hasEnd = has('gcode_macro END_PRINT');
  const userHooks = p.instances.filter(i => i.name.match(/^gcode_macro _USER_(START|END)_PRINT/i));
  if (hasStart && hasEnd) {
    r.push({ id: 'print_macros', severity: 'ok', title: 'START_PRINT et END_PRINT définis', detail: 'Le trancheur peut les appeler.' });
  } else {
    r.push({
      id: 'print_macros', severity: 'error',
      title: `${!hasStart ? 'START_PRINT manquant' : ''}${!hasStart && !hasEnd ? ' · ' : ''}${!hasEnd ? 'END_PRINT manquant' : ''}`,
      detail: (userHooks.length
        ? `${userHooks.length} hooks _USER_*_PRINT_* existent (lignes ${userHooks.map(h => h.line).join(', ')}) mais rien ne les appelle — ce sont des restes RatOS orphelins.\n`
        : '') + 'Le G-code de démarrage du trancheur échouera sur "Unknown command".',
      fixLabel: 'Ajouter START_PRINT et END_PRINT (appellent tes hooks _USER_* existants' +
        (p.includes.some(i => i.target.toLowerCase().includes('leds')) ? ' + macros LED STATUS_*' : '') + ')',
      applyFix: t => {
        const withLeds = t.split('\n').some(l => l.trim().match(/^\[include\s+.*leds/i));
        let out = t;
        if (!hasStart) out = fixAppendBlock(out, startPrintBlock(withLeds));
        if (!hasEnd) out = fixAppendBlock(out, endPrintBlock(withLeds));
        return out;
      },
    });
  }

  // ── 10. canbus_interface ─────────────────────────────────────────────────
  for (const sec of [toolheadSec, has('cartographer') ? 'cartographer' : null]) {
    if (!sec) continue;
    const ci = val(sec, 'canbus_interface');
    if (ci && ci !== 'can0') {
      r.push({
        id: `canif_${sec}`, severity: 'warn',
        title: `[${sec}] › canbus_interface = "${ci}"`,
        detail: 'Cette machine n\'a qu\'une interface : can0.',
        lines: [lineOf(sec, 'canbus_interface')!],
        fixLabel: 'Remplacer par canbus_interface: can0',
        applyFix: t => fixSetKey(t, sec, 'canbus_interface', 'can0'),
      });
    }
  }

  // ── 11. bed_mesh ─────────────────────────────────────────────────────────
  if (has('bed_mesh')) {
    if (val('bed_mesh', 'zero_reference_position')) {
      r.push({ id: 'zrp', severity: 'ok', title: 'zero_reference_position défini', detail: `${val('bed_mesh', 'zero_reference_position')}` });
    } else {
      r.push({
        id: 'zrp', severity: 'warn',
        title: 'bed_mesh sans zero_reference_position',
        detail: `Recommandé avec une sonde scanner : zero_reference_position: ${config.printerSize / 2}, ${config.printerSize / 2}`,
        fixLabel: `Ajouter zero_reference_position: ${config.printerSize / 2}, ${config.printerSize / 2}`,
        applyFix: t => fixSetKey(t, 'bed_mesh', 'zero_reference_position', `${config.printerSize / 2}, ${config.printerSize / 2}`),
      });
    }
  }

  // ── 12. [mcu] principal ──────────────────────────────────────────────────
  const mcuSerial = val('mcu', 'serial');
  if (mcuSerial?.includes('/dev/serial/by-id/')) {
    r.push({ id: 'mcu_serial', severity: 'ok', title: '[mcu] en USB série by-id', detail: mcuSerial.slice(0, 70) });
  } else if (has('mcu')) {
    r.push({
      id: 'mcu_serial', severity: 'warn',
      title: '[mcu] sans chemin /dev/serial/by-id/',
      detail: `serial = "${mcuSerial ?? '(absent)'}" — un chemin by-id survit aux redémarrages, un /dev/ttyACM0 non.`,
    });
  }

  // ── 13. leds.cfg si STATUS_ appelés ──────────────────────────────────────
  const usesStatus = rawLines.some(l => !l.trim().startsWith('#') && l.match(/\bSTATUS_(HOMING|HEATING|LEVELING|MESHING|PRINTING|LOADING)\b/));
  const hasLedsInc = p.includes.some(i => i.target.toLowerCase().includes('leds'));
  const definesStatus = p.instances.some(i => i.name.match(/^gcode_macro STATUS_/i));
  if (usesStatus && !hasLedsInc && !definesStatus) {
    r.push({
      id: 'leds', severity: 'warn',
      title: 'Des macros STATUS_* sont appelées mais jamais définies',
      detail: 'START_PRINT référence les macros LED sans [include leds.cfg] — chaque appel produira "Unknown command".',
    });
  }

  // ── 14. Bloc SAVE_CONFIG ─────────────────────────────────────────────────
  r.push({
    id: 'saveconfig', severity: 'info',
    title: p.hasSaveConfig ? 'Bloc SAVE_CONFIG présent (lignes #*#)' : 'Pas de bloc SAVE_CONFIG',
    detail: p.hasSaveConfig
      ? 'Contient PID, z-offset et calibration Cartographer. Ne jamais l\'éditer à la main.'
      : 'Normal si aucun SAVE_CONFIG n\'a encore été lancé — PID et calibrations ne sont pas encore persistés.',
  });

  return r;
}

/** Statistiques pour l'en-tête */
export function auditStats(results: AuditResult[]) {
  return {
    errors: results.filter(x => x.severity === 'error').length,
    warns: results.filter(x => x.severity === 'warn').length,
    oks: results.filter(x => x.severity === 'ok').length,
  };
}
