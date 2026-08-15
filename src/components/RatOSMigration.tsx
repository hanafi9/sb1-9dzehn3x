import React, { useState, useEffect } from 'react';
import {
  AlertTriangle, CheckCircle2, Copy, ChevronDown, ChevronUp,
  HardDrive, Cpu, Zap, Crosshair, ShieldCheck, Undo2, Download, Info,
} from 'lucide-react';
import type { PrinterConfig } from '../App';

// ─── Données de CETTE machine (vérifiées en session de dépannage) ─────────────

const MACHINE = {
  uuidEbb42: '564fed93e397',
  uuidCarto: '4973681e12df',
  uuidU2c: '6092d36469e1',
  canBitrate: 1000000,
  hostVersion: 'v0.13.0-733',
  octopusVersion: 'v0.12.0-268',
  ebbVersion: 'v0.12.0-208',
  cartoFw: 'CARTOGRAPHER 2.2.0',
};

// ─── Petits composants ────────────────────────────────────────────────────────

function Cmd({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 my-1">
      <code className="flex-1 text-orange-300 font-mono bg-gray-950 border border-gray-800 px-2 py-1.5 rounded text-xs break-all leading-relaxed whitespace-pre-wrap">{cmd}</code>
      <button
        onClick={() => { navigator.clipboard?.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        title="Copier"
        className="flex-shrink-0 text-gray-600 hover:text-gray-200 px-2 py-1.5 rounded border border-gray-800 hover:border-gray-500 transition-colors text-xs">
        {copied ? '✓' : <Copy size={11} />}
      </button>
    </div>
  );
}

function Menuconfig({ lines }: { lines: string[] }) {
  return (
    <div className="bg-gray-950 rounded-lg p-3 border border-gray-800 font-mono text-xs space-y-0.5 my-1">
      {lines.map((l, i) => (
        <div key={i} className={l.startsWith('#') ? 'text-gray-600 italic' : l.startsWith('  ') ? 'text-orange-300' : 'text-gray-400'}>{l}</div>
      ))}
    </div>
  );
}

function Danger({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg border border-red-900/60 bg-red-950/20 my-2">
      <AlertTriangle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
      <div className="text-xs text-red-200 leading-relaxed">{children}</div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg border border-blue-900/60 bg-blue-950/20 my-2">
      <Info size={13} className="text-blue-400 flex-shrink-0 mt-0.5" />
      <div className="text-xs text-blue-200 leading-relaxed">{children}</div>
    </div>
  );
}

// ─── Checklist persistante ────────────────────────────────────────────────────

const LS_KEY = 'ratos-migration-checklist';

function useChecklist() {
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}'); } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(checked)); } catch { /* privé */ }
  }, [checked]);
  const toggle = (id: string) => setChecked(c => ({ ...c, [id]: !c[id] }));
  const reset = () => setChecked({});
  return { checked, toggle, reset };
}

