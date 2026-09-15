import { useState, Fragment } from 'react';
import { Copy, Check, Scissors, AlertTriangle, Lightbulb, Rotate3D } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
//  Réglages SUPPORTS OrcaSlicer — pour des supports qui s'enlèvent SANS casser.
//
//  Le coupable n°1 des supports « soudés » : la Distance Z supérieure à 0.
//  Elle doit valoir ~1 hauteur de couche (0.2 mm) — plus en PETG/ABS qui collent.
//  Réglages pensés pour VCore 3.1 (surplombs OK jusqu'à ~45-50° sans support).
// ═══════════════════════════════════════════════════════════════════════════

interface Row {
  field: string;      // libellé OrcaSlicer (FR)
  value: string;      // valeur conseillée
  note?: string;      // pourquoi
}

interface MatSupport {
  key: string;
  label: string;
  color: string;
  desc: string;
  rows: Row[];
}

const MATERIALS: MatSupport[] = [
  {
    key: 'pla',
    label: 'PLA',
    color: 'text-green-400',
    desc: 'Le plus facile — supports nets si Z sup = 0.2',
    rows: [
      { field: 'Distance Z supérieure', value: '0.2 mm', note: '= 1 hauteur de couche. LE réglage clé' },
      { field: 'Angle de seuil', value: '40°', note: 'PAS 0 (0 = supports partout)' },
      { field: 'Type', value: 'Arbre (auto)', note: 'Touche la pièce en peu de points' },
      { field: 'Densité de support', value: '10 %', note: 'Moins de matière = moins accroché' },
      { field: 'Couches d’interface sup.', value: '2', note: 'Surface propre sans souder' },
      { field: 'Espacement de l’interface', value: '0.2 mm', note: 'Jamais 0' },
      { field: 'Motif d’interface', value: 'Rectilinéaire', note: 'Se décolle mieux' },
    ],
  },
  {
    key: 'petg',
    label: 'PETG',
    color: 'text-cyan-400',
    desc: 'Le pire — il colle à lui-même, augmente le gap Z',
    rows: [
      { field: 'Distance Z supérieure', value: '0.28 mm', note: 'PETG colle : + de gap qu’en PLA' },
      { field: 'Angle de seuil', value: '45°', note: 'Le moins de supports possible' },
      { field: 'Type', value: 'Arbre (auto)', note: 'Moins de contact = plus facile' },
      { field: 'Densité de support', value: '8 %', note: 'Le PETG accroche fort' },
      { field: 'Couches d’interface sup.', value: '2', note: 'Ou 0 pour arracher plus facile' },
      { field: 'Espacement de l’interface', value: '0.3 mm', note: 'Plus large = moins soudé' },
      { field: 'Distance Z inf. (interface)', value: '0.25 mm', note: 'Décolle la base du support' },
    ],
  },
  {
    key: 'abs',
    label: 'ABS / ABS+',
    color: 'text-orange-400',
    desc: 'Caisson chaud — gap Z modéré',
    rows: [
      { field: 'Distance Z supérieure', value: '0.24 mm', note: 'Entre PLA et PETG' },
      { field: 'Angle de seuil', value: '40°', note: 'Limiter les supports' },
      { field: 'Type', value: 'Arbre (auto)', note: 'Enlèvement plus propre' },
      { field: 'Densité de support', value: '10 %', note: '' },
      { field: 'Couches d’interface sup.', value: '2', note: '' },
      { field: 'Espacement de l’interface', value: '0.25 mm', note: '' },
      { field: 'Motif d’interface', value: 'Rectilinéaire', note: '' },
    ],
  },
  {
    key: 'tpu',
    label: 'TPU',
    color: 'text-purple-400',
    desc: 'Cauchemar — évite les supports, réoriente plutôt',
    rows: [
      { field: 'Distance Z supérieure', value: '0.3 mm', note: 'Le flexible s’arrache mal' },
      { field: 'Angle de seuil', value: '30°', note: 'Le TPU tient des surplombs raides' },
      { field: 'Type', value: 'Normal (auto)', note: 'L’arbre se déforme en flexible' },
      { field: 'Densité de support', value: '8 %', note: 'Le moins possible' },
      { field: 'Couches d’interface sup.', value: '0', note: 'Sinon impossible à décoller' },
      { field: 'Conseil', value: 'RÉORIENTER', note: 'En TPU : éviter les supports > tout régler' },
    ],
  },
  {
    key: 'carbone',
    label: 'Carbone (PETG-CF)',
    color: 'text-slate-300',
    desc: 'Rigide et cassant — gap Z généreux',
    rows: [
      { field: 'Distance Z supérieure', value: '0.3 mm', note: 'Cassant : gros gap pour ne pas forcer' },
      { field: 'Angle de seuil', value: '45°', note: 'Minimiser les supports' },
      { field: 'Type', value: 'Arbre (auto)', note: 'Peu de points de contact' },
      { field: 'Densité de support', value: '8 %', note: '' },
      { field: 'Couches d’interface sup.', value: '2', note: '' },
      { field: 'Espacement de l’interface', value: '0.3 mm', note: 'Le CF rigide casse si soudé' },
    ],
  },
];

