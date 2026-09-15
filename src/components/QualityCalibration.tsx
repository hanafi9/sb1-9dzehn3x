import { useState } from 'react';
import {
  Sparkles, Wind, Ruler, FlaskConical, SlidersHorizontal,
  Copy, Check, AlertTriangle, ChevronRight,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
//  Guide QUALITÉ / CALIBRATION — VCore 3.1 + Rapido + HGX Lite.
//  « Impeccable » = 70% calibration (une fois) + 30% réglages slicer.
//  Ordre d'impact : Input Shaper > calibration filament (Orca) > réglages visuels.
// ═══════════════════════════════════════════════════════════════════════════

interface Section {
  key: string;
  label: string;
  icon: typeof Sparkles;
  color: string;
}

const SECTIONS: Section[] = [
  { key: 'stringing', label: 'Anti-chevelure PETG', icon: Wind, color: 'text-cyan-400' },
  { key: 'shaper', label: 'Input Shaper (Klipper)', icon: Ruler, color: 'text-orange-400' },
  { key: 'orca', label: 'Calibration OrcaSlicer', icon: FlaskConical, color: 'text-purple-400' },
  { key: 'visual', label: 'Réglages visuels', icon: SlidersHorizontal, color: 'text-green-400' },
];

export function QualityCalibration() {
  const [active, setActive] = useState('stringing');
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1800);
  };

  const Code = ({ id, children }: { id: string; children: string }) => (
    <div className="relative rounded-lg border border-gray-800 bg-gray-950/70 overflow-hidden">
      <button
        onClick={() => copy(id, children)}
        className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs text-gray-300"
      >
        {copied === id ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
        {copied === id ? 'Copié' : 'Copier'}
      </button>
      <pre className="p-3 pr-20 overflow-x-auto text-xs leading-relaxed text-gray-300">
        <code>{children}</code>
      </pre>
    </div>
  );

  const Row = ({ k, v, n }: { k: string; v: string; n?: string }) => (
    <>
      <div className="bg-gray-900/50 px-3 py-2 text-xs text-gray-300">{k}</div>
      <div className="bg-gray-900/50 px-3 py-2 text-xs font-mono text-orange-300 text-center whitespace-nowrap">{v}</div>
      <div className="hidden sm:block bg-gray-900/50 px-3 py-2 text-xs text-gray-500">{n}</div>
    </>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
          <Sparkles size={18} className="text-orange-400" /> Qualité & Calibration
        </h2>
        <p className="text-sm text-gray-400">
          Une impression « impeccable » = <strong>70 % calibration</strong> (à faire une fois) +
          <strong> 30 % réglages slicer</strong>. À suivre dans l’ordre ci-dessous.
        </p>
      </div>

      {/* Sélecteur de section */}
      <div className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const on = active === s.key;
          return (
            <button
              key={s.key}
              onClick={() => setActive(s.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition-all ${
                on ? 'border-orange-500 bg-orange-500/10 text-orange-300'
                   : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:text-gray-200'
              }`}
            >
              <Icon size={14} className={on ? 'text-orange-400' : s.color} />
              {s.label}
            </button>
          );
        })}
      </div>

      {/* ─── ANTI-CHEVELURE PETG ─────────────────────────────────────────── */}
      {active === 'stringing' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-cyan-900/50 bg-cyan-950/20 flex gap-3">
            <AlertTriangle size={16} className="text-cyan-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-cyan-100 space-y-1">
              <p className="font-medium text-cyan-300">Cause n°1 de la chevelure en PETG : le filament HUMIDE</p>
              <p>Le PETG absorbe l’humidité de l’air. Humide = il « pète » à la sortie de la buse et fait des fils.
                <strong> Sécher la bobine (65 °C, 4-6 h)</strong> règle 80 % du stringing à lui seul.</p>
            </div>
          </div>

          <p className="text-sm text-gray-300 font-medium">Dans l’ordre, contre la chevelure PETG :</p>
          <div className="rounded-xl border border-gray-800 overflow-hidden">
            <div className="grid grid-cols-[1.3fr_auto_1.4fr] gap-px bg-gray-800">
              <div className="bg-gray-900 px-3 py-2 text-xs font-medium text-gray-400">Réglage</div>
              <div className="bg-gray-900 px-3 py-2 text-xs font-medium text-gray-400 text-center">Valeur</div>
              <div className="hidden sm:block bg-gray-900 px-3 py-2 text-xs font-medium text-gray-400">Pourquoi</div>
              <Row k="1. Sécher le filament" v="65°C · 4-6h" n="LE point clé. Sécheuse ou four." />
              <Row k="2. Température buse" v="235-240°C" n="Trop chaud = coule. Baisse par 5° (temp tower)." />
              <Row k="3. Rétraction (HGX Lite)" v="0.5-0.8 mm" n="Monte à 0.7 si ça file encore" />
              <Row k="4. Vitesse de déplacement" v="250-350 mm/s" n="Déplacement rapide = moins le temps de couler" />
              <Row k="5. Essuyer lors des rétractions" v="Activé" n="OrcaSlicer → Forçage → Wipe" />
              <Row k="6. Saut en Z (Z-hop)" v="0.2 mm" n="Évite d’accrocher les fils déjà posés" />
              <Row k="7. Température volume/hotend" v="—" n="Ne pas trop ventiler le PETG (délamination)" />
            </div>
          </div>
          <div className="p-4 rounded-lg border border-gray-800 bg-gray-900/40 text-xs text-gray-400 space-y-1">
            <p className="text-gray-200 font-medium mb-1">Test rapide</p>
            <p>Imprime un <strong>« stringing test »</strong> (2 tours espacés) depuis le menu Calibration d’OrcaSlicer,
              baisse la température de 5 °C entre chaque essai jusqu’à ce que les fils disparaissent.</p>
          </div>
        </div>
      )}

      {/* ─── INPUT SHAPER ────────────────────────────────────────────────── */}
      {active === 'shaper' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-orange-900/50 bg-orange-950/20 flex gap-3">
            <AlertTriangle size={16} className="text-orange-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-orange-100 space-y-1">
              <p className="font-medium text-orange-300">L’Input Shaper supprime le « ghosting »</p>
              <p>Le ghosting = les échos/fantômes que tu vois après chaque angle sur les parois. Ça vient des
                vibrations, pas du slicer. L’ADXL345 de ton EBB42 mesure les résonances et Klipper les compense.</p>
            </div>
          </div>

          <div className="space-y-3 text-sm text-gray-300">
            <p className="font-medium">Procédure (console Mainsail / Klipper) :</p>
            <div>
              <p className="flex items-center gap-1 text-xs text-gray-400 mb-1"><ChevronRight size={12} /> 1. Vérifier le bruit de fond de l’accéléromètre (imprimante à l’arrêt) :</p>
              <Code id="s1">MEASURE_AXES_NOISE</Code>
              <p className="text-xs text-gray-500 mt-1">Chaque axe doit être &lt; ~100. Si &gt; 300, câble ADXL mal branché.</p>
            </div>
            <div>
              <p className="flex items-center gap-1 text-xs text-gray-400 mb-1"><ChevronRight size={12} /> 2. Home puis lancer la calibration automatique (mesure X et Y, choisit le shaper) :</p>
              <Code id="s2">{`G28
SHAPER_CALIBRATE`}</Code>
              <p className="text-xs text-gray-500 mt-1">Ça bouge sur chaque axe ~30 s. Klipper propose un shaper (ex : MZV, EI) et une fréquence.</p>
            </div>
            <div>
              <p className="flex items-center gap-1 text-xs text-gray-400 mb-1"><ChevronRight size={12} /> 3. Sauvegarder dans le printer.cfg :</p>
              <Code id="s3">SAVE_CONFIG</Code>
              <p className="text-xs text-gray-500 mt-1">L’imprimante redémarre avec [input_shaper] enregistré. C’est fait pour de bon.</p>
            </div>
          </div>

          <div className="p-4 rounded-lg border border-gray-800 bg-gray-900/40 text-xs text-gray-400 space-y-1">
            <p className="text-gray-200 font-medium mb-1">Bonus — Pressure Advance (coins nets)</p>
            <p>Après l’Input Shaper, calibre le <strong>Pressure Advance</strong> : c’est ce qui donne des coins nets
              (pas de renflement ni de manque). Le plus simple = le test <em>Pressure Advance</em> du menu Calibration
              d’OrcaSlicer (onglet Calibration OrcaSlicer ci-contre).</p>
          </div>
        </div>
      )}

      {/* ─── CALIBRATION ORCASLICER ──────────────────────────────────────── */}
      {active === 'orca' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-300">
            OrcaSlicer a un <strong>menu « Calibration »</strong> en haut. Fais ces tests
            <strong> une fois par bobine/marque</strong> — c’est 90 % de la qualité d’une pièce.
          </p>
          <div className="space-y-3">
            {[
              { n: '1', t: 'Temperature tower', d: 'Trouve LA bonne température : moins de chevelure, meilleure adhésion des couches. Imprime la tour, choisis le palier le plus net.', badge: 'PETG 230→250' },
              { n: '2', t: 'Flow rate (Pass 1 puis Pass 2)', d: 'Le plus gros impact sur les parois lisses. Corrige la sur/sous-extrusion. Reporte le facteur trouvé dans le filament.', badge: 'Essentiel' },
              { n: '3', t: 'Pressure Advance', d: 'Coins nets. À faire si pas déjà calibré côté Klipper. Choisis Line method pour commencer.', badge: 'Coins' },
              { n: '4', t: 'Retraction test', d: 'Confirme la longueur de rétraction anti-chevelure (HGX Lite : autour de 0.5-0.8 mm).', badge: 'Anti-fils' },
              { n: '5', t: 'Max volumetric speed', d: 'La vitesse max réelle sans sous-extrusion. Évite les parois qui manquent de matière à grande vitesse.', badge: 'Vitesse' },
            ].map((c) => (
              <div key={c.n} className="flex gap-3 p-3 rounded-lg border border-gray-800 bg-gray-900/40">
                <div className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-300 text-xs font-bold flex items-center justify-center flex-shrink-0">{c.n}</div>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-100">{c.t}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/15 text-purple-300 border border-purple-500/30">{c.badge}</span>
                  </div>
                  <p className="text-xs text-gray-400">{c.d}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="p-4 rounded-lg border border-blue-900/50 bg-blue-950/20 text-xs text-blue-100">
            <p className="font-medium text-blue-300 mb-1">Ordre conseillé pour ton PETG</p>
            <p>Temperature tower → Flow rate (Pass 1 + 2) → Retraction test. Ces 3-là suffisent pour passer de « correct » à « impeccable ».</p>
          </div>
        </div>
      )}

      {/* ─── RÉGLAGES VISUELS ────────────────────────────────────────────── */}
      {active === 'visual' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-300">Une fois calibré, ces réglages OrcaSlicer donnent le rendu « impeccable » :</p>
          <div className="rounded-xl border border-gray-800 overflow-hidden">
            <div className="grid grid-cols-[1.3fr_auto_1.4fr] gap-px bg-gray-800">
              <div className="bg-gray-900 px-3 py-2 text-xs font-medium text-gray-400">Réglage</div>
              <div className="bg-gray-900 px-3 py-2 text-xs font-medium text-gray-400 text-center">Valeur</div>
              <div className="hidden sm:block bg-gray-900 px-3 py-2 text-xs font-medium text-gray-400">Effet</div>
              <Row k="Vitesse paroi extérieure" v="80-150 mm/s" n="LE réglage n°1 du visuel. Plus lent = plus lisse" />
              <Row k="Nombre de parois" v="3-4" n="Solidité + surface régulière" />
              <Row k="Ordre des parois" v="Extérieur d’abord" n="Surface plus lisse (ou Intérieur d’abord pour la précision)" />
              <Row k="Position de la couture (seam)" v="Arrière / Aligné" n="La cicatrice toujours au même endroit, cachée" />
              <Row k="Repassage (Ironing)" v="Dessus" n="Dessus lisse comme du verre" />
              <Row k="Couches solides dessus" v="5" n="Pas de trous sur le dessus" />
              <Row k="Couches solides dessous" v="4" n="Dessous propre" />
              <Row k="Hauteur de couche" v="0.2 mm" n="0.12-0.16 pour les détails fins" />
            </div>
          </div>
          <div className="p-4 rounded-lg border border-gray-800 bg-gray-900/40 text-xs text-gray-400 space-y-1">
            <p className="text-gray-200 font-medium mb-1">Le réflexe qui change tout</p>
            <p>Ralentis <strong>uniquement la paroi extérieure</strong> (pas tout le reste) : tu gardes la vitesse
              partout ailleurs, et seule la surface visible est parfaite. Compromis vitesse/qualité idéal.</p>
          </div>
        </div>
      )}
    </div>
  );
}
