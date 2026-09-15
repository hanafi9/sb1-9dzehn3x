import { useState } from 'react';
import { Copy, Check, Download, Eye, Camera, Bot, Pause, Bell, AlertTriangle } from 'lucide-react';
import { useMoonrakerConnection } from '../lib/moonraker';

// ═══════════════════════════════════════════════════════════════════════════
//  Détection d'anomalie d'impression — équivalent maison d'Obico / Spaghetti
//  Detective, via n8n + GPT-4o vision. Génère le workflow n8n importable.
// ═══════════════════════════════════════════════════════════════════════════

function buildWorkflow(opts: {
  printerIp: string;
  webcamUrl: string;
  intervalSec: number;
  threshold: number;
}): string {
  const { printerIp, webcamUrl, intervalSec, threshold } = opts;
  const moon = `http://${printerIp}:7125`;
  const wf = {
    name: 'Détection anomalie impression (GPT-4o)',
    nodes: [
      {
        parameters: { rule: { interval: [{ field: 'seconds', secondsInterval: intervalSec }] } },
        id: '11111111-1111-4111-8111-111111111111',
        name: `Toutes les ${intervalSec}s`,
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.2,
        position: [0, 300],
      },
      {
        parameters: { url: `${moon}/printer/objects/query?print_stats&gcode_macro AI_GUARD`, options: {} },
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Moonraker état',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [220, 300],
      },
      {
        parameters: {
          conditions: {
            options: { caseSensitive: true, version: 2 },
            conditions: [{
              leftValue: '={{ $json.result.status.print_stats.state }}',
              rightValue: 'printing',
              operator: { type: 'string', operation: 'equals' },
            }, {
              leftValue: "={{ $json.result.status['gcode_macro AI_GUARD'].enabled }}",
              rightValue: 1,
              operator: { type: 'number', operation: 'equals' },
            }],
            combinator: 'and',
          },
          options: {},
        },
        id: '33333333-3333-4333-8333-333333333333',
        name: 'En impression ?',
        type: 'n8n-nodes-base.if',
        typeVersion: 2,
        position: [440, 300],
      },
      {
        parameters: {
          url: webcamUrl,
          options: { response: { response: { responseFormat: 'file', outputPropertyName: 'data' } } },
        },
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Snapshot webcam',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [660, 200],
      },
      {
        parameters: {
          mode: 'runOnceForEachItem',
          jsCode: '// La donnée binaire de n8n est déjà en base64 dans .data\nconst b64 = $input.item.binary.data.data;\nreturn { json: { imageB64: b64 } };',
        },
        id: '55555555-5555-4555-8555-555555555555',
        name: 'Image → base64',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [880, 200],
      },
      {
        parameters: {
          method: 'POST',
          url: 'https://api.openai.com/v1/chat/completions',
          sendHeaders: true,
          headerParameters: { parameters: [{ name: 'Authorization', value: 'Bearer VOTRE_CLE_OPENAI' }] },
          sendBody: true,
          specifyBody: 'json',
          jsonBody: '={\n  "model": "gpt-4o",\n  "max_tokens": 200,\n  "response_format": { "type": "json_object" },\n  "messages": [\n    {\n      "role": "user",\n      "content": [\n        { "type": "text", "text": "Tu es un détecteur d\'échec d\'impression 3D FDM. Analyse l\'image de la webcam. Réponds STRICTEMENT en JSON: {\\"echec\\": true ou false, \\"confiance\\": nombre 0.0 à 1.0, \\"raison\\": texte court}. Mets echec=true UNIQUEMENT si tu vois clairement des spaghettis de filament, un amas de filament, un décollement net de la pièce, ou une pièce arrachée du plateau. En cas de doute ou de vue normale, echec=false." },\n        { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,{{ $json.imageB64 }}" } }\n      ]\n    }\n  ]\n}',
          options: {},
        },
        id: '66666666-6666-4666-8666-666666666666',
        name: 'GPT-4o Vision',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [1100, 200],
      },
      {
        parameters: {
          mode: 'runOnceForEachItem',
          jsCode: "// Le modèle renvoie une chaîne JSON dans message.content\nconst txt = $input.item.json.choices[0].message.content;\nlet v;\ntry { v = JSON.parse(txt); }\ncatch (e) { v = { echec: false, confiance: 0, raison: 'reponse illisible' }; }\nreturn { json: v };",
        },
        id: '77777777-7777-4777-8777-777777777777',
        name: 'Lecture verdict',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [1320, 200],
      },
      {
        parameters: {
          conditions: {
            options: { version: 2 },
            conditions: [
              { leftValue: '={{ $json.echec }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } },
              { leftValue: '={{ $json.confiance }}', rightValue: threshold, operator: { type: 'number', operation: 'gte' } },
            ],
            combinator: 'and',
          },
          options: {},
        },
        id: '88888888-8888-4888-8888-888888888888',
        name: 'Échec confirmé ?',
        type: 'n8n-nodes-base.if',
        typeVersion: 2,
        position: [1540, 200],
      },
      {
        parameters: { method: 'POST', url: `${moon}/printer/print/pause`, options: {} },
        id: '99999999-9999-4999-8999-999999999999',
        name: 'PAUSE impression',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [1760, 120],
      },
      {
        parameters: { method: 'POST', url: `=${moon}/printer/gcode/script?script=M117 ANOMALIE: {{ $json.raison }}`, options: {} },
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'Message imprimante',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [1760, 300],
      },
    ],
    connections: {
      [`Toutes les ${intervalSec}s`]: { main: [[{ node: 'Moonraker état', type: 'main', index: 0 }]] },
      'Moonraker état': { main: [[{ node: 'En impression ?', type: 'main', index: 0 }]] },
      'En impression ?': { main: [[{ node: 'Snapshot webcam', type: 'main', index: 0 }], []] },
      'Snapshot webcam': { main: [[{ node: 'Image → base64', type: 'main', index: 0 }]] },
      'Image → base64': { main: [[{ node: 'GPT-4o Vision', type: 'main', index: 0 }]] },
      'GPT-4o Vision': { main: [[{ node: 'Lecture verdict', type: 'main', index: 0 }]] },
      'Lecture verdict': { main: [[{ node: 'Échec confirmé ?', type: 'main', index: 0 }]] },
      'Échec confirmé ?': { main: [[{ node: 'PAUSE impression', type: 'main', index: 0 }, { node: 'Message imprimante', type: 'main', index: 0 }], []] },
    },
    active: false,
    settings: { executionOrder: 'v1' },
  };
  return JSON.stringify(wf, null, 2);
}

const STEPS = [
  { icon: Eye, label: 'Toutes les N secondes', desc: 'le workflow se réveille' },
  { icon: Camera, label: 'Impression en cours ?', desc: 'sinon il ne fait rien (via Moonraker)' },
  { icon: Bot, label: 'Snapshot → GPT-4o', desc: 'l\'IA cherche spaghettis / décollement' },
  { icon: Pause, label: 'Échec confirmé → PAUSE', desc: 'met l\'impression en pause + message' },
];

export function AnomalyDetection() {
  const { ip } = useMoonrakerConnection();
  const [printerIp, setPrinterIp] = useState(ip);
  const [webcamUrl, setWebcamUrl] = useState(`http://${ip}/webcam/?action=snapshot`);
  const [intervalSec, setIntervalSec] = useState(45);
  const [threshold, setThreshold] = useState(0.7);
  const [copied, setCopied] = useState(false);

  const wf = buildWorkflow({ printerIp, webcamUrl, intervalSec, threshold });

  const copy = async () => {
    await navigator.clipboard.writeText(wf).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  const download = () => {
    const blob = new Blob([wf], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'n8n-detection-anomalie.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const costPerHour = Math.round((3600 / intervalSec) * 0.005 * 100) / 100;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Détection d'anomalie par IA</h2>
        <p className="text-sm text-gray-400">
          Un équivalent maison d'Obico / The Spaghetti Detective : ta webcam + GPT-4o vision,
          orchestrés par ton serveur n8n. Met l'impression en pause si un échec est détecté.
        </p>
      </div>

      {/* Pipeline visuel */}
      <div className="flex flex-wrap items-stretch gap-3">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={i} className="flex-1 min-w-[160px] p-3 rounded-lg border border-gray-800 bg-gray-900/50">
              <div className="flex items-center gap-2 mb-1">
                <Icon size={15} className="text-orange-400" />
                <span className="text-xs font-semibold text-gray-200">{i + 1}. {s.label}</span>
              </div>
              <p className="text-xs text-gray-500">{s.desc}</p>
            </div>
          );
        })}
      </div>

      {/* Réglages */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 space-y-4">
        <h3 className="text-sm font-semibold text-gray-200">Réglages du workflow</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-xs text-gray-400">IP de l'imprimante (Moonraker)</span>
            <input value={printerIp} onChange={e => setPrinterIp(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-200 font-mono" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-400">URL du snapshot webcam</span>
            <input value={webcamUrl} onChange={e => setWebcamUrl(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-200 font-mono" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-400">Cadence : une analyse toutes les {intervalSec}s</span>
            <input type="range" min={20} max={180} step={5} value={intervalSec}
              onChange={e => setIntervalSec(Number(e.target.value))} className="mt-2 w-full accent-orange-500" />
            <span className="text-xs text-gray-500">≈ {costPerHour} $/h en GPT-4o (0,005 $/image)</span>
          </label>
          <label className="block">
            <span className="text-xs text-gray-400">Seuil de confiance : {threshold.toFixed(2)}</span>
            <input type="range" min={0.3} max={0.95} step={0.05} value={threshold}
              onChange={e => setThreshold(Number(e.target.value))} className="mt-2 w-full accent-orange-500" />
            <span className="text-xs text-gray-500">plus haut = moins de fausses alertes, plus de risque de rater</span>
          </label>
        </div>
      </div>

      {/* Boutons */}
      <div className="flex flex-wrap gap-2">
        <button onClick={download}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium transition-all">
          <Download size={15} /> Télécharger le workflow
        </button>
        <button onClick={copy}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-sm text-gray-300 transition-all">
          {copied ? <Check size={15} className="text-green-400" /> : <Copy size={15} />}
          {copied ? 'Copié !' : 'Copier le JSON'}
        </button>
      </div>

      {/* Guide d'installation */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 space-y-3 text-sm text-gray-300">
        <h3 className="font-semibold text-gray-200">Installation dans n8n</h3>
        <ol className="list-decimal list-inside space-y-1.5 text-gray-400">
          <li><strong className="text-gray-300">Copier le JSON</strong> (bouton ci-dessus).</li>
          <li>Dans n8n, ouvrir un <strong className="text-gray-300">nouveau workflow vide</strong>.</li>
          <li>Cliquer sur la <strong className="text-gray-300">toile</strong> et <strong className="text-gray-300">coller</strong> (Ctrl+V) — les nœuds apparaissent.</li>
          <li>Ouvrir le nœud <strong className="text-gray-300">« GPT-4o Vision »</strong> et remplacer <code className="bg-gray-800 px-1 rounded">VOTRE_CLE_OPENAI</code> par ta clé (ou un credential OpenAI).</li>
          <li>Tester l'URL du snapshot dans un navigateur — tu dois voir une image.</li>
          <li>Lancer une impression, cliquer <strong className="text-gray-300">« Test workflow »</strong>, vérifier chaque nœud.</li>
          <li>Une fois OK, <strong className="text-gray-300">activer</strong> le workflow (interrupteur en haut à droite).</li>
        </ol>
      </div>

      {/* Avertissements */}
      <div className="p-4 rounded-lg border border-yellow-900/50 bg-yellow-950/20 flex gap-3">
        <AlertTriangle size={15} className="text-yellow-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-yellow-200 space-y-1">
          <p>L'analyse se fait chez OpenAI : les images de ta webcam partent sur leur serveur. Coût à l'usage (~{costPerHour} $/h ici).</p>
          <p>Vérifie l'URL du snapshot dans <strong>Mainsail → Paramètres → Webcams</strong> si le nœud Snapshot échoue.</p>
        </div>
      </div>

      {/* Bonus notification */}
      <div className="p-4 rounded-lg border border-blue-900/50 bg-blue-950/20 flex gap-3">
        <Bell size={15} className="text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-200">
          <strong>Bonus n8n :</strong> ajoute un nœud Telegram / e-mail / Discord après « PAUSE impression »
          pour recevoir une alerte avec l'image et la raison de l'échec.
        </div>
      </div>
    </div>
  );
}