export function SupportSettings() {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  const mat = MATERIALS[active];

  const copy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1800);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Réglages Supports OrcaSlicer</h2>
        <p className="text-sm text-gray-400">
          Pour des supports qui se retirent <strong>sans casser la pièce</strong>. À appliquer dans
          l’onglet <em>Support</em> des réglages de traitement (l’icône <span className="text-gray-300">Traitement ⚙️</span>).
        </p>
      </div>

      {/* Règle d'or */}
      <div className="p-4 rounded-lg border border-amber-900/50 bg-amber-950/20 flex gap-3">
        <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-amber-100 space-y-1">
          <p className="font-medium text-amber-300">La règle d’or : la « Distance Z supérieure »</p>
          <p>C’est le vide laissé <em>au-dessus</em> du support. À <code className="bg-amber-900/30 px-1 rounded">0</code> les
            supports sont <strong>soudés</strong> à la pièce → impossibles à enlever, casse. À
            <code className="bg-amber-900/30 px-1 rounded mx-1">0.2 mm</code> (1 hauteur de couche) ils se détachent nets.
            Plus le matériau colle (PETG, CF), plus on augmente ce vide.</p>
        </div>
      </div>

      {/* Sélecteur matériau */}
      <div className="flex flex-wrap gap-2">
        {MATERIALS.map((m, i) => (
          <button
            key={m.key}
            onClick={() => setActive(i)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition-all ${
              i === active
                ? 'border-orange-500 bg-orange-500/10 text-orange-300'
                : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:text-gray-200'
            }`}
          >
            <Scissors size={14} className={i === active ? 'text-orange-400' : m.color} />
            {m.label}
          </button>
        ))}
      </div>

      <div className="text-sm text-gray-400">
        <span className={`font-medium ${mat.color}`}>{mat.label}</span> — {mat.desc}
      </div>

      {/* Tableau des réglages */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
        <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1.2fr_auto_1.4fr] gap-px bg-gray-800">
          <div className="bg-gray-900 px-4 py-2 text-xs font-medium text-gray-400">Champ OrcaSlicer</div>
          <div className="bg-gray-900 px-4 py-2 text-xs font-medium text-gray-400 text-center">Valeur</div>
          <div className="hidden sm:block bg-gray-900 px-4 py-2 text-xs font-medium text-gray-400">Pourquoi</div>
          {mat.rows.map((r) => {
            const k = `${mat.key}-${r.field}`;
            return (
              <Fragment key={k}>
                <div className="bg-gray-900/60 px-4 py-2.5 text-sm text-gray-200">{r.field}</div>
                <div className="bg-gray-900/60 px-4 py-2.5 flex items-center justify-center gap-2">
                  <span className="text-sm font-mono text-orange-300 whitespace-nowrap">{r.value}</span>
                  <button
                    onClick={() => copy(k, r.value)}
                    className="text-gray-500 hover:text-gray-200 transition-colors"
                    title="Copier"
                  >
                    {copied === k ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                  </button>
                </div>
                <div className="hidden sm:block bg-gray-900/60 px-4 py-2.5 text-xs text-gray-500">{r.note}</div>
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* Principes de fond */}
      <div className="p-4 rounded-lg border border-blue-900/50 bg-blue-950/20 flex gap-3">
        <Lightbulb size={16} className="text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-100 space-y-1.5">
          <p className="font-medium text-blue-300">Le meilleur support, c’est pas de support</p>
          <p className="flex gap-2"><Rotate3D size={13} className="flex-shrink-0 mt-0.5 text-blue-300" />
            <span><strong>Réoriente la pièce</strong> (clic droit → orientation optimale) : ça supprime souvent 80 % des supports.</span></p>
          <p>• Ta VCore imprime les surplombs <strong>jusqu’à ~45-50° sans support</strong> — d’où l’angle de seuil à 40-45°.</p>
          <p>• Coche <strong>« Supports sur plateau uniquement »</strong> : pas de supports au milieu de la pièce, bien plus faciles à retirer.</p>
          <p>• Supports <strong>Arbre (auto)</strong> = beaucoup moins de points de contact que les supports normaux → s’arrachent tout seuls.</p>
        </div>
      </div>

      <div className="p-4 rounded-lg border border-gray-800 bg-gray-900/40 text-xs text-gray-400 space-y-1">
        <p className="text-gray-200 font-medium mb-1">Si ça casse encore</p>
        <p>1. Augmente la <strong>Distance Z supérieure</strong> de 0.05 mm et re-teste.</p>
        <p>2. Passe l’<strong>espacement de l’interface</strong> plus large (0.3 → 0.35 mm).</p>
        <p>3. Baisse la <strong>densité</strong> et les <strong>couches d’interface</strong> (2 → 1 → 0).</p>
        <p>4. En dernier recours : réoriente ou fends la pièce en deux à coller.</p>
      </div>
    </div>
  );
}
