import { Printer, Cpu, Gauge, Thermometer, Sparkles, Scissors, Wrench, AlertTriangle } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
//  Fiche de réglages VCore 3.1 hybride (VzBot + Rapido standard + Orbiter 2.0
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
      ['6. Flow / rotation_distance', 'Orbiter 2.0 ≈ 4.637', 'Parois lisses (Flow Pass 1+2)'],
    ],
  },
  {
    id: 'motion', icon: Gauge, num: '02', title: 'Mouvement',
    note: 'Chariot VzBot plus léger → tu peux pousser l’accél. après Input Shaper.',
    head: ['Paramètre', 'Valeur', 'Note'],
    rows: [
      ['max_velocity', '500 mm/s', 'Plafond confortable VCore3'],
      ['max_accel', '7000 → 10000', 'Monter après Input Shaper validé'],
      ['square_corner_velocity', '5', 'Défaut RatOS'],
      ['max_z_velocity', '15 mm/s', 'Vis à billes'],
      ['Accél. paroi extérieure', '≤ 3000', 'Bride la paroi visible (slicer)'],
    ],
  },
  {
    id: 'fil', icon: Thermometer, num: '03', title: 'Profils filament (OrcaSlicer)',
    note: 'Rapido + Orbiter 2.0 direct drive, buse 0.4. Rétraction 0.5 mm, PA géré par Klipper. CPAP = ventilo bas.',
    head: ['Matériau', 'Buse', 'Plateau', 'Ventilo', 'Vol. max'],
    rows: [
      ['PLA', '210 / 215', '60', '100 %', '15'],
      ['PETG', '240', '80', '30–50 %', '12'],
      ['ABS', '245 / 250', '100–105', '0–20 %', '14'],
      ['ABS+', '250 / 255', '100–105', '0–15 %', '13'],
      ['TPU 95A', '225', '40–45', '50–80 %', '4'],
      ['Carbone (PETG-CF)', '250', '80', '30–40 %', '10'],
    ],
  },
  {
    id: 'qual', icon: Sparkles, num: '04', title: 'Qualité visuelle',
    note: 'Une fois calibré. Levier n°1 : ralentir la paroi extérieure seule.',
    head: ['Réglage', 'Valeur', 'Effet'],
    rows: [
      ['Vitesse paroi extérieure', '80–150 mm/s', 'Le plus lisse'],
      ['Nombre de parois', '3–4', 'Solidité + régularité'],
      ['Ordre des parois', 'Extérieur d’abord', 'Surface plus nette'],
      ['Position de couture', 'Arrière / Aligné', 'Cicatrice cachée'],
      ['Repassage (Ironing)', 'Dessus', 'Dessus lisse'],
      ['Couches solides dessus / dessous', '5 / 4', 'Pas de trous'],
      ['Hauteur de couche', '0.2 mm', '0.12–0.16 pour les détails'],
    ],
  },
  {
    id: 'sup', icon: Scissors, num: '05', title: 'Supports (faciles à enlever)',
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
    id: 'trouble', icon: Wrench, num: '06', title: 'Dépannage express',
    note: 'Les pannes rencontrées sur cette machine et leur cause réelle.',
    head: ['Symptôme', 'Cause réelle', 'Correctif'],
    rows: [
      ['ADC out of range / temp 349–433°', 'Thermistance débranchée (pas surchauffe)', 'Rebrancher TH0 / fils Rapido'],
      ['Chevelure PETG', 'Filament humide, buse trop chaude', 'Sécher 65° 4-6h, buse −5°, rétr. 0.5-0.7'],
      ['Supports impossibles', 'Distance Z sup = 0, angle = 0', 'Z sup 0.2, angle 40, Arbre'],
      ['Bed mesh aberrant', 'Bobine Cartographer hors plage', 'horizontal_move_z: 2'],
      ['Scanner CAN décroche', 'Terminaison CAN manquante', '120 Ω (can0.service)'],
      ['Ghosting', 'Résonances', 'SHAPER_CALIBRATE + SAVE_CONFIG'],
      ['Lignes désalignées en hauteur', 'Courroies / Z_TILT / portique', 'Retendre courroies, Z_TILT, châssis équerre'],
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
            VzBot + Rapido + Orbiter 2.0 + Cartographer. Bouton ci-contre pour imprimer ou générer un PDF.
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
          <p>VzBot · Rapido (standard) · Orbiter 2.0 · Cartographer · CPAP · RatOS v2.1</p>
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
                                : j === 1
                                ? 'font-mono text-orange-300 whitespace-nowrap'
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

        {/* G-code START_PRINT */}
        <section className="break-inside-avoid">
          <div className="flex items-baseline gap-3 mb-2">
            <span className="font-mono text-sm text-orange-400 font-semibold">07</span>
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
