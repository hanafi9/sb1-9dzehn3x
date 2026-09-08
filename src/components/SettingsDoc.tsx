import { Printer, Cpu, Gauge, Thermometer, Sparkles, Scissors, Wrench, FlaskConical, SlidersHorizontal, AlertTriangle, Layers } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
//  Fiche de réglages VCore 3.1 hybride (VzBot + Rapido standard + HGX Lite
//  + Cartographer + CPAP). Version imprimable : bouton « Imprimer / PDF »
//  qui déclenche window.print() avec un style @media print dédié (fond blanc,
//  texte noir, uniquement la fiche — le reste de l'app est masqué).
// ═══════════════════════════════════════════════════════════════════════════

type Row = string[];

interface Block {
  id: string;
  icon: typeof Cpu;
  num: string;
  title: string;
  note: string;
  head: string[];
  rows: Row[];
  /** true = toutes les colonnes de données sont des valeurs (rendu monospace) */
  numeric?: boolean;
}

const BLOCKS: Block[] = [
  {
    id: 'calib', icon: Cpu, num: '01', title: 'Calibration Klipper (la fondation)',
    note: 'À faire dans cet ordre, une fois pour toutes. 70 % du résultat se joue ici.',
    head: ['Étape', 'Commande / valeur', 'But'],
    rows: [
      ['1. Z_TILT_ADJUST', 'dans START_PRINT', 'Portique parfaitement horizontal'],
      ['2. Bed mesh adaptatif', 'BED_MESH_CALIBRATE ADAPTIVE=1', 'Label objects + exclude_object requis'],
      ['3. Z-offset', '1ʳᵉ couche ni écrasée ni décollée', '50 % du rendu et de l’adhérence'],
      ['4. Input Shaper', 'G28 → SHAPER_CALIBRATE → SAVE_CONFIG', 'Supprime le ghosting'],
      ['5. Pressure Advance', '≈ 0.03 (côté Klipper)', 'Coins nets — désactivé côté Orca'],
      ['6. Flow / rotation_distance', 'HGX Lite ≈ 5.56 (À CALIBRER)', 'Parois lisses (Flow Pass 1+2)'],
    ],
  },
  {
    id: 'spool', icon: FlaskConical, num: '02', title: 'Calibration par bobine (menu Calibration d’OrcaSlicer)',
    note: 'LE point qui sépare « correct » de « professionnel ». Aucun réglage copié ne remplace ces 3 tests — deux PETG de marques différentes n’ont pas le même débit.',
    head: ['Test', 'Fréquence', 'Ce que ça corrige'],
    rows: [
      ['1. Flow rate (Pass 1 puis Pass 2)', 'chaque bobine', 'Parois lisses — le plus gros levier visuel'],
      ['2. Pressure Advance (PA Pattern)', 'chaque matériau', 'Coins nets, coutures sans bouton'],
      ['3. Temperature tower', 'chaque bobine', 'Adhésion des couches + zéro chevelure'],
      ['4. Retraction test', 'si stringing', 'Confirme 0.5–0.8 mm (direct drive)'],
      ['5. Max volumetric speed', 'une fois', 'Évite la sous-extrusion à vitesse'],
    ],
  },
  {
    id: 'motion', icon: Gauge, num: '03', title: 'Mouvement — limites réelles de cette machine',
    note: 'Valeurs actuellement dans le printer.cfg. Elles sont volontairement conservatrices (refroidissement des drivers) — et pour de la QUALITÉ c’est parfait : inutile de demander 400 mm/s au slicer, la machine ne suivra pas.',
    head: ['Paramètre', 'Valeur', 'Note'],
    rows: [
      ['max_velocity', '300 mm/s', 'Plafond réel — le slicer ne peut pas dépasser'],
      ['max_accel', '3000', 'Bridé volontairement (drivers TMC2209)'],
      ['square_corner_velocity', '5', 'Défaut RatOS'],
      ['max_z_velocity / max_z_accel', '15 / 30', 'Vis à billes'],
      ['Accél. paroi extérieure (slicer)', '2000', 'Sous le plafond machine = paroi plus propre'],
      ['Si tu veux plus de vitesse', 'Input Shaper d’abord', 'Puis monter max_accel par paliers'],
    ],
  },
  {
    id: 'fil', icon: Thermometer, num: '04', title: 'Profils filament complets',
    note: 'Rapido HF + HGX Lite direct drive, buse 0.4, refroidissement CPAP (d’où les % de ventilo bas — le CPAP à 40 % souffle déjà comme un ventilo classique à fond).',
    numeric: true,
    head: ['Matériau', 'Buse 1ʳᵉ/autres', 'Plateau', 'Ventilo', 'Vol. max', 'Débit', 'Paroi ext.'],
    rows: [
      ['PLA', '215 / 210', '60', '70–100 %', '15', '0.98', '100–150'],
      ['PETG', '240 / 240', '80', '30–50 %', '12', '0.95', '80–100'],
      ['ABS', '250 / 245', '105 / 100', '0–20 %', '14', '0.95', '80–120'],
      ['ABS+', '255 / 250', '105 / 100', '0–15 %', '13', '0.96', '80–120'],
      ['TPU 95A', '230 / 225', '45 / 40', '50–80 %', '4', '0.95', '15–30'],
      ['Carbone (PETG-CF)', '255 / 250', '80', '30–40 %', '10', '0.95', '80–100'],
    ],
  },
  {
    id: 'trap', icon: AlertTriangle, num: '05', title: 'Le piège de chaque matériau',
    note: 'Ce qui fait rater une impression, matériau par matériau.',
    head: ['Matériau', 'Le piège', 'La parade'],
    rows: [
      ['PLA', 'Aucun — le plus facile', 'Avec CPAP, 100 % est parfois trop : essaie 70-80 %'],
      ['PETG', 'Filament humide + il arrache le PEI nu', 'Sécher 65 °C 4-6 h + bâton de colle sur le PEI'],
      ['ABS / ABS+', 'Warping', 'Caisson FERMÉ et chaud (40-50 °C), zéro courant d’air, brim 8 mm'],
      ['TPU', 'Bouchage à la rétraction', 'Imprimer lentement (15-30 mm/s), rétraction 0.4 mm'],
      ['Carbone', 'Détruit une buse laiton en 1 bobine', 'Buse acier trempé OBLIGATOIRE, 0.6 conseillée'],
    ],
  },
  {
    id: 'base', icon: SlidersHorizontal, num: '06', title: 'Base commune — qualité professionnelle',
    note: 'Réglages identiques pour tous les matériaux, une fois la calibration faite.',
    head: ['Réglage', 'Valeur', 'Note'],
    rows: [
      ['Hauteur de couche', '0.2 mm', '0.12–0.16 pour les détails fins'],
      ['Hauteur 1ʳᵉ couche', '0.25 mm', 'Meilleure accroche'],
      ['Largeur d’extrusion', '0.42 mm (1ʳᵉ : 0.45)', 'Buse 0.4'],
      ['Nombre de parois', '3 (4 en pièce technique)', ''],
      ['Couches solides dessus / dessous', '5 / 4', 'Pas de trous sur le dessus'],
      ['Remplissage', '15 % gyroïde (25–40 % technique)', ''],
      ['Vitesse paroi intérieure', '200 mm/s', ''],
      ['Vitesse remplissage', '250 mm/s', ''],
      ['Vitesse 1ʳᵉ couche', '30 mm/s', 'Ne jamais se presser ici'],
    ],
  },
  {
    id: 'qual', icon: Sparkles, num: '07', title: 'Les 4 réglages « finition pro »',
    note: 'Ceux qui font vraiment la différence à l’œil. Levier n°1 : ralentir la paroi extérieure SEULE (le reste garde sa vitesse).',
    head: ['Réglage', 'Valeur', 'Effet'],
    rows: [
      ['Vitesse paroi extérieure', '80–100 mm/s', '⭐ Le levier n°1 du rendu'],
      ['Joint en sifflet (scarf)', 'Contour', '⭐ Coutures quasi invisibles'],
      ['Position de couture', 'Aligné ou Arrière', 'Cicatrice cachée, toujours au même endroit'],
      ['Repassage (Ironing)', 'Dessus', 'Surface lisse comme du verre'],
      ['Ordre des parois', 'Extérieur d’abord', 'Surface plus nette'],
      ['Écart de couture (seam gap)', '10–15 %', 'Compense l’oozing du PETG'],
    ],
  },
  {
    id: 'sup', icon: Scissors, num: '08', title: 'Supports (faciles à enlever)',
    note: 'Le coupable des supports soudés : la Distance Z sup. à 0.',
    head: ['Réglage', 'Valeur', 'Note'],
    rows: [
      ['Distance Z supérieure', '0.2 mm', 'PLA. 0 = soudé, casse'],
      ['Distance Z sup. (PETG/CF)', '0.25–0.3 mm', 'Ils collent plus'],
      ['Angle de seuil', '40–45°', 'JAMAIS 0'],
      ['Type', 'Arbre (auto)', 'Peu de contact'],
      ['Densité', '8–12 %', 'Moins accroché'],
      ['Espacement interface', '0.2–0.3 mm', 'Jamais 0'],
      ['Sur plateau uniquement', 'Activé', 'Rien au milieu'],
    ],
  },
  {
    id: 'trouble', icon: Wrench, num: '09', title: 'Dépannage express',
    note: 'Les pannes rencontrées sur cette machine et leur cause réelle.',
    head: ['Symptôme', 'Cause réelle', 'Correctif'],
    rows: [
      ['ADC out of range / temp 349–433°', 'Thermistance débranchée (pas surchauffe)', 'Rebrancher TH0 / fils Rapido'],
      ['Chevelure PETG', 'Filament humide, buse trop chaude', 'Sécher 65° 4-6h, buse −5°, rétr. 0.5-0.7'],
      ['Supports impossibles', 'Distance Z sup = 0, angle = 0', 'Z sup 0.2, angle 40, Arbre'],
      ['Bed mesh aberrant', 'Bobine Cartographer hors plage', 'horizontal_move_z: 2'],
      ['Scanner CAN décroche', 'Terminaison CAN manquante', '120 Ω (can0.service)'],
      ['Ghosting', 'Résonances', 'SHAPER_CALIBRATE + SAVE_CONFIG'],
      ['Lignes désalignées en hauteur', 'SUR-EXTRUSION (rotation_distance faux) en 1er', 'Calibrer rotation_distance (test 100 mm)'],
      ['… si rotation_distance est bon', 'Courroies / Z_TILT / portique', 'Retendre courroies, Z_TILT, châssis équerre'],
      ['Parois bombées, buse qui racle', 'rotation_distance trop PETIT = trop de matière', 'HGX Lite ≈ 5.56, PAS 4.637 (Orbiter)'],
    ],
  },
];

