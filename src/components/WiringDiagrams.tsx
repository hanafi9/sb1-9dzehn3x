import React, { useState, useEffect } from 'react';
import {
  Cable, Zap, AlertTriangle, ExternalLink, ChevronDown, ChevronUp, Info, RefreshCw,
} from 'lucide-react';
import type { PrinterConfig } from '../App';

// ─── SVG distant rendu inline ─────────────────────────────────────────────────
// Les schémas drawio de RatOS référencent l'image de la carte en externe.
// Un SVG affiché via <img> n'a pas le droit de charger de ressources externes :
// les fils (vectoriels) apparaissent, la carte (bitmap référencé) disparaît.
// Solution : récupérer le SVG en texte, réécrire les href relatifs en absolus,
// et l'injecter inline — là, le navigateur charge tout.

function RemoteSvg({ url }: { url: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSvg(null); setErr(null);
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then(text => {
        if (!alive) return;
        const base = url.slice(0, url.lastIndexOf('/') + 1);
        // href/xlink:href relatifs → absolus (en épargnant http(s):, data:, #ancres)
        const fixed = text
          .replace(/(xlink:href|href)="(?!https?:|data:|#)([^"]+)"/g,
            (_m, attr: string, rel: string) => `${attr}="${base}${rel}"`)
          // Laisse le conteneur imposer la taille
          .replace(/<svg([^>]*?)\s(width|height)="[^"]*"/g, '<svg$1')
          .replace(/<svg([^>]*?)\s(width|height)="[^"]*"/g, '<svg$1');
        setSvg(fixed);
      })
      .catch(e => { if (alive) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [url]);

  if (err) {
    return (
      <div className="p-4 text-xs text-yellow-300 bg-yellow-950/20 rounded-lg border border-yellow-900/50">
        ⚠ Schéma inaccessible ({err}) — il faut un accès Internet vers raw.githubusercontent.com.
        Utiliser le lien « Ouvrir » pour le voir sur GitHub.
      </div>
    );
  }
  if (!svg) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-600">
        <RefreshCw size={16} className="animate-spin mr-2" /> <span className="text-xs">Chargement du schéma…</span>
      </div>
    );
  }
  return (
    <div
      className="w-full overflow-x-auto [&_svg]:w-full [&_svg]:h-auto [&_svg]:max-w-none"
      // SVG provenant du dépôt officiel RatOS — même origine de confiance que les liens
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// ─── Données matériel (vérifiées depuis RatOS-configuration v2.1.x) ───────────

const RATOS_REPO = 'https://github.com/Rat-OS/RatOS-configuration/blob/v2.1.x';
const RATOS_RAW  = 'https://raw.githubusercontent.com/Rat-OS/RatOS-configuration/v2.1.x';

interface Connector {
  name: string;
  pins: string;
  role: string;
  note?: string;
  critical?: boolean;
}

interface BoardInfo {
  id: string;
  name: string;
  subtitle: string;
  mcu: string;
  connection: string;
  color: string;
  /** Chemin du dossier board dans RatOS, si présent */
  ratosPath?: string;
  connectors: Connector[];
  /** Alias de pins RatOS (verbatim depuis toolboard-config.cfg / config.cfg) */
  pinAliases?: Array<[string, string]>;
  warnings?: string[];
}

const BOARDS: BoardInfo[] = [
  {
    id: 'octopus',
    name: 'BTT Octopus Pro',
    subtitle: 'Carte mère — pilote X, Y, Z×3, lit, chambre',
    mcu: 'STM32F446',
    connection: 'USB série vers le Raspberry Pi (pas de CAN)',
    color: 'blue',
    ratosPath: 'boards/btt-octopus-pro-446',
    connectors: [
      { name: 'USB-C',            pins: '—',            role: 'Liaison Klipper vers le Pi', note: 'Apparaît en /dev/serial/by-id/usb-Klipper_stm32f446xx_*', critical: true },
      { name: 'POWER IN',         pins: '2 (VIN, GND)', role: 'Alimentation 24 V depuis le PSU', note: 'Bornier principal — 14 AWG', critical: true },
      { name: 'MOTOR 0…7',        pins: '4',            role: 'Steppers X, Y, Z, Z1, Z2', note: 'Z, Z1, Z2 pour les 3 vis du VCore 3' },
      { name: 'HE0',              pins: '2',            role: 'Non utilisé — chauffe déportée sur l\'EBB42', note: 'Le hotend est piloté par la toolboard' },
      { name: 'BED',              pins: '2',            role: 'Chauffe du lit (via SSR)', critical: true },
      { name: 'TB / T0…T3',       pins: '2',            role: 'Thermistances lit et chambre' },
      { name: 'ENDSTOP X/Y',      pins: '3',            role: 'Fins de course physiques X et Y', note: 'Z utilise la sonde virtuelle du Cartographer' },
      { name: 'FAN0…FAN7',        pins: '2',            role: 'Ventilateurs chambre / électronique' },
    ],
    warnings: [
      'Le connecteur USB-C alimente la logique : ne pas confondre avec l\'entrée 24 V du bornier.',
      'Ne PAS flasher l\'Octopus en mode « USB to CAN bridge » — il parle en série USB dans cette configuration.',
    ],
  },
  {
    id: 'u2c',
    name: 'BTT U2C v2.1',
    subtitle: 'Pont USB ↔ CAN — crée l\'interface can0',
    mcu: 'STM32G0B1',
    connection: 'USB vers le Pi · Bus CAN vers l\'EBB42',
    color: 'purple',
    connectors: [
      { name: 'USB-C',      pins: '—',                              role: 'Vers le Raspberry Pi — alimente la carte ET porte le trafic CAN', critical: true },
      { name: 'CAN OUT',    pins: '2 (CAN_H, CAN_L)',               role: 'Vers l\'EBB42 — paire torsadée obligatoire', critical: true },
      { name: 'Bornier 24 V', pins: '2 (VIN, GND)',                 role: 'Optionnel — sert à réinjecter le 24 V sur le faisceau', note: 'La logique du U2C est alimentée par l\'USB' },
      { name: 'Jumper 120 Ω', pins: '2',                            role: 'Terminaison du bus — À INSTALLER', note: 'Le U2C est une extrémité physique du bus', critical: true },
    ],
    warnings: [
      'RatOS ne définit AUCUNE carte U2C : ce n\'est pas un MCU Klipper dans le modèle RatOS. N\'ajoute pas de section [mcu u2c] dans printer.cfg.',
      'Le U2C n\'apparaît pas dans /dev/serial/by-id — il se manifeste par l\'interface réseau can0.',
    ],
  },
  {
    id: 'ebb42',
    name: 'BTT EBB42 v1.1',
    subtitle: 'Toolboard CAN — hotend, extrudeur, ventilateurs, ADXL',
    mcu: 'STM32G0B1',
    connection: 'Nœud CAN — canbus_uuid',
    color: 'orange',
    ratosPath: 'boards/btt-ebb42-11',
    connectors: [
      { name: 'CAN IN',       pins: '4 (24V, GND, CAN_H, CAN_L)', role: 'Ombilical depuis le U2C / le PSU', note: '20 AWG pour 24 V+GND, paire torsadée 24 AWG pour CAN_H/L', critical: true },
      { name: 'CAN OUT',      pins: '4',                          role: 'Chaînage vers le Cartographer', critical: true },
      { name: 'HOTEND (HE)',  pins: '2',                          role: 'Cartouche chauffante', critical: true },
      { name: 'TH0',          pins: '2',                          role: 'Thermistance hotend', critical: true },
      { name: 'FAN0',         pins: '2',                          role: 'Ventilateur de refroidissement pièce' },
      { name: 'FAN1',         pins: '2',                          role: 'Ventilateur du hotend', note: 'Souvent câblé en permanence' },
      { name: 'MOTOR',        pins: '4',                          role: 'Moteur d\'extrudeur (Orbiter 2 / LGX Lite)', critical: true },
      { name: 'PROBE',        pins: '3 (5V, GND, SIG)',           role: 'Sonde inductive — inutilisé avec Cartographer' },
      { name: 'ADXL345',      pins: 'intégré',                    role: 'Accéléromètre embarqué pour l\'input shaping' },
      { name: 'RGB',          pins: '3',                          role: 'LED Neopixel / Stealthburner' },
      { name: 'USB-C',        pins: '—',                          role: 'Flash DFU uniquement — jamais en usage normal', note: 'Débrancher le CAN pendant un flash USB' },
      { name: 'BOOT + RESET', pins: '2 boutons',                  role: 'Entrée en bootloader', note: 'BOOT maintenu + RESET bref = mode DFU' },
      { name: 'Jumper 120 Ω', pins: '2',                          role: 'À RETIRER — l\'EBB42 est au milieu du bus', note: 'Deux terminaisons maximum sur tout le bus', critical: true },
    ],
    pinAliases: [
      ['e_step_pin',              'PD0'],
      ['e_dir_pin',               'PD1'],
      ['e_enable_pin',            'PD2'],
      ['e_heater_pin',            'PA2'],
      ['fan_part_cooling_pin',    'PA0'],
      ['fan_toolhead_cooling_pin','PA1'],
      ['probe_pin',               'PB9'],
      ['adxl345_cs_pin',          'PB12'],
      ['CAN (firmware)',          'PB0 / PB1'],
    ],
    warnings: [
      'Dans menuconfig, choisir « CAN bus (on PB0/PB1) » — surtout PAS « USB to CAN bus bridge ». L\'EBB42 est un nœud, pas un pont.',
      'Bootloader Katapult : offset 8 KiB, quartz 8 MHz.',
    ],
  },
  {
    id: 'cartographer',
    name: 'Cartographer',
    subtitle: 'Sonde inductive à balayage — endstop Z virtuel',
    mcu: 'STM32 ou RP2040 selon révision',
    connection: 'Nœud CAN — canbus_uuid',
    color: 'green',
    connectors: [
      { name: 'CAN IN',       pins: '4 (24V, GND, CAN_H, CAN_L)', role: 'Depuis le CAN OUT de l\'EBB42', critical: true },
      { name: 'Jumper 120 Ω', pins: '2',                          role: 'À INSTALLER — bout de chaîne', critical: true },
      { name: 'USB-C',        pins: '—',                          role: 'Flash de firmware uniquement' },
    ],
    warnings: [
      'RatOS v2.1 ne fournit PAS de z-probe/cartographer.cfg — seul Beacon est supporté nativement. Le plugin Cartographer s\'installe séparément et doit rester à jour vis-à-vis de Klipper.',
      'La sonde doit être montée à hauteur constante par rapport à la buse : x_offset / y_offset doivent refléter le montage réel.',
    ],
  },
];

const COLOR_MAP: Record<string, { border: string; bg: string; text: string; dot: string }> = {
  blue:   { border: 'border-blue-800',   bg: 'bg-blue-950/30',   text: 'text-blue-300',   dot: '#60a5fa' },
  purple: { border: 'border-purple-800', bg: 'bg-purple-950/30', text: 'text-purple-300', dot: '#c084fc' },
  orange: { border: 'border-orange-800', bg: 'bg-orange-950/30', text: 'text-orange-300', dot: '#fb923c' },
  green:  { border: 'border-green-800',  bg: 'bg-green-950/30',  text: 'text-green-300',  dot: '#4ade80' },
};

// ─── Schéma de topologie ──────────────────────────────────────────────────────

function TopologySVG({ config, onSelect }: { config: PrinterConfig; onSelect: (id: string) => void }) {
  const box = (x: number, y: number, w: number, h: number, fill: string, stroke: string) =>
    ({ x, y, width: w, height: h, rx: 8, fill, stroke, strokeWidth: 1.5 });

  return (
    <div className="overflow-x-auto">
      <svg viewBox="0 0 960 470" className="w-full min-w-[820px]" role="img"
        aria-label="Schéma de câblage entre Raspberry Pi, Octopus Pro, U2C, EBB42 et Cartographer">

        <defs>
          <marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#9ca3af" />
          </marker>
          <marker id="arrowCan" markerWidth="9" markerHeight="9" refX="8" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#fb923c" />
          </marker>
          <marker id="arrowPwr" markerWidth="9" markerHeight="9" refX="8" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#ef4444" />
          </marker>
        </defs>

        {/* ── Alimentation 24 V ── */}
        <rect {...box(40, 360, 150, 66, '#1f2937', '#ef4444')} />
        <text x={115} y={387} textAnchor="middle" className="fill-red-300" fontSize="13" fontWeight="700">PSU 24 V</text>
        <text x={115} y={406} textAnchor="middle" className="fill-gray-500" fontSize="10">Alimentation</text>

        {/* ── Raspberry Pi ── */}
        <rect {...box(40, 46, 150, 86, '#1f2937', '#22c55e')} />
        <text x={115} y={78} textAnchor="middle" className="fill-green-300" fontSize="13" fontWeight="700">Raspberry Pi</text>
        <text x={115} y={97} textAnchor="middle" className="fill-gray-400" fontSize="10">RatOS · Klipper</text>
        <text x={115} y={114} textAnchor="middle" className="fill-gray-500" fontSize="10">Moonraker · Mainsail</text>

        {/* ── Octopus Pro ── */}
        <g onClick={() => onSelect('octopus')} className="cursor-pointer">
          <rect {...box(300, 36, 200, 100, '#111827', '#3b82f6')} />
          <text x={400} y={66} textAnchor="middle" className="fill-blue-300" fontSize="13" fontWeight="700">Octopus Pro</text>
          <text x={400} y={85} textAnchor="middle" className="fill-gray-400" fontSize="10">STM32F446 · [mcu]</text>
          <text x={400} y={103} textAnchor="middle" className="fill-gray-500" fontSize="9">X · Y · Z×3 · lit</text>
          <text x={400} y={121} textAnchor="middle" className="fill-gray-600" fontSize="9">USB série — pas de CAN</text>
        </g>

        {/* ── U2C ── */}
        <g onClick={() => onSelect('u2c')} className="cursor-pointer">
          <rect {...box(300, 205, 170, 86, '#111827', '#a855f7')} />
          <text x={385} y={234} textAnchor="middle" className="fill-purple-300" fontSize="13" fontWeight="700">BTT U2C v2.1</text>
          <text x={385} y={252} textAnchor="middle" className="fill-gray-400" fontSize="10">Pont USB ↔ CAN</text>
          <text x={385} y={270} textAnchor="middle" className="fill-gray-500" fontSize="9">crée can0 — pas un MCU</text>
          {/* Terminaison */}
          <circle cx={300} cy={248} r={13} fill="#7f1d1d" stroke="#ef4444" strokeWidth="1.5" />
          <text x={300} y={252} textAnchor="middle" className="fill-red-200" fontSize="8" fontWeight="700">120Ω</text>
        </g>

        {/* ── EBB42 ── */}
        <g onClick={() => onSelect('ebb42')} className="cursor-pointer">
          <rect {...box(580, 198, 170, 100, '#111827', '#f97316')} />
          <text x={665} y={227} textAnchor="middle" className="fill-orange-300" fontSize="13" fontWeight="700">EBB42 v1.1</text>
          <text x={665} y={245} textAnchor="middle" className="fill-gray-400" fontSize="10">STM32G0B1</text>
          <text x={665} y={262} textAnchor="middle" className="fill-gray-500" fontSize="9">hotend · extrudeur</text>
          <text x={665} y={279} textAnchor="middle" className="fill-gray-500" fontSize="9">ventilos · ADXL345</text>
          {/* Pas de terminaison */}
          <circle cx={665} cy={183} r={15} fill="#1f2937" stroke="#6b7280" strokeWidth="1.5" strokeDasharray="3 2" />
          <text x={665} y={187} textAnchor="middle" className="fill-gray-400" fontSize="8" fontWeight="700">no Ω</text>
        </g>

        {/* ── Cartographer ── */}
        <g onClick={() => onSelect('cartographer')} className="cursor-pointer">
          <rect {...box(830, 205, 120, 86, '#111827', '#22c55e')} />
          <text x={890} y={236} textAnchor="middle" className="fill-green-300" fontSize="12" fontWeight="700">Cartographer</text>
          <text x={890} y={254} textAnchor="middle" className="fill-gray-400" fontSize="10">sonde Z</text>
          <text x={890} y={271} textAnchor="middle" className="fill-gray-500" fontSize="9">bout de chaîne</text>
          <circle cx={950} cy={248} r={13} fill="#7f1d1d" stroke="#ef4444" strokeWidth="1.5" />
          <text x={950} y={252} textAnchor="middle" className="fill-red-200" fontSize="8" fontWeight="700">120Ω</text>
        </g>

        {/* ── Liaisons USB ── */}
        <line x1={190} y1={78} x2={294} y2={78} stroke="#9ca3af" strokeWidth="2" markerEnd="url(#arrow)" />
        <text x={242} y={70} textAnchor="middle" className="fill-gray-400" fontSize="10" fontWeight="600">USB</text>

        <path d="M190 108 L 245 108 L 245 248 L 294 248" fill="none" stroke="#9ca3af" strokeWidth="2" markerEnd="url(#arrow)" />
        <text x={245} y={175} textAnchor="middle" className="fill-gray-400" fontSize="10" fontWeight="600"
          transform="rotate(-90 245 175)">USB</text>

        {/* ── Liaisons CAN ── */}
        <line x1={470} y1={248} x2={574} y2={248} stroke="#fb923c" strokeWidth="2.5" markerEnd="url(#arrowCan)" />
        <text x={522} y={239} textAnchor="middle" className="fill-orange-400" fontSize="10" fontWeight="600">CAN</text>
        <text x={522} y={266} textAnchor="middle" className="fill-gray-500" fontSize="9">
          {(config.canSpeed / 1000).toFixed(0)}k
        </text>

        <line x1={750} y1={248} x2={824} y2={248} stroke="#fb923c" strokeWidth="2.5" markerEnd="url(#arrowCan)" />
        <text x={787} y={239} textAnchor="middle" className="fill-orange-400" fontSize="10" fontWeight="600">CAN</text>

        {/* ── Alimentation 24 V ── */}
        <path d="M115 360 L 115 320 L 400 320 L 400 142" fill="none" stroke="#ef4444" strokeWidth="2"
          strokeDasharray="6 3" markerEnd="url(#arrowPwr)" />
        <text x={258} y={313} textAnchor="middle" className="fill-red-400" fontSize="10" fontWeight="600">24 V</text>

        <path d="M190 393 L 665 393 L 665 304" fill="none" stroke="#ef4444" strokeWidth="2"
          strokeDasharray="6 3" markerEnd="url(#arrowPwr)" />
        <text x={430} y={386} textAnchor="middle" className="fill-red-400" fontSize="10" fontWeight="600">
          24 V — dans l'ombilical, avec la paire CAN
        </text>

        {/* ── Légende ── */}
        <g>
          <line x1={620} y1={420} x2={654} y2={420} stroke="#9ca3af" strokeWidth="2" />
          <text x={660} y={424} className="fill-gray-400" fontSize="10">USB</text>
          <line x1={700} y1={420} x2={734} y2={420} stroke="#fb923c" strokeWidth="2.5" />
          <text x={740} y={424} className="fill-gray-400" fontSize="10">CAN</text>
          <line x1={780} y1={420} x2={814} y2={420} stroke="#ef4444" strokeWidth="2" strokeDasharray="6 3" />
          <text x={820} y={424} className="fill-gray-400" fontSize="10">24 V</text>
        </g>
        <text x={40} y={444} className="fill-gray-600" fontSize="10">
          Clique sur une carte pour voir ses connecteurs en détail.
        </text>
      </svg>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function WiringDiagrams({ config }: { config: PrinterConfig }) {
  const [openBoard, setOpenBoard] = useState<string | null>('ebb42');
  const [showOfficial, setShowOfficial] = useState(true);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Câblage</h2>
        <p className="text-sm text-gray-400">
          Topologie complète · Détail des connecteurs · Règles de terminaison CAN · Schémas officiels RatOS
        </p>
      </div>

      {/* ── Topologie ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Cable size={15} className="text-orange-400" />
          <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">
            Topologie — VCore 3.1 {config.printerSize}×{config.printerSize}
          </h3>
        </div>
        <TopologySVG config={config} onSelect={setOpenBoard} />
      </div>

      {/* ── Règle des terminaisons ────────────────────────────────────────── */}
      <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-red-200 mb-2">
              Règle des terminaisons 120 Ω — la cause n°1 des bus CAN instables
            </h3>
            <p className="text-xs text-gray-300 leading-relaxed mb-3">
              Un bus CAN veut <strong className="text-white">exactement deux résistances de 120 Ω</strong>, une à
              chaque extrémité physique. Ni une, ni trois. Avec ta chaîne{' '}
              <span className="font-mono text-orange-300">U2C → EBB42 → Cartographer</span> :
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                { board: 'U2C v2.1',     action: 'Jumper INSTALLÉ',  ok: true,  why: 'extrémité du bus' },
                { board: 'EBB42',        action: 'Jumper RETIRÉ',    ok: false, why: 'nœud intermédiaire' },
                { board: 'Cartographer', action: 'Jumper INSTALLÉ',  ok: true,  why: 'extrémité du bus' },
              ].map(r => (
                <div key={r.board} className={`p-3 rounded-lg border ${r.ok ? 'border-green-800 bg-green-950/30' : 'border-yellow-800 bg-yellow-950/30'}`}>
                  <div className="text-xs font-semibold text-gray-200">{r.board}</div>
                  <div className={`text-xs font-bold mt-1 ${r.ok ? 'text-green-400' : 'text-yellow-400'}`}>{r.action}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{r.why}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-3">
              Vérification à froid, imprimante éteinte : mesure entre CAN_H et CAN_L au multimètre —
              tu dois lire <strong className="text-gray-300">≈ 60 Ω</strong> (deux 120 Ω en parallèle).
              120 Ω = une terminaison manquante. 40 Ω = une de trop.
            </p>
          </div>
        </div>
      </div>

      {/* ── Câbles ────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Zap size={15} className="text-orange-400" />
          <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">L'ombilical toolhead</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left py-2 pr-4 font-medium">Conducteur</th>
                <th className="text-left py-2 pr-4 font-medium">Section</th>
                <th className="text-left py-2 pr-4 font-medium">Couleur usuelle</th>
                <th className="text-left py-2 font-medium">Contrainte</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {[
                ['+24 V',  '20 AWG', 'Rouge',      'Chauffe hotend + moteur : c\'est le conducteur qui porte le courant'],
                ['GND',    '20 AWG', 'Noir',       'Retour commun — même section que le +24 V'],
                ['CAN_H',  '24 AWG', 'Jaune',      'Torsadé avec CAN_L — impérativement'],
                ['CAN_L',  '24 AWG', 'Vert/Blanc', 'Torsadé avec CAN_H — impérativement'],
              ].map(([c, s, col, note]) => (
                <tr key={c}>
                  <td className="py-2 pr-4 font-mono text-orange-300">{c}</td>
                  <td className="py-2 pr-4 text-gray-300">{s}</td>
                  <td className="py-2 pr-4 text-gray-400">{col}</td>
                  <td className="py-2 text-gray-500">{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {[
            'La paire CAN_H / CAN_L doit être torsadée sur toute sa longueur — c\'est ce qui annule le bruit induit par les moteurs et la chauffe.',
            'Faire passer l\'ombilical à l\'écart des câbles moteur et de la nappe du lit chauffant.',
            'Longueur totale du bus sous 3 m à 1 Mbit/s. Au-delà, descendre à 500 kbit/s.',
            'Un blindage relié au GND côté U2C uniquement (jamais aux deux bouts) aide sur les machines bruyantes.',
          ].map((t, i) => (
            <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg border border-gray-800 bg-gray-800/30">
              <Info size={12} className="text-blue-400 flex-shrink-0 mt-0.5" />
              <span className="text-xs text-gray-400 leading-relaxed">{t}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Détail par carte ──────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Détail des connecteurs</h3>
        {BOARDS.map(b => {
          const c = COLOR_MAP[b.color];
          const open = openBoard === b.id;
          return (
            <div key={b.id} className={`rounded-xl border ${c.border} ${c.bg} overflow-hidden`}>
              <button onClick={() => setOpenBoard(open ? null : b.id)}
                className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors text-left">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.dot }} />
                  <div className="min-w-0">
                    <div className={`text-sm font-bold ${c.text}`}>{b.name}</div>
                    <div className="text-xs text-gray-500 truncate">{b.subtitle}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="hidden sm:inline text-xs text-gray-600 font-mono">{b.mcu}</span>
                  {open ? <ChevronUp size={15} className="text-gray-500" /> : <ChevronDown size={15} className="text-gray-500" />}
                </div>
              </button>

              {open && (
                <div className="border-t border-gray-800/60 p-4 space-y-4">
                  <div className="text-xs text-gray-400">
                    <span className="text-gray-600">Liaison :</span> {b.connection}
                  </div>

                  {/* Connecteurs */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-500 border-b border-gray-800">
                          <th className="text-left py-2 pr-3 font-medium">Connecteur</th>
                          <th className="text-left py-2 pr-3 font-medium">Broches</th>
                          <th className="text-left py-2 font-medium">Rôle</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/50">
                        {b.connectors.map(cn => (
                          <tr key={cn.name} className={cn.critical ? 'bg-orange-950/10' : ''}>
                            <td className="py-2 pr-3">
                              <span className={`font-mono ${cn.critical ? 'text-orange-300' : 'text-gray-300'}`}>{cn.name}</span>
                              {cn.critical && <span className="ml-1.5 text-orange-600">•</span>}
                            </td>
                            <td className="py-2 pr-3 text-gray-500 font-mono whitespace-nowrap">{cn.pins}</td>
                            <td className="py-2 text-gray-400">
                              {cn.role}
                              {cn.note && <div className="text-gray-600 mt-0.5">{cn.note}</div>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Alias de pins RatOS */}
                  {b.pinAliases && (
                    <div>
                      <div className="text-xs font-semibold text-gray-400 mb-2">
                        Alias de pins RatOS
                        <span className="font-normal text-gray-600 ml-1.5">
                          (depuis <code>{b.ratosPath}/toolboard-config.cfg</code>)
                        </span>
                      </div>
                      <div className="grid gap-1.5 sm:grid-cols-3">
                        {b.pinAliases.map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-gray-800 bg-gray-900/60">
                            <code className="text-xs text-gray-400 truncate">{k}</code>
                            <code className="text-xs text-orange-300 font-bold flex-shrink-0">{v}</code>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Avertissements */}
                  {b.warnings && b.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 p-3 rounded-lg border border-yellow-900/60 bg-yellow-950/20">
                      <AlertTriangle size={13} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                      <span className="text-xs text-yellow-200 leading-relaxed">{w}</span>
                    </div>
                  ))}

                  {/* Schéma officiel */}
                  {b.ratosPath && (
                    <a href={`${RATOS_REPO}/${b.ratosPath}/wiring.drawio.svg`} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300 underline">
                      Schéma de câblage officiel RatOS <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Schémas officiels embarqués ───────────────────────────────────── */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
        <button onClick={() => setShowOfficial(v => !v)}
          className="w-full flex items-center justify-between p-5 hover:bg-gray-800/30 transition-colors">
          <div className="flex items-center gap-2">
            <Cable size={15} className="text-orange-400" />
            <span className="text-xs font-bold text-gray-300 uppercase tracking-widest">
              Schémas officiels RatOS — vues des cartes réelles
            </span>
          </div>
          {showOfficial ? <ChevronUp size={15} className="text-gray-500" /> : <ChevronDown size={15} className="text-gray-500" />}
        </button>
        {showOfficial && (
          <div className="border-t border-gray-800 p-5 space-y-6">
            <p className="text-xs text-gray-500">
              Ces images viennent du dépôt RatOS-configuration et représentent exactement tes cartes.
              Elles se chargent depuis GitHub — il faut un accès Internet.
            </p>
            {[
              { path: 'boards/btt-octopus-pro-446/wiring.drawio.svg', label: 'Octopus Pro 446 — câblage général' },
              { path: 'boards/btt-octopus-pro-446/fan-wiring.drawio.svg', label: 'Octopus Pro 446 — ventilateurs' },
              { path: 'boards/btt-ebb42-11/wiring.drawio.svg', label: 'EBB42 v1.1 — câblage toolhead' },
              { path: 'boards/btt-ebb42-11/dfubooting.png', label: 'EBB42 v1.1 — entrée en mode DFU' },
            ].map(d => (
              <div key={d.path}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-300">{d.label}</span>
                  <a href={`${RATOS_REPO}/${d.path}`} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-orange-400 transition-colors">
                    Ouvrir <ExternalLink size={10} />
                  </a>
                </div>
                <div className="rounded-lg border border-gray-800 bg-gray-950 p-3 overflow-x-auto">
                  {d.path.endsWith('.svg')
                    ? <RemoteSvg url={`${RATOS_RAW}/${d.path}`} />
                    : <img src={`${RATOS_RAW}/${d.path}`} alt={d.label}
                        loading="lazy" className="max-w-full h-auto mx-auto block rounded" />}
                </div>
              </div>
            ))}
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { url: `${RATOS_REPO}/boards/btt-ebb42-11/manual.pdf`, label: 'Manuel BTT EBB42 v1.1 (PDF)' },
                { url: `${RATOS_REPO}/boards/btt-octopus-pro-446/manual.pdf`, label: 'Manuel BTT Octopus Pro (PDF)' },
                { url: 'https://docs.cartographer3d.com/', label: 'Documentation Cartographer 3D' },
                { url: 'https://github.com/bigtreetech/U2C', label: 'Dépôt BTT U2C (schémas, firmware)' },
              ].map(l => (
                <a key={l.url} href={l.url} target="_blank" rel="noreferrer"
                  className="flex items-center justify-between gap-2 p-3 rounded-lg border border-gray-800 bg-gray-800/30 hover:border-gray-600 transition-colors">
                  <span className="text-xs text-gray-300">{l.label}</span>
                  <ExternalLink size={12} className="text-gray-600 flex-shrink-0" />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