function StepCheck({ id, checked, onToggle, children }: {
  id: string; checked: boolean; onToggle: (id: string) => void; children: React.ReactNode;
}) {
  return (
    <label className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
      checked ? 'border-green-800 bg-green-950/20' : 'border-gray-800 bg-gray-900/40 hover:border-gray-600'
    }`}>
      <input type="checkbox" checked={checked} onChange={() => onToggle(id)}
        className="mt-0.5 accent-green-600 flex-shrink-0" />
      <span className={`text-xs leading-relaxed ${checked ? 'text-gray-500 line-through' : 'text-gray-300'}`}>{children}</span>
    </label>
  );
}

// ─── Phases ───────────────────────────────────────────────────────────────────

interface PhaseDef { id: string; n: number; title: string; icon: React.ElementType; time: string }

const PHASES: PhaseDef[] = [
  { id: 'backup',   n: 1, title: 'Sauvegarde — avant tout',            icon: HardDrive,   time: '~10 min' },
  { id: 'sdcard',   n: 2, title: 'Nouvelle carte SD RatOS 2.1.0',      icon: Download,    time: '~30 min' },
  { id: 'restore',  n: 3, title: 'Premier boot + restauration',        icon: Undo2,       time: '~20 min' },
  { id: 'plugin',   n: 4, title: 'Plugin Cartographer + les 2 patchs', icon: Crosshair,   time: '~10 min' },
  { id: 'octopus',  n: 5, title: 'Flash Octopus Pro 446',              icon: Cpu,         time: '~15 min' },
  { id: 'ebb42',    n: 6, title: 'Flash EBB42 (CAN via Katapult)',     icon: Zap,         time: '~15 min' },
  { id: 'carto',    n: 7, title: 'Cartographer & U2C',                 icon: Crosshair,   time: '~10 min' },
  { id: 'verify',   n: 8, title: 'Vérification finale',                icon: ShieldCheck, time: '~15 min' },
];

// ─── Composant principal ──────────────────────────────────────────────────────

export function RatOSMigration({ config }: { config: PrinterConfig }) {
  const [open, setOpen] = useState<string | null>('backup');
  const { checked, toggle, reset } = useChecklist();

  const doneCount = Object.values(checked).filter(Boolean).length;
  const uuidEbb = config.ebb42Uuid || MACHINE.uuidEbb42;
  const uuidCarto = config.cartographerUuid || MACHINE.uuidCarto;

  const Phase = ({ def, children }: { def: PhaseDef; children: React.ReactNode }) => {
    const isOpen = open === def.id;
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
        <button onClick={() => setOpen(isOpen ? null : def.id)}
          className="w-full flex items-center justify-between p-4 hover:bg-gray-800/30 transition-colors text-left">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-7 h-7 rounded-full bg-orange-700 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">{def.n}</span>
            <def.icon size={14} className="text-orange-400 flex-shrink-0" />
            <span className="text-sm font-semibold text-gray-200 truncate">{def.title}</span>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="hidden sm:inline text-xs text-gray-600">{def.time}</span>
            {isOpen ? <ChevronUp size={15} className="text-gray-500" /> : <ChevronDown size={15} className="text-gray-500" />}
          </div>
        </button>
        {isOpen && <div className="border-t border-gray-800 p-4 space-y-3">{children}</div>}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">Migration RatOS 2.1.0</h2>
          <p className="text-sm text-gray-400">
            RC2 → 2.1.0 par carte SD neuve · retour arrière instantané · flash de tous les MCU
          </p>
        </div>
        {doneCount > 0 && (
          <button onClick={reset}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors">
            Réinitialiser la checklist ({doneCount} cochées)
          </button>
        )}
      </div>

      {/* ── Pourquoi cette méthode ── */}
      <div className="rounded-xl border border-orange-900/50 bg-orange-950/20 p-5">
        <h3 className="text-sm font-bold text-orange-200 mb-3">La règle : jamais de mise à jour en place sur cette machine</h3>
        <div className="grid gap-2 sm:grid-cols-3 text-xs">
          {[
            { t: 'Plugin patché à la main', d: 'Deux correctifs dans cartographer-klipper (casse "PROBE", _mcu_freq). Un git pull les efface — l\'erreur probe revient.' },
            { t: 'Firmwares en retard', d: `Hôte ${MACHINE.hostVersion}, Octopus ${MACHINE.octopusVersion}, EBB42 ${MACHINE.ebbVersion}. Toute mise à jour de Klipper impose de reflasher.` },
            { t: 'Config 100 % manuelle', d: 'printer.cfg sans includes RatOS, dossier RatOS/ désactivé, Configurator HS. L\'updater RatOS suppose une structure qui n\'existe plus ici.' },
          ].map(x => (
            <div key={x.t} className="p-3 rounded-lg border border-orange-900/40 bg-gray-900/40">
              <div className="font-semibold text-orange-300 mb-1">{x.t}</div>
              <div className="text-gray-400 leading-relaxed">{x.d}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-300 mt-3 leading-relaxed">
          La méthode carte SD neuve transforme le risque en aller-retour : l'ancienne carte reste intacte.
          Un problème n'importe où ? Tu remets l'ancienne carte et tu réimprimes dans la minute.
        </p>
      </div>

      {/* ── Identité machine ── */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
        <div className="text-xs font-bold text-gray-300 uppercase tracking-widest mb-3">Références de ta machine — à garder sous les yeux</div>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 text-xs">
          {[
            ['UUID EBB42 → [mcu toolhead]', uuidEbb],
            ['UUID Cartographer → [cartographer]', uuidCarto],
            ['UUID U2C (aucune section !)', MACHINE.uuidU2c],
            ['Bitrate CAN', `${MACHINE.canBitrate}`],
          ].map(([k, v]) => (
            <div key={k} className="p-2.5 rounded-lg border border-gray-800 bg-gray-950">
              <div className="text-gray-600 mb-1">{k}</div>
              <code className="text-orange-300 font-bold">{v}</code>
            </div>
          ))}
        </div>
        <Danger>
          Les UUID de cette machine ont déjà été trouvés <strong>permutés</strong> une fois. Avant tout flash CAN,
          vérifier que <code className="bg-red-900/40 px-1 rounded">{uuidEbb}</code> est bien sous
          <code className="bg-red-900/40 px-1 rounded mx-1">[mcu toolhead]</code> — un flash avec les UUID inversés
          enverrait le firmware EBB42 dans le Cartographer.
        </Danger>
      </div>

      {/* ═══ PHASE 1 — SAUVEGARDE ═══ */}
      <Phase def={PHASES[0]}>
        <p className="text-xs text-gray-400 leading-relaxed">
          Le script <code className="bg-gray-800 px-1 rounded">migration-backup.sh</code> (fourni avec l'app,
          dossier <code className="bg-gray-800 px-1 rounded">machine/</code>) collecte : printer.cfg et toute la config,
          la base Moonraker, les fichiers patchés du plugin, les .config menuconfig, et un manifeste des versions.
          Il ne modifie rien.
        </p>
        <Cmd cmd="bash migration-backup.sh" />
        <Cmd cmd="scp pi@192.168.1.41:~/backup-migration-*.tar.gz ." />
        <div className="space-y-1.5 mt-2">
          <StepCheck id="bk1" checked={!!checked['bk1']} onToggle={toggle}>Script exécuté sans erreur — le manifeste affiche les 2 patchs « présents »</StepCheck>
          <StepCheck id="bk2" checked={!!checked['bk2']} onToggle={toggle}>Archive copiée sur le PC et ouverte pour vérification (elle contient printer.cfg)</StepCheck>
          <StepCheck id="bk3" checked={!!checked['bk3']} onToggle={toggle}>La machine imprime correctement AVANT migration (PROBE_ACCURACY ok, PID refaits sur PT1000)</StepCheck>
        </div>
        <Danger>Ne migre jamais une machine qui ne fonctionne pas : tu ne saurais pas si un problème vient de la migration ou d'avant.</Danger>
      </Phase>

      {/* ═══ PHASE 2 — CARTE SD ═══ */}
      <Phase def={PHASES[1]}>
        <p className="text-xs text-gray-400 leading-relaxed">
          Sur une <strong className="text-gray-200">carte SD différente</strong> (32 Go+, classe A1/A2).
          L'ancienne carte ne sera plus jamais écrite : c'est ton retour arrière.
        </p>
        <div className="text-xs text-gray-400 space-y-1 my-2">
          <p>1. Télécharger l'image <strong className="text-gray-200">RatOS 2.1.0</strong> (pas une RC) :</p>
          <a href="https://github.com/Rat-OS/RatOS/releases" target="_blank" rel="noreferrer"
            className="text-orange-400 hover:text-orange-300 underline inline-block ml-4">github.com/Rat-OS/RatOS/releases ↗</a>
          <p>2. Flasher avec Raspberry Pi Imager. Dans les options (roue dentée) : hostname <code className="bg-gray-800 px-1 rounded">ratos</code>, SSH activé, utilisateur <code className="bg-gray-800 px-1 rounded">pi</code>, ton Wi-Fi.</p>
          <p>3. <strong className="text-gray-200">Imprimante ÉTEINTE</strong>, remplacer la carte, rallumer.</p>
        </div>
        <div className="space-y-1.5 mt-2">
          <StepCheck id="sd1" checked={!!checked['sd1']} onToggle={toggle}>Image 2.1.0 stable téléchargée (vérifier que ce n'est pas une RC)</StepCheck>
          <StepCheck id="sd2" checked={!!checked['sd2']} onToggle={toggle}>Carte flashée avec SSH + Wi-Fi préconfigurés</StepCheck>
          <StepCheck id="sd3" checked={!!checked['sd3']} onToggle={toggle}>Ancienne carte retirée, étiquetée « RC2 — fonctionne », rangée</StepCheck>
        </div>
      </Phase>

      {/* ═══ PHASE 3 — RESTAURATION ═══ */}
      <Phase def={PHASES[2]}>
        <p className="text-xs text-gray-400">Premier boot : laisser 5 bonnes minutes, puis :</p>
        <Cmd cmd="ssh pi@ratos.local   # ou l'IP donnée par ta box" />
        <p className="text-xs text-gray-400 mt-2">Copier l'archive depuis le PC et restaurer la config :</p>
        <Cmd cmd="scp backup-migration-*.tar.gz pi@ratos.local:~/" />
        <Cmd cmd={"mkdir -p ~/restore && tar xzf ~/backup-migration-*.tar.gz -C ~/restore\ncp ~/restore/config/printer.cfg ~/printer_data/config/\ncp ~/restore/config/leds.cfg ~/printer_data/config/ 2>/dev/null || true"} />
        <Note>
          Restaure <strong>printer.cfg et tes fichiers à toi</strong> (leds.cfg…), pas moonraker.conf ni les fichiers
          RatOS de l'ancienne installation : la 2.1.0 fraîche a les siens, corrects. Ton printer.cfg
          fonctionne sans le dossier RatOS/ — il n'a aucun include RatOS.
        </Note>
        <p className="text-xs text-gray-400 mt-1">Vérifier le bus CAN de la nouvelle installation :</p>
        <Cmd cmd="ip -details link show can0" />
        <p className="text-xs text-gray-500">Attendu : UP, bitrate {MACHINE.canBitrate}. Si absent : configurer /etc/systemd/network/can0.network comme sur l'ancienne carte.</p>
        <div className="space-y-1.5 mt-2">
          <StepCheck id="rs1" checked={!!checked['rs1']} onToggle={toggle}>SSH fonctionne sur la nouvelle installation</StepCheck>
          <StepCheck id="rs2" checked={!!checked['rs2']} onToggle={toggle}>printer.cfg + leds.cfg restaurés</StepCheck>
          <StepCheck id="rs3" checked={!!checked['rs3']} onToggle={toggle}>can0 UP à {MACHINE.canBitrate}</StepCheck>
        </div>
      </Phase>

      {/* ═══ PHASE 4 — PLUGIN ═══ */}
      <Phase def={PHASES[3]}>
        <p className="text-xs text-gray-400">Installer le plugin, puis réappliquer <strong className="text-orange-300">immédiatement</strong> les deux patchs — sans eux, Klipper ne démarrera pas :</p>
        <Cmd cmd={"cd ~ && git clone https://github.com/Cartographer3D/cartographer-klipper.git\ncd cartographer-klipper && ./install.sh"} />
        <p className="text-xs text-gray-400 mt-2">Patch 1 — casse de la commande « probe » :</p>
        <Cmd cmd={'sed -i \'s/register_command("probe"/register_command("PROBE"/\' ~/cartographer-klipper/cartographer.py ~/cartographer-klipper/idm.py'} />
        <p className="text-xs text-gray-400 mt-2">Patch 2 — attribut privé _mcu_freq supprimé de Klipper :</p>
        <Cmd cmd={"sed -i \"s/self\\._mcu\\._mcu_freq/self._mcu.get_constant_float('CLOCK_FREQ')/g\" ~/cartographer-klipper/cartographer.py ~/cartographer-klipper/idm.py"} />
        <p className="text-xs text-gray-400 mt-2">Contrôle :</p>
        <Cmd cmd={'grep -c \'register_command("PROBE"\' ~/cartographer-klipper/cartographer.py && grep -c "CLOCK_FREQ" ~/cartographer-klipper/cartographer.py'} />
        <div className="space-y-1.5 mt-2">
          <StepCheck id="pl1" checked={!!checked['pl1']} onToggle={toggle}>Plugin cloné et install.sh passé</StepCheck>
          <StepCheck id="pl2" checked={!!checked['pl2']} onToggle={toggle}>Les 2 patchs appliqués — le grep de contrôle renvoie des comptes non nuls</StepCheck>
        </div>
        <Danger>
          Si le gestionnaire de mise à jour propose un jour « update » sur Cartographer Probe : les patchs sauteront.
          Les réappliquer fait partie de la mise à jour, pas une option.
        </Danger>
      </Phase>

      {/* ═══ PHASE 5 — OCTOPUS ═══ */}
      <Phase def={PHASES[4]}>
        <p className="text-xs text-gray-400 leading-relaxed">
          La 2.1.0 embarque un Klipper plus récent que tes firmwares v0.12 : les <strong className="text-gray-200">trois MCU Klipper</strong> doivent
          être reflashés à la version de l'hôte. On commence par l'Octopus — indépendant du bus CAN.
        </p>
        <Cmd cmd="cd ~/klipper && make menuconfig" />
        <Menuconfig lines={[
          '# Octopus Pro 446 — liaison USB série (PAS de CAN bridge)',
          '  [*] Enable extra low-level configuration options',
          '  Micro-controller: STMicroelectronics STM32',
          '  Processor model: STM32F446',
          '  Bootloader offset: 32KiB bootloader',
          '  Clock Reference: 12 MHz crystal',
          '  Communication interface: USB (on PA11/PA12)',
        ]} />
        <Cmd cmd="make clean && make -j4" />
        <p className="text-xs text-gray-400 mt-2">Flash par carte SD (méthode BTT standard) :</p>
        <div className="text-xs text-gray-400 space-y-1 ml-2">
          <p>1. <code className="bg-gray-800 px-1 rounded">cp ~/klipper/out/klipper.bin /tmp/firmware.bin</code> puis récupérer <code className="bg-gray-800 px-1 rounded">firmware.bin</code> sur une micro-SD (FAT32, ≤ 32 Go) via scp</p>
          <p>2. Imprimante <strong className="text-gray-200">éteinte</strong> → SD dans l'Octopus → rallumer → attendre 30 s</p>
          <p>3. La carte renomme le fichier en <code className="bg-gray-800 px-1 rounded">FIRMWARE.CUR</code> = flash réussi</p>
        </div>
        <p className="text-xs text-gray-400 mt-2">Vérifier :</p>
        <Cmd cmd="ls /dev/serial/by-id/  # l'entrée usb-Klipper_stm32f446xx_* doit être là" />
        <div className="space-y-1.5 mt-2">
          <StepCheck id="oc1" checked={!!checked['oc1']} onToggle={toggle}>menuconfig conforme au tableau (USB, PAS « USB to CAN bus bridge »)</StepCheck>
          <StepCheck id="oc2" checked={!!checked['oc2']} onToggle={toggle}>FIRMWARE.CUR présent sur la SD après boot</StepCheck>
          <StepCheck id="oc3" checked={!!checked['oc3']} onToggle={toggle}>/dev/serial/by-id montre l'Octopus</StepCheck>
        </div>
      </Phase>

      {/* ═══ PHASE 6 — EBB42 ═══ */}
      <Phase def={PHASES[5]}>
        <Danger>
          Vérifier une dernière fois l'UUID cible : <code className="bg-red-900/40 px-1 rounded">{uuidEbb}</code> = EBB42.
          Ne jamais couper l'alimentation pendant le flash.
        </Danger>
        <p className="text-xs text-gray-400">Recompiler Klipper pour l'EBB42 (le .config de l'Octopus est encore chargé — tout reprendre) :</p>
        <Cmd cmd="cd ~/klipper && make menuconfig" />
        <Menuconfig lines={[
          '# EBB42 v1.1 — nœud CAN (JAMAIS « USB to CAN bus bridge »)',
          '  [*] Enable extra low-level configuration options',
          '  Micro-controller: STMicroelectronics STM32',
          '  Processor model: STM32G0B1',
          '  Bootloader offset: 8KiB bootloader',
          '  Clock Reference: 8 MHz crystal',
          '  Communication interface: CAN bus (on PB0/PB1)',
          `  CAN bus speed: ${MACHINE.canBitrate}`,
        ]} />
        <Cmd cmd="make clean && make -j4" />
        <p className="text-xs text-gray-400 mt-2">Flash via Katapult (Klipper doit être arrêté) :</p>
        <Cmd cmd={"sudo systemctl stop klipper\npython3 ~/katapult/scripts/flashtool.py -i can0 -r -u " + uuidEbb + "\npython3 ~/katapult/scripts/flashtool.py -i can0 -q   # doit montrer « Application: Katapult »\npython3 ~/katapult/scripts/flashtool.py -i can0 -f ~/klipper/out/klipper.bin -u " + uuidEbb + "\nsudo systemctl start klipper"} />
        <Note>
          Si le -r ne fait pas apparaître Katapult (l'EBB42 de cette machine n'y a jamais répondu),
          passer par l'USB/DFU : câble USB-C direct EBB42 → Pi, BOOT maintenu + RESET, flasher
          d'abord Katapult (menuconfig : mêmes réglages CAN PB0/PB1, « Support bootloader entry on rapid double click »),
          puis revenir à cette étape. La séquence détaillée est dans l'onglet Diagnostic → Flash Firmware.
        </Note>
        <div className="space-y-1.5 mt-2">
          <StepCheck id="eb1" checked={!!checked['eb1']} onToggle={toggle}>menuconfig : STM32G0B1 · 8KiB · 8 MHz · CAN PB0/PB1 · {MACHINE.canBitrate}</StepCheck>
          <StepCheck id="eb2" checked={!!checked['eb2']} onToggle={toggle}>« CAN Flash Success » affiché</StepCheck>
          <StepCheck id="eb3" checked={!!checked['eb3']} onToggle={toggle}>canbus_query voit l'UUID {uuidEbb} en « Application: Klipper »</StepCheck>
        </div>
      </Phase>

      {/* ═══ PHASE 7 — CARTO & U2C ═══ */}
      <Phase def={PHASES[6]}>
        <p className="text-xs text-gray-400 leading-relaxed">
          <strong className="text-gray-200">Cartographer</strong> : firmware propriétaire ({MACHINE.cartoFw} actuellement),
          pas un firmware Klipper. Il ne se recompile pas avec make — il se télécharge.
          Ne le flasher <strong className="text-orange-300">que si</strong> le plugin le réclame au démarrage
          (message de version incompatible) : s'il fonctionne, on n'y touche pas.
        </p>
        <a href="https://github.com/Cartographer3D/cartographer-klipper/releases" target="_blank" rel="noreferrer"
          className="text-orange-400 hover:text-orange-300 underline text-xs inline-block">
          Releases firmware Cartographer ↗
        </a>
        <p className="text-xs text-gray-400 mt-1">Le cas échéant, flash par Katapult avec l'UUID <code className="text-orange-300">{uuidCarto}</code> :</p>
        <Cmd cmd={"sudo systemctl stop klipper\npython3 ~/katapult/scripts/flashtool.py -i can0 -r -u " + uuidCarto + "\npython3 ~/katapult/scripts/flashtool.py -i can0 -f ~/cartographer-firmware.bin -u " + uuidCarto + "\nsudo systemctl start klipper"} />
        <p className="text-xs text-gray-400 mt-3 leading-relaxed">
          <strong className="text-gray-200">U2C v2.1</strong> : rien à faire. Sans section <code className="bg-gray-800 px-1 rounded">[mcu u2c]</code>,
          Klipper ne lui parle jamais le protocole MCU — seul le noyau Linux l'utilise via gs_usb, insensible aux versions
          de Klipper. Le reflasher serait du risque sans bénéfice.
        </p>
        <div className="space-y-1.5 mt-2">
          <StepCheck id="ca1" checked={!!checked['ca1']} onToggle={toggle}>Cartographer : laissé tel quel, OU reflashé parce que le plugin l'exigeait</StepCheck>
          <StepCheck id="ca2" checked={!!checked['ca2']} onToggle={toggle}>U2C : rien touché, aucune section [mcu u2c] dans printer.cfg</StepCheck>
        </div>
      </Phase>

      {/* ═══ PHASE 8 — VÉRIFICATION ═══ */}
      <Phase def={PHASES[7]}>
        <p className="text-xs text-gray-400">
          Le script <code className="bg-gray-800 px-1 rounded">migration-verify.sh</code> contrôle tout d'un coup :
          can0, services, UUID dans les bonnes sections (il détecte la permutation !), absence de [mcu u2c],
          PT1000, patchs du plugin, versions MCU vs hôte. Lecture seule.
        </p>
        <Cmd cmd="bash migration-verify.sh" />
        <p className="text-xs text-gray-400 mt-2">S'il affiche « Contrôles passés », dérouler dans l'ordre :</p>
        <Cmd cmd={"QUERY_ENDSTOPS\nG28\nPROBE_ACCURACY SAMPLES=10\nPID_CALIBRATE HEATER=extruder TARGET=230\nSAVE_CONFIG"} />
        <div className="space-y-1.5 mt-2">
          <StepCheck id="vf1" checked={!!checked['vf1']} onToggle={toggle}>migration-verify.sh : 0 échec</StepCheck>
          <StepCheck id="vf2" checked={!!checked['vf2']} onToggle={toggle}>Versions MCU alignées sur l'hôte dans Charge Système (plus de « should be updated »)</StepCheck>
          <StepCheck id="vf3" checked={!!checked['vf3']} onToggle={toggle}>PROBE_ACCURACY : range &lt; 0.010, σ &lt; 0.005</StepCheck>
          <StepCheck id="vf4" checked={!!checked['vf4']} onToggle={toggle}>Première impression réussie → étiqueter la nouvelle carte « 2.1.0 — validée »</StepCheck>
        </div>
      </Phase>

      {/* ── Retour arrière ── */}
      <div className="rounded-xl border border-green-900/50 bg-green-950/20 p-5">
        <div className="flex items-start gap-3">
          <Undo2 size={16} className="text-green-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-green-200 mb-2">Retour arrière — à tout moment, quelle que soit la phase</h3>
            <p className="text-xs text-gray-300 leading-relaxed">
              Éteindre l'imprimante → remettre l'ancienne carte SD « RC2 — fonctionne » → rallumer.
              Tu retrouves exactement l'état d'avant, patchs compris.{' '}
              <strong className="text-green-300">Une seule exception</strong> : si tu as déjà flashé des MCU (phases 5-6),
              leurs firmwares sont plus récents que le Klipper de l'ancienne carte — il faudra les reflasher en v0.12
              depuis l'ancienne installation (mêmes procédures, exécutées depuis l'ancien ~/klipper). C'est pour ça que
              la <strong className="text-green-300">phase 8 se valide avant de célébrer</strong>, pas après.
            </p>
          </div>
        </div>
      </div>

      {/* ── Rappel post-migration ── */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
        <div className="flex items-start gap-2">
          <CheckCircle2 size={14} className="text-gray-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-gray-500 leading-relaxed">
            Après validation : refaire une sauvegarde avec <code className="bg-gray-800 px-1 rounded">migration-backup.sh</code> —
            elle capturera le nouvel état sain. Et garder l'ancienne carte RC2 intacte au moins un mois,
            le temps que la 2.1.0 fasse ses preuves sur plusieurs impressions.
          </p>
        </div>
      </div>
    </div>
  );
}