export function SettingsDoc() {
  return (
    <div className="space-y-6">
      {/* Barre d'action — masquée à l'impression */}
      <div className="no-print flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">Fiche de réglages — VCore 3.1 hybride</h2>
          <p className="text-sm text-gray-400 max-w-2xl">
            Tous les réglages optimaux (calibration, filaments, qualité, supports, dépannage) pour ton montage
            VzBot + Rapido + HGX Lite + Cartographer. Bouton ci-contre pour imprimer ou générer un PDF.
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium transition-all"
        >
          <Printer size={15} />
          Imprimer / PDF
        </button>
      </div>

      {/* Zone imprimable */}
      <div id="fiche-print" className="space-y-8">
        <div className="print-only hidden">
          <h1 className="text-2xl font-bold">VCore 3.1 Hybride — Fiche de réglages</h1>
          <p>VzBot · Rapido (standard) · HGX Lite · Cartographer · CPAP · RatOS v2.1</p>
        </div>

        {BLOCKS.map((b) => {
          const Icon = b.icon;
          return (
            <section key={b.id} className="break-inside-avoid">
              <div className="flex items-baseline gap-3 mb-1">
                <span className="font-mono text-sm text-orange-400 font-semibold">{b.num}</span>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Icon size={17} className="text-orange-400 no-print" /> {b.title}
                </h3>
              </div>
              <p className="text-sm text-gray-400 mb-3 max-w-3xl">{b.note}</p>
              <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr>
                      {b.head.map((h) => (
                        <th key={h} className="text-left font-mono text-[11px] uppercase tracking-wide text-gray-400 px-4 py-2.5 border-b border-gray-700 bg-gray-900 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, i) => (
                      <tr key={i} className="border-b border-gray-800 last:border-0">
                        {r.map((cell, j) => (
                          <td
                            key={j}
                            className={`px-4 py-2.5 align-top ${
                              j === 0
                                ? 'text-gray-200 font-medium'
                                : b.numeric || j === 1
                                ? 'font-mono text-orange-300 whitespace-nowrap tabular-nums'
                                : 'text-gray-500 text-[13px]'
                            }`}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}

        {/* Verdict slicer */}
        <section className="break-inside-avoid">
          <div className="flex items-baseline gap-3 mb-1">
            <span className="font-mono text-sm text-orange-400 font-semibold">10</span>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Layers size={17} className="text-orange-400 no-print" /> Quel slicer ?
            </h3>
          </div>
          <p className="text-sm text-gray-400 mb-3 max-w-3xl">
            Pour une machine Klipper qu’on veut calibrer finement, le choix est tranché.
          </p>
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  {['Slicer', 'Verdict', 'Pourquoi'].map((h) => (
                    <th key={h} className="text-left font-mono text-[11px] uppercase tracking-wide text-gray-400 px-4 py-2.5 border-b border-gray-700 bg-gray-900 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-800">
                  <td className="px-4 py-2.5 text-gray-200 font-medium">OrcaSlicer</td>
                  <td className="px-4 py-2.5 font-mono text-green-400 whitespace-nowrap">★ LE choix</td>
                  <td className="px-4 py-2.5 text-gray-500 text-[13px]">Suite de calibration intégrée (flow, PA, temp tower) + support Klipper natif + joint en sifflet. Décisif ici.</td>
                </tr>
                <tr className="border-b border-gray-800">
                  <td className="px-4 py-2.5 text-gray-200 font-medium">PrusaSlicer</td>
                  <td className="px-4 py-2.5 font-mono text-gray-400 whitespace-nowrap">Bon 2ᵉ</td>
                  <td className="px-4 py-2.5 text-gray-500 text-[13px]">Très stable, supports organiques excellents — mais AUCUNE suite de calibration.</td>
                </tr>
                <tr className="border-b border-gray-800">
                  <td className="px-4 py-2.5 text-gray-200 font-medium">Cura</td>
                  <td className="px-4 py-2.5 font-mono text-gray-400 whitespace-nowrap">Correct</td>
                  <td className="px-4 py-2.5 text-gray-500 text-[13px]">Riche en plugins, mais lourd et support Klipper plus faible.</td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 text-gray-200 font-medium">SuperSlicer</td>
                  <td className="px-4 py-2.5 font-mono text-red-400 whitespace-nowrap">À éviter</td>
                  <td className="px-4 py-2.5 text-gray-500 text-[13px]">Était formidable, aujourd’hui à l’abandon.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* G-code START_PRINT */}
        <section className="break-inside-avoid">
          <div className="flex items-baseline gap-3 mb-2">
            <span className="font-mono text-sm text-orange-400 font-semibold">11</span>
            <h3 className="text-lg font-bold text-white">G-code de début OrcaSlicer</h3>
          </div>
          <div className="rounded-lg border border-gray-700 bg-gray-950/60 px-4 py-3 overflow-x-auto">
            <code className="font-mono text-[13px] text-gray-200 whitespace-pre">
              <span className="text-orange-300">START_PRINT</span> EXTRUDER_TEMP=[nozzle_temperature_initial_layer] BED_TEMP=[bed_temperature_initial_layer_single]
            </code>
          </div>
          <p className="text-xs text-gray-500 mt-2">Le reste (Z_TILT, mesh adaptatif, chauffe, purge) est dans la macro START_PRINT du printer.cfg.</p>
        </section>
      </div>

      {/* Styles d'impression : n'imprime que la fiche, en fond blanc / texte noir */}
      <style>{`
        @media print {
          @page { margin: 14mm; }
          body { background: #fff !important; }
          body * { visibility: hidden; }
          #fiche-print, #fiche-print * { visibility: visible; }
          #fiche-print { position: absolute; left: 0; top: 0; width: 100%; color: #111 !important; }
          #fiche-print .print-only { display: block !important; margin-bottom: 16px; }
          #fiche-print h1, #fiche-print h3 { color: #111 !important; }
          #fiche-print h1 { border-bottom: 2px solid #dd5a1c; padding-bottom: 6px; }
          #fiche-print p { color: #333 !important; }
          #fiche-print .text-gray-400, #fiche-print .text-gray-500 { color: #444 !important; }
          #fiche-print .text-orange-400, #fiche-print .text-orange-300 { color: #c2410c !important; }
          #fiche-print table, #fiche-print .rounded-xl, #fiche-print .rounded-lg { background: #fff !important; border-color: #ccc !important; }
          #fiche-print thead th { background: #f4f0ea !important; color: #555 !important; border-color: #ccc !important; }
          #fiche-print td { color: #222 !important; border-color: #e2e2e2 !important; }
          #fiche-print td.font-mono, #fiche-print code { color: #c2410c !important; }
          #fiche-print .break-inside-avoid { break-inside: avoid; }
          .no-print { display: none !important; }
        }
        .print-only { display: none; }
      `}</style>
    </div>
  );
}
